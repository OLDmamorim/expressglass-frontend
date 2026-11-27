'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inviteProblem } = require('../netlify/functions/account-invite').__test;

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 1000).toISOString();

test('um convite só ativa contas pendentes', () => {
  assert.equal(inviteProblem({ kind: 'invite', account_status: 'invited', expires_at: future }), null);
  assert.equal(inviteProblem({ kind: 'invite', account_status: 'active', expires_at: future }).status, 409);
});

test('o link de "Esqueci a palavra-passe" muda a password de uma conta ativa', () => {
  assert.equal(inviteProblem({ kind: 'reset', account_status: 'active', expires_at: future }), null);
  assert.equal(inviteProblem({ kind: 'reset', account_status: 'invited', expires_at: future }), null);
  assert.equal(inviteProblem({ kind: 'reset', account_status: 'disabled', expires_at: future }).status, 409);
});

test('o link de recuperação expira, só se usa uma vez e explica como pedir outro', () => {
  const expired = inviteProblem({ kind: 'reset', account_status: 'active', expires_at: past });
  assert.equal(expired.status, 410);
  assert.match(expired.error, /Esqueci a palavra-passe/);
  assert.equal(inviteProblem({ kind: 'reset', account_status: 'active', expires_at: future, accepted_at: past }).status, 409);
  assert.equal(inviteProblem({ kind: 'reset', account_status: 'active', expires_at: future, revoked_at: past }).status, 404);
  assert.equal(inviteProblem(null).status, 404);
});

test('os convites antigos, sem tipo, continuam a ser convites', () => {
  assert.equal(inviteProblem({ account_status: 'invited', expires_at: future }), null);
  assert.equal(inviteProblem({ account_status: 'active', expires_at: future }).status, 409);
});
