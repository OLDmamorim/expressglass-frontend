// netlify/functions/campaign.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      image_data TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

function verifyAdmin(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  if (!h.startsWith('Bearer ')) throw new Error('Não autenticado');
  const user = jwt.verify(h.substring(7), JWT_SECRET);
  if (user.role !== 'admin') throw new Error('Acesso negado');
  return user;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const client = await pool.connect();
  try {
    await ensureTable(client);
    const qs = event.queryStringParameters || {};

    if (event.httpMethod === 'GET') {
      // Admin: list all (without image_data for efficiency)
      if (qs.all === '1') {
        verifyAdmin(event);
        const { rows } = await client.query(
          'SELECT id, title, start_date, end_date, active, created_at FROM campaigns ORDER BY created_at DESC'
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, campaigns: rows }) };
      }

      // Admin: fetch one campaign with image
      if (qs.id) {
        verifyAdmin(event);
        const { rows } = await client.query('SELECT * FROM campaigns WHERE id = $1', [qs.id]);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, campaign: rows[0] || null }) };
      }

      // Public: active campaign for today (no auth required)
      const today = new Date().toISOString().slice(0, 10);
      const { rows } = await client.query(
        `SELECT id, title, start_date, end_date, image_data
         FROM campaigns
         WHERE active = true AND start_date <= $1 AND end_date >= $1
         ORDER BY created_at DESC LIMIT 1`,
        [today]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, campaign: rows[0] || null }) };
    }

    if (event.httpMethod === 'POST') {
      verifyAdmin(event);
      const d = JSON.parse(event.body || '{}');
      if (!d.start_date || !d.end_date) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'start_date e end_date são obrigatórios' }) };
      }
      const { rows } = await client.query(
        `INSERT INTO campaigns (title, start_date, end_date, image_data, active)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [d.title || '', d.start_date, d.end_date, d.image_data || null, d.active !== false]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: rows[0].id }) };
    }

    if (event.httpMethod === 'PUT') {
      verifyAdmin(event);
      const id = qs.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'id obrigatório' }) };
      const d = JSON.parse(event.body || '{}');
      const hasImage = d.image_data !== undefined;
      if (hasImage) {
        await client.query(
          `UPDATE campaigns SET title=$1, start_date=$2, end_date=$3, active=$4, image_data=$5 WHERE id=$6`,
          [d.title || '', d.start_date, d.end_date, d.active !== false, d.image_data, id]
        );
      } else {
        await client.query(
          `UPDATE campaigns SET title=$1, start_date=$2, end_date=$3, active=$4 WHERE id=$5`,
          [d.title || '', d.start_date, d.end_date, d.active !== false, id]
        );
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (event.httpMethod === 'DELETE') {
      verifyAdmin(event);
      const id = qs.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'id obrigatório' }) };
      await client.query('DELETE FROM campaigns WHERE id = $1', [id]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  } catch (err) {
    console.error('campaign:', err);
    const code = err.message.includes('autenticado') || err.message.includes('negado') ? 403 : 500;
    return { statusCode: code, headers, body: JSON.stringify({ success: false, error: err.message }) };
  } finally {
    client.release();
  }
};
