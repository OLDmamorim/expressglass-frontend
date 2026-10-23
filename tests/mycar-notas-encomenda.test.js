'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isNotaEncomendaEmail,
  normalizeNe,
  parseNotasEncomenda,
  matchNotaPdfs,
  chooseServicesForRow,
  applyNotasEncomenda
} = require('../netlify/functions/lib/mycar-notas-encomenda');

// A tabela do email "NOTAS DE ENCOMENDA - 23/10" da MyCar.
const notasHtml = `
  <p>Bom dia.</p><p>Segue em anexo as Notas de Encomendas referentes aos serviços prestados, conforme a tabela abaixo:</p>
  <table>
    <tr><td>22593</td><td>bt-11-vc</td><td>SERIE-1</td><td>12/10/2026</td><td>REPARAÇÃO</td><td>48,00 €</td><td>22/10/2026</td><td>NE956303</td></tr>
    <tr><td>17936</td><td>BS-55-VH</td><td>RENAULT 5</td><td>16/10/2026</td><td>PARA-BRISAS</td><td>268,00 €</td><td>22/10/2026</td><td>NE956304</td></tr>
    <tr><td>23519</td><td>AS-91-PI</td><td>500C</td><td>19/10/2026</td><td>VIDRO OCULO</td><td>171,00 €</td><td>22/10/2026</td><td>NE956305</td></tr>
    <tr><td>23641</td><td>BJ-93-TQ</td><td>CAPTUR</td><td>20/10/2026</td><td>PARA-BRISAS</td><td>268,00 €</td><td>22/10/2026</td><td>NE956304</td></tr>
  </table>
  <table><tr><td><img src="cid:logo"></td><td>Rita Moreira<br>Assistente Admnistrativa<br>Telemóvel: 964 721 426</td></tr></table>`;

const email = (extra = {}) => ({
  subject: 'NOTAS DE ENCOMENDA - 23/10',
  from: { value: [{ address: 'gestao.mcc@grupojap.pt' }] },
  html: notasHtml,
  date: new Date('2026-10-23T08:40:00Z'),
  attachments: [],
  ...extra
});

test('reconhece o email das Notas de Encomenda pelo assunto e remetente', () => {
  assert.equal(isNotaEncomendaEmail(email()), true);
  assert.equal(isNotaEncomendaEmail(email({ subject: 'RE: BU-68-AX | WIP: 16801' })), false);
  assert.equal(isNotaEncomendaEmail(email({ from: { value: [{ address: 'outro@exemplo.pt' }] } })), false);
  assert.equal(isNotaEncomendaEmail(email({ subject: 'Nota de encomenda 23/10' })), true);
});

test('aceita a nota reencaminhada por paredes@ com a MyCar no cabeçalho citado', () => {
  const fw = email({
    subject: 'FW: NOTAS DE ENCOMENDA - 23/10',
    from: { value: [{ address: 'paredes@expressglass.pt' }] },
    html: `<p><b>De:</b> Gestão MCC &lt;gestao.mcc@grupojap.pt&gt;<br><b>Assunto:</b> NOTAS DE ENCOMENDA - 23/10</p>${notasHtml}`
  });
  assert.equal(isNotaEncomendaEmail(fw), true);
  assert.equal(parseNotasEncomenda(fw).length, 4);
  // Um reencaminhamento sem a MyCar no cabeçalho não é uma nota da MyCar
  assert.equal(isNotaEncomendaEmail(email({
    subject: 'FW: Notas de encomenda',
    from: { value: [{ address: 'paredes@expressglass.pt' }] },
    html: '<p>De: Fornecedor &lt;vendas@fornecedor.pt&gt;</p>'
  })), false);
});

test('lê as quatro linhas da tabela, com a matrícula, o WIP, o valor e a N.E.', () => {
  const rows = parseNotasEncomenda(email());
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { wip: '22593', matricula: 'BT-11-VC', servico: 'REPARAÇÃO', valor: 48, ne: 'NE956303' });
  assert.deepEqual(rows.map(r => r.ne), ['NE956303', 'NE956304', 'NE956305', 'NE956304']);
  assert.deepEqual(rows.map(r => r.matricula), ['BT-11-VC', 'BS-55-VH', 'AS-91-PI', 'BJ-93-TQ']);
});

test('também lê a tabela quando o email chega só em texto', () => {
  const rows = parseNotasEncomenda({
    text: '22593\tbt-11-vc\tSERIE-1\t12/10/2026\tREPARAÇÃO\t48,00 €\t22/10/2026\tNE956303\n' +
          '17936  BS-55-VH  RENAULT 5  16/10/2026  PARA-BRISAS  268,00 €  22/10/2026  NE956304'
  });
  assert.deepEqual(rows.map(r => [r.matricula, r.ne, r.valor]), [['BT-11-VC', 'NE956303', 48], ['BS-55-VH', 'NE956304', 268]]);
});

test('normaliza o número da N.E.', () => {
  assert.equal(normalizeNe('NE956303'), 'NE956303');
  assert.equal(normalizeNe('ne 956303'), 'NE956303');
  assert.equal(normalizeNe('NE-956303'), 'NE956303');
  assert.equal(normalizeNe('REPARAÇÃO'), null);
});

