const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const jwt = require('jsonwebtoken');

// O handler abre uma ligação Postgres no arranque. Substituímos o 'pg' por um
// duplo que regista as consultas e devolve respostas preparadas, para se poder
// exercitar a decisão "juntar ao existente ou criar novo" sem base de dados.
const consultas = [];
let respostas = [];

const originalLoad = Module._load;
Module._load = function (pedido) {
  if (pedido === 'pg') {
    return {
      Pool: class {
        query(texto, valores) {
          consultas.push({ texto, valores });
          // Migrações e UPDATEs: devolver vazio; as pesquisas consomem a fila
          if (/^\s*(ALTER|UPDATE|INSERT)/i.test(texto)) {
            return Promise.resolve({ rows: /INSERT/i.test(texto) ? [{ id: 99 }] : [] });
          }
          return Promise.resolve({ rows: respostas.shift() || [] });
        }
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

process.env.JWT_SECRET = 'segredo-de-teste';
const { handler } = require('../netlify/functions/import-services.js');
Module._load = originalLoad;

const token = jwt.sign({ role: 'admin', userId: 1 }, 'segredo-de-teste');

function pedido(servico) {
  return handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ services: [servico] })
  });
}

function reset() {
  consultas.length = 0;
  respostas = [];
}

const BASE = { portal_id: 1, plate: 'AA-00-BB', car: 'MERCEDES', service: 'PB', status: 'NE' };
const pesquisas = () => consultas.filter(c => /^\s*SELECT id, date, period, car/i.test(c.texto));
const criou = r => JSON.parse(r.body).data.created === 1;

test('matrícula já realizada não é reaproveitada: o serviço novo é criado à parte', async () => {
  reset();
  // A pesquisa por matrícula não devolve nada, porque exclui os realizados
  respostas = [[]];
  const r = await pedido({ ...BASE });

  const q = pesquisas()[0].texto;
  assert.match(q, /executed IS NOT TRUE/,
    'o fallback por matrícula tem de excluir os serviços já realizados');
  assert.ok(criou(r), 'deve criar um serviço novo em vez de reescrever o antigo');
});

test('matrícula ainda por realizar continua a ser actualizada, não duplicada', async () => {
  reset();
  respostas = [[{ id: 7, date: null, period: null, car: null, phone: null,
                  extra: null, notes: null, auto_imported: true, confirmed: false,
                  status: 'NE', order_ref: null, reception_ref: null }]];
  const r = await pedido({ ...BASE });

  const corpo = JSON.parse(r.body);
  assert.equal(corpo.data.created, 0, 'não deve criar');
  assert.ok(corpo.data.updated + corpo.data.skipped >= 1, 'deve tratar o existente');
});

test('com n.º de obra, a pesquisa por obra abrange os realizados — reimportar não duplica', async () => {
  reset();
  respostas = [[{ id: 7, date: '2026-10-01', period: 'Manhã', car: 'MERCEDES', phone: null,
                  extra: null, notes: null, auto_imported: true, confirmed: true,
                  status: 'ST', order_ref: null, reception_ref: null }]];
  const r = await pedido({ ...BASE, n_obra: 'FS1234' });

  const q = pesquisas()[0].texto;
  assert.match(q, /n_obra = \$2/, 'a primeira pesquisa é pela obra');
  assert.doesNotMatch(q, /executed IS NOT TRUE/,
    'a mesma obra é o mesmo trabalho, mesmo já realizado — senão reimportar duplicava');
  assert.ok(!criou(r), 'não deve criar: é a mesma obra');
});

test('obra nova na mesma matrícula não adopta um registo com obra diferente', async () => {
  reset();
  // 1.ª pesquisa (por obra) não encontra; 2.ª (por matrícula) também não,
  // porque exclui registos que já tenham obra própria
  respostas = [[], []];
  const r = await pedido({ ...BASE, n_obra: 'FS9999' });

  const q = pesquisas()[1].texto;
  assert.match(q, /executed IS NOT TRUE/);
  assert.match(q, /n_obra IS NULL/,
    'obra diferente é trabalho diferente — não se escreve por cima');
  assert.ok(criou(r), 'deve criar um serviço novo');
});
