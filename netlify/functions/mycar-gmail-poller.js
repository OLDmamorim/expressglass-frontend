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
  // Estado do poller (cursor = último UID processado)
  await client.query(`CREATE TABLE IF NOT EXISTS mycar_poller_state (k TEXT PRIMARY KEY, v TEXT)`);
}

async function getCursor(client) {
  const { rows } = await client.query(`SELECT v FROM mycar_poller_state WHERE k = 'cursor'`);
  return rows.length ? (parseInt(rows[0].v) || 0) : 0;
}
async function setCursor(client, uid) {
  await client.query(
    `INSERT INTO mycar_poller_state (k, v) VALUES ('cursor', $1)
     ON CONFLICT (k) DO UPDATE SET v = $1`,
    [String(uid)]
  );
}

// Janela de leitura e limites por execução. Lemos CABEÇALHOS de muitos
// emails (barato) mas só descarregamos o CORPO dos que são mesmo de
// serviço (matrícula no assunto), para não esgotar o tempo.
const SEARCH_DAYS   = 40;   // janela de pesquisa
const SCAN_PER_RUN  = 25;   // quantos emails analisamos (cabeçalho) por execução
const BODY_PER_RUN  = 6;    // quantos corpos descarregamos por execução

// Determinístico via CURSOR (último UID processado). Não depende de marcar
// como lido, por isso nunca fica preso a reler os mesmos emails.
// Devolve { emails, nextCursor, remaining, scanned }.
function fetchBatch(cursor) {
  return new Promise((resolve, reject) => {
    if (!GMAIL_USER || !GMAIL_PASSWORD) {
      reject(new Error('MYCAR_GMAIL_USER ou MYCAR_GMAIL_PASSWORD não configurados'));
      return;
    }
    const imap = new Imap({
      user: GMAIL_USER, password: GMAIL_PASSWORD, host: 'imap.gmail.com',
      port: 993, tls: true, tlsOptions: { rejectUnauthorized: false },
      connTimeout: 20000, authTimeout: 10000
    });
    const fail = (e) => { try { imap.end(); } catch (_) {} reject(e); };

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => { // readonly — não alteramos flags
        if (err) return fail(err);
        const since = new Date(); since.setDate(since.getDate() - SEARCH_DAYS);
        imap.search([['SINCE', since]], (err, uids) => {
          if (err) return fail(err);
          uids = (uids || []).sort((a, b) => a - b);
          const pend = uids.filter(u => u > cursor);
          const scanBatch = pend.slice(0, SCAN_PER_RUN);
          if (scanBatch.length === 0) { imap.end(); return resolve({ emails: [], nextCursor: cursor, remaining: 0, scanned: 0 }); }

          // Fase 1 — cabeçalhos (assunto) para saber quais são de serviço
          const subjOf = {};
          const hf = imap.fetch(scanBatch, { bodies: 'HEADER.FIELDS (SUBJECT)', markSeen: false });
          hf.on('message', (msg) => {
            let uid = null; const chunks = [];
            msg.on('body', (stream) => { stream.on('data', c => chunks.push(c)); });
            msg.once('attributes', (a) => { uid = a.uid; });
            msg.once('end', () => { const h = Imap.parseHeader(Buffer.concat(chunks).toString('utf8')); subjOf[uid] = (h.subject && h.subject[0]) || ''; });
          });
          hf.once('error', fail);
          hf.once('end', () => {
            const relevant = scanBatch.filter(u => extractIdFromSubject(subjOf[u] || ''));
            // Cursor: se todos os relevantes cabem no limite de corpos, avança
            // por toda a janela analisada; senão pára no último corpo lido.
            let bodyUids, nextCursor;
            if (relevant.length <= BODY_PER_RUN) {
              bodyUids = relevant;
              nextCursor = scanBatch[scanBatch.length - 1];
            } else {
              bodyUids = relevant.slice(0, BODY_PER_RUN);
              nextCursor = bodyUids[bodyUids.length - 1];
            }
            const remaining = pend.filter(u => u > nextCursor).length;
            console.log(`📬 janela:${scanBatch.length} | serviço:${relevant.length} | corpos:${bodyUids.length} | cursor:${cursor}→${nextCursor} | faltam:${remaining}`);

            if (bodyUids.length === 0) { imap.end(); return resolve({ emails: [], nextCursor, remaining, scanned: scanBatch.length }); }

            // Fase 2 — corpo completo só dos relevantes
            const emails = [];
            const bf = imap.fetch(bodyUids, { bodies: '', markSeen: false });
            const pending = [];
            bf.on('message', (msg) => {
              const chunks = [];
              const p = new Promise((res) => {
                msg.on('body', (stream) => { stream.on('data', c => chunks.push(c)); });
                msg.once('attributes', () => {});
                msg.once('end', () => res(Buffer.concat(chunks)));
              });
              pending.push(p);
            });
            bf.once('error', fail);
            bf.once('end', async () => {
              // Um email problemático não pode travar o lote — salta-o.
              for (const raw of await Promise.all(pending)) {
                try { emails.push(await simpleParser(raw)); }
                catch (e) { console.error('⚠️ simpleParser falhou, email ignorado:', e.message); }
              }
              imap.end();
              resolve({ emails, nextCursor, remaining, scanned: scanBatch.length });
            });
          });
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

// Remarca como NÃO LIDOS os emails dos últimos N dias, para o poller os reler
// e preencher os detalhes (recuperação após importações incompletas).
function resetSeen(days) {
  return new Promise((resolve, reject) => {
    if (!GMAIL_USER || !GMAIL_PASSWORD) { reject(new Error('Gmail não configurado')); return; }
    const imap = new Imap({
      user: GMAIL_USER, password: GMAIL_PASSWORD, host: 'imap.gmail.com',
      port: 993, tls: true, tlsOptions: { rejectUnauthorized: false },
      connTimeout: 20000, authTimeout: 10000
    });
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); reject(err); return; }
        const since = new Date(); since.setDate(since.getDate() - days);
        imap.search([['SINCE', since]], (err, uids) => {
          if (err) { imap.end(); reject(err); return; }
          if (!uids || uids.length === 0) { imap.end(); resolve(0); return; }
          imap.delFlags(uids, ['\\Seen'], (err2) => {
            imap.end();
            if (err2) reject(err2); else resolve(uids.length);
          });
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

async function runPoller() {
  console.log('🔄 Mycar Gmail Poller: início');

  const client = await pool.connect();
  try {
    await ensureTable(client);
    const portalId = await getMycaPortalId(client);
    const cursor = await getCursor(client);

    const { emails, nextCursor, remaining, scanned } = await fetchBatch(cursor);
    // Avança sempre o cursor (mesmo que a janela só tenha ruído)
    if (nextCursor > cursor) await setCursor(client, nextCursor);

    if (emails.length === 0) {
      console.log(`📭 Nada de serviço nesta janela (analisados ${scanned || 0})`);
      return { processed: 0, emails: 0, remaining, stats: { withTable: 0, viaSubject: 0, noId: scanned || 0, inserted: 0, updated: 0, skipped: 0, htmlVazio: 0 } };
    }

    let totalImported = 0;
    const stats = { withTable: 0, viaSubject: 0, noId: 0, inserted: 0, updated: 0, skipped: 0, htmlVazio: 0 };

    for (const email of emails) {
     try {
      const subject  = email.subject || '';
      const from     = email.from?.text || '';
      const date     = email.date || new Date();
      const html     = email.html || '';
      const wip      = extractWip(subject);
      const body     = cleanEmailBody(email.text || '');

      if (!html) stats.htmlVazio++;

      // Matrícula/VIN vem do ASSUNTO (fiável); os detalhes (serviço/valor/
      // eurocode) vêm da TABELA no corpo. Juntamos os dois.
      const subjId = extractIdFromSubject(subject);
      const tableRows = html ? parseTableHtml(html) : [];
      if (tableRows.length > 0) stats.withTable++;

      let services;
      if (tableRows.length > 0) {
        services = tableRows.map(r => ({
          matricula: (r.matricula && r.matricula.length >= 4) ? r.matricula : subjId,
          descricao: r.descricao, valor: r.valor, eurocode: r.eurocode, ne: r.ne
        })).filter(s => s.matricula);
      } else if (subjId) {
        services = [{ matricula: subjId, descricao: null, valor: null, eurocode: null, ne: null }];
        stats.viaSubject++;
      } else {
        stats.noId++;
        continue; // não é um email de serviço MyCar
      }
      if (services.length === 0) { stats.noId++; continue; }
      console.log(`📧 "${subject}" | tabela:${tableRows.length} | serviços:${services.length}`);

      for (const svc of services) {
        // Casar por ASSUNTO (um email = um orçamento) para atualizar a
        // entrada certa mesmo que a matrícula tenha entrado diferente antes.
        const { rows: existing } = await client.query(
          `SELECT id, descricao, valor, eurocode FROM mycar_services WHERE email_subject = $1 LIMIT 1`,
          [subject]
        );
        if (existing.length > 0) {
          const e = existing[0];
          const temNovos = svc.descricao || svc.valor != null || svc.eurocode;
          const faltava  = !e.descricao && e.valor == null && !e.eurocode;
          if (temNovos && faltava) {
            await client.query(
              `UPDATE mycar_services
                 SET matricula = $1,
                     descricao = COALESCE($2, descricao),
                     valor     = COALESCE($3, valor),
                     eurocode  = COALESCE($4, eurocode),
                     notas     = COALESCE(notas, $5),
                     updated_at = NOW()
               WHERE id = $6`,
              [svc.matricula, svc.descricao, svc.valor, svc.eurocode, wip, e.id]
            );
            totalImported++; stats.updated++;
            console.log(`🔧 Detalhes preenchidos: ${svc.matricula} | ${svc.descricao} | €${svc.valor}`);
          } else {
            stats.skipped++;
          }
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
        totalImported++; stats.inserted++;
        console.log(`✅ Importado: ${svc.matricula} | ${svc.descricao} | €${svc.valor}`);
      }
     } catch (emailErr) {
       stats.erros = (stats.erros || 0) + 1;
       console.error('⚠️ Erro a processar email:', emailErr.message);
     }
    }

    console.log(`📊 Total: ${totalImported} | lidos:${emails.length} | ${JSON.stringify(stats)} | ${remaining} por processar`);
    return { processed: totalImported, emails: emails.length, remaining, stats };

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
  let bodyObj = {};
  if (method === 'POST') {
    try {
      const authHeader = event.headers.authorization || event.headers.Authorization || '';
      if (!authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
      jwt.verify(authHeader.substring(7), JWT_SECRET);
    } catch {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
    }
    try { bodyObj = JSON.parse(event.body || '{}'); } catch { bodyObj = {}; }
  }

  // Recuperação: repõe o cursor a 0 para reprocessar tudo e preencher detalhes
  if (bodyObj.action === 'reset_seen' || bodyObj.action === 'reset_cursor') {
    const client = await pool.connect();
    try {
      await ensureTable(client);
      await setCursor(client, 0);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, reset: 1 }) };
    } catch (error) {
      console.error('❌ reset_cursor:', error.message);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
    } finally {
      client.release();
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
