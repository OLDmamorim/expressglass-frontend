const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const root = path.resolve(__dirname, '..');

test('a Oficina em Pressão carrega todos os recursos e controlos principais', () => {
  const html = fs.readFileSync(path.join(root, 'jogo.html'), 'utf8');
  const $ = cheerio.load(html);
  const ids = $('[id]').map((_, element) => $(element).attr('id')).get();

  assert.equal(new Set(ids).size, ids.length, 'não deve haver IDs duplicados');
  assert.equal($('#gameCanvas').length, 1);
  assert.equal($('#startBtn').length, 1);
  assert.equal($('#rankModal').length, 1);
  assert.equal($('.stage-track [data-stage-slot]').length, 4);
  assert.equal($('#decisionPanel').length, 1);
  assert.equal($('#rotateLeftBtn').length, 1);
  assert.equal($('#rotateRightBtn').length, 1);
  assert.equal($('script[src^="game-core.js"]').length, 1);
  assert.equal($('script[src^="jogo.js"]').length, 1);
  assert.equal($('link[href^="jogo.css"]').length, 1);
});

test('a experiência tem duas rotas distintas e já não depende de seguir um traço', () => {
  const source = [
    fs.readFileSync(path.join(root, 'jogo.html'), 'utf8'),
    fs.readFileSync(path.join(root, 'jogo.js'), 'utf8')
  ].join('\n').toLowerCase();

  for (const legacyTerm of [
    'tetris',
    'próximo caco',
    'encaixa os cacos',
    'linha completa',
    'segue o fio de corte',
    'acompanha o ponto luminoso',
    'updatetrace'
  ]) {
    assert.equal(source.includes(legacyTerm), false, 'encontrado termo antigo: ' + legacyTerm);
  }
  for (const mechanic of [
    'reparar ou substituir',
    'escolhe o para-brisas',
    'controla a pressão',
    'alinha posição e ângulo',
    'sincroniza o scanner',
    'teste de estanquidade'
  ]) {
    assert.equal(source.includes(mechanic), true, 'falta a mecânica: ' + mechanic);
  }
});

test('o endpoint ignora pontuações enviadas pelo navegador', () => {
  const source = fs.readFileSync(path.join(root, 'netlify/functions/game-scores.js'), 'utf8');
  assert.equal(/\bdata\.score\b/.test(source), false);
  assert.match(source, /Core\.calculateScore\(jobs, session\.multiplier\)/);
  assert.match(source, /verifyGameSession/);
});
