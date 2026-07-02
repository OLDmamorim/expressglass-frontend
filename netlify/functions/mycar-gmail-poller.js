// netlify/functions/mycar-gmail-poller.js
// Corre a cada 15 min — lê emails não lidos no Gmail e importa serviços por matrícula
// Também aceita POST autenticado para trigger manual via UI

// Polyfill: undici (dep do mailparser) usa File global disponível só no Node 20+
// Em Node 18 o File não é global mas existe em require('buffer')
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

// Extrai matrícula/VIN do assunto quando o email não traz tabela HTML
// (encaminhados com os dados em imagem, ex.: "FW: BM-79-LI",
//  "FW: BL-45-HM | WF0PXX...", "FW: M-049245//LSJW94393RG049245").
function extractIdFromSubject(subject) {
  if (!subject) return null;
  const s = subject.toUpperCase();
  // Matrícula PT: XX-XX-XX (letras/dígitos)
  const plate = s.match(/\b([A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2})\b/);
  if (plate) return plate[1];
  // VIN: 17 caracteres (sem I, O, Q)
  const vin = s.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vin) return vin[1];
  return null;
}

// Lê a tabela HTML do email (incluindo emails encaminhados/FW) e devolve array de serviços
function parseTableHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const services = [];

  $('table').each((_, table) => {
    const $rows = $(table).find('tr');
    let headerRowIdx = -1;
    let headers = [];

    // Procura a linha de cabeçalho que contém "Matrícula" — pode não ser a primeira linha
    $rows.each((rowIdx, row) => {
      const cells = $(row).find('th, td').map((_, c) => $(c).text().trim().toLowerCase()).get();
      if (cells.some(h => /matr[ií]cula/i.test(h))) {
        headerRowIdx = rowIdx;
        headers = cells;
        return false; // break
      }
    });

    if (headerRowIdx < 0) return; // tabela sem coluna Matrícula

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
  });

  return services;
}

// Extrai o texto útil do email — remove headers de FW, assinaturas e linhas de tabela
function cleanEmailBody(text) {
  if (!text) return null;

  // Se é email encaminhado, pegar só o conteúdo após os headers do original
  const fwdRx = /[-]{4,}\s*(Forwarded message|Mensagem encaminhada|Original Message)/i;
  const fwdIdx = text.search(fwdRx);
  if (fwdIdx >= 0) {
    const after = text.slice(fwdIdx);
    const lines = after.split('\n');
    // saltar linha do marker + headers (From/Date/Subject/To)
    let bodyStart = 0;
    let inHeaders = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^(From|De|Date|Data|Subject|Assunto|To|Para|Cc):/i.test(lines[i].trim())) { inHeaders = true; continue; }
      if (inHeaders && lines[i].trim() === '') { bodyStart = i + 1; break; }
    }
    text = lines.slice(bodyStart).join('\n');
  }

  // Cortar na palavra de fecho — assinatura começa depois
  const closingRx = /^(Obrigad[ao][\.\!,]?|Cumprimentos[\.\!]?|Com os melhores cumprimentos|Atenciosamente[\.\!]?|Com estima|Regards|Best regards|Abraços)/im;
  const closingMatch = text.match(closingRx);
  if (closingMatch) {
    text = text.slice(0, closingMatch.index + closingMatch[0].length);
  }

  const cleaned = text.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return false;
    if (/^[-=_*>]{3,}$/.test(t)) return false;                        // dividers / quoted markers
    if (/^(From|De|Date|Data|Subject|Assunto|To|Para|Cc|Sent|Enviado):/i.test(t)) return false;
    if (/^\[?(image|imagem|cid:)/i.test(t)) return false;             // inline images
    if ((t.match(/\t/g) || []).length >= 2) return false;             // linhas de tabela
    // Avisos de segurança do servidor de email
    if (/segurança.*email|email.*nossa.*organiza|email externo|não carregue|atenção.*email/i.test(t)) return false;
    if (/^[\[🔒].*segurança/i.test(t) || /^\[aten/i.test(t)) return false;
    // Linhas de assinatura
    if (/\d{4}-\d{3}/.test(t)) return false;                         // código postal
    if (/^T[:\.\s]+[\+\d]/.test(t) || /^Tel[:\.\s]+[\+\d]/i.test(t)) return false; // telefone
    if (/mailto:|<[^>]+@[^>]{1,30}>/.test(t)) return false;          // mailto / email entre <>
    if (/^(Rua|Av\.|Avenida|Largo|Travessa|Praceta|Estrada)\s/i.test(t)) return false; // morada
    if (/^Enviada?:/i.test(t)) return false;                         // data de reencaminhamento
    return true;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return cleaned.slice(0, 600) || null;
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
      status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'encomendado', 'realizado', 'faturado', 'rejeitado')),
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
  // Migrar constraint de status para incluir novos estados
  await client.query(`ALTER TABLE mycar_services DROP CONSTRAINT IF EXISTS mycar_services_status_check`);
  await client.query(`UPDATE mycar_services SET status = 'realizado' WHERE status = 'tratado'`);
  await client.query(`ALTER TABLE mycar_services ADD CONSTRAINT mycar_services_status_check CHECK (status IN ('pendente', 'encomendado', 'realizado', 'faturado', 'rejeitado'))`);
}

// Liga ao Gmail via IMAP e devolve emails dos últimos 3 dias
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

        // Pesquisar emails dos últimos 3 dias (apanha emails já lidos que falharam o parse)
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
      const body     = cleanEmailBody(email.text || '');

      const $dbg = html ? cheerio.load(html) : null;
      const tableCount = $dbg ? $dbg('table').length : 0;
      console.log(`📧 "${subject}" | html:${!!html} | tabelas:${tableCount} | from:${from}`);

      let services = html ? parseTableHtml(html) : [];

      // Fallback: sem tabela → tentar extrair a matrícula/VIN do assunto.
      // Estes emails encaminhados trazem os dados em imagem, por isso entra
      // só a matrícula (pendente) para o coordenador tratar manualmente.
      if (services.length === 0) {
        const subjId = extractIdFromSubject(subject);
        if (subjId) {
          services = [{ matricula: subjId, descricao: null, valor: null, eurocode: null, ne: null }];
          console.log(`🔤 Matrícula extraída do assunto: ${subjId} ("${subject}")`);
        } else {
          console.log(`⏭️ Sem tabela nem matrícula no assunto: "${subject}" (tabelas:${tableCount})`);
          continue;
        }
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
              email_from, email_subject, email_received_at, portal_id, notas, email_body)
           VALUES ($1,$2,$3,$4,'pendente',$5,$6,$7,$8,$9,$10)`,
          [svc.matricula, svc.descricao, svc.valor, svc.eurocode,
           from, subject, date, portalId, wip, body || null]
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
  const method = event?.httpMethod;
  console.log('🔔 Invocado | httpMethod:', method ?? 'NONE', '| next_run:', event?.next_run ?? 'NONE');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (method === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // POST via UI — requer autenticação JWT
  if (method === 'POST') {
    try {
      const authHeader = event.headers.authorization || event.headers.Authorization || '';
      if (!authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
      jwt.verify(authHeader.substring(7), JWT_SECRET);
    } catch {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
    }
  }

  // Qualquer outra invocação (scheduled, GET, HEAD, etc.) — corre o poller
  try {
    const result = await runPoller();
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
  } catch (error) {
    console.error('❌ Erro mycar-gmail-poller:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
