// netlify/functions/route-locks.js
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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS route_locks (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        portal_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(date, portal_id)
      )
    `);
  } catch (e) { console.warn('route_locks migration:', e.message); }

  try {
    const user = getUserFromToken(event);
    const isAdmin = user.role === 'admin';
    const isCoord = user.role === 'coordenador' || user.role === 'pesados_coord';

    const params = event.queryStringParameters || {};
    let portalId = user.portalId;
    if (isAdmin && params.portal_id) portalId = parseInt(params.portal_id);
    else if (isCoord && params.portal_id) {
      const allowed = user.portalIds || (user.portalId ? [user.portalId] : []);
      const req = parseInt(params.portal_id);
      if (allowed.includes(req)) portalId = req;
    }

    if (event.httpMethod === 'GET') {
      const { rows } = await pool.query(
        'SELECT date::text, portal_id, created_at FROM route_locks WHERE portal_id = $1 ORDER BY date',
        [portalId]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    if (!isAdmin && !isCoord) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };
    }

    if (event.httpMethod === 'POST') {
      const { date } = JSON.parse(event.body || '{}');
      if (!date) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'date obrigatório' }) };
      await pool.query(
        'INSERT INTO route_locks (date, portal_id) VALUES ($1, $2) ON CONFLICT (date, portal_id) DO NOTHING',
        [date, portalId]
      );
      return { statusCode: 201, headers, body: JSON.stringify({ success: true }) };
    }

    if (event.httpMethod === 'DELETE') {
      const date = params.date;
      if (!date) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'date obrigatório' }) };
      await pool.query('DELETE FROM route_locks WHERE date = $1 AND portal_id = $2', [date, portalId]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  } catch (err) {
    console.error('route-locks error:', err);
    if (err.message === 'Não autenticado' || err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
