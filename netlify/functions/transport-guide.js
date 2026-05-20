const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const pdfParse = require('pdf-parse');
const https = require('https');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function getUserFromToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(auth.substring(7), JWT_SECRET);
}

function extractEurocodes(text) {
  const upper = text.toUpperCase();
  const matches = upper.match(/\b\d{4}-?[A-Z]{3,}[0-9A-Z]*\b/g) || [];
  return [...new Set(matches.map(m => m.replace(/-/g, '')))];
}

function callAnthropicVision(imageBase64, mimeType) {
  return new Promise((resolve, reject) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return reject(new Error('ANTHROPIC_API_KEY não configurada'));

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 }
          },
          {
            type: 'text',
            text: 'Esta é uma Guia de Transporte AT portuguesa para vidros automóveis. Extrai todos os Eurocodes presentes na imagem. Os Eurocodes têm formato: 4 dígitos seguidos de letras maiúsculas e números (exemplos: 3739AB1C, 5385AGNVZPBL, 6564XY2Z). Lista apenas os códigos encontrados, um por linha, sem texto adicional. Se não encontrares nenhum, responde apenas: NENHUM'
          }
        ]
      }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Resposta inválida da API: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
  await client.query(`ALTER TABLE transport_guides ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'application/pdf'`);
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
      let portalId = user.portalId;
      if (!portalId && p.portal_id) portalId = parseInt(p.portal_id);
      if (!portalId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Portal não identificado' }) };
      const res = await client.query(
        `SELECT id, guide_date, guide_number, pdf_data, eurocodes, uploaded_at, COALESCE(file_type, 'application/pdf') AS file_type
         FROM transport_guides
         WHERE portal_id = $1 AND guide_date = $2
           AND guide_date >= CURRENT_DATE - INTERVAL '1 day'
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
      const { pdf_data, file_type, _portalId, guide_date: rawGuideDate } = body;
      if (!pdf_data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ficheiro em falta' }) };

      let portalId = user.portalId;
      if (!portalId && _portalId) portalId = parseInt(_portalId);
      if (!portalId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Portal não identificado' }) };

      // guide_date: accept 'today', 'tomorrow', or ISO date string; default today
      const todayIso = new Date().toISOString().split('T')[0];
      const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowIso = tomorrowDate.toISOString().split('T')[0];
      let guideDate = todayIso;
      if (rawGuideDate === 'tomorrow') guideDate = tomorrowIso;
      else if (rawGuideDate && /^\d{4}-\d{2}-\d{2}$/.test(rawGuideDate)) guideDate = rawGuideDate;

      const fileBuffer = Buffer.from(pdf_data, 'base64');
      let autoEurocodes = [];
      const isImage = file_type && file_type.startsWith('image/');

      if (!file_type || file_type === 'application/pdf') {
        try {
          const parsed = await pdfParse(fileBuffer);
          autoEurocodes = extractEurocodes(parsed.text);
        } catch (e) {
          // image-only or corrupt PDF — fall through to manual
        }
      } else if (isImage) {
        try {
          const result = await callAnthropicVision(pdf_data, file_type);
          if (result.error) throw new Error(result.error.message || 'Erro API vision');
          const text = result.content?.[0]?.text || '';
          autoEurocodes = extractEurocodes(text);
        } catch (e) {
          console.error('Vision OCR error:', e.message);
          // Fall through — manual codes still applied below
        }
      }

      const eurocodes = [...new Set(autoEurocodes)];
      const storedFileType = file_type || 'application/pdf';

      // Delete existing guide for same date + cleanup guides older than 2 days
      await client.query(
        "DELETE FROM transport_guides WHERE portal_id = $1 AND (guide_date = $2 OR guide_date < CURRENT_DATE - INTERVAL '1 day')",
        [portalId, guideDate]
      );
      const res = await client.query(
        `INSERT INTO transport_guides (portal_id, guide_date, pdf_data, eurocodes, uploaded_by, file_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, guide_date, eurocodes, uploaded_at, file_type`,
        [portalId, guideDate, pdf_data, eurocodes, user.userId, storedFileType]
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
      const body = JSON.parse(event.body || '{}');
      let portalId = user.portalId;
      if (!portalId && body._portalId) portalId = parseInt(body._portalId);
      if (!portalId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Portal não identificado' }) };
      const today = new Date().toISOString().split('T')[0];
      await client.query(
        'DELETE FROM transport_guides WHERE portal_id = $1 AND guide_date = $2',
        [portalId, today]
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
