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
const { callAI } = require('../lib/ai');
const {
  normalizeSubject,
  isReplySubject,
  extractThreadMeta,
  buildMessageKey,
  extractMyCarMessageBody,
  isMyCarMessage,
  hasExplicitAdvanceAuthorization,
  latestExplicitAdvanceInstruction,
  shouldAnalyzeAsFollowup
} = require('./lib/mycar-email-thread');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const GMAIL_USER     = process.env.MYCAR_GMAIL_USER;
const GMAIL_PASSWORD = process.env.MYCAR_GMAIL_PASSWORD;

function askAI(systemPrompt, userMsg) {
  return callAI({
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }],
    max_tokens: 400,
    model: 'gpt-4o-mini'
  });
}

// Analisa uma nova mensagem da mesma conversa. Além de alterações e
// cancelamentos, reconhece a autorização da MyCar para executar o serviço.
async function analyzeFollowupEmail({ existing, subject, body, tableRows }) {
  // Uma ordem inequívoca não deve depender da disponibilidade nem da
  // interpretação da IA. Este é precisamente o caso "Podem avançar".
  if (hasExplicitAdvanceAuthorization(body)) {
    return {
      action: 'autorizar',
      descricao: null,
      valor: null,
      eurocode: null,
      motivo: 'A MyCar deu autorização explícita para avançar.'
    };
  }

  const systemPrompt = `És um assistente que trata emails de acompanhamento de pedidos de serviço recebidos no Mural MyCar Center (oficina de reparação/substituição de vidros automóveis em Portugal).

Já existe uma entrada registada para este assunto de email, com estes dados atuais:
- Descrição: ${existing.descricao || '(vazia)'}
- Valor: ${existing.valor != null ? existing.valor : '(vazio)'}
- Eurocode: ${existing.eurocode || '(vazio)'}
- Estado: ${existing.status}

Chegou agora uma NOVA mensagem da mesma conversa. Analisa apenas a resposta nova e ignora texto antigo citado. A tua tarefa é perceber o que a MyCar está a comunicar:
- "autorizar" — a MyCar autoriza, aprova ou dá ordem explícita para avançar/proceder com o serviço. "Pedido enviado para autorização", "aguardar autorização" ou simples confirmação de receção NÃO são autorização.
- "cancelar" — o email diz que o serviço/encomenda foi cancelado, anulado ou já não é necessário.
- "atualizar" — o email muda algo de facto (ex.: passou de substituição para reparação, mudou o valor, mudou o eurocode/peça, corrigiu a descrição).
- "sem_alteracao" — o email não traz nenhuma alteração relevante ao pedido (ex.: agradecimento, confirmação de receção, resposta administrativa sem novos dados, assunto repetido por engano).

Responde EXCLUSIVAMENTE em JSON válido, sem texto adicional:
{"action": "autorizar" | "cancelar" | "atualizar" | "sem_alteracao", "descricao": "..." ou null, "valor": number ou null, "eurocode": "..." ou null, "motivo": "resumo curto (1 frase, português) do que mudou ou da razão"}

Em "atualizar", só preenche descricao/valor/eurocode quando a nova mensagem realmente indicar esse novo valor — deixa a null o que não for mencionado (não repitas o valor antigo). Nas restantes ações, deixa descricao/valor/eurocode a null.`;

  const tableStr = (tableRows || []).map(r =>
    `- matrícula ${r.matricula || '?'} | serviço: ${r.descricao || '?'} | valor: ${r.valor != null ? r.valor : '?'} | eurocode: ${r.eurocode || '?'}`
  ).join('\n');

  const userMsg = `Assunto do email: ${subject}

Corpo do email:
${body || '(sem texto útil extraído)'}

${tableStr ? `Tabela encontrada no email:\n${tableStr}` : ''}`;

  const result = await askAI(systemPrompt, userMsg);
  if (result.error) throw new Error(result.error.message || 'Erro da IA');

  const text = result.content?.[0]?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Resposta da IA sem JSON: ' + text.slice(0, 200));
  const parsed = JSON.parse(m[0]);

  if (!['autorizar', 'cancelar', 'atualizar', 'sem_alteracao'].includes(parsed.action)) {
    parsed.action = 'sem_alteracao';
  }
  if (parsed.valor != null && typeof parsed.valor !== 'number') {
    parsed.valor = parseValor(String(parsed.valor));
  }
  // Salvaguarda para respostas muito curtas e inequívocas, como "Podem avançar".
  if (parsed.action === 'sem_alteracao' && hasExplicitAdvanceAuthorization(body)) {
    parsed.action = 'autorizar';
    parsed.motivo = parsed.motivo || 'A MyCar deu autorização explícita para avançar.';
  }
  return parsed;
}

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

  // Nas respostas, conservar apenas a mensagem nova. O texto citado pode
  // conter uma ordem antiga e não deve influenciar a decisão atual.
  const replySeparators = [
    /^\s*(?:Em|No dia)\s+.+\s+escreveu:\s*$/im,
    /^\s*On\s+.+\s+wrote:\s*$/im,
    /^\s*-{2,}\s*(?:Original Message|Mensagem original)\s*-{2,}\s*$/im,
    /^\s*(?:De|From):[^\n]+\n\s*(?:Enviado|Sent|Data|Date):/im,
    /^\s*_{5,}\s*$/m
  ];
  const replyCut = replySeparators
    .map(rx => text.search(rx))
    .filter(idx => idx > 0)
    .sort((a, b) => a - b)[0];
  if (replyCut !== undefined) text = text.slice(0, replyCut);

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

  return cleaned.slice(0, 1000) || null;
}

