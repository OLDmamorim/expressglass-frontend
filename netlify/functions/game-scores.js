// Ranking do "Pit Stop ExpressGlass".
// O servidor abre uma sessão curta, valida a telemetria e calcula a pontuação.
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const Core = require('../../game-core');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const GAME_SESSION_SECRET = process.env.GAME_SESSION_SECRET || JWT_SECRET;
const GAME_SESSION_ISSUER = 'expressglass-pit-stop';
const GAME_VERSION = Core.VERSION;
const MAX_RUNS_PER_TEN_MINUTES = 12;

let schemaReady;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getUserFromToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Não autenticado');
  try {
    return jwt.verify(header.substring(7), JWT_SECRET);
  } catch (_) {
    throw new HttpError(401, 'Sessão inválida');
  }
}

function userIdentity(user) {
  return String(user.userId || user.username || '');
}

function portugalHour(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    hour12: false
  }).formatToParts(date || new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

function tournamentMultiplier(date) {
  const hour = portugalHour(date);
  return hour >= 12 && hour < 14 ? 2 : 1;
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_scores (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      username TEXT,
      portal_id INTEGER,
      portal_name TEXT,
      score INTEGER NOT NULL,
      lines INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE game_scores
      ADD COLUMN IF NOT EXISTS quality INTEGER,
      ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
      ADD COLUMN IF NOT EXISTS session_id TEXT,
      ADD COLUMN IF NOT EXISTS game_version TEXT
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_created ON game_scores (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores (score DESC)`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_game_scores_session
    ON game_scores (session_id)
    WHERE session_id IS NOT NULL
  `);
}

function ensureSchema() {
  if (!schemaReady) schemaReady = migrate();
  return schemaReady;
}

function periodStartSql(period) {
  if (period === 'week') {
    return `date_trunc('week', NOW() AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon'`;
  }
  if (period === 'today') {
    return `date_trunc('day', NOW() AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon'`;
  }
  return `'epoch'::timestamptz`;
}

function openSession(user) {
  const identity = userIdentity(user);
  if (!identity) throw new HttpError(400, 'Utilizador sem identificação');
  const now = Date.now();
  const multiplier = tournamentMultiplier(new Date(now));
  const sessionId = crypto.randomUUID();
  const sessionToken = jwt.sign({
    type: 'pit-stop-session',
    uid: identity,
    startedAt: now,
    multiplier,
    version: GAME_VERSION
  }, GAME_SESSION_SECRET, {
    expiresIn: '4m',
    issuer: GAME_SESSION_ISSUER,
    jwtid: sessionId
  });
  return {
    success: true,
    sessionToken,
    multiplier,
    durationMs: Core.TOTAL_MS,
    version: GAME_VERSION
  };
}

function verifyGameSession(token, user) {
  if (!token || typeof token !== 'string') throw new HttpError(400, 'Sessão de jogo em falta');
  let session;
  try {
    session = jwt.verify(token, GAME_SESSION_SECRET, { issuer: GAME_SESSION_ISSUER });
  } catch (_) {
    throw new HttpError(400, 'Sessão de jogo inválida ou expirada');
  }
  if (session.type !== 'pit-stop-session' ||
      session.uid !== userIdentity(user) ||
      session.version !== GAME_VERSION ||
      !session.jti ||
      !Number.isFinite(session.startedAt)) {
    throw new HttpError(400, 'Sessão de jogo inconsistente');
  }
  return session;
}

async function saveRun(data, user) {
  const session = verifyGameSession(data.sessionToken, user);
  const wallElapsedMs = Date.now() - session.startedAt;
  const validationError = Core.validateRun(data.jobs, data.durationMs, wallElapsedMs);
  if (validationError) throw new HttpError(400, validationError);

  const jobs = Core.normalizeJobs(data.jobs);
  const score = Core.calculateScore(jobs, session.multiplier);
  const quality = Core.averageQuality(jobs);
  const durationMs = Math.round(Number(data.durationMs));

  if (!jobs.length || score === 0) {
    return { success: true, saved: false, score: 0 };
  }

  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const recent = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM game_scores
      WHERE user_id = $1
        AND game_version = $2
        AND created_at >= NOW() - INTERVAL '10 minutes'
    `, [user.userId || null, GAME_VERSION]);
    if ((recent.rows[0]?.total || 0) >= MAX_RUNS_PER_TEN_MINUTES) {
      throw new HttpError(429, 'Aguarda alguns minutos antes de voltar a jogar');
    }

    const previous = await client.query(`
      SELECT MAX(score)::int AS best
      FROM game_scores
      WHERE user_id = $1 AND game_version = $2
    `, [user.userId || null, GAME_VERSION]);
    const previousBest = previous.rows[0]?.best || 0;

    await client.query(`
      INSERT INTO game_scores (
        user_id, username, portal_id, portal_name, score, lines, level,
        quality, duration_ms, session_id, game_version
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      user.userId || null,
      user.username || null,
      user.portalId || null,
      user.portalName || null,
      score,
      jobs.length,
      Math.max(1, jobs.length),
      quality,
      durationMs,
      session.jti,
      GAME_VERSION
    ]);

    await client.query('COMMIT');
    return {
      success: true,
      saved: true,
      score,
      quality,
      personalBest: Math.max(previousBest, score),
      isNewBest: score > previousBest
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new HttpError(409, 'Esta partida já foi registada');
    throw error;
  } finally {
    client.release();
  }
}

async function getRanking(event, user) {
  await ensureSchema();
  const params = event.queryStringParameters || {};
  const period = ['today', 'week', 'all'].includes(params.period) ? params.period : 'today';
  const since = periodStartSql(period);

  const [players, stores, mine, mineAll] = await Promise.all([
    pool.query(`
      SELECT user_id, MAX(username) AS username, MAX(portal_name) AS portal_name,
             MAX(score)::int AS best, COUNT(*)::int AS games
      FROM game_scores
      WHERE created_at >= ${since}
        AND game_version = $1
        AND user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY best DESC
      LIMIT 15
    `, [GAME_VERSION]),
    pool.query(`
      WITH best AS (
        SELECT user_id, portal_id, MAX(portal_name) AS portal_name, MAX(score)::int AS best
        FROM game_scores
        WHERE created_at >= ${since}
          AND game_version = $1
          AND portal_id IS NOT NULL
          AND user_id IS NOT NULL
        GROUP BY user_id, portal_id
      )
      SELECT portal_id, MAX(portal_name) AS portal_name, SUM(best)::int AS total,
             COUNT(*)::int AS players, MAX(best)::int AS top
      FROM best
      GROUP BY portal_id
      ORDER BY total DESC
      LIMIT 15
    `, [GAME_VERSION]),
    pool.query(`
      SELECT MAX(score)::int AS best
      FROM game_scores
      WHERE user_id = $1
        AND game_version = $2
        AND created_at >= ${since}
    `, [user.userId || null, GAME_VERSION]),
    pool.query(`
      SELECT MAX(score)::int AS best
      FROM game_scores
      WHERE user_id = $1 AND game_version = $2
    `, [user.userId || null, GAME_VERSION])
  ]);

  return {
    success: true,
    period,
    version: GAME_VERSION,
    players: players.rows,
    stores: stores.rows,
    me: {
      username: user.username || null,
      portalName: user.portalName || null,
      periodBest: mine.rows[0]?.best || 0,
      allTimeBest: mineAll.rows[0]?.best || 0
    }
  };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const user = getUserFromToken(event);

    if (event.httpMethod === 'POST') {
      let data;
      try {
        data = JSON.parse(event.body || '{}');
      } catch (_) {
        throw new HttpError(400, 'Pedido inválido');
      }

      const result = data.action === 'start'
        ? openSession(user)
        : data.action === 'finish'
          ? await saveRun(data, user)
          : (() => { throw new HttpError(400, 'Ação inválida'); })();

      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    if (event.httpMethod === 'GET') {
      const result = await getRanking(event, user);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    throw new HttpError(405, 'Método não permitido');
  } catch (error) {
    console.error('game-scores:', error.message);
    const statusCode = error.statusCode || 500;
    const message = statusCode >= 500 ? 'Erro interno ao processar o jogo' : error.message;
    return {
      statusCode,
      headers,
      body: JSON.stringify({ success: false, error: message })
    };
  }
};

exports.__test = {
  portugalHour,
  tournamentMultiplier,
  openSession,
  verifyGameSession
};
