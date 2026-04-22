// netlify/functions/registration-request.js
// Gestão de pedidos de acesso ao portal.
// POST (público): submeter pedido de inscrição
// GET ?action=portals (público): listar portais para o formulário
// GET (admin auth): listar pedidos pendentes
// PUT (admin auth): marcar pedido como aprovado/rejeitado

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Content-Type': 'application/json',
};

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registration_requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      portal_name TEXT,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const p = event.queryStringParameters || {};

  try {
    // ── GET ?action=portals — público, sem auth ──
    if (event.httpMethod === 'GET' && p.action === 'portals') {
      const { rows } = await pool.query(
        "SELECT id, name, portal_type FROM portals ORDER BY name"
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, portals: rows }) };
    }

    // ── POST — submeter pedido (sem auth) ──
    if (event.httpMethod === 'POST') {
      await ensureTable();
      const body = JSON.parse(event.body || '{}');
      const { name, email, portal_name, role } = body;

      if (!name || !email || !role) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Preencha nome, email e cargo.' }) };
      }

      // Impedir duplicados pendentes
      const dup = await pool.query(
        "SELECT id FROM registration_requests WHERE email = $1 AND status = 'pending'",
        [email.toLowerCase().trim()]
      );
      if (dup.rows.length > 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Já existe um pedido pendente para este email.' }) };
      }

      await pool.query(
        'INSERT INTO registration_requests (name, email, portal_name, role) VALUES ($1, $2, $3, $4)',
        [name.trim(), email.toLowerCase().trim(), portal_name || null, role]
      );

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Pedido enviado! O administrador irá criar a sua conta em breve.' }) };
    }

    // ── GET — listar pedidos (admin auth) ──
    if (event.httpMethod === 'GET') {
      const auth = event.headers.authorization || event.headers.Authorization || '';
      if (!auth.startsWith('Bearer ')) return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
      const decoded = jwt.verify(auth.substring(7), JWT_SECRET);
      if (decoded.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Acesso negado' }) };

      await ensureTable();
      const { rows } = await pool.query(
        "SELECT * FROM registration_requests WHERE status = 'pending' ORDER BY created_at DESC"
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, requests: rows }) };
    }

    // ── PUT — aprovar ou rejeitar (admin auth) ──
    if (event.httpMethod === 'PUT') {
      const auth = event.headers.authorization || event.headers.Authorization || '';
      if (!auth.startsWith('Bearer ')) return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
      jwt.verify(auth.substring(7), JWT_SECRET);

      const body = JSON.parse(event.body || '{}');
      const { id, status } = body;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'ID em falta' }) };

      await pool.query(
        'UPDATE registration_requests SET status = $1 WHERE id = $2',
        [status || 'approved', id]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: '{}' };

  } catch (err) {
    console.error('[registration-request]', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
