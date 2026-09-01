const test = require('node:test');
const assert = require('node:assert/strict');

const { limitarAoPassado, racio, indicadores, juntarPorPortal } = require('../netlify/lib/sm-efficiency.js');

test('o período nunca conta dias que ainda não chegaram', () => {
  // Pedir agosto inteiro a 20 de agosto: os dias 21-31 não são falhas do SM.
  assert.equal(limitarAoPassado('2026-08-31', '2026-08-20'), '2026-08-20');
});

test('um período já fechado fica como está', () => {
  assert.equal(limitarAoPassado('2026-07-31', '2026-08-20'), '2026-07-31');
});

test('o último dia do próprio dia de hoje conta', () => {
  assert.equal(limitarAoPassado('2026-08-20', '2026-08-20'), '2026-08-20');
});

test('aceita um timestamp completo como "hoje"', () => {
  assert.equal(limitarAoPassado('2026-08-31', '2026-08-20T18:45:00.000Z'), '2026-08-20');
});

test('sem denominador não há rácio, e zero não é resposta', () => {
  // 0% de realização num período sem nada agendado acusaria alguém sem razão.
  assert.equal(racio(0, 0), null);
  assert.equal(racio(5, 0), null);
  assert.equal(racio(0, 5), 0);
  assert.equal(racio(3, 4), 0.75);
});

test('rácios com valores em falta não rebentam', () => {
  assert.equal(racio(undefined, undefined), null);
  assert.equal(racio(null, 'abc'), null);
});

test('indicadores derivam do que veio da base de dados', () => {
  const i = indicadores({
    agendados: 79, realizados: 67, naoRealizados: 10,
    km: 2474, horas: 157.5, diasRegistados: 21, minutosEstrada: 961,
  });
  assert.equal(i.agendados, 79);
  assert.equal(i.realizados, 67);
  assert.ok(Math.abs(i.taxaRealizacao - 67 / 79) < 1e-9);
  assert.ok(Math.abs(i.servicosPorDia - 67 / 21) < 1e-9);
  assert.ok(Math.abs(i.horasPorDia - 7.5) < 1e-9);
  assert.ok(Math.abs(i.servicosPorHora - 67 / 157.5) < 1e-9);
  assert.ok(Math.abs(i.kmPorServico - 2474 / 67) < 1e-9);
});

test('um SM sem dias registados não inventa médias', () => {
  const i = indicadores({ agendados: 4, realizados: 0, diasRegistados: 0, horas: 0 });
  assert.equal(i.servicosPorDia, null);
  assert.equal(i.horasPorDia, null);
  assert.equal(i.servicosPorHora, null);
  assert.equal(i.taxaRealizacao, 0); // agendou 4, fez 0 — isto é mesmo zero
});

test('um SM parado aparece na mesma, a zeros', () => {
  // É precisamente o SM sem actividade que interessa ver no relatório.
  const linhas = juntarPorPortal(
    [{ id: 7, name: 'Braga SM', portal_type: 'sm', powering_loja_id: 12, vehicle_plate: '00-AA-00' }],
    [], [], [], []
  );
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].nome, 'Braga SM');
  assert.equal(linhas[0].agendados, 0);
  assert.equal(linhas[0].taxaRealizacao, null);
  assert.deepEqual(linhas[0].motivosNaoRealizacao, []);
});

test('cada SM recebe só os seus números', () => {
  const linhas = juntarPorPortal(
    [
      { id: 1, name: 'Braga SM', portal_type: 'sm', powering_loja_id: 10 },
      { id: 2, name: 'Porto SM', portal_type: 'sm', powering_loja_id: 20 },
    ],
    [
      { portal_id: 2, agendados: 50, realizados: 40, nao_realizados: 10, km: 900 },
      { portal_id: 1, agendados: 79, realizados: 67, nao_realizados: 10, km: 2474 },
    ],
    [{ portal_id: 1, horas: 157.5, dias_registados: 21 }],
    [
      { portal_id: 1, motivo: 'Cliente ausente', total: 6 },
      { portal_id: 2, motivo: 'Vidro em falta', total: 3 },
    ],
    [{ portal_id: 1, comercial: 'Ana', agendados: 20, realizados: 18 }]
  );

  const braga = linhas.find(l => l.portalId === 1);
  const porto = linhas.find(l => l.portalId === 2);
  assert.equal(braga.agendados, 79);
  assert.equal(porto.agendados, 50);
  assert.equal(braga.diasRegistados, 21);
  assert.equal(porto.diasRegistados, 0);
  assert.deepEqual(braga.motivosNaoRealizacao.map(m => m.motivo), ['Cliente ausente']);
  assert.deepEqual(porto.motivosNaoRealizacao.map(m => m.motivo), ['Vidro em falta']);
  assert.equal(braga.porComercial.length, 1);
  assert.equal(porto.porComercial.length, 0);
});

test('motivos e comerciais vêm do maior para o menor', () => {
  const [linha] = juntarPorPortal(
    [{ id: 1, name: 'Braga SM', portal_type: 'sm', powering_loja_id: 10 }],
    [], [],
    [
      { portal_id: 1, motivo: 'Vidro em falta', total: 2 },
      { portal_id: 1, motivo: 'Cliente ausente', total: 9 },
      { portal_id: 1, motivo: 'Chuva', total: 5 },
    ],
    [
      { portal_id: 1, comercial: 'Bruno', agendados: 5, realizados: 5 },
      { portal_id: 1, comercial: 'Ana', agendados: 30, realizados: 20 },
    ]
  );
  assert.deepEqual(linha.motivosNaoRealizacao.map(m => m.total), [9, 5, 2]);
  assert.deepEqual(linha.porComercial.map(c => c.comercial), ['Ana', 'Bruno']);
  assert.ok(Math.abs(linha.porComercial[0].taxaRealizacao - 20 / 30) < 1e-9);
});

