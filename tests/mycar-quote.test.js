'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { simpleParser } = require('mailparser');
const {
  parseValor,
  parseTableHtml,
  parseQuoteText,
  consolidateQuoteRows,
  assignQuoteRows,
  pickQuoteForPlate,
  selectLatestQuoteMessage
} = require('../netlify/functions/lib/mycar-quote');

const bu68ReplyHtml = `
  <table class="outlook-layout"><tr><td>
    <p>Bom dia,<br>Podem avançar, serviço a realizar no mcc.</p>
    <blockquote>
      <p>Bom dia,</p>
      <table class="cotacao">
        <tr>
          <td>Matrícula</td><td>Serviço</td><td>Valor</td><td>Ne</td><td>Notas</td>
        </tr>
        <tr>
          <td>BU-68-AX</td>
          <td>SUBSTITUIÇÃO VIDRO LATERAL TRASEIRO ESQUERDO<br>/OEM</td>
          <td>192,00<br>€</td>
          <td></td>
          <td>*3593LYPE5RWZ</td>
        </tr>
      </table>
    </blockquote>
  </td></tr></table>`;

test('lê a cotação citada no reply real BU-68-AX', () => {
  const rows = parseTableHtml(bu68ReplyHtml);

  assert.deepEqual(rows, [{
    matricula: 'BU-68-AX',
    descricao: 'SUBSTITUIÇÃO VIDRO LATERAL TRASEIRO ESQUERDO /OEM',
    valor: 192,
    eurocode: '*3593LYPE5RWZ',
    ne: null
  }]);
});

test('lê a cotação quando o Outlook cola todas as células em texto', () => {
  const text = `Bom dia,
Podem avançar, serviço a realizar no mcc.

MatrículaServiçoValorNeNotasBU-68-AXSUBSTITUIÇÃO VIDRO LATERAL TRASEIRO ESQUERDO
/OEM192,00
€*3593LYPE5RWZ`;

  assert.deepEqual(parseQuoteText(text, 'BU-68-AX'), [{
    matricula: 'BU-68-AX',
    descricao: 'SUBSTITUIÇÃO VIDRO LATERAL TRASEIRO ESQUERDO /OEM',
    valor: 192,
    eurocode: '*3593LYPE5RWZ',
    ne: null
  }]);
});

test('recupera a cotação após o mailparser converter o HTML do Outlook em texto', async () => {
  const rawEmail = [
    'From: Gestao Clientes <gestaoclientes@expressglass.pt>',
    'To: orcamentacao@mycarcenter.pt',
    'Subject: RE: BU-68-AX | WIP: 16801',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    bu68ReplyHtml
  ].join('\r\n');
  const parsed = await simpleParser(Buffer.from(rawEmail));
  const [quote] = parseQuoteText(parsed.text, 'BU-68-AX');

  assert.equal(quote.descricao, 'SUBSTITUIÇÃO VIDRO LATERAL TRASEIRO ESQUERDO /OEM');
  assert.equal(quote.valor, 192);
  assert.equal(quote.eurocode, '*3593LYPE5RWZ');
});

test('lê a cotação quando o Outlook separa as células por linhas', () => {
  const text = `Matrícula
BU-68-AX
Serviço
SUBSTITUIÇÃO VIDRO LATERAL TRASEIRO ESQUERDO /OEM
Valor
192,00 €
Ne
Notas
*3593LYPE5RWZ`;

  const [quote] = parseQuoteText(text, 'BU68AX');
  assert.equal(quote.descricao, 'SUBSTITUIÇÃO VIDRO LATERAL TRASEIRO ESQUERDO /OEM');
  assert.equal(quote.valor, 192);
  assert.equal(quote.eurocode, '*3593LYPE5RWZ');
});

test('não confunde uma matrícula isolada no assunto com uma cotação', () => {
  const text = `RE: BU-68-AX | WIP: 16801\n\nBom dia, podem avançar.\n${'texto '.repeat(90)}192,00 €`;
  assert.deepEqual(parseQuoteText(text, 'BU-68-AX'), []);
});

test('interpreta valores portugueses com e sem separador de milhares', () => {
  assert.equal(parseValor('192,00 €'), 192);
  assert.equal(parseValor('1.234,56 €'), 1234.56);
  assert.equal(parseValor('sem valor'), null);
});

test('não deixa uma cotação antiga substituir a primeira da conversa', () => {
  const rows = consolidateQuoteRows([
    { matricula: 'BU-68-AX', descricao: 'VIDRO LATERAL /OEM', valor: 192, eurocode: 'NOVO' },
    { matricula: 'BU68AX', descricao: 'VIDRO LATERAL', valor: 180, eurocode: 'ANTIGO' }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].valor, 192);
  assert.equal(rows[0].eurocode, 'NOVO');
  assert.equal(pickQuoteForPlate(rows, 'BU-68-AX').descricao, 'VIDRO LATERAL /OEM');
});

