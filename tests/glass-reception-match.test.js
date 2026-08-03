const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Match = require('../netlify/lib/glass-reception-match');

function appointment(id, overrides = {}) {
  return {
    id,
    date: '2026-08-03',
    plate: '11-AA-11',
    car: 'Viatura',
    portal_id: 1,
    portal_name: 'SM Braga',
    ...overrides
  };
}

test('normaliza a encomenda curta e Enc.Axial para a mesma chave', () => {
  assert.equal(Match.normalizeOrderRef('83509'), '83509');
  assert.equal(Match.normalizeOrderRef('Enc.Axial 83509'), '83509');
  assert.equal(Match.normalizeOrderRef('ENC AXIAL-83509'), '83509');
  assert.equal(Match.appointmentMatchesOrder(
    appointment(1, { order_ref: 'Enc.Axial 83509' }),
    '83509'
  ), true);
});

test('encontra encomendas também em notas sem confundir números parciais', () => {
  assert.equal(Match.containsOrderRef('Vidro — Enc.Axial 83509 — urgente', '83509'), true);
  assert.equal(Match.containsOrderRef('Vidro — Enc.Axial 183509 — urgente', '83509'), false);
});

test('normaliza as confusões OCR I/1 e O/0 sem misturar prefixos', () => {
  assert.equal(Match.normalizeEurocode('3750AGIO'), '3750AG10');
  assert.equal(Match.appointmentMatchesEurocode(
    appointment(1, { glass_eurocode: '3750AG10' }),
    '3750AGIO'
  ), true);
  assert.equal(Match.appointmentMatchesEurocode(
    appointment(2, { glass_eurocode: '#3750AG10' }),
    '3750AG10'
  ), false);
});

test('lê eurocodes dos campos atuais, do JSON antigo e das notas', () => {
  assert.deepEqual(
    Match.appointmentEurocodes(appointment(1, {
      glass_eurocode: '6723AGS1',
      extra: JSON.stringify({ eurocode: '8350AGSV' }),
      notes: 'Alternativa 6557AGS2'
    })),
    ['6723AGS1', '8350AGSV', '6557AGS2']
  );
});

test('quando encomenda e eurocode existem privilegia a correspondência dos dois', () => {
  const reception = { order_ref: '83509', eurocode: '6557AGS2', created_at: '2026-08-03T10:00:00Z' };
  const candidates = Match.findCandidates(reception, [
    appointment(1, { order_ref: 'Enc.Axial 83509', glass_eurocode: 'OUTRO1' }),
    appointment(2, { order_ref: 'Enc.Axial 99999', glass_eurocode: '6557AGS2' }),
    appointment(3, { order_ref: 'Enc.Axial 83509', glass_eurocode: '6557AGS2', plate: '33-CC-33' })
  ]);

  assert.deepEqual(candidates.map(candidate => candidate.id), [3]);
});

test('um eurocode repetido fica ambíguo e não é escolhido pela data', () => {
  const reception = { eurocode: '6723AGS1', created_at: '2026-08-03T10:00:00Z' };
  const candidates = Match.findCandidates(reception, [
    appointment(1, { date: '2026-08-03', glass_eurocode: '6723AGS1' }),
    appointment(2, { date: '2026-08-04', glass_eurocode: '6723AGS1' })
  ]);

  assert.equal(candidates.length, 2);
  assert.deepEqual(new Set(candidates.map(candidate => candidate.id)), new Set([1, 2]));
});

test('o índice em lote devolve as mesmas correspondências sem reler todos os campos', () => {
  const appointments = [
    appointment(1, { order_ref: 'Enc.Axial 83509', glass_eurocode: '6557AGS2' }),
    appointment(2, { order_ref: 'Enc.Axial 99999', glass_eurocode: '6723AGS1' })
  ];
  const reception = { order_ref: '83509', eurocode: '6557AGS2', created_at: '2026-08-03T10:00:00Z' };

  const indexed = Match.findCandidates(reception, Match.createCandidateIndex(appointments));
  assert.deepEqual(indexed.map(candidate => candidate.id), [1]);
});

test('serviços realizados continuam elegíveis para recuperar uma receção', () => {
  const candidates = Match.findCandidates(
    { order_ref: '83509', created_at: '2026-08-03T10:00:00Z' },
    [appointment(1, { order_ref: 'Enc.Axial 83509', executed: true })]
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].executed, true);
});

test('o fluxo publicado pesquisa portais consultáveis e não esconde erros', () => {
  const root = path.resolve(__dirname, '..');
  const appointments = fs.readFileSync(path.join(root, 'netlify/functions/appointments.js'), 'utf8');
  const reception = fs.readFileSync(path.join(root, 'netlify/functions/glass-reception.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(appointments, /consultable_portals WHERE user_id = \$1/);
  assert.match(appointments, /params\.search_eurocode \|\| params\.search_order_ref \|\| params\.search_plate/);
  assert.match(page, /qp\.set\('include_executed', 'true'\)/);
  assert.doesNotMatch(page, /\.then\(r => r\.json\(\)\)\.then\(j => j\.success \? \(j\.data \|\| \[\]\) : \[\]\)\.catch\(\(\) => \[\]\)/);
  assert.match(reception, /d\.action === 'reanalyse_pending'/);
  assert.match(reception, /d\.action === 'associate_reception'/);
  assert.match(page, /agendamentos possíveis — escolhe o correto/);
  assert.match(reception, /Associa primeiro esta receção ao agendamento correto/);
});