function emailText(email = {}) {
  const plain = String(email.text || '').trim();
  if (plain) return plain;
  if (!email.html) return '';
  try { return cheerio.load(email.html).text().trim(); }
  catch (_) { return ''; }
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
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS historico TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS email_subject_normalized TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS email_thread_id VARCHAR(64)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS email_message_id VARCHAR(500)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMP`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS last_reply_body TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS advance_authorized_at TIMESTAMP`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS advance_authorized_reason TEXT`);
  // Migrar constraint de status para incluir novos estados
  await client.query(`ALTER TABLE mycar_services DROP CONSTRAINT IF EXISTS mycar_services_status_check`);
  await client.query(`UPDATE mycar_services SET status = 'realizado' WHERE status = 'tratado'`);
  await client.query(`ALTER TABLE mycar_services ADD CONSTRAINT mycar_services_status_check CHECK (status IN ('pendente', 'encomendado', 'realizado', 'faturado', 'rejeitado'))`);
  // Estado do poller (cursor = último UID processado)
  await client.query(`CREATE TABLE IF NOT EXISTS mycar_poller_state (k TEXT PRIMARY KEY, v TEXT)`);
  // Deduplicação independente do cursor. Permite repetir um lote após erro sem
  // voltar a aplicar respostas que já foram tratadas.
  await client.query(`
    CREATE TABLE IF NOT EXISTS mycar_processed_emails (
      message_key TEXT PRIMARY KEY,
      gmail_message_id VARCHAR(64),
      rfc_message_id VARCHAR(500),
      processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_email_thread ON mycar_services(email_thread_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_email_subject_norm ON mycar_services(email_subject_normalized)`);
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

async function getStateInt(client, key) {
  const { rows } = await client.query(`SELECT v FROM mycar_poller_state WHERE k = $1`, [key]);
  return rows.length ? (parseInt(rows[0].v, 10) || 0) : 0;
}

async function setState(client, key, value) {
  await client.query(
    `INSERT INTO mycar_poller_state (k, v) VALUES ($1, $2)
     ON CONFLICT (k) DO UPDATE SET v = $2`,
    [key, String(value)]
  );
}

async function startThreadReplayOnce(client) {
  const { rows } = await client.query(
    `INSERT INTO mycar_poller_state (k, v)
     VALUES ('thread_reply_replay_v1', NOW()::text)
     ON CONFLICT (k) DO NOTHING
     RETURNING k`
  );
  if (rows.length === 0) return false;
  await setCursor(client, 0);
  return true;
}

async function getKnownThreadIds(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT email_thread_id FROM mycar_services WHERE email_thread_id IS NOT NULL`
  );
  return new Set(rows.map(r => String(r.email_thread_id)));
}

async function wasMessageProcessed(client, messageKey) {
  if (!messageKey) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM mycar_processed_emails WHERE message_key = $1 LIMIT 1`,
    [messageKey]
  );
  return rows.length > 0;
}

async function markMessageProcessed(client, messageKey, meta) {
  if (!messageKey) return;
  await client.query(
    `INSERT INTO mycar_processed_emails (message_key, gmail_message_id, rfc_message_id)
     VALUES ($1,$2,$3) ON CONFLICT (message_key) DO NOTHING`,
    [messageKey, meta.gmailMessageId, meta.messageId]
  );
}

function samePlate(a, b) {
  const norm = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return Boolean(norm(a) && norm(a) === norm(b));
}

async function findExistingService(client, svc, meta, subject, wip) {
  const refs = [...new Set([meta.messageId, ...meta.references].filter(Boolean))];

  // Primeiro, identificadores fortes da conversa. Funcionam mesmo que o
  // assunto seja alterado numa resposta.
  if (meta.gmailThreadId || refs.length || wip) {
    const { rows } = await client.query(
      `SELECT id, matricula, descricao, valor, eurocode, status,
              email_subject, email_subject_normalized, email_thread_id,
              email_message_id, email_received_at, advance_authorized_at
         FROM mycar_services
        WHERE ($1::text IS NOT NULL AND email_thread_id = $1)
           OR (CARDINALITY($2::text[]) > 0 AND email_message_id = ANY($2::text[]))
           OR ($3::text IS NOT NULL AND notas = $3)
        ORDER BY updated_at DESC, id DESC
        LIMIT 50`,
      [meta.gmailThreadId, refs, wip]
    );
    const byPlate = svc?.matricula ? rows.find(r => samePlate(r.matricula, svc.matricula)) : null;
    if (byPlate) return byPlate;
    if (!svc?.matricula && rows.length === 1) return rows[0];
  }

  if (!svc?.matricula) return null;

  // Compatibilidade com os registos antigos, que ainda não têm IDs Gmail:
  // restringir à matrícula e comparar o assunto sem RE:/FW:/ENC:.
  const { rows } = await client.query(
    `SELECT id, matricula, descricao, valor, eurocode, status,
            email_subject, email_subject_normalized, email_thread_id,
            email_message_id, email_received_at, advance_authorized_at
       FROM mycar_services
      WHERE REGEXP_REPLACE(UPPER(matricula), '[^A-Z0-9]', '', 'g') = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 50`,
    [String(svc.matricula).toUpperCase().replace(/[^A-Z0-9]/g, '')]
  );
  const normalized = meta.normalizedSubject || normalizeSubject(subject);
  return rows.find(r =>
    r.email_subject === subject ||
    (r.email_subject_normalized || normalizeSubject(r.email_subject)) === normalized
  ) || null;
}

// Janela de leitura e limites por execução. Lemos CABEÇALHOS de muitos
// emails (barato) mas só descarregamos o CORPO dos que são mesmo de
// serviço (matrícula no assunto), para não esgotar o tempo.
const SEARCH_DAYS   = 40;   // janela de pesquisa
const SCAN_PER_RUN  = 25;   // quantos emails analisamos (cabeçalho) por execução
const BODY_PER_RUN  = 6;    // quantos corpos descarregamos por execução
const PENDING_REPLY_SWEEP_PER_RUN = 5;
const THREAD_MESSAGES_PER_SERVICE = 12;

// O replay geral percorre milhares de mensagens por cursor e pode demorar
// horas. Esta ronda vai diretamente aos processos ainda pendentes, pesquisa a
// respetiva matrícula no Gmail e recupera ordens explícitas sem esperar que o
// cursor histórico chegue à data da resposta.
async function getPendingReplySweepCandidates(client, limit) {
  const stateKey = 'pending_reply_sweep_cursor_v1';
  const cursor = await getStateInt(client, stateKey);
  const fields = `id, matricula, email_received_at, advance_authorized_at`;
  const active = `status IN ('pendente', 'encomendado')
    AND advance_authorized_at IS NULL
    AND matricula IS NOT NULL
    AND email_received_at IS NOT NULL
    AND email_received_at >= NOW() - INTERVAL '45 days'`;

  const { rows: after } = await client.query(
    `SELECT ${fields} FROM mycar_services
      WHERE ${active} AND id > $1
      ORDER BY id ASC LIMIT $2`,
    [cursor, limit]
  );

  let rows = after;
  if (rows.length < limit && cursor > 0) {
    const { rows: wrapped } = await client.query(
      `SELECT ${fields} FROM mycar_services
        WHERE ${active} AND id <= $1
        ORDER BY id ASC LIMIT $2`,
      [cursor, limit - rows.length]
    );
    rows = rows.concat(wrapped);
  }

  if (rows.length > 0) await setState(client, stateKey, rows[rows.length - 1].id);
  return rows;
}

function connectReadOnlyInbox() {
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
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) { try { imap.end(); } catch (_) {} reject(err); return; }
        resolve(imap);
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

function fetchMessagesForPendingService(imap, service) {
  return new Promise((resolve, reject) => {
    const since = new Date(service.email_received_at);
    since.setDate(since.getDate() - 1);
    imap.search([['SINCE', since], ['HEADER', 'SUBJECT', service.matricula]], (err, uids) => {
      if (err) { reject(err); return; }
      const selected = (uids || [])
        .sort((a, b) => b - a)
        .slice(0, THREAD_MESSAGES_PER_SERVICE);
      if (selected.length === 0) { resolve([]); return; }

      const pending = [];
      const fetcher = imap.fetch(selected, { bodies: '', markSeen: false });
      fetcher.on('message', (msg) => {
        const chunks = [];
        let attrs = {};
        pending.push(new Promise((done) => {
          msg.on('body', stream => stream.on('data', chunk => chunks.push(chunk)));
          msg.once('attributes', value => { attrs = value || {}; });
          msg.once('end', async () => {
            try {
              const parsed = await simpleParser(Buffer.concat(chunks));
              parsed._imapAttrs = attrs;
              parsed._imapUid = attrs?.uid;
              done(parsed);
            } catch (error) {
              console.error(`⚠️ Resposta ${service.matricula} inválida:`, error.message);
              done(null);
            }
          });
        }));
      });
      fetcher.once('error', reject);
      fetcher.once('end', async () => resolve((await Promise.all(pending)).filter(Boolean)));
    });
  });
}

async function runPendingReplySweep(client, limit = PENDING_REPLY_SWEEP_PER_RUN) {
  const candidates = await getPendingReplySweepCandidates(client, limit);
  const stats = { scanned: 0, authorized: 0, blocked: 0, errors: 0 };
  if (candidates.length === 0) return stats;

  const imap = await connectReadOnlyInbox();
  try {
    for (const service of candidates) {
      try {
        const target = String(service.matricula).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const emails = await fetchMessagesForPendingService(imap, service);
        const messages = emails
          .map(email => {
            const text = emailText(email);
            const myCarBody = extractMyCarMessageBody({ ...email, text });
            return {
              email,
              myCarBody,
              subjectMatches: String(email.subject || '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(target)
            };
          })
          .filter(item => item.myCarBody && item.subjectMatches)
          .map(({ email, myCarBody }) => ({
            date: email.date,
            body: cleanEmailBody(myCarBody),
            meta: extractThreadMeta(email, email._imapAttrs || {}, email._imapUid)
          }));
        const decision = latestExplicitAdvanceInstruction(messages, service.email_received_at);
        stats.scanned++;

        if (decision?.action === 'bloquear') {
          stats.blocked++;
          continue;
        }
        if (decision?.action !== 'autorizar') continue;

        const reason = 'A MyCar deu autorização explícita para avançar.';
        const stamp = new Date(decision.date).toLocaleString('pt-PT');
        const meta = decision.meta || {};
        const { rows } = await client.query(
          `UPDATE mycar_services
              SET email_thread_id = COALESCE(email_thread_id, $1),
                  email_message_id = COALESCE(email_message_id, $2),
                  last_reply_at = $3,
                  last_reply_body = $4,
                  advance_authorized_at = $3,
                  advance_authorized_reason = $5,
                  historico = COALESCE(NULLIF(historico, '') || E'\n', '') || $6,
                  updated_at = NOW()
            WHERE id = $7 AND advance_authorized_at IS NULL
            RETURNING id`,
          [meta.gmailThreadId || null, meta.messageId || null, decision.date,
           decision.body, reason, `[${stamp}] ✅ Autorizado pela MyCar: ${reason}`, service.id]
        );
        if (rows.length > 0) {
          await markMessageProcessed(client, buildMessageKey(meta), meta);
          stats.authorized++;
          console.log(`✅ Autorização recuperada diretamente: ${service.matricula}`);
        }
      } catch (error) {
        stats.errors++;
        console.error(`⚠️ Reanálise direta ${service.matricula} falhou:`, error.message);
      }
    }
  } finally {
    try { imap.end(); } catch (_) {}
  }
  return stats;
}

// Determinístico via CURSOR (último UID processado). Não depende de marcar
// como lido, por isso nunca fica preso a reler os mesmos emails.
// Devolve { emails, nextCursor, remaining, scanned }.
function fetchBatch(cursor, knownThreadIds = new Set()) {
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
          const replyHeaderOf = {};
          const attrsOf = {};
          const hf = imap.fetch(scanBatch, { bodies: 'HEADER.FIELDS (SUBJECT IN-REPLY-TO REFERENCES)', markSeen: false });
          hf.on('message', (msg) => {
            let uid = null; const chunks = [];
            msg.on('body', (stream) => { stream.on('data', c => chunks.push(c)); });
            msg.once('attributes', (a) => { uid = a.uid; attrsOf[a.uid] = a; });
            msg.once('end', () => {
              const h = Imap.parseHeader(Buffer.concat(chunks).toString('utf8'));
              subjOf[uid] = (h.subject && h.subject[0]) || '';
              replyHeaderOf[uid] = Boolean(
                (h['in-reply-to'] && h['in-reply-to'].length) ||
                (h.references && h.references.length)
              );
            });
          });
          hf.once('error', fail);
          hf.once('end', () => {
            const relevant = scanBatch.filter(u => {
              const subject = subjOf[u] || '';
              const threadId = attrsOf[u]?.['x-gm-thrid'];
              return Boolean(
                extractIdFromSubject(subject) ||
                (threadId != null && knownThreadIds.has(String(threadId))) ||
                isReplySubject(subject) ||
                replyHeaderOf[u]
              );
            });
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
              let attrs = {};
              const p = new Promise((res) => {
                msg.on('body', (stream) => { stream.on('data', c => chunks.push(c)); });
                msg.once('attributes', a => { attrs = a || {}; });
                msg.once('end', () => res({ raw: Buffer.concat(chunks), attrs }));
              });
              pending.push(p);
            });
            bf.once('error', fail);
            bf.once('end', async () => {
              // Um email problemático não pode travar o lote — salta-o.
              for (const item of await Promise.all(pending)) {
                try {
                  const parsed = await simpleParser(item.raw);
                  parsed._imapAttrs = item.attrs;
                  parsed._imapUid = item.attrs?.uid;
                  emails.push(parsed);
                }
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
    const replayStarted = await startThreadReplayOnce(client);
    if (replayStarted) console.log('↩️ Reanálise única das respostas MyCar dos últimos 40 dias iniciada');
    const cursor = await getCursor(client);
    const knownThreadIds = await getKnownThreadIds(client);

    // Prioridade aos processos que o técnico ainda vê como pendentes. Assim,
    // uma resposta antiga como a do BU-23-JN é encontrada pelo assunto da
    // própria matrícula, sem ficar à espera do replay geral de toda a caixa.
    let replySweep = { scanned: 0, authorized: 0, blocked: 0, errors: 0 };
    try {
      replySweep = await runPendingReplySweep(client);
    } catch (error) {
      replySweep.errors++;
      console.error('⚠️ Reanálise direta dos pendentes falhou:', error.message);
    }

    const { emails, nextCursor, remaining, scanned } = await fetchBatch(cursor, knownThreadIds);

    if (emails.length === 0) {
      // Janela só com ruído: pode avançar imediatamente.
      if (nextCursor > cursor) await setCursor(client, nextCursor);
      console.log(`📭 Nada de serviço nesta janela (analisados ${scanned || 0})`);
      return {
        processed: replySweep.authorized,
        emails: 0,
        remaining,
        stats: {
          withTable: 0, viaSubject: 0, noId: scanned || 0,
          inserted: 0, updated: 0, skipped: 0, htmlVazio: 0,
          autorizados: replySweep.authorized,
          pendentesReanalisados: replySweep.scanned,
          errosReanalise: replySweep.errors
        }
      };
    }

    let totalImported = replySweep.authorized;
    const stats = {
      withTable: 0, viaSubject: 0, viaThread: 0, noId: 0,
      inserted: 0, updated: 0, skipped: 0, duplicated: 0,
      htmlVazio: 0, atualizadosIA: 0, autorizados: replySweep.authorized,
      cancelados: 0, erros: 0,
      pendentesReanalisados: replySweep.scanned,
      errosReanalise: replySweep.errors
    };

    for (const email of emails) {
     try {
      const subject  = email.subject || '';
      const from     = email.from?.text || '';
      const date     = email.date || new Date();
      const html     = email.html || '';
      const wip      = extractWip(subject);
      const rawText  = emailText(email);
      const myCarBody = extractMyCarMessageBody({ ...email, text: rawText });
      const body     = cleanEmailBody(myCarBody || rawText);
      const fromMyCar = Boolean(myCarBody) || isMyCarMessage({ ...email, text: rawText });
      const meta     = extractThreadMeta(email, email._imapAttrs || {}, email._imapUid);
      const messageKey = buildMessageKey(meta);

      if (await wasMessageProcessed(client, messageKey)) {
        stats.duplicated++;
        continue;
      }

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
        // O assunto pode ter sido alterado na resposta. Recuperar o processo
        // pelo ID da conversa, In-Reply-To/References ou WIP.
        const existingByThread = await findExistingService(client, null, meta, subject, wip);
        if (existingByThread) {
          services = [{
            matricula: existingByThread.matricula,
            descricao: null, valor: null, eurocode: null, ne: null,
            _existing: existingByThread
          }];
          stats.viaThread++;
        } else {
          stats.noId++;
          await markMessageProcessed(client, messageKey, meta);
          continue; // não pertence a um processo MyCar conhecido
        }
      }
      if (services.length === 0) {
        stats.noId++;
        await markMessageProcessed(client, messageKey, meta);
        continue;
      }
      console.log(`📧 "${subject}" | tabela:${tableRows.length} | serviços:${services.length}`);

      for (const svc of services) {
        const e = svc._existing || await findExistingService(client, svc, meta, subject, wip);
        if (e) {
          let serviceChanged = false;
          const isFollowupMessage = shouldAnalyzeAsFollowup(e, { subject, date, meta });

          // Aprender os identificadores desta conversa para que as próximas
          // respostas sejam associadas mesmo que o assunto mude por completo.
          await client.query(
            `UPDATE mycar_services
                SET email_thread_id = COALESCE(email_thread_id, $1),
                    email_message_id = COALESCE(email_message_id, $2),
                    email_subject_normalized = COALESCE(NULLIF(email_subject_normalized, ''), $3),
                    last_reply_at = $4,
                    last_reply_body = $5,
                    updated_at = NOW()
              WHERE id = $6`,
            [meta.gmailThreadId, meta.messageId, meta.normalizedSubject, date, body, e.id]
          );

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
            serviceChanged = true; stats.updated++;
            console.log(`🔧 Detalhes preenchidos: ${svc.matricula} | ${svc.descricao} | €${svc.valor}`);
          }

          // Uma resposta é analisada mesmo que traga novamente a tabela
          // original citada. A mensagem inicial, quando relida na recuperação,
          // serve apenas para aprender os IDs da conversa.
          let decision = null;
          if (isFollowupMessage && fromMyCar) {
            try {
              decision = await analyzeFollowupEmail({ existing: e, subject, body, tableRows });
            } catch (aiErr) {
              if (hasExplicitAdvanceAuthorization(body)) {
                decision = { action: 'autorizar', motivo: 'A MyCar deu autorização explícita para avançar.' };
              } else {
                console.error('⚠️ IA de acompanhamento falhou:', aiErr.message);
              }
            }
          }

          const stamp = new Date(date).toLocaleString('pt-PT');
          if (decision?.action === 'autorizar') {
            const reason = decision.motivo || 'A MyCar autorizou o avanço do serviço.';
            await client.query(
              `UPDATE mycar_services
                  SET status = CASE WHEN status = 'rejeitado' THEN 'pendente' ELSE status END,
                      advance_authorized_at = $1,
                      advance_authorized_reason = $2,
                      historico = COALESCE(NULLIF(historico, '') || E'\n', '') || $3,
                      updated_at = NOW()
                WHERE id = $4`,
              [date, reason, `[${stamp}] ✅ Autorizado pela MyCar: ${reason}`, e.id]
            );
            serviceChanged = true; stats.autorizados++;
            console.log(`✅ Autorizado para avançar: ${e.id} | ${reason}`);
          } else if (decision?.action === 'cancelar') {
            await client.query(
              `UPDATE mycar_services
                  SET status = 'rejeitado',
                      advance_authorized_at = NULL,
                      advance_authorized_reason = NULL,
                      historico = COALESCE(NULLIF(historico, '') || E'\n', '') || $1,
                      updated_at = NOW()
                WHERE id = $2`,
              [`[${stamp}] Cancelado por email de acompanhamento: ${decision.motivo || subject}`, e.id]
            );
            serviceChanged = true; stats.cancelados++;
            console.log(`🚫 Cancelado por email: ${e.id} | ${decision.motivo || ''}`);
          } else if (decision?.action === 'atualizar') {
            await client.query(
              `UPDATE mycar_services
                  SET descricao = COALESCE($1, descricao),
                      valor     = COALESCE($2, valor),
                      eurocode  = COALESCE($3, eurocode),
                      historico = COALESCE(NULLIF(historico, '') || E'\n', '') || $4,
                      updated_at = NOW()
                WHERE id = $5`,
              [decision.descricao, decision.valor, decision.eurocode,
               `[${stamp}] Alterado por email de acompanhamento: ${decision.motivo || ''}`, e.id]
            );
            serviceChanged = true; stats.atualizadosIA++;
            console.log(`✏️ Atualizado por IA: ${e.id} | ${decision.motivo || ''}`);
          } else if (!serviceChanged) {
            stats.skipped++;
          }

          if (serviceChanged) totalImported++;
          continue;
        }

        await client.query(
          `INSERT INTO mycar_services
             (matricula, descricao, valor, eurocode, status,
              email_from, email_subject, email_subject_normalized,
              email_thread_id, email_message_id, email_received_at,
              portal_id, notas, email_body)
           VALUES ($1,$2,$3,$4,'pendente',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [svc.matricula, svc.descricao, svc.valor, svc.eurocode,
           from, subject, meta.normalizedSubject, meta.gmailThreadId, meta.messageId,
           date, portalId, wip, body || null]
        );
        totalImported++; stats.inserted++;
        console.log(`✅ Importado: ${svc.matricula} | ${svc.descricao} | €${svc.valor}`);
      }

      await markMessageProcessed(client, messageKey, meta);
     } catch (emailErr) {
       stats.erros++;
       console.error('⚠️ Erro a processar email:', emailErr.message);
     }
    }

    // Só avançar a janela quando todas as mensagens foram tratadas. Em caso de
    // erro, a próxima execução repete o lote; as mensagens concluídas são
    // ignoradas pela tabela de deduplicação.
    if (stats.erros === 0 && nextCursor > cursor) await setCursor(client, nextCursor);

    console.log(`📊 Total: ${totalImported} | lidos:${emails.length} | ${JSON.stringify(stats)} | ${remaining} por processar`);
    return { processed: totalImported, emails: emails.length, remaining, stats };

  } finally {
    client.release();
  }
}

