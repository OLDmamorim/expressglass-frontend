const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function getUserFromToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization;
  if (!auth?.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(auth.substring(7), JWT_SECRET);
}

const EC_RX = /\b\d{4}[A-Z]{3,}[0-9A-Z]*/i;

function extractEurocode(extra, notes) {
  if (extra) {
    try {
      const ec = (JSON.parse(extra).eurocode || '').trim().toUpperCase();
      if (ec) return ec;
    } catch {
      const m = extra.match(EC_RX);
      if (m) return m[0].toUpperCase();
      const t = extra.trim().toUpperCase();
      if (t) return t;
    }
  }
  if (notes) {
    const m = notes.match(EC_RX);
    if (m) return m[0].toUpperCase();
  }
  return null;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{}' };

  const client = await pool.connect();
  try {
    const user = getUserFromToken(event);
    if (!['admin', 'coordinator', 'coordenador'].includes(user.role)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
    }

    const p = event.queryStringParameters || {};
    // Prefer active portal from frontend; fall back to JWT portalId
    const portalId = (p.portal_id ? parseInt(p.portal_id) : null) || user.portalId;

    // date param: 'today' uses today, anything else (default) uses tomorrow
    const useToday = p.date === 'today';
    const targetDate = useToday ? 'CURRENT_DATE' : '(CURRENT_DATE + INTERVAL \'1 day\')::date';

    let rows;
    if (user.role === 'admin' && !portalId) {
      // Admin sem portal específico — mostra todos os SM
      const res = await client.query(`
        SELECT a.portal_id, p.name AS portal_name, a.extra, a.notes, a.plate, a.car
        FROM appointments a
        JOIN portals p ON p.id = a.portal_id
        WHERE a.date::date = ${targetDate}
          AND COALESCE(p.portal_type, '') NOT IN ('loja', 'mycar')
          AND (
            (a.extra IS NOT NULL AND a.extra != '')
            OR (a.notes IS NOT NULL AND a.notes != '')
          )
        ORDER BY p.name, a.id
      `);
      rows = res.rows;
    } else {
      if (!portalId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Portal não identificado' }) };
      const res = await client.query(`
        SELECT a.portal_id, p.name AS portal_name, a.extra, a.notes, a.plate, a.car
        FROM appointments a
        JOIN portals p ON p.id = a.portal_id
        WHERE a.date::date = ${targetDate}
          AND a.portal_id = $1
          AND COALESCE(p.portal_type, '') NOT IN ('loja', 'mycar')
          AND (
            (a.extra IS NOT NULL AND a.extra != '')
            OR (a.notes IS NOT NULL AND a.notes != '')
          )
        ORDER BY a.id
      `, [portalId]);
      rows = res.rows;
    }

    // Group by portal, deduplicate eurocodes
    const byPortal = {};
    for (const row of rows) {
      const ec = extractEurocode(row.extra, row.notes);
      if (!ec) continue;
      if (!byPortal[row.portal_id]) {
        byPortal[row.portal_id] = { portal_id: row.portal_id, portal_name: row.portal_name, eurocodes: [] };
      }
      byPortal[row.portal_id].eurocodes.push(ec);
    }
    const portals = Object.values(byPortal).map(pp => ({
      ...pp,
      eurocodes: [...new Set(pp.eurocodes)]
    }));

    const refDate = new Date();
    if (!useToday) refDate.setDate(refDate.getDate() + 1);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, date: refDate.toISOString().split('T')[0], portals })
    };
  } catch (err) {
    console.error('tomorrow-eurocodes error:', err);
    if (err.message === 'Não autenticado' || err.name === 'JsonWebTokenError') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autenticado' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    client.release();
  }
};
