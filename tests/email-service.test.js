const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_EMAIL_FROM,
  RESEND_API_URL,
  sendTransactionalEmail
} = require('../netlify/lib/email-service');
const { sendAccountInvite } = require('../netlify/lib/account-email');

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test('usa o remetente autenticado da PoweringEG através do Resend', async () => {
  let request;
  const result = await sendTransactionalEmail({
    to: 'utilizador@empresa.pt',
    subject: 'Convite',
    html: '<p>Olá</p>',
    text: 'Olá'
  }, {
    env: { RESEND_API_KEY: 're_test_key' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return okResponse({ id: 'email_123' });
    }
  });

  const body = JSON.parse(request.options.body);
  assert.equal(result.sent, true);
  assert.equal(result.id, 'email_123');
  assert.equal(request.url, RESEND_API_URL);
  assert.equal(request.options.headers.Authorization, 'Bearer re_test_key');
  assert.equal(body.from, DEFAULT_EMAIL_FROM);
  assert.equal(body.to, 'utilizador@empresa.pt');
  assert.equal(body.text, 'Olá');
});

test('EMAIL_FROM permite reutilizar outra identidade verificada', async () => {
  let body;
  await sendTransactionalEmail({
    to: 'utilizador@empresa.pt',
    subject: 'Teste',
    html: '<p>Teste</p>'
  }, {
    env: {
      RESEND_API_KEY: 're_test_key',
      EMAIL_FROM: 'ExpressGlass <portal@poweringeg.pt>'
    },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return okResponse({ id: 'email_456' });
    }
  });

  assert.equal(body.from, 'ExpressGlass <portal@poweringeg.pt>');
});

test('não tenta enviar sem a chave do Resend', async () => {
  let called = false;
  const result = await sendTransactionalEmail({
    to: 'utilizador@empresa.pt',
    subject: 'Teste',
    html: '<p>Teste</p>'
  }, {
    env: {},
    fetchImpl: async () => {
      called = true;
      return okResponse({});
    }
  });

  assert.equal(result.sent, false);
  assert.match(result.error, /não configurado/);
  assert.equal(called, false);
});

test('mantém o Gmail atual como fallback enquanto o Resend não estiver configurado', async () => {
  let transportOptions;
  let mailOptions;
  const result = await sendTransactionalEmail({
    to: 'utilizador@gmail.com',
    subject: 'Teste',
    html: '<p>Teste</p>',
    text: 'Teste'
  }, {
    env: {
      GMAIL_USER: 'conta@gmail.com',
      GMAIL_APP_PASSWORD: 'password-de-teste'
    },
    createTransport(options) {
      transportOptions = options;
      return {
        async sendMail(message) {
          mailOptions = message;
          return { messageId: 'gmail_123' };
        }
      };
    }
  });

  assert.equal(result.sent, true);
  assert.equal(result.provider, 'gmail');
  assert.equal(transportOptions.auth.user, 'conta@gmail.com');
  assert.equal(mailOptions.from, '"ExpressGlass Agendamentos" <conta@gmail.com>');
});

test('o convite inclui o portal, versão em texto e username', async () => {
  let body;
  const result = await sendAccountInvite({
    email: 'marco@empresa.pt',
    name: 'Marco',
    username: 'marco.amorim',
    token: 'token-seguro'
  }, {
    env: {
      RESEND_API_KEY: 're_test_key',
      PUBLIC_SITE_URL: 'https://agendamentosm.netlify.app'
    },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return okResponse({ id: 'email_invite' });
    }
  });

  assert.equal(result.sent, true);
  assert.match(body.html, /definir-password\.html\?token=token-seguro/);
  assert.match(body.text, /https:\/\/agendamentosm\.netlify\.app\/definir-password\.html\?token=token-seguro/);
  assert.match(body.text, /marco\.amorim/);
});
