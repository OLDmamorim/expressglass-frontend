// netlify/functions/backup-all.js
// Devolve todos os agendamentos de todos os portais (apenas admin)

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };

  try {
    const token = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Apenas admin' }) };
  } catch(e) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Não autenticado' }) };
  }

  try {
    const { rows: portals } = await pool.query(`SELECT id, name FROM portals ORDER BY name`);
    const { rows: appointments } = await pool.query(
      `SELECT a.*, p.name as portal_name
       FROM appointments a
       LEFT JOIN portals p ON p.id = a.portal_id
       ORDER BY a.portal_id, a.date NULLS LAST, a.sortIndex`
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        exportedAt: new Date().toISOString(),
        portals: portals.length,
        total: appointments.length,
        appointments
      })
    };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