// Procura no Gmail o email cujo ASSUNTO contém esta matrícula (ex.: "BM-79-LI"
// → "FW: BM-79-LI | ...") e devolve os detalhes da tabela. Tenta do mais
// recente para o mais antigo até encontrar um com tabela.
function findServiceByMatricula(imap, matricula) {
  return new Promise((resolve) => {
    imap.search([['HEADER', 'SUBJECT', matricula]], (err, uids) => {
      if (err || !uids || !uids.length) return resolve(null);
      const ordered = uids.slice().sort((a, b) => b - a).slice(0, 5);
      let idx = 0;
      const tryNext = () => {
        if (idx >= ordered.length) return resolve(null);
        const uid = ordered[idx++];
        const chunks = [];
        const f = imap.fetch([uid], { bodies: '', markSeen: false });
        f.on('message', (msg) => { msg.on('body', (stream) => { stream.on('data', c => chunks.push(c)); }); });
        f.once('error', () => tryNext());
        f.once('end', async () => {
          try {
            const parsed = await simpleParser(Buffer.concat(chunks));
            const rows = parsed.html ? parseTableHtml(parsed.html) : [];
            if (rows.length) {
              const r = rows[0];
              return resolve({
                matricula: (r.matricula && r.matricula.length >= 4) ? r.matricula : matricula,
                descricao: r.descricao, valor: r.valor, eurocode: r.eurocode,
                wip: extractWip(parsed.subject || ''),
                body: cleanEmailBody(parsed.text || '')
              });
            }
            tryNext();
          } catch { tryNext(); }
        });
      };
      tryNext();
    });
  });
}

