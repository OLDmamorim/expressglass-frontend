// netlify/functions/stock-reports.js
// Reportes de stock (vidro errado, danificado, com defeito, partido) feitos no
// cartão do agendamento. Vão para o PoweringEG, para o menu Stock do Portal da
// loja PRINCIPAL do SM (Braga SM → Braga): lá dispara o email e os lembretes
// até alguém marcar como tratado.
//  - GET  ?portal_id=X           → os reportes deste portal (pendentes e tratados)
//  - POST { portal_id, appointment_id, matricula, eurocode, problema,
//           observacoes, foto: { base64, mimeType } } → regista o reporte
// O portal da agenda liga-se à loja do PoweringEG por portals.powering_loja_id.

const https = require('https');
const jwt   = require('jsonwebtoken');
const { Pool } = require('pg');

const JWT_SECRET    = process.env.JWT_SECRET    || 'expressglass-secret-key-change-in-production';
const POWERING_KEY  = process.env.POWERING_EG_API_KEY;
const POWERING_HOST = process.env.POWERING_EG_HOST || 'poweringeg.pt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PROBLEMAS = ['errado', 'danificado', 'defeito', 'partido'];

function pedirPowering(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: POWERING_HOST,
        path: `/api/external${path}`,
        method,
        headers: {
          'X-API-Key': POWERING_KEY,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* não é JSON */ }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const erro = new Error((json && (json.error || json.message)) || `PoweringEG HTTP ${res.statusCode}`);
            erro.statusCode = res.statusCode;
            reject(erro);
            return;
          }
          if (!json) { reject(new Error('Resposta inválida do PoweringEG')); return; }
          resolve(json);
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function lojaDoPortal(portalId) {
  const id = parseInt(portalId, 10);
  if (!id) return null;
  const { rows } = await pool.query('SELECT powering_loja_id FROM portals WHERE id = $1 LIMIT 1', [id]);
  return rows[0]?.powering_loja_id ?? null;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let user;
  try {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
    user = jwt.verify(auth.substring(7), JWT_SECRET);
  } catch (_) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
  }
  if (!POWERING_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'POWERING_EG_API_KEY não configurada' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const p = event.queryStringParameters || {};
      const lojaId = await lojaDoPortal(p.portal_id || user.portalId);
      if (!lojaId) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: 'sem_portal', error: 'Portal sem loja do PoweringEG' }) };
      }
      const data = await pedirPowering('GET', `/reportes-stock?lojaId=${lojaId}`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, lojaId, reportes: data.reportes || [] }) };
    }

    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (!PROBLEMAS.includes(b.problema)) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Escolha o problema do vidro' }) };
      }
      const lojaId = await lojaDoPortal(b.portal_id || user.portalId);
      if (!lojaId) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, reason: 'sem_portal', error: 'Este portal não está ligado a uma loja do PoweringEG' }) };
      }
      const foto = b.foto && typeof b.foto.base64 === 'string' && /^image\//.test(String(b.foto.mimeType || ''))
        ? { base64: b.foto.base64, mimeType: b.foto.mimeType }
        : null;
      const r = await pedirPowering('POST', '/reportes-stock', {
        lojaId,
        eurocode: String(b.eurocode || ''),
        problema: b.problema,
        matricula: b.matricula ? String(b.matricula).slice(0, 20) : null,
        observacoes: b.observacoes ? String(b.observacoes).slice(0, 1000) : null,
        reportadoPor: user.username || user.email || null,
        agendaPortalId: parseInt(b.portal_id || user.portalId, 10) || null,
        agendaServicoId: b.appointment_id != null ? String(b.appointment_id) : null,
        foto,
      });
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, ...r }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  } catch (error) {
    const status = error.statusCode === 400 ? 400 : 502;
    if (status !== 400) console.error('❌ stock-reports:', error.message);
    return { statusCode: status, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
