// netlify/functions/game-scores.js
// Ranking do jogo "Vidro Perfeito". Guarda as pontuações e devolve os tops
// individuais e por loja (hoje / semana / sempre).
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function getUserFromToken(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  if (!h.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(h.substring(7), JWT_SECRET);
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_created ON game_scores (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores (score DESC)`);
}

// Início do período, na hora de Portugal (senão o "hoje" mudava à meia-noite UTC)
function periodStartSql(period) {
  if (period === 'week')  return `date_trunc('week', NOW() AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon'`;
  if (period === 'today') return `date_trunc('day',  NOW() AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon'`;
  return `'epoch'::timestamptz`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    await migrate();
    const user = getUserFromToken(event);

    if (event.httpMethod === 'POST') {
      const d = JSON.parse(event.body || '{}');
      const score = Math.floor(Number(d.score) || 0);
      const lines = Math.floor(Number(d.lines) || 0);
      const level = Math.floor(Number(d.level) || 1);

      // Guarda de sanidade: ignora valores impossíveis (o máximo teórico por
      // linha é bem inferior a isto, mesmo com hard drops e multiplicador).
      if (score < 0 || score > 5000000 || lines < 0 || lines > 100000) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Pontuação inválida' }) };
      }
      if (score === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, saved: false }) };
      }

      await pool.query(
        `INSERT INTO game_scores (user_id, username, portal_id, portal_name, score, lines, level)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [user.userId || null, user.username || null, user.portalId || null, user.portalName || null, score, lines, level]
      );

      // Recorde pessoal de sempre?
      const { rows } = await pool.query(
        `SELECT MAX(score)::int AS best FROM game_scores WHERE user_id = $1`,
        [user.userId || null]
      );
      const best = rows[0]?.best || 0;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, saved: true, personalBest: best, isNewBest: score >= best })
      };
    }

    // GET — tops individuais e por loja
    const p = event.queryStringParameters || {};
    const period = ['today', 'week', 'all'].includes(p.period) ? p.period : 'today';
    const since = periodStartSql(period);

    const players = await pool.query(`
      SELECT username, MAX(portal_name) AS portal_name, MAX(score)::int AS best, SUM(1)::int AS games
      FROM game_scores
      WHERE created_at >= ${since} AND username IS NOT NULL
      GROUP BY username
      ORDER BY best DESC
      LIMIT 15
    `);

    // Loja = soma do MELHOR resultado de cada jogador (premeia perícia e
    // participação, sem deixar que uma pessoa sozinha inflacione com repetições)
    const stores = await pool.query(`
      WITH best AS (
        SELECT user_id, portal_id, MAX(portal_name) AS portal_name, MAX(score)::int AS best
        FROM game_scores
        WHERE created_at >= ${since} AND portal_id IS NOT NULL
        GROUP BY user_id, portal_id
      )
      SELECT portal_id, portal_name, SUM(best)::int AS total,
             COUNT(*)::int AS players, MAX(best)::int AS top
      FROM best
      GROUP BY portal_id, portal_name
      ORDER BY total DESC
      LIMIT 15
    `);

    const mine = await pool.query(`
      SELECT MAX(score)::int AS best FROM game_scores
      WHERE user_id = $1 AND created_at >= ${since}
    `, [user.userId || null]);

    const mineAll = await pool.query(
      `SELECT MAX(score)::int AS best FROM game_scores WHERE user_id = $1`,
      [user.userId || null]
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        period,
        players: players.rows,
        stores: stores.rows,
        me: {
          username: user.username || null,
          portalName: user.portalName || null,
          periodBest: mine.rows[0]?.best || 0,
          allTimeBest: mineAll.rows[0]?.best || 0
        }
      })
    };
  } catch (err) {
    console.error('game-scores:', err.message);
    const code = /autenticad|jwt|token/i.test(err.message) ? 401 : 500;
    return { statusCode: code, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
