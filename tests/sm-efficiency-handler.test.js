const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// O handler abre uma ligação Postgres no arranque. Substituímos o 'pg' por um
// duplo que regista as consultas, para se poder exercitar a autenticação e a
// validação sem base de dados nenhuma.
const consultas = [];
let respostas = [];

const originalLoad = Module._load;
Module._load = function (pedido, pai, isMain) {
  if (pedido === 'pg') {
    return {
      Pool: class {
        query(texto, valores) {
          consultas.push({ texto, valores });
          return Promise.resolve({ rows: respostas.shift() || [] });
        }
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

process.env.EGAGENDA_API_KEY = 'chave-de-teste';
const { handler } = require('../netlify/functions/sm-efficiency.js');
Module._load = originalLoad;

function pedido({ chave = 'chave-de-teste', de = '2026-08-01', ate = '2026-08-31', metodo = 'GET' } = {}) {
  return {
    httpMethod: metodo,
    headers: chave === null ? {} : { 'x-api-key': chave },
    queryStringParameters: { date_from: de, date_to: ate },
  };
}

test('sem chave não passa', async () => {
  const r = await handler(pedido({ chave: null }));
  assert.equal(r.statusCode, 403);
});

test('com chave errada não passa', async () => {
  const r = await handler(pedido({ chave: 'outra-chave-qq' }));
  assert.equal(r.statusCode, 403);
});

test('uma chave de comprimento diferente não rebenta a comparação', async () => {
  // timingSafeEqual atira se os buffers tiverem tamanhos diferentes.
  const r = await handler(pedido({ chave: 'x' }));
  assert.equal(r.statusCode, 403);
});

test('datas em falta ou mal formadas são recusadas', async () => {
  // Construído à mão: o ajudante acima tem valores por omissão que tapariam
  // justamente o caso da data ausente.
  const casos = [
    {},
    { date_to: '2026-08-31' },
    { date_from: '2026-08-01' },
    { date_from: '01/08/2026', date_to: '2026-08-31' },
    { date_from: '2026-8-1', date_to: '2026-08-31' },
    { date_from: '2026-08-01', date_to: 'ontem' },
  ];
  for (const queryStringParameters of casos) {
    const r = await handler({
      httpMethod: 'GET',
      headers: { 'x-api-key': 'chave-de-teste' },
      queryStringParameters,
    });
    assert.equal(r.statusCode, 400, JSON.stringify(queryStringParameters));
  }
});

test('sem parâmetros nenhuns não rebenta', async () => {
  const r = await handler({ httpMethod: 'GET', headers: { 'x-api-key': 'chave-de-teste' } });
  assert.equal(r.statusCode, 400);
});

test('período ao contrário é recusado', async () => {
  const r = await handler(pedido({ de: '2026-08-31', ate: '2026-08-01' }));
  assert.equal(r.statusCode, 400);
});

test('sem SMs configurados devolve lista vazia, não erro', async () => {
  respostas = [[]]; // portais
  const r = await handler(pedido());
  assert.equal(r.statusCode, 200);
  const corpo = JSON.parse(r.body);
  assert.deepEqual(corpo.sms, []);
});

test('devolve um SM com os seus números e o mapeamento resolvido', async () => {
  respostas = [
    [{ id: 1, name: 'Braga SM', portal_type: 'sm', powering_loja_id: 12, vehicle_plate: '00-AA-00' }],
    [{ portal_id: 1, agendados: 79, realizados: 67, nao_realizados: 10, km: 2474, minutos_estrada: 961 }],
    [{ portal_id: 1, dias_registados: 21, horas: 157.5 }],
    [{ portal_id: 1, motivo: 'Cliente ausente', total: 6 }],
    [{ portal_id: 1, comercial: 'ana', agendados: 20, realizados: 18 }],
  ];
  const r = await handler(pedido());
  assert.equal(r.statusCode, 200);
  const [sm] = JSON.parse(r.body).sms;
  assert.equal(sm.nome, 'Braga SM');
  assert.equal(sm.poweringLojaId, 12);
  assert.equal(sm.realizados, 67);
  assert.ok(Math.abs(sm.taxaRealizacao - 67 / 79) < 1e-9);
  assert.equal(sm.motivosNaoRealizacao[0].motivo, 'Cliente ausente');
  assert.equal(sm.porComercial[0].comercial, 'ana');
});

test('só vai buscar portais do tipo sm', async () => {
  consultas.length = 0;
  respostas = [[]];
  await handler(pedido());
  assert.deepEqual(consultas[0].valores, [['sm']]);
});

test('o período devolvido é o efectivo, nunca para lá de hoje', async () => {
  consultas.length = 0;
  respostas = [[]];
  const hoje = new Date().toISOString().slice(0, 10);
  const r = await handler(pedido({ de: '2000-01-01', ate: '2999-12-31' }));
  const corpo = JSON.parse(r.body);
  assert.equal(corpo.periodo.ate, hoje, 'quem consome tem de saber que período é que estes números cobrem');
});

test('só responde a GET', async () => {
  const r = await handler(pedido({ metodo: 'POST' }));
  assert.equal(r.statusCode, 405);
});

test('OPTIONS responde para o CORS', async () => {
  const r = await handler({ httpMethod: 'OPTIONS', headers: {}, queryStringParameters: {} });
  assert.equal(r.statusCode, 200);
});
