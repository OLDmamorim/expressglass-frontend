// netlify/functions/mycar-gmail-poller.js
// Corre a cada 15 min — lê emails não lidos no Gmail e importa serviços por matrícula
// Também aceita POST autenticado para trigger manual via UI
const { Pool } = require('pg');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const cheerio = require('cheerio');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const GMAIL_USER     = process.env.MYCAR_GMAIL_USER;
const GMAIL_PASSWORD = process.env.MYCAR_GMAIL_PASSWORD;

// Extrai o número WIP do assunto: "RE: BR-04-QA | SJNTAAJ12U2111980 | WIP: 61336" → "WIP: 61336"
function extractWip(subject) {
  const m = subject.match(/WIP[:\s]+(\w+)/i);
  return m ? `WIP: ${m[1]}` : null;
}

function parseValor(str) {
  if (!str) return null;
  const v = parseFloat(str.replace(/[^\d,.-]/g, '').replace(',', '.'));
  return isNaN(v) ? null : v;
}

// Lê a tabela HTML do email (incluindo emails encaminhados/FW) e devolve array de serviços
function parseTableHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const services = [];

  $('table').each((_, table) => {
    // Ignorar tabelas de assinatura/layout (poucas colunas ou sem texto de cabeçalho relevante)
    const headerCells = $(table).find('tr').first().find('th, td');
    if (headerCells.length < 3) return;

    const headers = headerCells.map((_, c) => $(c).text().trim().toLowerCase()).get();

    const matIdx = headers.findIndex(h => /matr[ií]cula/i.test(h));
    if (matIdx < 0) return; // não é a tabela certa

    const svcIdx = headers.findIndex(h => /servi[çc]o|descri[çc][aã]o/i.test(h));
    const valIdx = headers.findIndex(h => /valor/i.test(h));
    const neIdx  = headers.findIndex(h => /^ne$/i.test(h));
    const notIdx = headers.findIndex(h => /notas?/i.test(h));

    $(table).find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
      if (cells.length < 2) return;
      const mat = cells[matIdx]?.replace(/\s/g, '').toUpperCase();
      if (!mat || mat.length < 4) return;

      services.push({
        matricula: mat,
        descricao: svcIdx >= 0 ? (cells[svcIdx] || null) : null,
        valor:     valIdx >= 0 ? parseValor(cells[valIdx]) : null,
        eurocode:  notIdx >= 0 ? (cells[notIdx] || null) : null,
        ne:        neIdx  >= 0 ? (cells[neIdx]  || null) : null,
      });
    });
  });

  return services;
}

// Lookup do portal Mycar Center na DB
async function getMycaPortalId(client) {
  const { rows } = await client.query(
    `SELECT id FROM portals WHERE name = 'Mycar Center' LIMIT 1`
  );
  return rows.length > 0 ? rows[0].id : null;
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
      obs_tecnico TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS obs_tecnico TEXT`);
}

// Liga ao Gmail via IMAP e devolve emails não lidos
function fetchUnseenEmails() {
  return new Promise((resolve, reject) => {
    if (!GMAIL_USER || !GMAIL_PASSWORD) {
      reject(new Error('MYCAR_GMAIL_USER ou MYCAR_GMAIL_PASSWORD não configurados'));
      return;
    }

    const imap = new Imap({
      user: GMAIL_USER,
      password: GMAIL_PASSWORD,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 20000,
      authTimeout: 10000
    });

    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); reject(err); return; }

        // Procurar emails não lidos
        imap.search(['UNSEEN'], (err, uids) => {
          if (err) { imap.end(); reject(err); return; }
          if (!uids || uids.length === 0) { imap.end(); resolve([]); return; }

          console.log(`📬 ${uids.length} email(s) não lido(s) encontrado(s)`);

          const fetch = imap.fetch(uids, { bodies: '', markSeen: true });
          const pending = [];

          fetch.on('message', (msg) => {
            const p = new Promise((res) => {
              const chunks = [];
              msg.on('body', (stream) => {
                stream.on('data', chunk => chunks.push(chunk));
                stream.once('end', () => res(Buffer.concat(chunks)));
              });
              msg.once('attributes', () => {});
            });
            pending.push(p);
          });

          fetch.once('end', async () => {
            for (const raw of await Promise.all(pending)) {
              const parsed = await simpleParser(raw);
              emails.push(parsed);
            }
            imap.end();
            resolve(emails);
          });

          fetch.once('error', (err) => { imap.end(); reject(err); });
        });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

async function runPoller() {
  console.log('🔄 Mycar Gmail Poller: início');

  const emails = await fetchUnseenEmails();

  if (emails.length === 0) {
    console.log('📭 Sem emails novos');
    return { processed: 0, emails: 0 };
  }

  const client = await pool.connect();
  try {
    await ensureTable(client);
    const portalId = await getMycaPortalId(client);
    let totalImported = 0;

    for (const email of emails) {
      const subject  = email.subject || '';
      const from     = email.from?.text || '';
      const date     = email.date || new Date();
      const html     = email.html || '';
      const wip      = extractWip(subject);

      const services = html ? parseTableHtml(html) : [];

      if (services.length === 0) {
        console.log(`⏭️ Sem tabela de serviços em: "${subject}"`);
        continue;
      }

      for (const svc of services) {
        const { rows: existing } = await client.query(
          `SELECT id FROM mycar_services WHERE matricula = $1 AND email_subject = $2 LIMIT 1`,
          [svc.matricula, subject]
        );
        if (existing.length > 0) {
          console.log(`⏭️ Duplicado ignorado: ${svc.matricula} / "${subject}"`);
          continue;
        }

        await client.query(
          `INSERT INTO mycar_services
             (matricula, descricao, valor, eurocode, status,
              email_from, email_subject, email_received_at, portal_id, notas)
           VALUES ($1,$2,$3,$4,'pendente',$5,$6,$7,$8,$9)`,
          [svc.matricula, svc.descricao, svc.valor, svc.eurocode,
           from, subject, date, portalId, wip]
        );
        totalImported++;
        console.log(`✅ Importado: ${svc.matricula} | ${svc.descricao} | €${svc.valor}`);
      }
    }

    console.log(`📊 Total: ${totalImported} serviço(s) de ${emails.length} email(s)`);
    return { processed: totalImported, emails: emails.length };

  } finally {
    client.release();
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Scheduled invocation (no httpMethod)
  if (!event || !event.httpMethod) {
    try {
      const result = await runPoller();
      return { statusCode: 200, body: JSON.stringify({ success: true, ...result }) };
    } catch (error) {
      console.error('❌ Erro mycar-gmail-poller:', error.message);
      return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod === 'POST') {
    // Require JWT auth
    try {
      const authHeader = event.headers.authorization || event.headers.Authorization || '';
      if (!authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
      jwt.verify(authHeader.substring(7), JWT_SECRET);
    } catch {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
    }

    try {
      const result = await runPoller();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    } catch (error) {
      console.error('❌ Erro mycar-gmail-poller:', error.message);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
};
