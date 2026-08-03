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
