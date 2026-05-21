// netlify/functions/mycar-email-ingest.js
// Recebe email (via webhook Mailgun/SendGrid ou import manual) e extrai serviços por matrícula
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const MYCAR_EMAIL_SECRET = process.env.MYCAR_EMAIL_SECRET || '';
const MYCAR_ALLOWED_SENDERS = (process.env.MYCAR_ALLOWED_SENDERS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function getUserFromToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.substring(7), JWT_SECRET);
  } catch {
    return null;
  }
}

function parseDate(str) {
  if (!str) return null;
  const d1 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (d1) {
    const [, d, m, y] = d1;
    const year = y.length === 2 ? '20' + y : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
  return null;
}

function parseTextTable(text) {
  if (!text) return [];
  const services = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const matRx  = /matr[ií]cula|plate|viatura|veículo|veiculo/i;
  const dateRx = /data|date/i;
  const descRx = /descri[çc][aã]o|servi[çc]o|description|service|obs/i;
  const valRx  = /valor|value|pre[çc]o|price|pvp|montante/i;
  const euroRx = /eurocode|euro\s*c[oó]d|c[oó]digo/i;

  let headerIdx = -1;
  let colMap = {};

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(/[\t;,|]+/).map(c => c.trim());
    if (cols.length < 2) continue;
    const joined = cols.join(' ');
    if (matRx.test(joined) || (dateRx.test(joined) && valRx.test(joined))) {
      headerIdx = i;
      colMap = {
        matricula: cols.findIndex(h => matRx.test(h)),
        data:      cols.findIndex(h => dateRx.test(h)),
        descricao: cols.findIndex(h => descRx.test(h)),
        valor:     cols.findIndex(h => valRx.test(h)),
        eurocode:  cols.findIndex(h => euroRx.test(h))
      };
      break;
    }
  }

  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(/[\t;,|]+/).map(c => c.trim());
      if (cols.length < 2) continue;
      const svc = {};
      if (colMap.matricula >= 0 && cols[colMap.matricula]) svc.matricula = cols[colMap.matricula].toUpperCase().replace(/\s/g, '');
      if (colMap.data >= 0 && cols[colMap.data])           svc.data_servico = parseDate(cols[colMap.data]);
      if (colMap.descricao >= 0 && cols[colMap.descricao]) svc.descricao = cols[colMap.descricao];
      if (colMap.valor >= 0 && cols[colMap.valor]) {
        const v = parseFloat(cols[colMap.valor].replace(',', '.').replace(/[^\d.-]/g, ''));
        if (!isNaN(v)) svc.valor = v;
      }
      if (colMap.eurocode >= 0 && cols[colMap.eurocode]) svc.eurocode = cols[colMap.eurocode];
      if (svc.matricula && svc.matricula.length >= 4) services.push(svc);
    }
  } else {
    // Fallback: procurar padrões de matrícula PT (AA-00-AA, 00-AA-00, AA-00-00, 00-00-AA)
    const plateRx = /\b([A-Z]{2}-\d{2}-[A-Z]{2}|\d{2}-[A-Z]{2}-\d{2}|[A-Z]{2}-\d{2}-\d{2}|\d{2}-\d{2}-[A-Z]{2})\b/gi;
    for (const line of lines) {
      const match = plateRx.exec(line);
      if (match) services.push({ matricula: match[1].toUpperCase() });
      plateRx.lastIndex = 0;
    }
  }

  return services;
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mycar_services (
      id SERIAL PRIMARY KEY,
      matricula VARCHAR(20) NOT NULL,
      data_servico DATE,
      descricao TEXT,
      valor DECIMAL(10,2),
      eurocode VARCHAR(100),
      status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'tratado', 'rejeitado')),
      email_from VARCHAR(255),
      email_subject VARCHAR(500),
      email_received_at TIMESTAMP,
      portal_id INTEGER,
      notas TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mycar-Secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  }

  const user = getUserFromToken(event);
  const webhookSecret = event.headers['x-mycar-secret'] || event.headers['X-Mycar-Secret'];
  const isAuthedUser    = user !== null;
  const isAuthedWebhook = MYCAR_EMAIL_SECRET && webhookSecret === MYCAR_EMAIL_SECRET;

  if (!isAuthedUser && !isAuthedWebhook) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    let emailFrom    = null;
    let emailSubject = null;
    let emailDate    = new Date().toISOString();
    let services     = [];
    let portalId     = user?.portalId || null;

    if (body.portal_id) portalId = parseInt(body.portal_id);

    // Caso 1: array de serviços direto (import manual via UI)
    if (Array.isArray(body.services)) {
      emailFrom    = body.email_from    || null;
      emailSubject = body.email_subject || null;
      emailDate    = body.email_date    || emailDate;
      services     = body.services;
    }
    // Caso 2: webhook Mailgun / SendGrid inbound
    else if (body.sender || body.from) {
      emailFrom    = body.sender || body.from;
      emailSubject = body.subject || '';
      emailDate    = body.Date   || body.date || emailDate;
      const text   = body['body-plain'] || body.text || body.body || '';

      if (MYCAR_ALLOWED_SENDERS.length > 0) {
        const senderLow = emailFrom.toLowerCase();
        if (!MYCAR_ALLOWED_SENDERS.some(s => senderLow.includes(s))) {
          return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Remetente não autorizado' }) };
        }
      }
      services = parseTextTable(text);
    }
    // Caso 3: texto livre (paste de email)
    else if (body.text || body.content) {
      emailFrom    = body.from    || null;
      emailSubject = body.subject || null;
      emailDate    = body.date    || emailDate;
      services     = parseTextTable(body.text || body.content);
    }

    if (services.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Nenhum serviço encontrado no conteúdo' }) };
    }

    const client = await pool.connect();
    try {
      await ensureTable(client);
      const created = [];

      for (const svc of services) {
        if (!svc.matricula) continue;
        const { rows } = await client.query(
          `INSERT INTO mycar_services
             (matricula, data_servico, descricao, valor, eurocode, status,
              email_from, email_subject, email_received_at, portal_id)
           VALUES ($1,$2,$3,$4,$5,'pendente',$6,$7,$8,$9) RETURNING *`,
          [
            svc.matricula.toUpperCase().trim(),
            svc.data_servico  || null,
            svc.descricao     || null,
            svc.valor         !== undefined ? svc.valor : null,
            svc.eurocode      || null,
            emailFrom,
            emailSubject,
            emailDate,
            svc.portal_id || portalId || null
          ]
        );
        created.push(rows[0]);
      }

      console.log(`📧 Mycar ingest: ${created.length} serviços de "${emailFrom || 'manual'}"`);
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, count: created.length, data: created }) };

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Erro mycar-email-ingest:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Erro interno do servidor' }) };
  }
};