test('recupera a cotação do reply mais recente para o processo existente', () => {
  const selected = selectLatestQuoteMessage([
    {
      date: '2026-09-01T11:30:00Z',
      tableRows: [{ matricula: 'BU-68-AX', valor: 180, eurocode: 'ANTIGO' }]
    },
    {
      date: '2026-09-01T14:45:00Z',
      body: 'Podem avançar, serviço a realizar no mcc.',
      tableRows: parseTableHtml(bu68ReplyHtml),
      meta: { gmailMessageId: 'reply-184' }
    }
  ], 'BU68AX');

  assert.equal(selected.quote.valor, 192);
  assert.equal(selected.quote.eurocode, '*3593LYPE5RWZ');
  assert.equal(selected.meta.gmailMessageId, 'reply-184');
});

test('ignora mensagens da conversa que não contêm qualquer cotação', () => {
  const selected = selectLatestQuoteMessage([
    {
      date: '2026-09-01T14:45:00Z',
      body: 'Podem avançar, serviço a realizar no mcc.',
      tableRows: []
    },
    {
      date: '2026-09-01T11:30:00Z',
      tableRows: parseTableHtml(bu68ReplyHtml)
    }
  ], 'BU-68-AX');

  assert.equal(selected.quote.valor, 192);
  assert.equal(selected.quote.eurocode, '*3593LYPE5RWZ');
});

test('o sweep consolida a cotação antes de marcar o reply como processado', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../netlify/functions/mycar-gmail-poller.js'),
    'utf8'
  );
  const start = source.indexOf('async function runPendingReplySweep');
  const end = source.indexOf('\nfunction fetchBatch', start);
  const sweep = source.slice(start, end);

  assert.ok(sweep.indexOf('selectLatestQuoteMessage') >= 0);
  assert.ok(sweep.indexOf('selectLatestQuoteMessage') < sweep.indexOf('markMessageProcessed'));
  assert.match(source, /processed:\s*replySweep\.authorized\s*\+\s*replySweep\.detailsRecovered/);
  assert.match(source, /advance_authorized_at IS NULL[\s\S]*?NULLIF\(TRIM\(eurocode\), ''\) IS NULL/);
  assert.match(source, /pending_reply_sweep_cursor_v3/);
  assert.match(source, /parseQuoteText\(text, service\.matricula\)/);
});

test('o asterisco da referência é preservado, o resto da pontuação não', () => {
  // O fornecedor escreve *7624BGSHAI e o asterisco distingue a peça: tem de
  // chegar ao portal tal como veio. Bullets, dois pontos e traços continuam a
  // ser ruído de formatação da célula.
  const comNotas = (notas) => parseTableHtml(
    '<table><tr><th>Matricula</th><th>Serviço</th><th>Valor</th><th>Notas</th></tr>' +
    `<tr><td>BJ-95-CU</td><td>SUBSTITUIÇÃO ÓCULO / OEM</td><td>248,00 €</td><td>${notas}</td></tr></table>`
  )[0].eurocode;

  assert.equal(comNotas('*7624BGSHAI'), '*7624BGSHAI');
  assert.equal(comNotas('* 7624BGSHAI'), '*7624BGSHAI');
  assert.equal(comNotas('**7624BGSHAI'), '**7624BGSHAI');
  assert.equal(comNotas('7624BGSHAI'), '7624BGSHAI');
  assert.equal(comNotas('# 7624BGSHAI'), '7624BGSHAI');
  assert.equal(comNotas('• 7624BGSHAI'), '7624BGSHAI');
  assert.equal(comNotas(': 7624BGSHAI'), '7624BGSHAI');

  // Também no texto corrido, que é como chega quando o Outlook achata a tabela
  const corrido = parseQuoteText('BJ-95-CU SUBSTITUIÇÃO ÓCULO / OEM 248,00 € *7624BGSHAI', 'BJ-95-CU');
  assert.equal(corrido[0].eurocode, '*7624BGSHAI');
});

// ── Pedidos com vários vidros ────────────────────────────────────────────────
const br11Quote = (rows) => `<table class="cotacao">
  <tr><td>Matrícula</td><td>Serviço</td><td>Valor</td><td>Ne</td><td>Notas</td></tr>
  ${rows.map(([desc, valor, code]) => `<tr><td>BR-11-XT</td><td>${desc}</td><td>${valor}</td><td></td><td>${code}</td></tr>`).join('\n  ')}
</table>`;

test('uma cotação com três vidros dá três linhas, uma por vidro', () => {
  const html = br11Quote([
    ['SUBSTITUIÇÃO DO PARA-BRISAS + CALIBRAGEM /AFTERMARKET', '268,00 €', '6748AGACMVZ'],
    ['SUBSTITUIÇÃO ÓCULO TRASEIRO /OEM', '310,00 €', '6748BGSH'],
    ['SUBSTITUIÇÃO VIDRO FIXO PORTA TRAS. ESQ. /AFTERMARKET', '95,00 €', '6748LGSH5RQ']
  ]);
  const rows = consolidateQuoteRows(parseTableHtml(html), 'BR-11-XT');

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.valor), [268, 310, 95]);
  assert.deepEqual(rows.map(r => r.eurocode), ['6748AGACMVZ', '6748BGSH', '6748LGSH5RQ']);
});

