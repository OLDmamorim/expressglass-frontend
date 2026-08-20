const test = require('node:test');
const assert = require('node:assert/strict');

const { resumoAgendamentos, interfaceOcupada, CAMPOS_VISIVEIS } = require('../appointments-sync.js');

function appt(id, overrides = {}) {
  return {
    id,
    date: '2026-08-19',
    period: 'manha',
    plate: '00-92-XF',
    executed: null,
    ...overrides
  };
}

test('a mesma agenda dá o mesmo resumo', () => {
  const antes = resumoAgendamentos([appt(1), appt(2)]);
  const depois = resumoAgendamentos([appt(1), appt(2)]);
  assert.equal(antes, depois);
});

test('marcar realizado muda o resumo', () => {
  // O caso que motivou isto: o coordenador marca ✓ e o quadro tem de reagir.
  const antes = resumoAgendamentos([appt(1), appt(2)]);
  const depois = resumoAgendamentos([appt(1, { executed: true }), appt(2)]);
  assert.notEqual(antes, depois);
});

test('não realizado com motivo também muda', () => {
  const antes = resumoAgendamentos([appt(1)]);
  const depois = resumoAgendamentos([appt(1, { executed: false, not_done_reason: 'Cliente ausente' })]);
  assert.notEqual(antes, depois);
});

test('vidro retirado muda', () => {
  const antes = resumoAgendamentos([appt(1)]);
  const depois = resumoAgendamentos([appt(1, { glass_removed: true, glass_removed_date: '2026-08-19' })]);
  assert.notEqual(antes, depois);
});

test('um serviço novo muda, e um serviço apagado também', () => {
  const base = resumoAgendamentos([appt(1)]);
  assert.notEqual(base, resumoAgendamentos([appt(1), appt(2)]));
  assert.notEqual(base, resumoAgendamentos([]));
});

test('a ordem em que a API devolve os serviços não conta', () => {
  const a = resumoAgendamentos([appt(1), appt(2), appt(3)]);
  const b = resumoAgendamentos([appt(3), appt(1), appt(2)]);
  assert.equal(a, b);
});

test('campos que não se vêem não provocam redesenho', () => {
  // updated_at muda a cada gravação de qualquer pessoa; se contasse, o quadro
  // saltava de 45 em 45 segundos sem nada ter mudado à vista.
  const antes = resumoAgendamentos([appt(1, { updated_at: '2026-08-19T10:00:00Z' })]);
  const depois = resumoAgendamentos([appt(1, { updated_at: '2026-08-19T11:30:00Z' })]);
  assert.equal(antes, depois);
});

test('distingue vazio de zero e de falso', () => {
  const nulo = resumoAgendamentos([appt(1, { executed: null })]);
  const falso = resumoAgendamentos([appt(1, { executed: false })]);
  const verdadeiro = resumoAgendamentos([appt(1, { executed: true })]);
  assert.notEqual(nulo, falso);
  assert.notEqual(falso, verdadeiro);
});

test('sortIndex aceita o nome que vier da base de dados', () => {
  assert.equal(
    resumoAgendamentos([appt(1, { sortIndex: 3 })]),
    resumoAgendamentos([appt(1, { sortindex: 3 })])
  );
});

test('aguenta lista vazia e registos nulos sem rebentar', () => {
  assert.equal(resumoAgendamentos([]), '');
  assert.equal(resumoAgendamentos(undefined), '');
  assert.doesNotThrow(() => resumoAgendamentos([null, appt(1)]));
});

test('o executed está entre os campos vigiados', () => {
  // Guarda contra alguém limpar a lista sem reparar no que ela sustenta.
  for (const campo of ['executed', 'not_done_reason', 'glass_removed', 'date']) {
    assert.ok(CAMPOS_VISIVEIS.includes(campo), `${campo} tem de ser vigiado`);
  }
});

// ---- interfaceOcupada ----

function docFalso({ activeElement = null, caixas = [] } = {}) {
  return {
    activeElement,
    querySelectorAll: () => caixas
  };
}

test('escrever num campo adia o redesenho', () => {
  assert.equal(interfaceOcupada(docFalso({ activeElement: { tagName: 'INPUT' } })), true);
  assert.equal(interfaceOcupada(docFalso({ activeElement: { tagName: 'TEXTAREA' } })), true);
  assert.equal(interfaceOcupada(docFalso({ activeElement: { tagName: 'DIV', isContentEditable: true } })), true);
});

test('uma caixa aberta adia o redesenho', () => {
  assert.equal(interfaceOcupada(docFalso({ caixas: [{ style: { display: 'flex' } }] })), true);
});

test('caixas fechadas não contam', () => {
  assert.equal(interfaceOcupada(docFalso({ caixas: [{ style: { display: 'none' } }, { style: {} }] })), false);
});

test('quadro parado não está ocupado', () => {
  assert.equal(interfaceOcupada(docFalso({ activeElement: { tagName: 'BODY' } })), false);
  assert.equal(interfaceOcupada(docFalso()), false);
});
