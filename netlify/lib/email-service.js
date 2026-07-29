const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_EMAIL_FROM = 'PoweringEG Platform <noreply@poweringeg.pt>';
const REQUEST_TIMEOUT_MS = 15000;

function providerError(payload, response) {
  return payload?.message
    || payload?.error?.message
    || response?.statusText
    || `HTTP ${response?.status || 'desconhecido'}`;
}

async function responsePayload(response) {
  try {
    const raw = await response.text();
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
}

async function sendWithLegacyGmail(
  { to, subject, html, text },
  { env, createTransport }
) {
  const gmailUser = env.GMAIL_USER;
  const gmailPassword = env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPassword) {
    console.warn('[email] RESEND_API_KEY e credenciais Gmail não configuradas');
    return { sent: false, error: 'Serviço de email não configurado' };
  }

  const transporter = createTransport
    ? createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPassword }
    })
    : require('nodemailer').createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPassword }
    });

  try {
    const info = await transporter.sendMail({
      from: `"ExpressGlass Agendamentos" <${gmailUser}>`,
      to,
      subject,
      html,
      text
    });
    return { sent: true, id: info?.messageId || null, provider: 'gmail' };
  } catch (error) {
    console.warn(`[email-gmail] falha no envio: ${error.message}`);
    return { sent: false, error: 'Não foi possível enviar o email' };
  }
}

async function sendTransactionalEmail(
  { to, subject, html, text, replyTo },
  { fetchImpl = global.fetch, env = process.env, createTransport } = {}
) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM || DEFAULT_EMAIL_FROM;

  if (!apiKey) {
    return sendWithLegacyGmail(
      { to, subject, html, text },
      { env, createTransport }
    );
  }
  if (typeof fetchImpl !== 'function') {
    console.warn('[email-resend] fetch indisponível');
    return { sent: false, error: 'Serviço de email indisponível' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body = { from, to, subject, html };
    if (text) body.text = text;
    if (replyTo) body.reply_to = replyTo;

    const response = await fetchImpl(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await responsePayload(response);

    if (!response.ok || payload.error) {
      console.warn(`[email-resend] envio recusado (${response.status}): ${providerError(payload, response)}`);
      return { sent: false, error: 'Não foi possível enviar o email' };
    }

    return { sent: true, id: payload.id || null, provider: 'resend' };
  } catch (error) {
    const detail = error?.name === 'AbortError' ? 'tempo limite excedido' : error.message;
    console.warn(`[email-resend] falha no envio: ${detail}`);
    return { sent: false, error: 'Não foi possível enviar o email' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  DEFAULT_EMAIL_FROM,
  RESEND_API_URL,
  sendTransactionalEmail
};
