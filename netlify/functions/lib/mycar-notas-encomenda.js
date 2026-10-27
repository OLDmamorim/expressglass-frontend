'use strict';

// Notas de Encomenda da MyCar: no fim do processo, a MyCar (gestao.mcc@grupojap.pt)
// envia um email "NOTAS DE ENCOMENDA - dd/mm" com uma tabela — WIP, matrícula,
// viatura, data, serviço, valor, data, N.E. — e os PDFs das notas em anexo.
// Uma N.E. pode cobrir mais do que um serviço (a mesma em duas linhas).

const crypto = require('crypto');
const cheerio = require('cheerio');
const { normalizePlate, parseValor } = require('./mycar-quote');

const DEFAULT_SENDERS = ['gestao.mcc@grupojap.pt'];
const SUBJECT_RX = /notas?\s+de\s+encomenda/i;
const NE_RX = /\bNE\s*-?\s*(\d{4,})\b/i;
const PLATE_RX = /^(?:[A-Z0-9]{2}\s*-\s*[A-Z0-9]{2}\s*-\s*[A-Z0-9]{2}|[A-Z0-9]{6})$/i;

function configuredSenders(env = process.env) {
  const list = String(env.MYCAR_NE_SENDERS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_SENDERS;
}

function senderAddresses(email = {}) {
  return (email.from?.value || []).map(v => String(v.address || '').toLowerCase());
}

// Chegam quase sempre reencaminhadas ("FW: NOTAS DE ENCOMENDA", de
// paredes@expressglass.pt): aí a MyCar só aparece no cabeçalho citado.
function isNotaEncomendaEmail(email = {}, senders = DEFAULT_SENDERS) {
  if (!SUBJECT_RX.test(String(email.subject || ''))) return false;
  const from = senderAddresses(email);
  if (from.length === 0 || from.some(a => senders.includes(a))) return true;
  const body = `${email.text || ''}\n${email.html || ''}`.toLowerCase();
  return senders.some(s => body.includes(s));
}

function cleanCell(value) {
  return String(value || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeNe(value) {
  const m = String(value || '').match(NE_RX);
  return m ? `NE${m[1]}` : null;
}

const DATE_RX = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

function isoDate(cell) {
  const m = String(cell || '').match(DATE_RX);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// Uma linha da tabela — WIP, matrícula, viatura, data, serviço, valor, data,
// N.E. A matrícula e a N.E. são obrigatórias; o WIP é o primeiro número de
// 4–6 dígitos; o valor é a primeira célula com €; a viatura vem entre a
// matrícula e a primeira data, e o serviço é o texto a seguir a essa data.
function rowFromCells(cells) {
  const plateIdx = cells.findIndex(c => PLATE_RX.test(c) && /\d/.test(c) && /[A-Z]/i.test(c));
  const neIdx = cells.findIndex(c => normalizeNe(c));
  if (plateIdx < 0 || neIdx < 0) return null;
  const wipCell = cells.find((c, i) => i !== plateIdx && /^\d{4,6}$/.test(c));
  const valorCell = cells.find(c => /€/.test(c));
  const dateIdx = cells.findIndex((c, i) => i > plateIdx && DATE_RX.test(c));
  const isText = c => /[A-Za-zÀ-ú]/.test(c) && !/€/.test(c) && !DATE_RX.test(c) && !normalizeNe(c);
  const serviceCell = (dateIdx >= 0 ? cells.slice(dateIdx + 1, neIdx).find(isText) : null) ||
    cells.find((c, i) => i > plateIdx && i < neIdx && isText(c) &&
      /repara|para-?brisas|vidro|[oó]culo|lateral|luneta|substitui|calibra|borracha|m[aã]o\s+de\s+obra/i.test(c));
  const modelCell = dateIdx > plateIdx + 1 ? cells.slice(plateIdx + 1, dateIdx).find(isText) : null;
  return {
    wip: wipCell || null,
    matricula: cells[plateIdx].toUpperCase().replace(/\s/g, ''),
    viatura: modelCell || null,
    data: dateIdx >= 0 ? isoDate(cells[dateIdx]) : null,
    servico: serviceCell || null,
    valor: valorCell ? parseValor(valorCell) : null,
    ne: normalizeNe(cells[neIdx])
  };
}

function parseNotasEncomendaHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(String(html));
  const rows = [];
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td, th').map((__, td) => cleanCell($(td).text())).get();
    if (cells.length < 3) return;
    const row = rowFromCells(cells);
    if (row) rows.push(row);
  });
  return rows;
}

// O Outlook pode chegar só em texto: cada linha da tabela numa linha, com as
// células separadas por tabulações ou espaços largos.
function parseNotasEncomendaText(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!NE_RX.test(line)) continue;
    const cells = line.split(/\t|\s{2,}|\s*\|\s*/).map(cleanCell).filter(Boolean);
    const row = rowFromCells(cells);
    if (row) rows.push(row);
  }
  return rows;
}

