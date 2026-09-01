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
    eurocode: '3593LYPE5RWZ',
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
    eurocode: '3593LYPE5RWZ',
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
  assert.equal(quote.eurocode, '3593LYPE5RWZ');
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
  assert.equal(quote.eurocode, '3593LYPE5RWZ');
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
  assert.equal(selected.quote.eurocode, '3593LYPE5RWZ');
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
  assert.equal(selected.quote.eurocode, '3593LYPE5RWZ');
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