// Preenche os detalhes (serviço/valor/eurocode) das entradas que estão sem
// eles — procurando cada uma pelo seu próprio assunto. Bounded por 'limit'.
async function runFillDetails(limit) {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const missingSql = `SELECT COUNT(*)::int AS n FROM mycar_services
      WHERE matricula IS NOT NULL AND descricao IS NULL AND valor IS NULL AND eurocode IS NULL`;
    const { rows } = await client.query(
      `SELECT id, matricula FROM mycar_services
       WHERE matricula IS NOT NULL AND descricao IS NULL AND valor IS NULL AND eurocode IS NULL
       ORDER BY created_at DESC LIMIT $1`, [limit]);
    if (rows.length === 0) {
      const { rows: r0 } = await client.query(missingSql);
      return { filled: 0, remaining: r0[0].n };
    }

    const imap = new Imap({
      user: GMAIL_USER, password: GMAIL_PASSWORD, host: 'imap.gmail.com',
      port: 993, tls: true, tlsOptions: { rejectUnauthorized: false },
      connTimeout: 20000, authTimeout: 10000
    });

    let filled = 0;
    await new Promise((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err) => {
          if (err) { try { imap.end(); } catch (_) {} return reject(err); }
          (async () => {
            for (const row of rows) {
              try {
                const svc = await findServiceByMatricula(imap, row.matricula);
                if (svc && (svc.descricao || svc.valor != null || svc.eurocode)) {
                  await client.query(
                    `UPDATE mycar_services
                       SET matricula  = COALESCE($1, matricula),
                           descricao  = COALESCE($2, descricao),
                           valor      = COALESCE($3, valor),
                           eurocode   = COALESCE($4, eurocode),
                           notas      = COALESCE(notas, $5),
                           email_body = COALESCE(email_body, $6),
                           updated_at = NOW()
                     WHERE id = $7`,
                    [svc.matricula, svc.descricao, svc.valor, svc.eurocode, svc.wip, svc.body, row.id]
                  );
                  filled++;
                }
              } catch (e) { console.error('⚠️ fill entry falhou:', e.message); }
            }
            try { imap.end(); } catch (_) {}
            resolve();
          })();
        });
      });
      imap.once('error', reject);
      imap.connect();
    });

    const { rows: rN } = await client.query(missingSql);
    return { filled, remaining: rN[0].n };
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

  // Recuperar detalhes: preenche as entradas sem detalhes, uma a uma, pelo assunto
  if (bodyObj.action === 'fill_details') {
    try {
      const result = await runFillDetails(parseInt(bodyObj.limit) || 6);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    } catch (error) {
      console.error('❌ fill_details:', error.message);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }
  }

  // Recuperação (antigo): repõe o cursor a 0
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

// Exportado para o cron (mycar-poller-cron) reutilizar a MESMA lógica eficiente
module.exports.runPoller = runPoller;
