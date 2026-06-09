const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

function verifyToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(auth.substring(7), JWT_SECRET);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{}' };

  try {
    const user = verifyToken(event);
    if (!['admin', 'coordinator', 'coordenador'].includes(user.role)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
    }

    const params = event.queryStringParameters || {};
    const date = params.date || new Date().toISOString().slice(0, 10);

    const vals = [date];
    let portalFilter = '';

    if (user.role !== 'admin') {
      const ids = user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []);
      if (!ids.length) return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [], date }) };
      vals.push(ids);
      portalFilter = `AND p.id = ANY($${vals.length})`;
    }

    const { rows } = await pool.query(`
      SELECT
        p.id          AS portal_id,
        p.name        AS portal_name,
        p.portal_type,
        tc.user_id,
        tc.user_name,
        tc.checkin_at,
        tc.checkout_at,
        tc.checkin_auto,
        tc.checkout_auto,
        tc.notes
      FROM portals p
      LEFT JOIN team_checkins tc ON tc.portal_id = p.id AND tc.date = $1
      WHERE COALESCE(p.portal_type, 'sm') IN ('sm', 'pesados')
        ${portalFilter}
      ORDER BY
        CASE
          WHEN tc.checkin_at  IS NULL THEN 0
          WHEN tc.checkout_at IS NULL THEN 1
          ELSE 2
        END,
        p.name
    `, vals);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows, date }) };
  } catch (e) {
    if (e.message === 'Não autenticado' || e.name === 'JsonWebTokenError') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autenticado' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
