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
  const codes = new Set();
  // Word-first: split on whitespace/punctuation so PDF table columns don't concatenate
  upper.split(/[\s\/,;|]+/).forEach(token => {
    const clean = token.replace(/^[^A-Z0-9]+/, '').replace(/[^A-Z0-9]+$/, '');
    const m = clean.match(/^(\d{4}-?[A-Z]{3,}[0-9A-Z]*)$/);
    if (m) codes.add(m[1].replace(/-/g, ''));
  });
  // Fallback regex for non-whitespace-delimited cases
  (upper.match(/\b\d{4}-?[A-Z]{3,}[0-9A-Z]*\b/g) || []).forEach(m => codes.add(m.replace(/-/g, '')));
  return [...codes];
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
      // Prefer explicit portal_id from query (sent from window.activePortalId for coordinators
      // managing multiple portals) over the JWT portal (which may be their primary portal, not
      // the one they're currently viewing).
      let portalId = p.portal_id ? parseInt(p.portal_id) : user.portalId;
      if (!portalId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Portal não identificado' }) };
      const res = await client.query(
        `SELECT id, guide_date, guide_number, pdf_data, eurocodes, uploaded_at, COALESCE(file_type, 'application/pdf') AS file_type
         FROM transport_guides
         WHERE portal_id = $1 AND guide_date = $2
           AND guide_date >= CURRENT_DATE - INTERVAL '1 day'
         ORDER BY uploaded_at DESC`,
        [portalId, date]
      );
      if (!res.rows.length) return { statusCode: 200, headers, body: JSON.stringify({ success: true, guide: null }) };
      const mergedEc = [...new Set(res.rows.flatMap(r => r.eurocodes || []))];
      const latest = res.rows[0];
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, guide: { ...latest, eurocodes: mergedEc }, guide_count: res.rows.length }) };
    }

    if (event.httpMethod === 'POST') {
      if (!['admin', 'coordinator', 'coordenador'].includes(user.role)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Sem permissão' }) };
      }
      const body = JSON.parse(event.body || '{}');
      const { pdf_data, file_type, _portalId, guide_date: rawGuideDate } = body;
      if (!pdf_data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ficheiro em falta' }) };

      // Prefer _portalId (from window.activePortalId on the frontend) over JWT portal so that
      // coordinators managing multiple portals upload the guide to the correct portal.
      let portalId = _portalId ? parseInt(_portalId) : user.portalId;
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
          console.warn('transport-guide PDF parse warning:', e.message);
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

      // Only cleanup guides older than 1 day — never delete same-date guides
      await client.query(
        "DELETE FROM transport_guides WHERE portal_id = $1 AND guide_date < CURRENT_DATE - INTERVAL '1 day'",
        [portalId]
      );
      const res = await client.query(
        `INSERT INTO transport_guides (portal_id, guide_date, pdf_data, eurocodes, uploaded_by, file_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, guide_date, eurocodes, uploaded_at, file_type`,
        [portalId, guideDate, pdf_data, eurocodes, user.userId, storedFileType]
      );
      // Merge eurocodes from all guides for this date
      const allRows = await client.query(
        `SELECT eurocodes FROM transport_guides WHERE portal_id = $1 AND guide_date = $2`,
        [portalId, guideDate]
      );
      const allEurocodes = [...new Set(allRows.rows.flatMap(r => r.eurocodes || []))];
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, guide: { ...res.rows[0], pdf_data, eurocodes: allEurocodes }, eurocodes_found: eurocodes, all_eurocodes: allEurocodes, guide_count: allRows.rows.length })
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
