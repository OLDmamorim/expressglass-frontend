const test = require('node:test');
const assert = require('node:assert/strict');

const vl = require('../vehicle-lookup.js');

test('a matrícula leva os traços ao escrever', () => {
  assert.equal(vl.comTracos('bc30rq'), 'BC-30-RQ');
  assert.equal(vl.comTracos('BC-3'), 'BC-3');
  assert.equal(vl.comTracos('49 ue 30 x'), '49-UE-30');
  assert.equal(vl.matriculaValida('BC-30-RQ'), true);
  assert.equal(vl.matriculaValida('B3-0R-Q1'), false);
});

test('o ano do modelo pelo VIN', () => {
  const hoje = new Date('2026-11-05');
  assert.equal(vl.anoModeloDoVin('WVGZZZA1ZMK017919', hoje), 2021);
  assert.equal(vl.anoModeloDoVin('VF38EBHZTGL038181', hoje), 2016);
  assert.equal(vl.anoModeloDoVin('VXEVBYHVMPZ036209', hoje), 2023);
  assert.equal(vl.anoModeloDoVin('', hoje), null);
});

test('as linhas da viatura, sem as vazias', () => {
  const linhas = vl.linhasDaViatura({
    marca: 'OPEL', modelo: 'Vivaro C Furgão 1.5', vin: 'VXEVBYHVMPZ036209', motor: 'D 15 DTH (DV5RUC)',
    potencia: '88 kW / 120 cv', transmissao: undefined, detalhes: [{ rotulo: 'Combustível', valor: 'Diesel' }],
  }, new Date('2026-11-05'));
  assert.deepEqual(linhas.map(l => l[0]), ['Marca', 'Modelo', 'Ano do modelo', 'VIN', 'Motor', 'Potência', 'Combustível']);
  assert.equal(linhas[2][1], '2023');
});
