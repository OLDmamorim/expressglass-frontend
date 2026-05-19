const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const pdfParse = require('pdf-parse');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function getUserFromToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(auth.substring(7), JWT_SECRET);
}

function extractEurocodes(text) {
  const matches = text.match(/\b\d{4}[A-Z]{2,}[0-9A-Z]*\b/g) || [];
  return [...new Set(matches)];
}

async function migrate(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS transport_guides (
      id SERIAL PRIMARY KEY,
      portal_id INTEGER NOT NULL,
      guide_date DATE NOT NULL,
      guide_number TEXT,
      pdf_data TEXT NOT NULL,
      eurocodes TEXT[] NOT NULL DEFAULT '{}',
      uploaded_by INTEGER NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const client = await pool.connect();
  try {
    await migrate(client);
    const user = getUserFromToken(event);

    if (event.httpMethod === 'GET') {
      const p = event.queryStringParameters || {};
      const date = p.date || new Date().toISOString().split('T')[0];
      const portalId = p.portal_id || user.portalId;
      const res = await client.query(
        `SELECT id, guide_date, guide_number, pdf_data, eurocodes, uploaded_at
         FROM transport_guides WHERE portal_id = $1 AND guide_date = $2
         ORDER BY uploaded_at DESC LIMIT 1`,
        [portalId, date]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, guide: res.rows[0] || null }) };
    }

    if (event.httpMethod === 'POST') {
      if (!['admin', 'coordinator', 'coordenador'].includes(user.role)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
      }
      const body = JSON.parse(event.body || '{}');
      const { pdf_data, file_type, manual_eurocodes } = body;
      if (!pdf_data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ficheiro em falta' }) };

      const fileBuffer = Buffer.from(pdf_data, 'base64');
      let autoEurocodes = [];
      if (!file_type || file_type === 'application/pdf') {
        try {
          const parsed = await pdfParse(fileBuffer);
          autoEurocodes = extractEurocodes(parsed.text);
        } catch (e) {
          // image-only or corrupt PDF — fall through to manual
        }
      }
      const manualList = Array.isArray(manual_eurocodes) ? manual_eurocodes.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
      const eurocodes = [...new Set([...autoEurocodes, ...manualList])];

      const today = new Date().toISOString().split('T')[0];
      await client.query(
        'DELETE FROM transport_guides WHERE portal_id = $1 AND guide_date = $2',
        [user.portalId, today]
      );
      const res = await client.query(
        `INSERT INTO transport_guides (portal_id, guide_date, pdf_data, eurocodes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, guide_date, eurocodes, uploaded_at`,
        [user.portalId, today, pdf_data, eurocodes, user.userId]
      );
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, guide: { ...res.rows[0], pdf_data }, eurocodes_found: eurocodes })
      };
    }

    if (event.httpMethod === 'DELETE') {
      if (!['admin', 'coordinator', 'coordenador'].includes(user.role)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
      }
      const today = new Date().toISOString().split('T')[0];
      await client.query(
        'DELETE FROM transport_guides WHERE portal_id = $1 AND guide_date = $2',
        [user.portalId, today]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não suportado' }) };

  } catch (err) {
    console.error('Transport guide error:', err);
    if (err.message === 'Não autenticado' || err.name === 'JsonWebTokenError') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autenticado' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  } finally {
    client.release();
  }
};
