// netlify/functions/cleanup-imported.js
// Elimina permanentemente os serviços importados (auto_imported) que ainda
// estão por confirmar e cuja data já passou (<= hoje) — os cartões cinzas a
// piscar na agenda. Se voltarem a fazer falta, são reimportados pelo Excel.
// Apenas administradores. Chamada manual via POST com token.

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  }

  let user;
  try {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    user = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    if (user.role !== 'admin') throw new Error('Acesso negado: apenas administradores');
  } catch (e) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }

  try {
    // Cartões cinzas a piscar = importados, ainda por confirmar (status NE),
    // não realizados, com data já passada (<= hoje).
    const { rows } = await pool.query(`
      DELETE FROM appointments
      WHERE auto_imported = true
        AND date IS NOT NULL
        AND date <= CURRENT_DATE
        AND executed IS NOT TRUE
        AND (status IS NULL OR status = 'NE')
      RETURNING id, plate, date, portal_id
    `);

    // Registar na auditoria
    try {
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, entity, details, created_at)
         VALUES ($1, $2, 'cleanup_imported', 'appointment', $3, NOW())`,
        [user.userId || null, user.username || null, JSON.stringify({
          removed: rows.length,
          plates: rows.map(r => r.plate)
        })]
      );
    } catch (e) { console.warn('[cleanup-imported audit]', e.message); }

    console.log(`[cleanup-imported] ${rows.length} serviços importados por confirmar eliminados`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, removed: rows.length, items: rows })
    };
  } catch (e) {
    console.error('[cleanup-imported]', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
