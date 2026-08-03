const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_BULK_DELETE,
  normalizeReceptionIds,
  assertBulkDeleteTargets
} = require('../netlify/lib/glass-reception-bulk-delete');

function reception(id, overrides = {}) {
  return {
    id,
    portal_id: 10,
    status: 'pending',
    is_return: false,
    ...overrides
  };
}

test('normaliza, valida e remove IDs repetidos da seleção', () => {
  assert.deepEqual(normalizeReceptionIds(['3', 1, 3, 2, 0, 'x']), [3, 1, 2]);
  assert.throws(() => normalizeReceptionIds([]), error => error.statusCode === 400);
  assert.throws(
    () => normalizeReceptionIds(Array.from({ length: MAX_BULK_DELETE + 1 }, (_, index) => index + 1)),
    error => error.statusCode === 400
  );
});

test('autoriza apenas pendentes visíveis ao coordenador', () => {
  const ids = [1, 2, 3];
  const rows = [
    reception(1, { status: 'pending' }),
    reception(2, { status: 'confirmed' }),
    reception(3, { status: 'missing' })
  ];

  assert.deepEqual(assertBulkDeleteTargets(ids, rows, [10], false), ids);
  assert.throws(
    () => assertBulkDeleteTargets(ids, rows, [20], false),
    error => error.statusCode === 403
  );
});

test('impede eliminação parcial, devoluções e registos já tratados', () => {
  assert.throws(
    () => assertBulkDeleteTargets([1, 2], [reception(1)], [10], false),
    error => error.statusCode === 409
  );
  assert.throws(
    () => assertBulkDeleteTargets([1], [reception(1, { is_return: true })], [10], false),
    error => error.statusCode === 409
  );
  assert.throws(
    () => assertBulkDeleteTargets([1], [reception(1, { status: 'received' })], [10], false),
    error => error.statusCode === 409
  );
});

test('a interface marca tudo por defeito e envia uma única eliminação em lote', () => {
  const root = path.resolve(__dirname, '..');
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const endpoint = fs.readFileSync(path.join(root, 'netlify/functions/glass-reception.js'), 'utf8');

  assert.match(page, /class="gr-reception-select"[^>]*type="checkbox"[^>]*checked/);
  assert.match(page, /id="grSelectAllReceptions"[^>]*type="checkbox" checked/);
  assert.match(page, /body: JSON\.stringify\(\{ ids \}\)/);
  assert.match(page, /Os agendamentos e os respetivos cards não serão apagados/);
  assert.match(endpoint, /Array\.isArray\(body\.ids\)/);
  assert.match(endpoint, /WHERE id = ANY\(\$1::int\[\]\)[\s\S]*FOR UPDATE/);
  assert.match(endpoint, /deleted_ids: deleted\.map/);
});
