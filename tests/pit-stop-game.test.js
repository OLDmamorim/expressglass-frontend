const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const Core = require('../game-core');
const gameScores = require('../netlify/functions/game-scores');

const FALLBACK_SECRET = 'expressglass-secret-key-change-in-production';

test('o ranking é decidido exclusivamente pelo tempo sobrevivido', () => {
  const run = {
    durationMs: 87340,
    distanceM: 2650,
    dodged: 68,
    hits: 4,
    repairs: 1,
    replacements: 1,
    bonuses: 5,
    maxCombo: 23,
    endingDamage: 100
  };
  assert.equal(Core.calculateScore(run), 87340);
  assert.equal(Core.calculateScore({ ...run, dodged: 600 }), 87340);
});

test('os pontos por desvio premiam pedra, combo e bónus ×2', () => {
  assert.equal(Core.dodgeCredits('small', 1, false), 8);
  assert.equal(Core.dodgeCredits('medium', 5, false), 14);
  assert.equal(Core.dodgeCredits('large', 10, false), 23);
  assert.equal(Core.dodgeCredits('large', 10, true), 47);
});

test('o arrasto móvel atravessa as faixas com um movimento curto e contínuo', () => {
  assert.equal(Core.dragLane(0, 0, 390), 0);
  assert.ok(Core.dragLane(0, 70, 390) > .99);
  assert.equal(Core.dragLane(0, -150, 390), -1);
  assert.ok(Core.dragLane(1, -140, 390) < -.99);
  assert.equal(Core.dragLane(-1, -500, 390), -1);
});

test('a reparação e substituição respeitam dano e saldo', () => {
  assert.deepEqual(Core.applyService({ damage: 62, credits: 90 }, 'repair', false), {
    ok: true,
    damage: 32,
    credits: 45,
    cost: 45
  });
  assert.match(
    Core.applyService({ damage: 82, credits: 200 }, 'repair', false).reason,
    /demasiado danificado/
  );
  assert.match(
    Core.applyService({ damage: 55, credits: 120 }, 'replace', false).reason,
    /insuficientes/
  );
  assert.deepEqual(Core.applyService({ damage: 99, credits: 0 }, 'replace', true), {
    ok: true,
    damage: 0,
    credits: 0,
    cost: 0
  });
});

test('a telemetria recebida é normalizada e limitada', () => {
  assert.deepEqual(Core.normalizeRun({
    durationMs: '62450',
    distanceM: '1700',
    dodged: '48',
    hits: -3,
    repairs: 2,
    replacements: 1,
    bonuses: 4,
    maxCombo: 18,
    endingDamage: 140
  }), {
    durationMs: 62450,
    distanceM: 1700,
    dodged: 48,
    hits: 0,
    repairs: 2,
    replacements: 1,
    bonuses: 4,
    maxCombo: 18,
    endingDamage: 100
  });
});

test('a validação rejeita viagens fisicamente impossíveis', () => {
  const valid = {
    durationMs: 60000,
    distanceM: 1650,
    dodged: 52,
    hits: 4,
    repairs: 1,
    replacements: 1,
    bonuses: 5,
    maxCombo: 19,
    endingDamage: 100
  };
  assert.equal(Core.validateRun(valid, 63000), null);
  assert.match(Core.validateRun({ ...valid, durationMs: 70000 }, 60000), /Duração inconsistente/);
  assert.match(Core.validateRun({ ...valid, dodged: 900 }, 63000), /desvios/);
  assert.match(Core.validateRun({ ...valid, maxCombo: 80 }, 63000), /Combo/);
  assert.match(Core.validateRun({ ...valid, distanceM: 9000 }, 63000), /Distância/);
});

test('abrir uma sessão cria um token longo ligado ao utilizador e à versão', () => {
  const user = { userId: 17, username: 'tecnico', portalId: 4 };
  const opened = gameScores.__test.openSession(user);
  const verified = gameScores.__test.verifyGameSession(opened.sessionToken, user);
  assert.equal(opened.success, true);
  assert.equal(opened.version, Core.VERSION);
  assert.equal(opened.maxDurationMs, Core.MAX_RUN_MS);
  assert.equal(verified.uid, '17');
  assert.equal(verified.version, Core.VERSION);
  assert.throws(
    () => gameScores.__test.verifyGameSession(opened.sessionToken, { userId: 18 }),
    /inconsistente/
  );
});

test('o endpoint inicia uma viagem autenticada sem confiar numa pontuação', async () => {
  const authToken = jwt.sign({
    userId: 22,
    username: 'marco',
    portalId: 3,
    portalName: 'Guimarães'
  }, FALLBACK_SECRET);
  const response = await gameScores.handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer ' + authToken },
    body: JSON.stringify({ action: 'start', score: 5000000 })
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.maxDurationMs, Core.MAX_RUN_MS);
  assert.equal(typeof body.sessionToken, 'string');
  assert.equal(body.score, undefined);
});
