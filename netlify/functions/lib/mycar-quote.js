'use strict';

const cheerio = require('cheerio');

function cleanCell(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlCellText($, cell) {
  const clone = $(cell).clone();
  clone.find('br').replaceWith(' ');
  return cleanCell(clone.text());
}

function normalizePlate(value) {
  return cleanCell(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseValor(value) {
  let text = cleanCell(value).replace(/[^\d,.-]/g, '');
  if (!text) return null;

  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    text = text.replace(thousands, '').replace(decimal, '.');
  } else if (comma >= 0) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1) {
    const parts = text.split('.');
    text = parts.slice(0, -1).join('') + '.' + parts.at(-1);
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEurocode(value) {
  const text = cleanCell(value).replace(/^[*#•:\s-]+/, '');
  return text ? text.toUpperCase() : null;
}

function parseTableHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(String(html));
  const services = [];
  const exactRows = new Set();

  $('table').each((_, table) => {
    // Outlook envolve frequentemente a tabela da cotação noutras tabelas de
    // layout. Só lemos as linhas que pertencem diretamente a esta tabela para
    // não importar a mesma cotação várias vezes.
    const $rows = $(table).find('tr').filter((__, row) => $(row).closest('table')[0] === table);
    let headerRowIdx = -1;
    let headers = [];

    $rows.each((rowIdx, row) => {
      const cells = $(row).children('th, td').map((__, cell) => htmlCellText($, cell).toLowerCase()).get();
      if (cells.some(label => /matr[ií]cula/i.test(label))) {
        headerRowIdx = rowIdx;
        headers = cells;
        return false;
      }
    });

    if (headerRowIdx < 0) return;

    const matIdx = headers.findIndex(label => /matr[ií]cula/i.test(label));
    const svcIdx = headers.findIndex(label => /servi[çc]o|descri[çc][aã]o/i.test(label));
    const valIdx = headers.findIndex(label => /valor/i.test(label));
    const euroIdx = headers.findIndex(label => /euro\s*-?\s*code|eurocode|c[oó]digo.*vidro/i.test(label));
    const neIdx = headers.findIndex(label => /^n(?:[.º°o]|e)*$/i.test(label));
    const notesIdx = headers.findIndex(label => /notas?/i.test(label));

    $rows.slice(headerRowIdx + 1).each((__, row) => {
      const cells = $(row).children('td').map((___, cell) => htmlCellText($, cell)).get();
      if (cells.length < 2) return;

      const matricula = cleanCell(cells[matIdx]).replace(/\s/g, '').toUpperCase();
      if (!matricula || matricula.length < 4) return;

      const rawEurocode = euroIdx >= 0 ? cells[euroIdx] : (notesIdx >= 0 ? cells[notesIdx] : null);
      const service = {
        matricula,
        descricao: svcIdx >= 0 ? (cleanCell(cells[svcIdx]) || null) : null,
        valor: valIdx >= 0 ? parseValor(cells[valIdx]) : null,
        eurocode: normalizeEurocode(rawEurocode),
        ne: neIdx >= 0 ? (cleanCell(cells[neIdx]) || null) : null
      };
      const key = JSON.stringify(service);
      if (!exactRows.has(key)) {
        exactRows.add(key);
        services.push(service);
      }
    });
  });

  return services;
}

function hasQuoteDetails(row = {}) {
  return Boolean(row.descricao || row.valor != null || row.eurocode);
}

// A primeira tabela no email é a cotação mais recente. Se a conversa incluir
// cópias antigas da mesma matrícula, elas só podem preencher campos que a
// tabela mais recente deixou vazios; nunca substituem os valores mais novos.
function consolidateQuoteRows(rows = [], fallbackPlate = null) {
  const grouped = new Map();

  for (const row of rows) {
    const matricula = row?.matricula || fallbackPlate;
    const key = normalizePlate(matricula);
    if (!key) continue;

    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        matricula,
        descricao: row?.descricao || null,
        valor: row?.valor == null ? null : row.valor,
        eurocode: row?.eurocode || null,
        ne: row?.ne || null
      });
      continue;
    }

    if (!current.descricao && row?.descricao) current.descricao = row.descricao;
    if (current.valor == null && row?.valor != null) current.valor = row.valor;
    if (!current.eurocode && row?.eurocode) current.eurocode = row.eurocode;
    if (!current.ne && row?.ne) current.ne = row.ne;
  }

  return [...grouped.values()];
}

function pickQuoteForPlate(rows = [], plate = null) {
  const quotes = consolidateQuoteRows(rows, plate);
  const target = normalizePlate(plate);
  if (target) {
    const exact = quotes.find(row => normalizePlate(row.matricula) === target);
    if (exact) return exact;
  }
  return quotes.length === 1 ? quotes[0] : null;
}

function selectLatestQuoteMessage(messages = [], plate = null) {
  return messages
    .map((message, index) => ({
      ...message,
      quote: pickQuoteForPlate(message?.tableRows || [], plate),
      timestamp: new Date(message?.date).getTime(),
      index
    }))
    .filter(message => hasQuoteDetails(message.quote))
    .sort((a, b) => {
      const aTime = Number.isFinite(a.timestamp) ? a.timestamp : -Infinity;
      const bTime = Number.isFinite(b.timestamp) ? b.timestamp : -Infinity;
      return bTime - aTime || a.index - b.index;
    })[0] || null;
}

module.exports = {
  normalizePlate,
  parseValor,
  normalizeEurocode,
  parseTableHtml,
  hasQuoteDetails,
  consolidateQuoteRows,
  pickQuoteForPlate,
  selectLatestQuoteMessage
};
