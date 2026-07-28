const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const root = path.resolve(__dirname, '..');

test('o Impacto carrega a estrada, oficina e controlos principais', () => {
  const html = fs.readFileSync(path.join(root, 'jogo.html'), 'utf8');
  const $ = cheerio.load(html);
  const ids = $('[id]').map((_, element) => $(element).attr('id')).get();

  assert.equal(new Set(ids).size, ids.length, 'não deve haver IDs duplicados');
  assert.equal($('#gameCanvas').length, 1);
  assert.equal($('#startBtn').length, 1);
  assert.equal($('#touchSteerHint').length, 1);
  assert.equal($('#leftBtn').length, 1);
  assert.equal($('#rightBtn').length, 1);
  assert.equal($('#useGlassBonusBtn').length, 1);
  assert.equal($('#shopPrompt').length, 1);
  assert.equal($('#repairBtn').length, 1);
  assert.equal($('#replaceBtn').length, 1);
  assert.equal($('#rankModal').length, 1);
  assert.equal($('script[src^="game-core.js"]').length, 1);
  assert.equal($('script[src^="jogo.js"]').length, 1);
  assert.equal($('link[href^="jogo.css"]').length, 1);
});

test('no telemóvel o carro acompanha o dedo sem esperar que o toque termine', () => {
  const html = fs.readFileSync(path.join(root, 'jogo.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'jogo.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'jogo.css'), 'utf8');

  assert.match(html, /Mantém o dedo e arrasta para conduzir/);
  assert.match(script, /pointer\.touchSteering = event\.pointerType === 'touch'/);
  assert.match(script, /function handlePointerMove[\s\S]*?steerWithPointer\(event\)/);
  assert.match(script, /Core\.dragLane\(pointer\.startLane, dx, rect\.width\)/);
  assert.match(styles, /@media \(max-width: 680px\), \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.lane-controls\s*\{\s*display: none;/);
});

test('a experiência é um endless runner ligado ao vidro e já não usa a oficina antiga', () => {
  const source = [
    fs.readFileSync(path.join(root, 'jogo.html'), 'utf8'),
    fs.readFileSync(path.join(root, 'jogo.js'), 'utf8')
  ].join('\n').toLowerCase();

  for (const legacyTerm of [
    'segue o fio de corte',
    'acompanha o ponto luminoso',
    'escolhe o para-brisas',
    'controla a pressão',
    'sincroniza o scanner',
    'updatetrace',
    'createjob'
  ]) {
    assert.equal(source.includes(legacyTerm), false, 'encontrado termo antigo: ' + legacyTerm);
  }

  for (const mechanic of [
    'a estrada não perdoa',
    'muda de faixa',
    'pedra no para-brisas',
    'parar na expressglass',
    'reparar impacto',
    'substituir vidro',
    'vidro novo',
    'pontos ×2'
  ]) {
    assert.equal(source.includes(mechanic), true, 'falta a mecânica: ' + mechanic);
  }
});

test('a entrada Impacto abre diretamente o modo de teste sem login', () => {
  const entry = fs.readFileSync(path.join(root, 'impacto.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'jogo.js'), 'utf8');

  assert.match(entry, /jogo\.html\?demo=1(?:&|&amp;)release=impacto-v4/);
  assert.match(script, /query\.get\('demo'\) === '1'/);
  assert.match(script, /if \(!token && !demoMode\)/);
  assert.match(script, /Teste Impacto V4/);
});

test('o endpoint calcula o tempo no servidor e ignora pontuações enviadas', () => {
  const source = fs.readFileSync(path.join(root, 'netlify/functions/game-scores.js'), 'utf8');
  assert.equal(/\bdata\.score\b/.test(source), false);
  assert.match(source, /Core\.calculateScore\(run\)/);
  assert.match(source, /Core\.validateRun\(data\.run, wallElapsedMs\)/);
  assert.match(source, /verifyGameSession/);
});
