const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function getUserFromToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  const token = authHeader.substring(7);
  return jwt.verify(token, JWT_SECRET);
}

function getCurrentWeekStart() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diff);
  return monday.toISOString().split('T')[0];
}

async function migrate(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS flash_glass_contests (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL UNIQUE,
      theme TEXT NOT NULL,
      description TEXT DEFAULT '',
      published BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS flash_glass_submissions (
      id SERIAL PRIMARY KEY,
      contest_id INTEGER REFERENCES flash_glass_contests(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      portal_id INTEGER,
      username TEXT NOT NULL,
      photo_data TEXT NOT NULL,
      vote_count INTEGER DEFAULT 0,
      medal INTEGER DEFAULT 0,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(contest_id, user_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS flash_glass_votes (
      id SERIAL PRIMARY KEY,
      contest_id INTEGER REFERENCES flash_glass_contests(id) ON DELETE CASCADE,
      voter_id INTEGER NOT NULL,
      submission_id INTEGER REFERENCES flash_glass_submissions(id) ON DELETE CASCADE,
      voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(contest_id, voter_id)
    )
  `);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const client = await pool.connect();
  try {
    await migrate(client);
    const user = getUserFromToken(event);
    const params = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};

    // ---- GET ----
    if (event.httpMethod === 'GET') {
      const action = params.action || 'current';

      if (action === 'current') {
        const weekStart = getCurrentWeekStart();
        const contestRes = await client.query(
          'SELECT * FROM flash_glass_contests WHERE week_start = $1', [weekStart]
        );
        if (!contestRes.rows.length) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, contest: null }) };
        }
        const contest = contestRes.rows[0];
        const mySubRes = await client.query(
          'SELECT id, submitted_at, updated_at FROM flash_glass_submissions WHERE contest_id = $1 AND user_id = $2',
          [contest.id, user.userId]
        );
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, contest: { ...contest, mySubmission: mySubRes.rows[0] || null } })
        };
      }

      if (action === 'mural') {
        const muralsRes = await client.query(`
          SELECT id, week_start, theme, description, published, created_at
          FROM flash_glass_contests
          WHERE published = true
          ORDER BY week_start DESC
        `);
        const murals = [];
        for (const contest of muralsRes.rows) {
          const subsRes = await client.query(`
            SELECT id, username, photo_data, vote_count, medal
            FROM flash_glass_submissions
            WHERE contest_id = $1
            ORDER BY vote_count DESC, submitted_at ASC
          `, [contest.id]);
          const myVoteRes = await client.query(
            'SELECT submission_id FROM flash_glass_votes WHERE contest_id = $1 AND voter_id = $2',
            [contest.id, user.userId]
          );
          murals.push({ ...contest, submissions: subsRes.rows, myVote: myVoteRes.rows[0]?.submission_id || null });
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, murals }) };
      }

      if (action === 'ranking') {
        const res = await client.query(`
          SELECT s.username,
            SUM(s.vote_count) as total_votes,
            COUNT(*) as participations,
            SUM(CASE WHEN s.medal = 1 THEN 1 ELSE 0 END) as gold,
            SUM(CASE WHEN s.medal = 2 THEN 1 ELSE 0 END) as silver,
            SUM(CASE WHEN s.medal = 3 THEN 1 ELSE 0 END) as bronze
          FROM flash_glass_submissions s
          JOIN flash_glass_contests c ON c.id = s.contest_id AND c.published = true
          GROUP BY s.username
          ORDER BY total_votes DESC, participations DESC
        `);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, ranking: res.rows }) };
      }

      if (action === 'week-submissions') {
        if (user.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
        const weekStart = params.week_start || getCurrentWeekStart();
        const res = await client.query(`
          SELECT s.id, s.username, s.photo_data, s.vote_count, s.medal, s.submitted_at, s.updated_at,
                 c.id as contest_id, c.week_start, c.published
          FROM flash_glass_submissions s
          JOIN flash_glass_contests c ON c.id = s.contest_id
          WHERE c.week_start = $1
          ORDER BY s.vote_count DESC, s.submitted_at ASC
        `, [weekStart]);
        const contestRes = await client.query('SELECT * FROM flash_glass_contests WHERE week_start = $1', [weekStart]);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, submissions: res.rows, contest: contestRes.rows[0] || null })
        };
      }

      if (action === 'all-contests') {
        if (user.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
        const res = await client.query(`
          SELECT c.*,
            (SELECT COUNT(*) FROM flash_glass_submissions WHERE contest_id = c.id) as submission_count
          FROM flash_glass_contests c
          ORDER BY c.week_start DESC
        `);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, contests: res.rows }) };
      }
    }

    // ---- POST ----
    if (event.httpMethod === 'POST') {
      const { action } = body;

      if (action === 'submit') {
        const { contest_id, photo_data } = body;
        if (!contest_id || !photo_data) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Dados inválidos' }) };
        }
        const contestRes = await client.query('SELECT id FROM flash_glass_contests WHERE id = $1', [contest_id]);
        if (!contestRes.rows.length) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Concurso não encontrado' }) };
        }
        await client.query(`
          INSERT INTO flash_glass_submissions (contest_id, user_id, portal_id, username, photo_data)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (contest_id, user_id)
          DO UPDATE SET photo_data = $5, updated_at = NOW()
        `, [contest_id, user.userId, user.portalId, user.username, photo_data]);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (action === 'vote') {
        const { contest_id, submission_id } = body;
        const contestRes = await client.query('SELECT id, published FROM flash_glass_contests WHERE id = $1', [contest_id]);
        if (!contestRes.rows.length || !contestRes.rows[0].published) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Concurso não disponível para votação' }) };
        }
        const ownRes = await client.query(
          'SELECT id FROM flash_glass_submissions WHERE id = $1 AND user_id = $2',
          [submission_id, user.userId]
        );
        if (ownRes.rows.length) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Não podes votar na tua própria foto' }) };
        }
        const prevVoteRes = await client.query(
          'SELECT submission_id FROM flash_glass_votes WHERE contest_id = $1 AND voter_id = $2',
          [contest_id, user.userId]
        );
        if (prevVoteRes.rows.length) {
          const prevSubId = prevVoteRes.rows[0].submission_id;
          await client.query('UPDATE flash_glass_submissions SET vote_count = vote_count - 1 WHERE id = $1', [prevSubId]);
          await client.query('DELETE FROM flash_glass_votes WHERE contest_id = $1 AND voter_id = $2', [contest_id, user.userId]);
        }
        await client.query(
          'INSERT INTO flash_glass_votes (contest_id, voter_id, submission_id) VALUES ($1, $2, $3)',
          [contest_id, user.userId, submission_id]
        );
        await client.query('UPDATE flash_glass_submissions SET vote_count = vote_count + 1 WHERE id = $1', [submission_id]);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (action === 'create-contest') {
        if (user.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
        const { week_start, theme, description } = body;
        if (!week_start || !theme) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Dados obrigatórios em falta' }) };
        const res = await client.query(`
          INSERT INTO flash_glass_contests (week_start, theme, description)
          VALUES ($1, $2, $3)
          ON CONFLICT (week_start) DO UPDATE SET theme = $2, description = $3
          RETURNING *
        `, [week_start, theme, description || '']);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, contest: res.rows[0] }) };
      }

      if (action === 'publish-mural') {
        if (user.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
        const { contest_id } = body;
        await client.query('UPDATE flash_glass_contests SET published = true WHERE id = $1', [contest_id]);
        // Assign medals to top 3 by vote_count
        const topRes = await client.query(`
          SELECT id FROM flash_glass_submissions WHERE contest_id = $1
          ORDER BY vote_count DESC, submitted_at ASC LIMIT 3
        `, [contest_id]);
        await client.query('UPDATE flash_glass_submissions SET medal = 0 WHERE contest_id = $1', [contest_id]);
        for (let i = 0; i < topRes.rows.length; i++) {
          await client.query('UPDATE flash_glass_submissions SET medal = $1 WHERE id = $2', [i + 1, topRes.rows[i].id]);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não suportado' }) };

  } catch (err) {
    console.error('Flash Glass error:', err);
    if (err.message === 'Não autenticado' || err.name === 'JsonWebTokenError') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autenticado' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    client.release();
  }
};
