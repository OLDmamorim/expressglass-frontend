const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const Core = require('../game-core');
const gameScores = require('../netlify/functions/game-scores');

const FALLBACK_SECRET = 'expressglass-secret-key-change-in-production';

test('a pontuação é calculada no motor partilhado', () => {
  const jobs = [
    { quality: 90, durationMs: 12000, mistakes: 0 },
    { quality: 80, durationMs: 18000, mistakes: 2 }
  ];
  assert.equal(Core.calculateJobPoints(jobs[0], 0), 2599);
  assert.equal(Core.calculateJobPoints(jobs[1], 1), 1876);
  assert.equal(Core.calculateScore(jobs, 1), 4475);
  assert.equal(Core.calculateScore(jobs, 2), 8950);
});

test('os dados recebidos são normalizados e limitados', () => {
  const jobs = Core.normalizeJobs([
    { quality: 140, durationMs: -20, mistakes: 90 },
    { quality: '82', durationMs: '12450', mistakes: '1' }
  ]);
  assert.deepEqual(jobs, [
    { quality: 100, durationMs: 0, mistakes: 30 },
    { quality: 82, durationMs: 12450, mistakes: 1 }
  ]);
});

test('a validação rejeita serviços fisicamente impossíveis', () => {
  const valid = [
    { quality: 92, durationMs: 15000, mistakes: 0 },
    { quality: 84, durationMs: 16000, mistakes: 1 }
  ];
  assert.equal(Core.validateRun(valid, 75000, 77000), null);
  assert.match(
    Core.validateRun([{ quality: 100, durationMs: 2000, mistakes: 0 }], 6000, 7000),
    /Duração de serviço/
  );
  assert.match(
    Core.validateRun(Array(11).fill(valid[0]), 75000, 76000),
    /Número de serviços/
  );
  assert.match(Core.validateRun(valid, 80000, 70000), /Duração inconsistente/);
});

test('o torneio do almoço usa a hora de Lisboa, incluindo horário de verão', () => {
  assert.equal(gameScores.__test.tournamentMultiplier(new Date('2026-01-15T12:30:00Z')), 2);
  assert.equal(gameScores.__test.tournamentMultiplier(new Date('2026-07-15T11:30:00Z')), 2);
  assert.equal(gameScores.__test.tournamentMultiplier(new Date('2026-07-15T13:30:00Z')), 1);
});

test('abrir uma sessão devolve um token curto ligado ao utilizador', () => {
  const user = { userId: 17, username: 'tecnico', portalId: 4 };
  const opened = gameScores.__test.openSession(user);
  const verified = gameScores.__test.verifyGameSession(opened.sessionToken, user);
  assert.equal(opened.success, true);
  assert.equal(opened.version, Core.VERSION);
  assert.equal(verified.uid, '17');
  assert.equal(verified.version, Core.VERSION);
  assert.throws(
    () => gameScores.__test.verifyGameSession(opened.sessionToken, { userId: 18 }),
    /inconsistente/
  );
});

test('o endpoint inicia uma partida autenticada sem confiar numa pontuação', async () => {
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
  assert.equal(body.durationMs, Core.TOTAL_MS);
  assert.equal(typeof body.sessionToken, 'string');
  assert.equal(body.score, undefined);
});
