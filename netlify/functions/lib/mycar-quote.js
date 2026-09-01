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

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function identifierRegex(value) {
  const normalized = normalizePlate(value);
  if (normalized.length === 6) {
    const groups = [normalized.slice(0, 2), normalized.slice(2, 4), normalized.slice(4, 6)];
    // Nas versões de texto do Outlook, a célula seguinte pode ficar colada à
    // matrícula ("BU-68-AXSUBSTITUIÇÃO"), portanto não podemos exigir uma
    // fronteira de palavra no fim. A validação do valor/serviço abaixo evita
    // que a matrícula isolada do assunto seja interpretada como cotação.
    return new RegExp(groups.map(escapeRegex).join('\\s*-?\\s*'), 'gi');
  }
  if (normalized.length === 17) return new RegExp(escapeRegex(normalized), 'gi');
  return /\b(?:[A-Z0-9]{2}\s*-\s*[A-Z0-9]{2}\s*-\s*[A-Z0-9]{2}|[A-HJ-NPR-Z0-9]{17})\b/gi;
}

function cleanServiceDescription(value) {
  let text = cleanCell(value)
    .replace(/\s*>\s*/g, ' ')
    .replace(/^(?:(?:servi[çc]o|descri[çc][aã]o)\s*:?\s*)+/i, '')
    .replace(/\s*(?:valor|pre[çc]o)\s*:?\s*$/i, '')
    .replace(/\s*(?:n[.º°o]?e?|notas?)\s*:?\s*$/i, '')
    .replace(/^[|;:,\-]+|[|;:,\-]+$/g, '')
    .trim();

  if (text.length > 260) {
    const starts = [...text.matchAll(/\b(?:substitui[çc][aã]o|repara[çc][aã]o|vidro|para-?brisas|[oó]culo|luneta)\b/gi)];
    if (starts.length) text = text.slice(starts.at(-1).index).trim();
  }

  if (text.length > 260) return null;
  return /substitui|repara|vidro|para-?brisas|[oó]culo|lateral|luneta|\/oem/i.test(text) ? text : null;
}

// O Outlook pode reenviar a cotação sem conservar as tags <table>. O
// mailparser transforma então as células numa sequência de texto, por vezes
// sem qualquer espaço ("MatrículaServiçoValor..."). Recuperamos a linha pela
// matrícula e pelos marcadores fortes do valor/Eurocode.
function parseQuoteText(text, fallbackPlate = null) {
  const source = String(text || '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
  if (!source) return [];

  const services = [];
  const idRx = identifierRegex(fallbackPlate);
  for (const match of source.matchAll(idRx)) {
    const tail = source.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 520);
    // Também o valor pode ficar colado à descrição ("/OEM192,00").
    const valueMatch = tail.match(/\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}(?:\s*€)?/);
    if (!valueMatch || valueMatch.index == null || valueMatch.index > 320) continue;

    const descricao = cleanServiceDescription(tail.slice(0, valueMatch.index));
    const afterValue = tail.slice(valueMatch.index + valueMatch[0].length, valueMatch.index + valueMatch[0].length + 220);
    const starredCode = afterValue.match(/\*+\s*([A-Z0-9][A-Z0-9._/-]{6,30})/i);
    const plainCode = afterValue.match(/\b(\d{4}[A-Z][A-Z0-9]{5,20})\b/i);
    const eurocode = normalizeEurocode(starredCode?.[1] || plainCode?.[1] || null);

    // Uma matrícula no assunto seguida, muito mais abaixo, por um valor não é
    // uma linha da cotação. Exigimos descrição de serviço ou Eurocode forte.
    if (!descricao && !eurocode) continue;

    services.push({
      matricula: fallbackPlate || cleanCell(match[0]).replace(/\s/g, '').toUpperCase(),
      descricao,
      valor: parseValor(valueMatch[0]),
      eurocode,
      ne: null
    });
  }

  return consolidateQuoteRows(services, fallbackPlate);
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
  return Boolean(row && (row.descricao || row.valor != null || row.eurocode));
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
  parseQuoteText,
  hasQuoteDetails,
  consolidateQuoteRows,
  pickQuoteForPlate,
  selectLatestQuoteMessage
};
