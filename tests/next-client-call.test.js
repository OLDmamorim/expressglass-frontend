const test = require('node:test');
const assert = require('node:assert/strict');

const nextClientCall = require('../next-client-call.js');

function appt(id, overrides = {}) {
  return {
    id,
    date: '2026-08-02',
    sortIndex: 1,
    phone: '912 345 678',
    ...overrides
  };
}

test('serviço móvel respeita primeiro, segundo e ordem da rota', () => {
  const services = [
    appt('route-3', { sortIndex: 3 }),
    appt('second', { second_of_day: true, sortIndex: 9 }),
    appt('first', { first_of_day: true, sortIndex: 8 }),
    appt('route-2', { sortIndex: 2 })
  ];
  const context = nextClientCall.buildContext(services[2], services, { isStore: false });

  assert.equal(nextClientCall.findNext(context, services).id, 'second');
});

test('loja passa da manhã para a tarde apenas depois dos serviços da manhã', () => {
  const services = [
    appt('tarde-1', { period: 'Tarde', sortIndex: 1 }),
    appt('manha-2', { period: 'Manhã', sortIndex: 2 }),
    appt('manha-1', { period: 'Manhã', sortIndex: 1 })
  ];
  const context = nextClientCall.buildContext(services[2], services, { isStore: true });

  assert.equal(nextClientCall.findNext(context, services).id, 'manha-2');
  const secondContext = nextClientCall.buildContext(services[1], services, { isStore: true });
  assert.equal(nextClientCall.findNext(secondContext, services).id, 'tarde-1');
});

test('usa a ordem exata que está renderizada no telemóvel', () => {
  const services = [appt('a', { sortIndex: 1 }), appt('b', { sortIndex: 2 }), appt('c', { sortIndex: 3 })];
  const context = nextClientCall.buildContext(services[2], services, {
    isStore: false,
    renderedIds: ['c', 'a', 'b']
  });

  assert.equal(nextClientCall.findNext(context, services).id, 'a');
});

test('ignora serviços seguintes que já estejam tratados', () => {
  const services = [
    appt('current', { sortIndex: 1 }),
    appt('done', { sortIndex: 2, executed: true }),
    appt('not-done', { sortIndex: 3, executed: false, not_done_reason: 'Vidro errado' }),
    appt('removed', { sortIndex: 4, glass_removed: true }),
    appt('pending', { sortIndex: 5 })
  ];
  const context = nextClientCall.buildContext(services[0], services, { isStore: false });

  assert.equal(nextClientCall.findNext(context, services).id, 'pending');
});

test('no último serviço do dia não devolve qualquer chamada', () => {
  const services = [appt('first', { sortIndex: 1 }), appt('last', { sortIndex: 2 })];
  const context = nextClientCall.buildContext(services[1], services, { isStore: false });

  assert.equal(nextClientCall.getCallTarget(context, services), null);
});

test('não salta um serviço sem contacto para ligar a um cliente posterior', () => {
  const services = [
    appt('current', { sortIndex: 1 }),
    appt('next-without-phone', { sortIndex: 2, phone: '' }),
    appt('later-with-phone', { sortIndex: 3 })
  ];
  const context = nextClientCall.buildContext(services[0], services, { isStore: false });

  assert.equal(nextClientCall.getCallTarget(context, services), null);
});

test('normaliza contactos nacionais e internacionais para tel:', () => {
  assert.equal(nextClientCall.normalizePhone('912 345 678'), '912345678');
  assert.equal(nextClientCall.normalizePhone('+351 912 345 678'), '+351912345678');
  assert.equal(nextClientCall.normalizePhone('912 345 678 / 913 456 789'), '912345678');
  assert.equal(nextClientCall.normalizePhone('1234'), '');
});

test('a sugestão de chamada é de quem anda na estrada', () => {
  // Serviço móvel, de ligeiros e de pesados: há sempre um cliente seguinte.
  assert.equal(nextClientCall.podeSugerirChamada('sm'), true);
  assert.equal(nextClientCall.podeSugerirChamada('SM'), true);
  assert.equal(nextClientCall.podeSugerirChamada('pesados'), true);
  // Na loja o cliente vem ter com o técnico: a pergunta não tem destinatário.
  assert.equal(nextClientCall.podeSugerirChamada('loja'), false);
  assert.equal(nextClientCall.podeSugerirChamada('mycar'), false);
  assert.equal(nextClientCall.podeSugerirChamada('recalibra'), false);
});

test('sem tipo definido vale sm, como em applyPortalConfig', () => {
  // Um portal SM cujo registo não tem portal_type continua a receber a
  // sugestão — é esse o valor por omissão que a aplicação usa.
  assert.equal(nextClientCall.podeSugerirChamada(undefined), true);
  assert.equal(nextClientCall.podeSugerirChamada(''), true);
  assert.equal(nextClientCall.podeSugerirChamada(null), true);
});

test('num portal de loja não se chega sequer a capturar contexto', () => {
  // Guarda ponta-a-ponta: é capture() que os dois sítios que marcam o serviço
  // chamam, por isso é aqui que a caixa tem de deixar de nascer.
  const portalAnterior = globalThis.portalConfig;
  const agendaAnterior = globalThis.appointments;
  const servicos = [appt('atual'), appt('seguinte', { sortIndex: 2 })];
  globalThis.appointments = servicos;
  try {
    globalThis.portalConfig = { portalType: 'loja' };
    assert.equal(nextClientCall.capture(servicos[0]), null);
    assert.equal(nextClientCall.offer({ currentId: 'atual', date: '2026-08-02', orderedIds: ['atual', 'seguinte'], snapshots: servicos }), false);

    globalThis.portalConfig = { portalType: 'sm' };
    assert.notEqual(nextClientCall.capture(servicos[0]), null);
  } finally {
    globalThis.portalConfig = portalAnterior;
    globalThis.appointments = agendaAnterior;
  }
});
