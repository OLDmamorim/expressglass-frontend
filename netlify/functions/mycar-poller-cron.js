// netlify/functions/mycar-poller-cron.js
// Pure scheduled function — runs every 15 min via Netlify Scheduled Functions
// No HTTP handling to avoid any method-check conflicts

if (typeof File === 'undefined') {
  try { global.File = require('buffer').File; } catch (_) {
    global.File = class File extends Blob {
      constructor(bits, name, opts = {}) { super(bits, opts); this.name = name; this.lastModified = opts.lastModified ?? Date.now(); }
    };
  }
}

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

function extractWip(subject) {
  const m = subject.match(/WIP[:\s]+(\w+)/i);
  return m ? `WIP: ${m[1]}` : null;
}

function parseValor(str) {
  if (!str) return null;
  const v = parseFloat(str.replace(/[^\d,.-]/g, '').replace(',', '.'));
  return isNaN(v) ? null : v;
}

// Portuguese plate: AA-##-AA (current), ##-AA-## or ##-##-AA (older)
const PLATE_RX = /^[A-Z]{2}-\d{2}-[A-Z]{2}$|^\d{2}-[A-Z]{2}-\d{2}$|^\d{2}-\d{2}-[A-Z]{2}$/i;
const EUROCODE_RX = /\b\d{4}[A-Z]{3,}[0-9A-Z]*\b/i;

function parseTableHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const services = [];

  $('table').each((_, table) => {
    const $rows = $(table).find('tr');
    let headerRowIdx = -1;
    let headers = [];

    $rows.each((rowIdx, row) => {
      const cells = $(row).find('th, td').map((_, c) => $(c).text().trim().toLowerCase()).get();
      if (cells.some(h => /matr[ií]cula/i.test(h))) {
        headerRowIdx = rowIdx;
        headers = cells;
        return false;
      }
    });

    if (headerRowIdx >= 0) {
      // Standard parsing with header row
      const matIdx = headers.findIndex(h => /matr[ií]cula/i.test(h));
      const svcIdx = headers.findIndex(h => /servi[çc]o|descri[çc][aã]o/i.test(h));
      const valIdx = headers.findIndex(h => /valor/i.test(h));
      const neIdx  = headers.findIndex(h => /^ne$/i.test(h));
      const notIdx = headers.findIndex(h => /notas?/i.test(h));

      $rows.slice(headerRowIdx + 1).each((_, row) => {
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
    } else {
      // Fallback: headerless table — detect plate pattern in first column
      // Handles emails like BR-42-XN that go straight to data rows without headers
      $rows.each((_, row) => {
        const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
        if (cells.length < 2) return;
        const mat = cells[0]?.replace(/\s/g, '').toUpperCase();
        if (!mat || !PLATE_RX.test(mat)) return;

        // Columns: [0]=plate, [1]=description, [2]=value, [3..n]=scan for eurocode
        let eurocode = null;
        for (let i = 2; i < cells.length; i++) {
          const m = cells[i]?.toUpperCase().match(EUROCODE_RX);
          if (m) { eurocode = m[0]; break; }
        }

        services.push({
          matricula: mat,
          descricao: cells[1] || null,
          valor:     cells.length > 2 ? parseValor(cells[2]) : null,
          eurocode,
          ne: null,
        });
      });
    }
  });

  return services;
}

function cleanEmailBody(text) {
  if (!text) return null;

  const fwdRx = /[-]{4,}\s*(Forwarded message|Mensagem encaminhada|Original Message)/i;
  const fwdIdx = text.search(fwdRx);
  if (fwdIdx >= 0) {
    const after = text.slice(fwdIdx);
    const lines = after.split('\n');
    let bodyStart = 0;
    let inHeaders = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^(From|De|Date|Data|Subject|Assunto|To|Para|Cc):/i.test(lines[i].trim())) { inHeaders = true; continue; }
      if (inHeaders && lines[i].trim() === '') { bodyStart = i + 1; break; }
    }
    text = lines.slice(bodyStart).join('\n');
  }

  const cleaned = text.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return false;
    if (/^[-=_*>]{3,}$/.test(t)) return false;
    if (/^(From|De|Date|Data|Subject|Assunto|To|Para|Cc|Sent|Enviado):/i.test(t)) return false;
    if (/^\[?(image|imagem|cid:)/i.test(t)) return false;
    if ((t.match(/\t/g) || []).length >= 2) return false;
    return true;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return cleaned.slice(0, 600) || null;
}

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
      status VARCHAR(20) DEFAULT 'pendente',
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
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS email_body TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP`);
  await client.query(`ALTER TABLE mycar_services DROP CONSTRAINT IF EXISTS mycar_services_status_check`);
  await client.query(`UPDATE mycar_services SET status = 'realizado' WHERE status = 'tratado'`);
  await client.query(`ALTER TABLE mycar_services ADD CONSTRAINT mycar_services_status_check CHECK (status IN ('pendente', 'encomendado', 'realizado', 'faturado', 'rejeitado'))`);
}

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

        const since = new Date();
        since.setDate(since.getDate() - 3);
        imap.search([['SINCE', since]], (err, uids) => {
          if (err) { imap.end(); reject(err); return; }
          if (!uids || uids.length === 0) { imap.end(); resolve([]); return; }

          console.log(`📬 ${uids.length} email(s) encontrado(s) nos últimos 3 dias`);

          const fetch = imap.fetch(uids, { bodies: '', markSeen: false });
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

exports.handler = async () => {
  console.log('⏰ mycar-poller-cron: início');

  const client = await pool.connect();
  try {
    await ensureTable(client);
    const portalId = await getMycaPortalId(client);

    let emails;
    try {
      emails = await fetchUnseenEmails();
    } catch (err) {
      console.error('❌ Erro IMAP:', err.message);
      return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
    }

    if (emails.length === 0) {
      console.log('📭 Sem emails');
      return { statusCode: 200, body: JSON.stringify({ success: true, processed: 0, emails: 0 }) };
    }

    let totalImported = 0;

    for (const email of emails) {
      const subject  = email.subject || '';
      const from     = email.from?.text || '';
      const date     = email.date || new Date();
      const html     = email.html || '';
      const wip      = extractWip(subject);
      const body     = cleanEmailBody(email.text || '');

      const tableCount = html ? cheerio.load(html)('table').length : 0;
      console.log(`📧 "${subject}" | html:${!!html} | tabelas:${tableCount}`);

      const services = html ? parseTableHtml(html) : [];

      if (services.length === 0) {
        console.log(`⏭️ Sem tabela: "${subject}"`);
        continue;
      }

      for (const svc of services) {
        const { rows: existing } = await client.query(
          `SELECT id FROM mycar_services WHERE matricula = $1 AND email_subject = $2 LIMIT 1`,
          [svc.matricula, subject]
        );
        if (existing.length > 0) {
          console.log(`⏭️ Duplicado: ${svc.matricula}`);
          continue;
        }

        await client.query(
          `INSERT INTO mycar_services
             (matricula, descricao, valor, eurocode, status,
              email_from, email_subject, email_received_at, portal_id, notas, email_body)
           VALUES ($1,$2,$3,$4,'pendente',$5,$6,$7,$8,$9,$10)`,
          [svc.matricula, svc.descricao, svc.valor, svc.eurocode,
           from, subject, date, portalId, wip, body || null]
        );
        totalImported++;
        console.log(`✅ ${svc.matricula} | ${svc.descricao} | €${svc.valor}`);
      }
    }

    console.log(`📊 Total: ${totalImported} serviço(s) de ${emails.length} email(s)`);
    return { statusCode: 200, body: JSON.stringify({ success: true, processed: totalImported, emails: emails.length }) };

  } finally {
    client.release();
  }
};
