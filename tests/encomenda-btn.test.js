const test = require('node:test');
const assert = require('node:assert/strict');

const { caminhoPortalLink, menuValido } = require('../netlify/lib/portal-link');
const encomenda = require('../encomenda-btn.js');

test('o pedido ao PoweringEG: Frota por omissão, Consumíveis com menu=encomenda', () => {
  assert.equal(caminhoPortalLink(12), '/portal-link/12');
  assert.equal(caminhoPortalLink('12', 'viatura'), '/portal-link/12');
  assert.equal(caminhoPortalLink(12, 'encomenda'), '/portal-link/12?menu=encomenda');
  // Um menu desconhecido não passa para o PoweringEG.
  assert.equal(caminhoPortalLink(12, 'admin&x=1'), '/portal-link/12');
  assert.equal(menuValido(undefined), 'viatura');
  assert.throws(() => caminhoPortalLink('abc', 'encomenda'), /lojaId inválido/);
});

test('o botão pede o link de encomenda do portal ativo', () => {
  assert.equal(
    encomenda.urlDoPedido('7'),
    '/.netlify/functions/powering-kpis?action=portal-link&menu=encomenda&portal_id=7'
  );
});

test('a resposta: link, portal sem loja, ou tentar outra vez (até 5)', () => {
  assert.deepEqual(
    encomenda.interpretar({ success: true, url: 'https://poweringeg.pt/portal-loja?token=x&tab=frisos', lojaNome: 'Braga' }, 0),
    { estado: 'ok', url: 'https://poweringeg.pt/portal-loja?token=x&tab=frisos', lojaNome: 'Braga' }
  );
  assert.deepEqual(encomenda.interpretar({ success: false, reason: 'sem_portal' }, 0), { estado: 'sem_portal' });
  assert.deepEqual(encomenda.interpretar({ success: false, error: 'HTTP 502' }, 0), { estado: 'repetir' });
  assert.deepEqual(encomenda.interpretar(null, 4), { estado: 'sem_portal' });
});
