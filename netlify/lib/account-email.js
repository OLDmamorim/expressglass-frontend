const { INVITE_HOURS, RESET_HOURS } = require('./account-access');
const { sendTransactionalEmail } = require('./email-service');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inviteUrl(token) {
  const base = process.env.PUBLIC_SITE_URL || process.env.URL || 'https://agendamentosm.netlify.app';
  const url = new URL('/definir-password.html', base);
  url.searchParams.set('token', token);
  return url.toString();
}

async function sendAccountInvite({ email, name, username, token }, options) {
  const link = inviteUrl(token);
  const safeName = escapeHtml(name || username || email);
  const safeEmail = escapeHtml(email);
  const safeUsername = escapeHtml(username);

  return sendTransactionalEmail({
    to: email,
    subject: 'Ativa a tua conta ExpressGlass',
    text: [
      `Olá ${name || username || email},`,
      '',
      `Foi criada uma conta para ${email}.`,
      `Define a tua password através deste link: ${link}`,
      '',
      `O convite é válido durante ${INVITE_HOURS} horas.`,
      `Depois da ativação podes entrar com o teu email ou com o username ${username}.`
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#14243a;">
        <div style="background:#092d57;padding:24px;border-radius:14px 14px 0 0;">
          <h1 style="margin:0;color:#fff;font-size:22px;">Bem-vindo à ExpressGlass</h1>
        </div>
        <div style="padding:26px;border:1px solid #dbe6f1;border-top:0;border-radius:0 0 14px 14px;background:#f8fbff;">
          <p>Olá <strong>${safeName}</strong>,</p>
          <p>Foi criada uma conta para <strong>${safeEmail}</strong>. Define a tua password para começares a utilizar a plataforma.</p>
          <a href="${escapeHtml(link)}"
             style="display:block;margin:24px 0;padding:14px 18px;border-radius:9px;background:#e21f2f;color:#fff;text-align:center;text-decoration:none;font-weight:800;">
            Definir password
          </a>
          <p style="font-size:13px;color:#607087;">O convite é válido durante ${INVITE_HOURS} horas.</p>
          <p style="font-size:12px;color:#8290a3;">Depois da ativação podes entrar com o teu email. Em alternativa, o teu username é <strong>${safeUsername}</strong>.</p>
        </div>
      </div>
    `
  }, options);
}

// "Esqueci a palavra-passe": link para definir uma password nova
async function sendPasswordReset({ email, name, username, token }, options) {
  const link = inviteUrl(token);
  const safeName = escapeHtml(name || username || email);
  const safeUsername = escapeHtml(username);

  return sendTransactionalEmail({
    to: email,
    subject: 'Nova palavra-passe — Agenda ExpressGlass',
    text: [
      `Olá ${name || username || email},`,
      '',
      'Recebemos um pedido para definir uma nova palavra-passe para a sua conta.',
      `Defina-a através deste link: ${link}`,
      '',
      `O link é válido durante ${RESET_HOURS} horas e só pode ser usado uma vez.`,
      `Depois pode entrar com o email ${email}${username ? ` (ou com o username ${username})` : ''}.`,
      'Se não fez este pedido, ignore este email: a palavra-passe atual mantém-se.'
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#14243a;">
        <div style="background:#092d57;padding:24px;border-radius:14px 14px 0 0;">
          <h1 style="margin:0;color:#fff;font-size:22px;">Nova palavra-passe</h1>
        </div>
        <div style="padding:26px;border:1px solid #dbe6f1;border-top:0;border-radius:0 0 14px 14px;background:#f8fbff;">
          <p>Olá <strong>${safeName}</strong>,</p>
          <p>Recebemos um pedido para definir uma nova palavra-passe para a sua conta da Agenda ExpressGlass.</p>
          <a href="${escapeHtml(link)}"
             style="display:block;margin:24px 0;padding:14px 18px;border-radius:9px;background:#e21f2f;color:#fff;text-align:center;text-decoration:none;font-weight:800;">
            Definir nova palavra-passe
          </a>
          <p style="font-size:13px;color:#607087;">O link é válido durante ${RESET_HOURS} horas e só pode ser usado uma vez.</p>
          <p style="font-size:12px;color:#8290a3;">Depois pode entrar com o email <strong>${escapeHtml(email)}</strong>${username ? `, ou com o username <strong>${safeUsername}</strong>` : ''}.</p>
          <p style="font-size:12px;color:#8290a3;">Se não fez este pedido, ignore este email: a palavra-passe atual mantém-se.</p>
        </div>
      </div>
    `
  }, options);
}

module.exports = { sendAccountInvite, sendPasswordReset, inviteUrl };
