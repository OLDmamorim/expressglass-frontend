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

// O asterisco faz parte da referência que o fornecedor escreve (*7624BGSHAI),
// não é pontuação a limpar: distingue a peça e tem de chegar ao portal tal
// como veio no pedido. Os restantes (bullets, dois pontos, traços) continuam
// a ser ruído de formatação da célula.
function normalizeEurocode(value) {
  const text = cleanCell(value)
    .replace(/^[#•:\s-]+/, '')
    .replace(/^(\*+)\s+/, '$1');
  return text ? text.toUpperCase() : null;
}

// Cada linha lida guarda (escondido) o bloco de onde veio: uma tabela no HTML,
// ou um troço de texto que começa num cabeçalho "Matrícula". Um pedido com
// vários vidros tem várias linhas no MESMO bloco; as cópias citadas mais
// abaixo na conversa vêm noutros blocos.
function withBlock(row, block) {
  Object.defineProperty(row, '_block', { value: block, enumerable: false, configurable: true });
  return row;
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
  let block = 0;
  let lastRowEnd = 0;
  for (const match of source.matchAll(idRx)) {
    const tail = source.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 520);
    // Também o valor pode ficar colado à descrição ("/OEM192,00").
    const valueMatch = tail.match(/\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}(?:\s*€)?/);
    if (!valueMatch || valueMatch.index == null || valueMatch.index > 320) continue;

    const descricao = cleanServiceDescription(tail.slice(0, valueMatch.index));
    const afterValue = tail.slice(valueMatch.index + valueMatch[0].length, valueMatch.index + valueMatch[0].length + 220);
    // Captura inclui o asterisco — faz parte da referência, ver normalizeEurocode
    const starredCode = afterValue.match(/(\*+\s*[A-Z0-9][A-Z0-9._/-]{6,30})/i);
    const plainCode = afterValue.match(/\b(\d{4}[A-Z][A-Z0-9]{5,20})\b/i);
    const eurocode = normalizeEurocode(starredCode?.[1] || plainCode?.[1] || null);

    // Uma matrícula no assunto seguida, muito mais abaixo, por um valor não é
    // uma linha da cotação. Exigimos descrição de serviço ou Eurocode forte.
    if (!descricao && !eurocode) continue;

    // Um novo cabeçalho "Matrícula" entre esta linha e a anterior é o
    // começo de outra tabela (a cotação citada de uma mensagem anterior).
    if (services.length && /matr[ií]cula/i.test(source.slice(lastRowEnd, match.index || 0))) block++;
    lastRowEnd = (match.index || 0) + match[0].length + valueMatch.index + valueMatch[0].length;

    services.push(withBlock({
      matricula: fallbackPlate || cleanCell(match[0]).replace(/\s/g, '').toUpperCase(),
      descricao,
      valor: parseValor(valueMatch[0]),
      eurocode,
      ne: null
    }, `t${block}`));
  }

  return consolidateQuoteRows(services, fallbackPlate);
}

function parseTableHtml(html) {
  if (!html) return [];
  const $ = cheerio.load(String(html));
  const services = [];
  const exactRows = new Set();

  $('table').each((tableIdx, table) => {
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
        services.push(withBlock(service, `h${tableIdx}`));
      }
    });
  });

  return services;
}

function hasQuoteDetails(row = {}) {
  return Boolean(row && (row.descricao || row.valor != null || row.eurocode));
}

function fillMissing(current, row) {
  if (!current.descricao && row?.descricao) current.descricao = row.descricao;
  if (current.valor == null && row?.valor != null) current.valor = row.valor;
  if (!current.eurocode && row?.eurocode) current.eurocode = row.eurocode;
  if (!current.ne && row?.ne) current.ne = row.ne;
}

function sameGlassRow(a, b) {
  return Boolean(
    (a.eurocode && b.eurocode && normalizePlate(a.eurocode) === normalizePlate(b.eurocode)) ||
    (a.descricao && b.descricao && cleanCell(a.descricao).toUpperCase() === cleanCell(b.descricao).toUpperCase())
  );
}

// A primeira tabela no email é a cotação mais recente, com uma linha por
// vidro: essas linhas são os vidros do pedido. Se a conversa incluir cópias
// antigas da mesma matrícula (outros blocos), elas só podem preencher campos
// que a tabela mais recente deixou vazios — no mesmo vidro (pelo Eurocode ou
// pela descrição, senão pela posição) — e nunca substituem os valores novos.
// Linhas sem bloco conhecido contam cada uma como uma cópia à parte.
function consolidateQuoteRows(rows = [], fallbackPlate = null) {
  const grouped = new Map();

  rows.forEach((row, index) => {
    const matricula = row?.matricula || fallbackPlate;
    const key = normalizePlate(matricula);
    if (!key) return;
    const block = row?._block ?? `row${index}`;

    let plate = grouped.get(key);
    if (!plate) {
      plate = { block, glasses: [], copies: new Map() };
      grouped.set(key, plate);
    }

    const glass = {
      matricula,
      descricao: row?.descricao || null,
      valor: row?.valor == null ? null : row.valor,
      eurocode: row?.eurocode || null,
      ne: row?.ne || null
    };

    if (block === plate.block) {
      const duplicate = plate.glasses.find(g =>
        g.descricao === glass.descricao && g.valor === glass.valor && g.eurocode === glass.eurocode);
      if (!duplicate) plate.glasses.push(withBlock(glass, block));
      return;
    }

    // Cópia antiga: completa o vidro correspondente da cotação mais recente.
    const copy = plate.copies.get(block) || [];
    plate.copies.set(block, copy);
    const target = plate.glasses.find(g => sameGlassRow(g, glass)) || plate.glasses[copy.length];
    copy.push(glass);
    if (target) fillMissing(target, glass);
  });

  return [...grouped.values()].flatMap(plate => plate.glasses);
}

// Liga cada vidro da cotação a um serviço que já existe na mesma conversa:
// primeiro pelo mesmo Eurocode/descrição, depois pela ordem (o pedido entra
// como um só serviço sem detalhes, que fica com o primeiro vidro). Os vidros
// que sobram não têm serviço e devem ser criados. Devolve [{ glass, existing }].
function assignQuoteRows(glasses = [], existing = []) {
  const free = [...existing].sort((a, b) => a.id - b.id);
  const take = (service) => { free.splice(free.indexOf(service), 1); return service; };
  const result = glasses.map(glass => {
    const match = free.find(s => sameGlassRow(s, glass));
    return { glass, existing: match ? take(match) : null };
  });
  for (const entry of result) {
    if (!entry.existing && free.length) entry.existing = take(free[0]);
  }
  return result;
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
  assignQuoteRows,
  pickQuoteForPlate,
  selectLatestQuoteMessage
};
