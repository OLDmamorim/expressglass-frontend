'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CLEAN_DUPLICATES_SQL,
  CREATE_TRIGGER_FUNCTION_SQL,
  CREATE_TRIGGER_SQL,
  CREATE_UNIQUE_INDEX_SQL,
  ensureSingleFirstOfDay
} = require('../netlify/functions/lib/first-of-day-invariant');

test('a limpeza mantém o primeiro cartão da rota e desmarca os restantes', () => {
  assert.match(CLEAN_DUPLICATES_SQL, /PARTITION BY portal_id, date/i);
  assert.match(CLEAN_DUPLICATES_SQL, /ORDER BY sortIndex ASC NULLS LAST, created_at ASC NULLS LAST, id ASC/i);
  assert.match(CLEAN_DUPLICATES_SQL, /route_position > 1/i);
  assert.match(CLEAN_DUPLICATES_SQL, /SET first_of_day = FALSE/i);
});

test('duas gravações simultâneas da mesma agenda e dia são serializadas', () => {
  assert.match(CREATE_TRIGGER_FUNCTION_SQL, /pg_advisory_xact_lock\(NEW\.portal_id, hashtext\(NEW\.date::text\)\)/i);
  assert.match(CREATE_TRIGGER_FUNCTION_SQL, /portal_id = NEW\.portal_id/i);
  assert.match(CREATE_TRIGGER_FUNCTION_SQL, /date = NEW\.date/i);
  assert.match(CREATE_TRIGGER_FUNCTION_SQL, /id IS DISTINCT FROM NEW\.id/i);
  assert.match(CREATE_TRIGGER_SQL, /BEFORE INSERT OR UPDATE OF first_of_day, date, portal_id/i);
});

test('a base de dados proíbe dois primeiros serviços por agenda e dia', () => {
  assert.match(CREATE_UNIQUE_INDEX_SQL, /UNIQUE INDEX/i);
  assert.match(CREATE_UNIQUE_INDEX_SQL, /ON appointments \(portal_id, date\)/i);
  assert.match(CREATE_UNIQUE_INDEX_SQL, /WHERE first_of_day IS TRUE/i);
});

test('instala a limpeza, o trigger e a restrição por esta ordem', async () => {
  const calls = [];
  const db = { query: async sql => { calls.push(sql); return { rows: [] }; } };

  await ensureSingleFirstOfDay(db);

  assert.deepEqual(calls, [
    CLEAN_DUPLICATES_SQL,
    CREATE_TRIGGER_FUNCTION_SQL,
    CREATE_TRIGGER_SQL,
    CREATE_UNIQUE_INDEX_SQL
  ]);
});

test('a API instala a proteção antes de aceitar POST ou PUT', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../netlify/functions/appointments.js'),
    'utf8'
  );
  const invariant = source.indexOf('await ensureSingleFirstOfDay(pool)');
  const post = source.indexOf("if (event.httpMethod === 'POST')");
  const put = source.indexOf("if (event.httpMethod === 'PUT')");

  assert.ok(invariant >= 0);
  assert.ok(invariant < post);
  assert.ok(invariant < put);
});
