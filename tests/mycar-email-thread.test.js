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
  extractMyCarMessageBody,
  isMyCarMessage,
  classifyExplicitAdvanceInstruction,
  hasExplicitAdvanceAuthorization,
  latestExplicitAdvanceInstruction,
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

test('identifica o remetente real num email MyCar reencaminhado', () => {
  assert.equal(isMyCarMessage({
    from: { text: 'Orçamentação Mycarcenter <orcamentacao@mycarcenter.pt>' },
    text: 'Bom dia, podem avançar.\n\nDe: ExpressGlass <gestaoclientes@expressglass.pt>'
  }), true);
  assert.equal(isMyCarMessage({
    from: { text: 'ExpressGlass <gestaoclientes@expressglass.pt>' },
    text: 'De: Orçamentação Mycarcenter <orcamentacao@mycarcenter.pt>\nEnviado: 8 de julho\n\nPodem avançar.'
  }), true);
  assert.equal(isMyCarMessage({
    from: { text: 'ExpressGlass <gestaoclientes@expressglass.pt>' },
    text: 'De: ExpressGlass.Gestao Clientes <gestaoclientes@expressglass.pt>\nEnviado: 7 de julho\n\nAguardamos resposta.\nDe: Orçamentação Mycarcenter <orcamentacao@mycarcenter.pt>'
  }), false);
});

test('atravessa uma camada ExpressGlass vazia e lê a resposta MyCar do BU-23-JN', () => {
  const text = `---------- Forwarded message ---------
From: ExpressGlass.Gestao Clientes <gestaoclientes@expressglass.pt>
Date: quarta-feira, 8 de julho de 2026
Subject: FW: BU-23-JN | WP0ZZZ995SS233043
To: Marco

De: Orçamentação Mycarcenter <orcamentacao@mycarcenter.pt>
Enviado: quarta-feira, 8 de julho de 2026 12:07:28
Para: ExpressGlass.Gestao Clientes <gestaoclientes@expressglass.pt>
Assunto: RE: BU-23-JN | WP0ZZZ995SS233043

Segurança: Este email não é da nossa organização. Confirme a identidade do remetente.
Bom dia,
Podem avançar com o pedido.
Serviço a ser realizado no Mycarcenter.
Obrigada.

De: ExpressGlass.Gestao Clientes <gestaoclientes@expressglass.pt>
Enviada: 7 de julho de 2026 17:55
Para: Orçamentação Mycarcenter <orcamentacao@mycarcenter.pt>
Assunto: RE: BU-23-JN | WP0ZZZ995SS233043`;

  const body = extractMyCarMessageBody({
    from: { text: 'ExpressGlass <gestaoclientes@expressglass.pt>' },
    text
  });

  assert.match(body, /Podem avançar com o pedido/i);
  assert.equal(hasExplicitAdvanceAuthorization(body), true);
  assert.equal(isMyCarMessage({ from: { text: 'ExpressGlass <gestaoclientes@expressglass.pt>' }, text }), true);
});

test('não atravessa uma resposta interna com texto para autorizar por uma citação antiga', () => {
  const text = `De: ExpressGlass.Gestao Clientes <gestaoclientes@expressglass.pt>
Enviado: 9 de julho de 2026

Aguardamos a vossa confirmação.

De: Orçamentação Mycarcenter <orcamentacao@mycarcenter.pt>
Enviado: 8 de julho de 2026

Podem avançar com o pedido.`;

  assert.equal(extractMyCarMessageBody({
    from: { text: 'ExpressGlass <gestaoclientes@expressglass.pt>' },
    text
  }), null);
});

test('deteta ordens explícitas para avançar', () => {
  assert.equal(hasExplicitAdvanceAuthorization('Bom dia, podem avançar com o serviço.'), true);
  assert.equal(hasExplicitAdvanceAuthorization('Bom dia,\nPodem avançar com o pedido.\nServiço a ser realizado no Mycarcenter.\nObrigada.'), true);
  assert.equal(hasExplicitAdvanceAuthorization('O orçamento está aprovado. Podem proceder.'), true);
  assert.equal(hasExplicitAdvanceAuthorization('Serviço autorizado.'), true);
});

test('não confunde espera ou recusa com autorização', () => {
  assert.equal(hasExplicitAdvanceAuthorization('Não podem avançar. Aguardem autorização.'), false);
  assert.equal(hasExplicitAdvanceAuthorization('Pedido pendente de autorização.'), false);
  assert.equal(hasExplicitAdvanceAuthorization('Acusamos a receção do orçamento.'), false);
});

test('classifica uma recusa ou espera explícita como bloqueio', () => {
  assert.equal(classifyExplicitAdvanceInstruction('Não podem avançar. Aguardem autorização.'), 'bloquear');
  assert.equal(classifyExplicitAdvanceInstruction('Pedido pendente de autorização.'), 'bloquear');
  assert.equal(classifyExplicitAdvanceInstruction('Obrigado pela informação.'), null);
});

test('na recuperação prevalece a instrução explícita mais recente', () => {
  const initial = '2026-07-07T15:33:07Z';
  const authorized = latestExplicitAdvanceInstruction([
    { date: initial, body: 'Pedido enviado para autorização.' },
    { date: '2026-07-08T12:07:28Z', body: 'Bom dia, podem avançar com o pedido.' }
  ], initial);

  assert.equal(authorized.action, 'autorizar');
  assert.equal(authorized.date, '2026-07-08T12:07:28Z');

  const blocked = latestExplicitAdvanceInstruction([
    { date: '2026-07-08T12:07:28Z', body: 'Podem avançar com o pedido.' },
    { date: '2026-07-08T13:10:00Z', body: 'Não avancem. Aguardem autorização.' }
  ], initial);
  assert.equal(blocked.action, 'bloquear');
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