test('as cotações antigas citadas não acrescentam vidros nem substituem os novos', () => {
  const recente = br11Quote([
    ['SUBSTITUIÇÃO DO PARA-BRISAS /AFTERMARKET', '268,00 €', '6748AGACMVZ'],
    ['SUBSTITUIÇÃO ÓCULO TRASEIRO /OEM', '310,00 €', '']
  ]);
  const antiga = br11Quote([
    ['SUBSTITUIÇÃO DO PARA-BRISAS', '250,00 €', 'ANTIGO'],
    ['SUBSTITUIÇÃO ÓCULO TRASEIRO /OEM', '300,00 €', '6748BGSH']
  ]);
  const rows = consolidateQuoteRows(parseTableHtml(`${recente}<blockquote>${antiga}</blockquote>`), 'BR-11-XT');

  assert.equal(rows.length, 2);
  assert.equal(rows[0].valor, 268);
  assert.equal(rows[0].eurocode, '6748AGACMVZ');
  assert.equal(rows[1].valor, 310);
  // O Eurocode que faltava ao óculo vem da cópia antiga do mesmo vidro
  assert.equal(rows[1].eurocode, '6748BGSH');
});

test('no texto do Outlook, cada tabela citada começa noutro cabeçalho', () => {
  const text = `Podem avançar.
MatrículaServiçoValorNeNotas
BG-53-AHSUBSTITUIÇÃO VIDRO LATERAL TRAS. ESQUERDO / AFTERMARKET171,00 €7311LGSR5RQZ
BG-53-AHSUBSTITUIÇÃO ÓCULO TRASEIRO / OEM289,00 €7311BGSH
De: Gestao Clientes
MatrículaServiçoValorNeNotas
BG-53-AHSUBSTITUIÇÃO VIDRO LATERAL TRAS. ESQUERDO / AFTERMARKET165,00 €7311LGSR5RQZ`;
  const rows = parseQuoteText(text, 'BG-53-AH');

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.valor), [171, 289]);
});

test('o HTML e o texto do mesmo email não duplicam os vidros', () => {
  const html = br11Quote([
    ['SUBSTITUIÇÃO DO PARA-BRISAS /AFTERMARKET', '268,00 €', '6748AGACMVZ'],
    ['SUBSTITUIÇÃO ÓCULO TRASEIRO /OEM', '310,00 €', '6748BGSH']
  ]);
  const text = `MatrículaServiçoValorNeNotas
BR-11-XTSUBSTITUIÇÃO DO PARA-BRISAS /AFTERMARKET268,00 €6748AGACMVZ
BR-11-XTSUBSTITUIÇÃO ÓCULO TRASEIRO /OEM310,00 €6748BGSH`;
  const rows = consolidateQuoteRows([...parseTableHtml(html), ...parseQuoteText(text, 'BR-11-XT')], 'BR-11-XT');

  assert.equal(rows.length, 2);
});

test('o pedido sem detalhes fica com o primeiro vidro e os outros são novos', () => {
  const glasses = [
    { matricula: 'BR-11-XT', descricao: 'PARA-BRISAS', valor: 268, eurocode: 'A' },
    { matricula: 'BR-11-XT', descricao: 'ÓCULO', valor: 310, eurocode: 'B' },
    { matricula: 'BR-11-XT', descricao: 'VIDRO FIXO', valor: 95, eurocode: 'C' }
  ];
  const result = assignQuoteRows(glasses, [{ id: 254, descricao: null, valor: null, eurocode: null }]);

  assert.deepEqual(result.map(r => r.existing?.id ?? null), [254, null, null]);
});

test('numa nova cotação, cada vidro volta ao seu serviço pelo Eurocode', () => {
  const glasses = [
    { descricao: 'ÓCULO /OEM', valor: 300, eurocode: 'B' },
    { descricao: 'PARA-BRISAS /OEM', valor: 280, eurocode: 'A' }
  ];
  const existing = [
    { id: 10, descricao: 'PARA-BRISAS', valor: 268, eurocode: 'A' },
    { id: 11, descricao: 'ÓCULO', valor: 310, eurocode: 'B' }
  ];
  const result = assignQuoteRows(glasses, existing);

  assert.deepEqual(result.map(r => r.existing.id), [11, 10]);
});

test('um só vidro continua a atualizar o serviço que já existe', () => {
  const result = assignQuoteRows(
    [{ descricao: 'VIDRO LATERAL /OEM', valor: 192, eurocode: 'NOVO' }],
    [{ id: 5, descricao: 'VIDRO LATERAL', valor: 180, eurocode: 'ANTIGO' }]
  );
  assert.equal(result[0].existing.id, 5);
});
