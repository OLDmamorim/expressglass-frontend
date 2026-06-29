// netlify/functions/recusados.js
// Gere os serviços RECUSADOS por loja (portal). Sincronizados na importação do
// Excel (estado RECUSADO) e listados no aviso diário das 9h.
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function getUserFromToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(authHeader.substring(7), JWT_SECRET);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recusados (
        id SERIAL PRIMARY KEY,
        portal_id INTEGER NOT NULL,
        plate TEXT,
        car TEXT,
        n_obra TEXT,
        data_obra DATE,
        data_servico DATE,
        client_name TEXT,
        obs TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) { console.warn('recusados migration:', e.message); }

  try {
    const user = getUserFromToken(event);
    const params = event.queryStringParameters || {};

    // ---------- GET: listar recusados de um portal ----------
    if (event.httpMethod === 'GET') {
      const portalId = params.portal_id ? parseInt(params.portal_id) : (user.portalId || null);
      if (!portalId) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'portal_id obrigatório' }) };
      const { rows } = await pool.query(
        `SELECT id, portal_id, plate, car, n_obra, data_obra::text, data_servico::text, client_name, obs
         FROM recusados WHERE portal_id = $1 ORDER BY data_obra ASC NULLS LAST, plate ASC`,
        [portalId]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    // POST exige permissão de gestão (quem importa)
    const isAllowed = ['admin', 'coordenador', 'coordinator', 'pesados_coord'].includes(user.role);
    if (!isAllowed) return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };

    // ---------- POST: sincronizar recusados de um portal (substitui tudo) ----------
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const portalId = body.portal_id ? parseInt(body.portal_id) : (user.portalId || null);
      const lista = Array.isArray(body.recusados) ? body.recusados : [];
      if (!portalId) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'portal_id obrigatório' }) };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Substituir o conjunto atual do portal pela lista do Excel (mantém em sincronia)
        await client.query('DELETE FROM recusados WHERE portal_id = $1', [portalId]);
        for (const r of lista) {
          await client.query(
            `INSERT INTO recusados (portal_id, plate, car, n_obra, data_obra, data_servico, client_name, obs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              portalId,
              r.plate || null,
              r.car || null,
              r.n_obra || null,
              r.data_obra || null,
              r.data_servico || null,
              r.client_name || null,
              r.obs || null
            ]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, count: lista.length }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  } catch (err) {
    console.error('recusados error:', err);
    if (err.message === 'Não autenticado' || err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
