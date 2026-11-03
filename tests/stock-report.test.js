const test = require('node:test');
const assert = require('node:assert/strict');

const stock = require('../stock-report.js');

test('os quatro problemas do modal', () => {
  assert.deepEqual(stock.PROBLEMAS.map(p => p.id), ['errado', 'danificado', 'defeito', 'partido']);
  assert.equal(stock.nomeProblema('defeito'), 'Com defeito');
  assert.equal(stock.nomeProblema('partido'), 'Partido');
});

test('o Eurocode do serviço vem já preenchido, sem o asterisco do fornecedor', () => {
  assert.deepEqual(stock.eurocodesDoServico('*3595LYPR5RQZ'), ['3595LYPR5RQZ']);
  assert.deepEqual(stock.eurocodesDoServico('# 7624bgshai'), ['7624BGSHAI']);
});

test('um serviço com vários vidros dá a escolher os Eurocodes, sem repetidos', () => {
  assert.deepEqual(stock.eurocodesDoServico('8547AGNGYV1V;8547ASMST1A'), ['8547AGNGYV1V', '8547ASMST1A']);
  assert.deepEqual(stock.eurocodesDoServico('2488AGN, 2488AGN / 3733AGN'), ['2488AGN', '3733AGN']);
});

test('texto que não é Eurocode fica de fora', () => {
  assert.deepEqual(stock.eurocodesDoServico(''), []);
  assert.deepEqual(stock.eurocodesDoServico('PARA-BRISAS'), []);
  assert.deepEqual(stock.eurocodesDoServico(null), []);
});

test('o estado do cartão: pendente enquanto houver um por tratar', () => {
  const reportes = [
    { agendaServicoId: '101', estado: 'tratado' },
    { agendaServicoId: '101', estado: 'pendente' },
    { agendaServicoId: '202', estado: 'tratado' },
  ];
  assert.equal(stock.estadoDoServico(reportes, 101), 'pendente');
  assert.equal(stock.estadoDoServico(reportes, '202'), 'tratado');
  assert.equal(stock.estadoDoServico(reportes, 303), null);
  assert.equal(stock.estadoDoServico(undefined, 1), null);
});

test('o filtro da lista: por tratar, tratados ou todos', () => {
  const reportes = [{ id: 1, estado: 'pendente' }, { id: 2, estado: 'tratado' }, { id: 3, estado: 'pendente' }];
  assert.deepEqual(stock.filtrar(reportes, 'pendente').map(r => r.id), [1, 3]);
  assert.deepEqual(stock.filtrar(reportes, 'tratado').map(r => r.id), [2]);
  assert.deepEqual(stock.filtrar(reportes, 'todos').map(r => r.id), [1, 2, 3]);
});
