'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSubject,
  normalizeMessageId,
  normalizeReferences,
  isReplySubject,
  extractThreadMeta,
  buildMessageKey,
  hasExplicitAdvanceAuthorization,
  isAuthorizationActive,
  shouldAnalyzeAsFollowup
} = require('../netlify/functions/lib/mycar-email-thread');

test('normaliza prefixos de resposta e encaminhamento sem perder o assunto', () => {
  assert.equal(normalizeSubject(' RE: FW: BT-04-HZ | WIP: 123 '), 'bt-04-hz | wip: 123');
  assert.equal(normalizeSubject('[EXTERNAL] RES: BT-04-HZ'), 'bt-04-hz');
  assert.equal(normalizeSubject('BT-04-HZ'), 'bt-04-hz');
});

test('reconhece assuntos de reply comuns', () => {
  assert.equal(isReplySubject('RE: BT-04-HZ'), true);
  assert.equal(isReplySubject('RES: BT-04-HZ'), true);
  assert.equal(isReplySubject('Enc: BT-04-HZ'), false);
  assert.equal(isReplySubject('BT-04-HZ'), false);
});

test('extrai identificadores Gmail e cabeçalhos RFC da conversa', () => {
  const meta = extractThreadMeta({
    subject: 'RE: BT-04-HZ',
    messageId: '<Reply@MyCar.pt>',
    inReplyTo: '<Original@Expressglass.pt>',
    references: ['<Root@Expressglass.pt>', '<Original@Expressglass.pt>']
  }, { uid: 42, 'x-gm-thrid': '987654321', 'x-gm-msgid': '123456789' }, 42);

  assert.equal(meta.gmailThreadId, '987654321');
  assert.equal(meta.gmailMessageId, '123456789');
  assert.equal(meta.messageId, 'reply@mycar.pt');
  assert.deepEqual(meta.references, ['root@expressglass.pt', 'original@expressglass.pt']);
  assert.equal(meta.normalizedSubject, 'bt-04-hz');
  assert.equal(buildMessageKey(meta), 'gmail:123456789');
});

test('normaliza referências e elimina duplicados', () => {
  assert.equal(normalizeMessageId('<ABC@EXAMPLE.COM>'), 'abc@example.com');
  assert.deepEqual(normalizeReferences('<A@x.pt> <a@x.pt> <B@x.pt>'), ['a@x.pt', 'b@x.pt']);
});

test('deteta ordens explícitas para avançar', () => {
  assert.equal(hasExplicitAdvanceAuthorization('Bom dia, podem avançar com o serviço.'), true);
  assert.equal(hasExplicitAdvanceAuthorization('O orçamento está aprovado. Podem proceder.'), true);
  assert.equal(hasExplicitAdvanceAuthorization('Serviço autorizado.'), true);
});

test('não confunde espera ou recusa com autorização', () => {
  assert.equal(hasExplicitAdvanceAuthorization('Não podem avançar. Aguardem autorização.'), false);
  assert.equal(hasExplicitAdvanceAuthorization('Pedido pendente de autorização.'), false);
  assert.equal(hasExplicitAdvanceAuthorization('Acusamos a receção do orçamento.'), false);
});

test('a autorização visual deixa de estar ativa após fecho do serviço', () => {
  const base = { advance_authorized_at: '2026-08-05T09:00:00Z' };
  assert.equal(isAuthorizationActive({ ...base, status: 'pendente' }), true);
  assert.equal(isAuthorizationActive({ ...base, status: 'encomendado' }), true);
  assert.equal(isAuthorizationActive({ ...base, status: 'realizado' }), false);
  assert.equal(isAuthorizationActive({ ...base, status: 'rejeitado' }), false);
});

test('a recuperação não trata novamente o email inicial como reply', () => {
  const existing = {
    email_subject: 'FW: BT-04-HZ | WIP: 123',
    email_received_at: '2026-08-05T08:00:00Z'
  };
  assert.equal(shouldAnalyzeAsFollowup(existing, {
    subject: 'FW: BT-04-HZ | WIP: 123',
    date: '2026-08-05T08:00:00Z',
    meta: { references: [] }
  }), false);
});

test('resposta direta ou reencaminhada mais tarde é analisada', () => {
  const existing = {
    email_subject: 'FW: BT-04-HZ | WIP: 123',
    email_received_at: '2026-08-05T08:00:00Z'
  };
  assert.equal(shouldAnalyzeAsFollowup(existing, {
    subject: 'RE: BT-04-HZ | WIP: 123',
    date: '2026-08-05T09:00:00Z',
    meta: { references: ['original@example.com'] }
  }), true);
  assert.equal(shouldAnalyzeAsFollowup(existing, {
    subject: 'FW: BT-04-HZ | WIP: 123',
    date: '2026-08-05T09:00:00Z',
    meta: { references: [] }
  }), true);
});
