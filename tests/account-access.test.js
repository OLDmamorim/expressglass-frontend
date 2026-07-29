const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const Access = require('../netlify/lib/account-access');
const accountInvite = require('../netlify/functions/account-invite');
const usersFunction = require('../netlify/functions/users');

const root = path.resolve(__dirname, '..');

test('normaliza emails e gera usernames previsíveis sem alterar contas existentes', () => {
  assert.equal(Access.normalizeEmail('  Marco.Amorim@ExpressGlass.PT '), 'marco.amorim@expressglass.pt');
  assert.equal(Access.isValidEmail('marco.amorim@expressglass.pt'), true);
  assert.equal(Access.isValidEmail('marco@expressglass'), false);
  assert.equal(Access.usernameBase('João da Silva'), 'joao.da.silva');
  assert.equal(Access.usernameBase('', 'maria.costa@expressglass.pt'), 'maria.costa');
});

test('gera um username alternativo quando o preferido já existe', async () => {
  const client = {
    async query(_sql, values) {
      return { rows: ['joao.silva', 'joao.silva2'].includes(values[0]) ? [{ id: 1 }] : [] };
    }
  };
  assert.equal(await Access.uniqueUsername(client, 'João Silva', ''), 'joao.silva3');
});

test('convites usam tokens aleatórios, guardam apenas hash e expiram', () => {
  const first = Access.createInviteToken();
  const second = Access.createInviteToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 32);
  assert.notEqual(Access.hashInviteToken(first), first);
  assert.equal(Access.hashInviteToken(first), Access.hashInviteToken(first));
  assert.equal(Access.inviteExpiresAt(new Date('2026-07-29T10:00:00Z')).toISOString(), '2026-07-31T10:00:00.000Z');
});

test('password de convite exige pelo menos oito caracteres com letras e números', () => {
  assert.match(Access.passwordError('abcdefg'), /8 caracteres/);
  assert.match(Access.passwordError('abcdefgh'), /letras e números/);
  assert.equal(Access.passwordError('express8'), null);
});

test('um convite utilizado, revogado ou expirado não pode ativar a conta', () => {
  const valid = {
    expires_at: new Date(Date.now() + 60000).toISOString(),
    accepted_at: null,
    revoked_at: null,
    account_status: 'invited'
  };
  assert.equal(accountInvite.__test.inviteProblem(valid), null);
  assert.equal(accountInvite.__test.inviteProblem({ ...valid, accepted_at: new Date() }).status, 409);
  assert.equal(accountInvite.__test.inviteProblem({ ...valid, revoked_at: new Date() }).status, 404);
  assert.equal(accountInvite.__test.inviteProblem({ ...valid, account_status: 'active' }).status, 409);
  assert.equal(accountInvite.__test.inviteProblem({ ...valid, expires_at: new Date(Date.now() - 1) }).status, 410);
});

test('as regras antigas de portal e cargo continuam ativas', () => {
  assert.match(usersFunction.__test.accessError({ role: 'user' }), /portal/);
  assert.equal(usersFunction.__test.accessError({ role: 'user', portal_id: 3 }), null);
  assert.equal(usersFunction.__test.accessError({ role: 'admin' }), null);
  assert.match(usersFunction.__test.accessError({ role: 'comercial', assigned_portal_ids: [] }), /SM/);
});

test('o login aceita email ou username e preserva o acesso legado', () => {
  const source = fs.readFileSync(path.join(root, 'netlify/functions/auth-login.js'), 'utf8');
  assert.match(source, /LOWER\(u\.username\) = LOWER\(\$1\)/);
  assert.match(source, /LOWER\(u\.email\) = LOWER\(\$1\)/);
  assert.match(source, /user\.account_status !== 'active'/);
  assert.match(source, /bcrypt\.compare\(password, user\.password_hash\)/);
});

test('a administração oferece os dois métodos e a ativação é feita pelo próprio', () => {
  const admin = cheerio.load(fs.readFileSync(path.join(root, 'admin.html'), 'utf8'));
  const login = cheerio.load(fs.readFileSync(path.join(root, 'login.html'), 'utf8'));
  const activation = cheerio.load(fs.readFileSync(path.join(root, 'definir-password.html'), 'utf8'));
  const inviteSource = fs.readFileSync(path.join(root, 'netlify/functions/account-invite.js'), 'utf8');
  const usersSource = fs.readFileSync(path.join(root, 'netlify/functions/users.js'), 'utf8');

  assert.equal(admin('input[name="userAccessMethod"][value="email"]').length, 1);
  assert.equal(admin('input[name="userAccessMethod"][value="manual"]').length, 1);
  assert.equal(admin('#userEmail').attr('type'), 'email');
  assert.match(login('label[for="username"]').text(), /Email ou username/);
  assert.equal(activation('#newPassword').attr('autocomplete'), 'new-password');
  assert.equal(activation('#confirmPassword').length, 1);
  assert.match(inviteSource, /plain_password = NULL/);
  assert.match(inviteSource, /bcrypt\.hash\(body\.password, 12\)/);
  assert.match(usersSource, /invite_by_email === true/);
  assert.match(usersSource, /Username e password são obrigatórios/);
});
