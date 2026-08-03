const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { selectPoweringResult } = require('../netlify/lib/powering-kpis-select');

test('escolhe o registo mais completo do mes pedido', () => {
  const result = selectPoweringResult([
    { mes: 8, ano: 2026, totalServicos: 12, objetivoMensal: 91 },
    { mes: 7, ano: 2026, totalServicos: 123, objetivoMensal: 78 },
    { mes: 8, ano: 2026, totalServicos: 18, objetivoMensal: 91 }
  ], 8, 2026);

  assert.equal(result.totalServicos, 18);
  assert.equal(result.objetivoMensal, 91);
});

test('sem dados do mes pedido usa o mes mais recente e nao o maior historico', () => {
  const result = selectPoweringResult([
    { mes: 5, ano: 2026, totalServicos: 123, objetivoMensal: 78 },
    { mes: 6, ano: 2026, totalServicos: 96, objetivoMensal: 88 },
    { mes: 7, ano: 2026, totalServicos: 89, objetivoMensal: 91 }
  ], 8, 2026);

  assert.equal(result.mes, 7);
  assert.equal(result.ano, 2026);
  assert.equal(result.totalServicos, 89);
  assert.equal(result.objetivoMensal, 91);
});

test('o fallback respeita a passagem de ano', () => {
  const result = selectPoweringResult([
    { mes: 11, ano: 2025, totalServicos: 140 },
    { mes: 12, ano: 2025, totalServicos: 82 }
  ], 1, 2026);

  assert.equal(result.mes, 12);
  assert.equal(result.ano, 2025);
  assert.equal(result.totalServicos, 82);
});

test('ignora meses futuros quando procura um fallback anterior', () => {
  const result = selectPoweringResult([
    { mes: 3, ano: 2026, totalServicos: 70 },
    { mes: 5, ano: 2026, totalServicos: 90 }
  ], 4, 2026);

  assert.equal(result.mes, 3);
});

test('sem resultados datados nao associa valores a um mes errado', () => {
  assert.equal(selectPoweringResult([{ totalServicos: 123 }], 8, 2026), null);
  assert.equal(selectPoweringResult([], 8, 2026), null);
});

test('o banner usa o mes efetivamente devolvido pela API', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'powering-banner.js'), 'utf8');

  assert.match(source, /mes: d\.mes \?\? d\.kpis\.mes/);
  assert.match(source, /monthLabel\.textContent = new Date\(year, month - 1, 1\)/);
});