function parseNotasEncomenda(email = {}) {
  const rows = parseNotasEncomendaHtml(email.html);
  const found = rows.length ? rows : parseNotasEncomendaText(email.text);
  const seen = new Set();
  return found.filter(r => {
    const key = `${normalizePlate(r.matricula)}|${r.ne}|${r.valor}|${r.wip}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isPdf(att) {
  return /pdf/i.test(String(att?.contentType || '')) || /\.pdf$/i.test(String(att?.filename || ''));
}

// Liga cada N.E. ao seu PDF: pelo número no nome do ficheiro, depois pelo
// texto do PDF (`pdfTexts`, na mesma ordem dos anexos), e, se houver uma só
// N.E. e um só PDF, um ao outro. Devolve Map(ne -> [anexos]).
function matchNotaPdfs(neNumbers = [], attachments = [], pdfTexts = []) {
  const pdfs = attachments.map((att, i) => ({ att, text: pdfTexts[i] || '' })).filter(p => isPdf(p.att));
  const result = new Map();
  const digitsOf = ne => String(ne).replace(/\D/g, '');
  for (const ne of [...new Set(neNumbers)]) {
    const digits = digitsOf(ne);
    let matches = pdfs.filter(p => String(p.att.filename || '').replace(/\D/g, ' ').split(' ').includes(digits));
    if (!matches.length) matches = pdfs.filter(p => p.text.replace(/\s/g, '').includes(digits));
    if (matches.length) result.set(ne, matches.map(p => p.att));
  }
  const unique = [...new Set(neNumbers)];
  if (unique.length === 1 && !result.has(unique[0]) && pdfs.length === 1) {
    result.set(unique[0], [pdfs[0].att]);
  }
  return result;
}

function wipOf(service) {
  const m = String(service?.notas || '').match(/(\d{4,6})/);
  return m ? m[1] : null;
}

// Escolhe os serviços da linha entre os da mesma matrícula: o mesmo WIP,
// depois o mesmo valor (um pedido pode ter vários vidros); fora os rejeitados.
function chooseServicesForRow(row, services = []) {
  const plate = normalizePlate(row.matricula);
  let candidates = services.filter(s => normalizePlate(s.matricula) === plate && s.status !== 'rejeitado');
  if (candidates.length <= 1) return candidates;

  if (row.wip) {
    const sameWip = candidates.filter(s => wipOf(s) === row.wip);
    if (sameWip.length) candidates = sameWip;
  }
  if (candidates.length > 1 && row.valor != null) {
    const sameValue = candidates.filter(s => s.valor != null && Math.abs(Number(s.valor) - row.valor) < 0.01);
    if (sameValue.length) candidates = sameValue;
  }
  if (candidates.length > 1) {
    const withSameNe = candidates.filter(s => s.nota_encomenda === row.ne);
    if (withSameNe.length) return withSameNe;
    const withoutNe = candidates.filter(s => !s.nota_encomenda);
    if (withoutNe.length) candidates = withoutNe;
  }
  return candidates;
}

async function ensureNotasTables(client) {
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS nota_encomenda VARCHAR(40)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS nota_encomenda_at TIMESTAMP`);
  // Usadas nos serviços criados a partir da nota (também criadas em mycar-services)
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS car TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS work_type VARCHAR(20)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS images_checked_at TIMESTAMP`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS glasses_checked_at TIMESTAMP`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS mycar_service_documents (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES mycar_services(id) ON DELETE CASCADE,
      kind VARCHAR(30) NOT NULL,
      reference VARCHAR(60),
      filename TEXT,
      content_type VARCHAR(100) NOT NULL,
      size_bytes INTEGER,
      checksum VARCHAR(64) NOT NULL,
      data TEXT NOT NULL,
      email_message_id VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (service_id, checksum)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_documents_service ON mycar_service_documents(service_id)`);
}

// As reparações e a mão de obra não chegam por email: a MyCar pede-as por
// outra via e só a Nota de Encomenda as traz (ex.: BX-92-CG, REPARAÇÃO 48 €).
// Uma matrícula sem nenhum serviço no mural ganha um, já realizado (a nota
// só vem depois de o serviço estar feito) e por faturar.
async function createServiceFromRow(client, row, email, { portalId = null, stamp } = {}) {
  const { rows } = await client.query(
    `INSERT INTO mycar_services
       (matricula, data_servico, descricao, valor, status, car, work_type,
        email_from, email_subject, email_received_at, portal_id, notas, historico,
        images_checked_at, glasses_checked_at)
     VALUES ($1, $2, $3, $4, 'realizado', $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
     RETURNING id, matricula, valor, status, notas, nota_encomenda`,
    [row.matricula, row.data, row.servico, row.valor, row.viatura,
     /repara/i.test(row.servico || '') ? 'reparacao' : null,
     email.from?.text || null, email.subject || null, email.date || new Date(), portalId,
     row.wip ? `WIP: ${row.wip}` : null,
     `[${stamp}] Criado a partir da Nota de Encomenda ${row.ne} (o pedido não chegou por email)`]
  );
  return rows[0];
}

// Aplica um email de Notas de Encomenda. `pdfTexts` é o texto de cada anexo
// (na mesma ordem), para reconhecer o PDF de cada N.E. quando o nome não diz.
// Devolve { rows, matched, created, unmatched: [linhas sem serviço], documents }.
async function applyNotasEncomenda(client, email, { pdfTexts = [], messageId = null, portalId = null } = {}) {
  const rows = parseNotasEncomenda(email);
  const pdfsByNe = matchNotaPdfs(rows.map(r => r.ne), email.attachments || [], pdfTexts);
  const stamp = new Date(email.date || Date.now()).toLocaleString('pt-PT');
  let matched = 0, created = 0, documents = 0;
  const unmatched = [];

  for (const row of rows) {
    const { rows: services } = await client.query(
      `SELECT id, matricula, valor, status, notas, nota_encomenda
         FROM mycar_services
        WHERE REGEXP_REPLACE(UPPER(matricula), '[^A-Z0-9]', '', 'g') = $1
        ORDER BY email_received_at DESC NULLS LAST, id DESC`,
      [normalizePlate(row.matricula)]
    );
    let targets = chooseServicesForRow(row, services);
    // Só quando a matrícula não tem serviço nenhum: se tiver (mesmo rejeitado),
    // a linha fica por associar em vez de criar um duplicado.
    if (!targets.length && services.length === 0) {
      targets = [await createServiceFromRow(client, row, email, { portalId, stamp })];
      created++;
    }
    if (!targets.length) { unmatched.push(row); continue; }
    matched++;

    for (const service of targets) {
      if (service.nota_encomenda !== row.ne) {
        await client.query(
          `UPDATE mycar_services
              SET nota_encomenda = $1,
                  nota_encomenda_at = $2,
                  historico = COALESCE(NULLIF(historico, '') || E'\n', '') || $3,
                  updated_at = NOW()
            WHERE id = $4`,
          [row.ne, email.date || new Date(), `[${stamp}] Nota de encomenda ${row.ne} recebida da MyCar`, service.id]
        );
      }
      for (const att of pdfsByNe.get(row.ne) || []) {
        const checksum = att.checksum || crypto.createHash('md5').update(att.content).digest('hex');
        const { rowCount } = await client.query(
          `INSERT INTO mycar_service_documents
             (service_id, kind, reference, filename, content_type, size_bytes, checksum, data, email_message_id)
           VALUES ($1, 'nota_encomenda', $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (service_id, checksum) DO NOTHING`,
          [service.id, row.ne, att.filename || `${row.ne}.pdf`, 'application/pdf',
           att.size || att.content.length, checksum, att.content.toString('base64'), messageId]
        );
        documents += rowCount;
      }
    }
  }
  return { rows: rows.length, matched, created, unmatched, documents };
}

module.exports = {
  DEFAULT_SENDERS,
  ensureNotasTables,
  applyNotasEncomenda,
  configuredSenders,
  isNotaEncomendaEmail,
  normalizeNe,
  parseNotasEncomenda,
  parseNotasEncomendaHtml,
  parseNotasEncomendaText,
  matchNotaPdfs,
  chooseServicesForRow
};
