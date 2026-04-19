// audit-log.js — Netlify Function para consultar logs de auditoria
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const auth = event.headers?.authorization || '';
    const decoded = jwt.verify(auth.substring(7), JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Acesso negado');

    const p = event.queryStringParameters || {};
    const page   = parseInt(p.page  || '1');
    const limit  = parseInt(p.limit || '50');
    const action = p.action || null;
    const user   = p.user   || null;
    const offset = (page - 1) * limit;

    let where = [];
    let vals  = [];
    let i     = 1;

    if (action) { where.push(`action = $${i++}`); vals.push(action); }
    if (user)   { where.push(`(username ILIKE $${i++} OR CAST(user_id AS TEXT) = $${i++})`); vals.push(`%${user}%`); vals.push(user); i++; }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const { rows } = await pool.query(`
      SELECT id, user_id, username, action, entity, entity_id, details, ip, user_agent, created_at
      FROM audit_log
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `, [...vals, limit, offset]);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM audit_log ${whereClause}`, vals
    );

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        data: rows,
        total: parseInt(countRows[0].count),
        page, limit
      })
    };

  } catch (e) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