test('comercial em branco fica nomeado, não vazio', () => {
  // O motivo em branco tem tratamento próprio — ver o teste do semJustificacao.
  const [linha] = juntarPorPortal(
    [{ id: 1, name: 'Braga SM', portal_type: 'sm', powering_loja_id: 10 }],
    [], [], [],
    [{ portal_id: 1, comercial: null, agendados: 2, realizados: 1 }]
  );
  assert.equal(linha.porComercial[0].comercial, 'Sem comercial');
});

test('um SM sem powering_loja_id vem com null, não com lixo', () => {
  // Sem mapeamento, o PoweringEG não tem onde pousar estes números — tem de
  // dar para ver que falta configurar, em vez de irem parar à loja errada.
  const [linha] = juntarPorPortal(
    [{ id: 9, name: 'SM novo', portal_type: 'sm', powering_loja_id: null }],
    [], [], [], []
  );
  assert.equal(linha.poweringLojaId, null);
});

test('o powering_loja_id sai como número mesmo vindo como texto', () => {
  const [linha] = juntarPorPortal(
    [{ id: 9, name: 'SM', portal_type: 'sm', powering_loja_id: '42' }],
    [], [], [], []
  );
  assert.equal(linha.poweringLojaId, 42);
});

test('aguenta listas em falta sem rebentar', () => {
  assert.deepEqual(juntarPorPortal(undefined, undefined, undefined, undefined, undefined), []);
  assert.equal(juntarPorPortal([{ id: 1, name: 'X', portal_type: 'sm' }]).length, 1);
});

test('"sem motivo" não é um motivo — conta à parte', () => {
  // Aparecia "Sem motivo" no topo de todos os SMs e a coluna deixava de dizer
  // nada. O que ali está é falha de preenchimento, não uma causa.
  const [linha] = juntarPorPortal(
    [{ id: 1, name: 'Braga SM', portal_type: 'sm', powering_loja_id: 10 }],
    [], [],
    [
      { portal_id: 1, motivo: null, total: 8 },
      { portal_id: 1, motivo: 'Cliente ausente', total: 3 },
      { portal_id: 1, motivo: '   ', total: 2 },
    ],
    [], [], []
  );
  assert.deepEqual(linha.motivosNaoRealizacao, [{ motivo: 'Cliente ausente', total: 3 }]);
  assert.equal(linha.semJustificacao, 10, 'os nulos e os brancos somam-se');
});

test('sem nenhum motivo registado, a lista fica vazia e o contador conta', () => {
  const [linha] = juntarPorPortal(
    [{ id: 1, name: 'SM', portal_type: 'sm', powering_loja_id: 10 }],
    [], [], [{ portal_id: 1, motivo: null, total: 4 }], [], [], []
  );
  assert.deepEqual(linha.motivosNaoRealizacao, []);
  assert.equal(linha.semJustificacao, 4);
});

test('localidades vêm da mais movimentada para a menos', () => {
  const [linha] = juntarPorPortal(
    [{ id: 1, name: 'SM', portal_type: 'sm', powering_loja_id: 10 }],
    [], [], [], [],
    [
      { portal_id: 1, localidade: 'Braga', agendados: 9, realizados: 8, km: 92 },
      { portal_id: 1, localidade: 'Póvoa de Lanhoso', agendados: 13, realizados: 11, km: 516 },
    ],
    []
  );
  assert.deepEqual(linha.porLocalidade.map(l => l.localidade), ['Póvoa de Lanhoso', 'Braga']);
  assert.ok(Math.abs(linha.porLocalidade[0].taxaRealizacao - 11 / 13) < 1e-9);
});

test('os dias saem por ordem cronológica, com o rácio de cada um', () => {
  const [linha] = juntarPorPortal(
    [{ id: 1, name: 'SM', portal_type: 'sm', powering_loja_id: 10 }],
    [], [], [], [], [],
    [
      { portal_id: 1, data: '2026-08-05', checkin_at: '09:18', checkout_at: '17:38', horas: 7.33, realizados: 5, km: 141 },
      { portal_id: 1, data: '2026-08-03', checkin_at: '09:12', checkout_at: '16:45', horas: 6.55, realizados: 1, km: 36 },
    ]
  );
  assert.deepEqual(linha.dias.map(d => d.data), ['2026-08-03', '2026-08-05']);
  assert.ok(Math.abs(linha.dias[0].servicosPorHora - 1 / 6.55) < 1e-9);
});

test('um dia sem horas não inventa serviços por hora', () => {
  // Check-in sem check-out: as horas ficam a zero e o rácio não existe.
  const [linha] = juntarPorPortal(
    [{ id: 1, name: 'SM', portal_type: 'sm', powering_loja_id: 10 }],
    [], [], [], [], [],
    [{ portal_id: 1, data: '2026-08-03', checkin_at: '09:12', checkout_at: null, horas: null, realizados: 2, km: 0 }]
  );
  assert.equal(linha.dias[0].horas, 0);
  assert.equal(linha.dias[0].servicosPorHora, null);
  assert.equal(linha.dias[0].saida, null);
});

test('sem detalhe nenhum, as listas ficam vazias em vez de undefined', () => {
  const [linha] = juntarPorPortal(
    [{ id: 1, name: 'SM', portal_type: 'sm', powering_loja_id: 10 }], [], [], [], []
  );
  assert.deepEqual(linha.porLocalidade, []);
  assert.deepEqual(linha.dias, []);
  assert.equal(linha.semJustificacao, 0);
});