const pdf = (filename) => ({ filename, contentType: 'application/pdf', content: Buffer.from(filename) });

test('liga cada N.E. ao seu PDF pelo nome do ficheiro', () => {
  const a = pdf('NE956303.pdf'), b = pdf('Nota Encomenda 956304.pdf'), c = pdf('NE956305.pdf');
  const map = matchNotaPdfs(['NE956303', 'NE956304', 'NE956305'], [a, b, c]);
  assert.deepEqual(map.get('NE956303'), [a]);
  assert.deepEqual(map.get('NE956304'), [b]);
  assert.deepEqual(map.get('NE956305'), [c]);
});

test('sem o número no nome, procura-o no texto do PDF', () => {
  const a = pdf('doc1.pdf'), b = pdf('doc2.pdf');
  const map = matchNotaPdfs(['NE956303', 'NE956304'], [a, b], ['Nota de Encomenda N.º NE 956304', 'NE956303 ...']);
  assert.deepEqual(map.get('NE956303'), [b]);
  assert.deepEqual(map.get('NE956304'), [a]);
});

test('uma só N.E. e um só PDF ficam ligados mesmo sem número', () => {
  const a = pdf('anexo.pdf');
  assert.deepEqual(matchNotaPdfs(['NE956303'], [a]).get('NE956303'), [a]);
  assert.equal(matchNotaPdfs(['NE1111', 'NE2222'], [a]).size, 0);
});

test('as imagens da assinatura não contam como PDF', () => {
  const logo = { filename: 'image001.png', contentType: 'image/png', content: Buffer.from('x') };
  assert.equal(matchNotaPdfs(['NE956303'], [logo]).size, 0);
});

test('escolhe o serviço da linha pela matrícula, WIP e valor', () => {
  const services = [
    { id: 1, matricula: 'BS-55-VH', valor: 268, status: 'realizado', notas: 'WIP: 17936' },
    { id: 2, matricula: 'BS-55-VH', valor: 95, status: 'realizado', notas: 'WIP: 17936' },
    { id: 3, matricula: 'BS-55-VH', valor: 268, status: 'realizado', notas: 'WIP: 11111' },
    { id: 4, matricula: 'AS-91-PI', valor: 171, status: 'realizado', notas: 'WIP: 23519' }
  ];
  const row = { wip: '17936', matricula: 'BS-55-VH', valor: 268, ne: 'NE956304' };
  assert.deepEqual(chooseServicesForRow(row, services).map(s => s.id), [1]);
});

test('uma matrícula com um só serviço fica com a N.E., e os rejeitados ficam de fora', () => {
  const row = { wip: '99999', matricula: 'bt-11-vc', valor: 48, ne: 'NE956303' };
  assert.deepEqual(chooseServicesForRow(row, [{ id: 7, matricula: 'BT-11-VC', valor: null, status: 'pendente' }]).map(s => s.id), [7]);
  assert.deepEqual(chooseServicesForRow(row, [{ id: 8, matricula: 'BT-11-VC', status: 'rejeitado' }]), []);
});

test('applyNotasEncomenda grava a N.E. e o PDF em cada serviço e diz o que ficou sem serviço', async () => {
  const servicesByPlate = {
    BT11VC: [{ id: 10, matricula: 'BT-11-VC', valor: 48, status: 'realizado', notas: 'WIP: 22593', nota_encomenda: null }],
    BS55VH: [{ id: 11, matricula: 'BS-55-VH', valor: 268, status: 'realizado', notas: 'WIP: 17936', nota_encomenda: null }],
    AS91PI: [],
    BJ93TQ: [{ id: 13, matricula: 'BJ-93-TQ', valor: 268, status: 'faturado', notas: 'WIP: 23641', nota_encomenda: 'NE956304' }]
  };
  const updates = [], documents = [];
  const client = {
    async query(sql, params) {
      if (/FROM mycar_services/.test(sql) && /SELECT/.test(sql)) return { rows: servicesByPlate[params[0]] || [] };
      if (/UPDATE mycar_services/.test(sql)) { updates.push([params[3], params[0]]); return { rows: [] }; }
      if (/INSERT INTO mycar_service_documents/.test(sql)) { documents.push([params[0], params[1], params[2]]); return { rowCount: 1 }; }
      throw new Error('consulta inesperada: ' + sql);
    }
  };
  const result = await applyNotasEncomenda(client, email({
    attachments: [pdf('NE956303.pdf'), pdf('NE956304.pdf'), pdf('NE956305.pdf')]
  }), { messageId: '<ne@grupojap>' });

  assert.equal(result.rows, 4);
  assert.equal(result.matched, 3);
  assert.deepEqual(result.unmatched.map(r => r.matricula), ['AS-91-PI']);
  // BJ-93-TQ já tinha a mesma N.E.: não volta a ser escrita
  assert.deepEqual(updates, [[10, 'NE956303'], [11, 'NE956304']]);
  // A NE956304 cobre dois serviços: o mesmo PDF fica nos dois
  assert.deepEqual(documents, [
    [10, 'NE956303', 'NE956303.pdf'],
    [11, 'NE956304', 'NE956304.pdf'],
    [13, 'NE956304', 'NE956304.pdf']
  ]);
});
