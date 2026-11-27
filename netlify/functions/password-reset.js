// netlify/functions/password-reset.js
//
// "Esqueci a palavra-passe".
//  POST (sem sessão) { email, hint? }
//    - email de uma conta → recebe logo o link para definir uma nova password
//      (ou o convite, se a conta ainda estiver por ativar);
//    - email que nenhuma conta tem (contas antigas por username) → fica um
//      pedido no painel admin, que o associa ao utilizador certo.
//    A resposta é sempre a mesma, para não revelar que emails existem.
//  GET  (admin) → pedidos pendentes
//  PUT  (admin) { id, action: 'associate', user_id } → grava o email na conta
//       e envia o link; { id, action: 'dismiss' } → arquiva o pedido.

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const {
  normalizeEmail,
  isValidEmail,
  createAccountToken,
  ensureAccountSchema
} = require('../lib/account-access');
const { sendAccountInvite, sendPasswordReset } = require('../lib/account-email');
const { sendTransactionalEmail } = require('../lib/email-service');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.GMAIL_USER;

// Um link novo para a mesma conta só de 2 em 2 minutos; no máximo 5 pedidos
// novos (sem conta) por IP e por hora, para o painel não encher de lixo.
const RESEND_COOLDOWN_MIN = 2;
const MAX_REQUESTS_PER_IP_HOUR = 5;

const GENERIC_MESSAGE =
  'Pedido recebido. Se o email estiver associado a uma conta, vai receber em instantes um link ' +
  'para definir uma nova palavra-passe. Se ainda não estiver, o pedido segue para o administrador, ' +
  'que vai associar o email à sua conta e enviar-lhe o link.';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
};

function response(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function clientIp(event) {
  return event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null;
}

function verifyAdmin(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('Não autenticado'), { status: 401 });
  const decoded = jwt.verify(auth.substring(7), JWT_SECRET);
  if (decoded.role !== 'admin') throw Object.assign(new Error('Acesso negado'), { status: 403 });
  return decoded;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function auditLog({ userId = null, username = null, action, entityId = null, details = null, event }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, ip, user_agent)
       VALUES ($1, $2, $3, 'user', $4, $5, $6, $7)`,
      [userId, username, action, entityId ? String(entityId) : null,
       details ? JSON.stringify(details) : null, clientIp(event), event?.headers?.['user-agent'] || null]
    );
  } catch (error) {
    console.warn('[password-reset-audit]', error.message);
  }
}

// Envia o link certo para a conta: convite se ainda está por ativar,
// recuperação se já está ativa.
async function sendLinkToUser(client, user, email, createdBy) {
  const kind = user.account_status === 'invited' ? 'invite' : 'reset';
  const { token } = await createAccountToken(client, { userId: user.id, email, kind, createdBy });
  const send = kind === 'invite' ? sendAccountInvite : sendPasswordReset;
  const result = await send({ email, username: user.username, token });
  return { kind, sent: Boolean(result?.sent), error: result?.error || null };
}

async function notifyAdmin({ email, hint }) {
  if (!ADMIN_EMAIL) return;
  const result = await sendTransactionalEmail({
    to: ADMIN_EMAIL,
    subject: `Recuperação de password — ${email}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:#092d57;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h2 style="color:#fff;margin:0;">🔑 Pedido de recuperação de password</h2>
        </div>
        <div style="background:#f8fafc;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;">
          <p style="color:#374151;margin:0 0 16px;">Alguém pediu uma nova password com um email que ainda não está associado a nenhuma conta:</p>
          <table style="font-size:14px;width:100%;">
            <tr><td style="color:#6b7280;padding:6px 0;width:110px;">Email</td><td style="font-weight:700;">${escapeHtml(email)}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0;">Indicou</td><td>${escapeHtml(hint || '—')}</td></tr>
          </table>
          <div style="margin-top:18px;padding:12px;background:#fffbeb;border-radius:8px;font-size:13px;color:#92400e;">
            Painel admin → Utilizadores → Pedidos de recuperação: associe o email ao utilizador certo.
          </div>
        </div>
      </div>`
  });
  if (!result?.sent) console.warn('[password-reset] email ao admin falhou:', result?.error);
}

async function handleRequest(event) {
  const body = JSON.parse(event.body || '{}');
  const email = normalizeEmail(body.email);
  const hint = String(body.hint || '').trim().slice(0, 160) || null;
  if (!isValidEmail(email)) {
    return response(400, { success: false, error: 'Indique um email válido.' });
  }

  const { rows } = await pool.query(
    `SELECT id, username, email, account_status FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  const user = rows[0];

  if (user) {
    if (!['active', 'invited'].includes(user.account_status)) {
      await auditLog({ userId: user.id, username: user.username, action: 'password_reset_refused', entityId: user.id, details: { status: user.account_status }, event });
      return response(200, { success: true, message: GENERIC_MESSAGE });
    }
    const recent = await pool.query(
      `SELECT 1 FROM account_invites
        WHERE user_id = $1 AND created_at > NOW() - ($2 || ' minutes')::interval
        LIMIT 1`,
      [user.id, String(RESEND_COOLDOWN_MIN)]
    );
    if (recent.rows.length === 0) {
      const result = await sendLinkToUser(pool, user, email, null);
      await auditLog({
        userId: user.id, username: user.username, action: 'password_reset_requested', entityId: user.id,
        details: { kind: result.kind, emailSent: result.sent }, event
      });
      if (!result.sent) console.warn('[password-reset] email falhou:', result.error);
    }
    return response(200, { success: true, message: GENERIC_MESSAGE });
  }

  // Sem conta com este email: pedido para o administrador
  const pending = await pool.query(
    `SELECT id FROM password_reset_requests WHERE LOWER(email) = LOWER($1) AND status = 'pending' LIMIT 1`,
    [email]
  );
  if (pending.rows.length) {
    if (hint) await pool.query('UPDATE password_reset_requests SET hint = $1 WHERE id = $2', [hint, pending.rows[0].id]);
    return response(200, { success: true, message: GENERIC_MESSAGE });
  }
  const ip = clientIp(event);
  if (ip) {
    const { rows: [count] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM password_reset_requests WHERE ip = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [ip]
    );
    if (count.n >= MAX_REQUESTS_PER_IP_HOUR) {
      await auditLog({ action: 'password_reset_throttled', details: { email }, event });
      return response(200, { success: true, message: GENERIC_MESSAGE });
    }
  }
  const { rows: [request] } = await pool.query(
    'INSERT INTO password_reset_requests (email, hint, ip) VALUES ($1, $2, $3) RETURNING id',
    [email, hint, ip]
  );
  await auditLog({ action: 'password_reset_request_created', entityId: request.id, details: { email, hint }, event });
  try { await notifyAdmin({ email, hint }); } catch (e) { console.warn('[password-reset] aviso ao admin:', e.message); }
  return response(200, { success: true, message: GENERIC_MESSAGE });
}

async function handleAssociate(event, admin, body) {
  const requestId = Number(body.id);
  const userId = Number(body.user_id);
  if (!Number.isInteger(requestId) || !Number.isInteger(userId)) {
    return response(400, { success: false, error: 'Pedido ou utilizador em falta' });
  }

  const client = await pool.connect();
  let user, email;
  try {
    await client.query('BEGIN');
    const { rows: [request] } = await client.query(
      'SELECT id, email, status FROM password_reset_requests WHERE id = $1 FOR UPDATE',
      [requestId]
    );
    if (!request) { await client.query('ROLLBACK'); return response(404, { success: false, error: 'Pedido não encontrado' }); }
    if (request.status !== 'pending') { await client.query('ROLLBACK'); return response(409, { success: false, error: 'Este pedido já foi tratado' }); }
    email = normalizeEmail(request.email);

    const { rows: [target] } = await client.query(
      'SELECT id, username, email, account_status FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!target) { await client.query('ROLLBACK'); return response(404, { success: false, error: 'Utilizador não encontrado' }); }
    if (!['active', 'invited'].includes(target.account_status)) {
      await client.query('ROLLBACK');
      return response(409, { success: false, error: 'Esta conta não está ativa' });
    }
    const taken = await client.query(
      'SELECT id, username FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
      [email, userId]
    );
    if (taken.rows.length) {
      await client.query('ROLLBACK');
      return response(409, { success: false, error: `Este email já pertence ao utilizador ${taken.rows[0].username}` });
    }

    await client.query('UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2', [email, userId]);
    // Outros pedidos pendentes com o mesmo email ficam também tratados
    await client.query(
      `UPDATE password_reset_requests
          SET status = 'resolved', user_id = $1, resolved_by = $2, resolved_at = NOW()
        WHERE (id = $3 OR (LOWER(email) = LOWER($4) AND status = 'pending'))`,
      [userId, admin.userId || null, requestId, email]
    );
    user = { ...target, email, previousEmail: target.email || null };
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const result = await sendLinkToUser(pool, user, email, admin.userId || null);
  await auditLog({
    userId: admin.userId, username: admin.username, action: 'password_reset_email_associated', entityId: user.id,
    details: { email, previousEmail: user.previousEmail, targetUsername: user.username, kind: result.kind, emailSent: result.sent },
    event
  });
  return response(200, {
    success: true,
    emailSent: result.sent,
    warning: result.sent ? null : (result.error || 'O email não foi enviado'),
    username: user.username
  });
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    await ensureAccountSchema(pool);

    if (event.httpMethod === 'POST') return await handleRequest(event);

    const admin = verifyAdmin(event);

    if (event.httpMethod === 'GET') {
      const { rows } = await pool.query(
        `SELECT id, email, hint, created_at FROM password_reset_requests
          WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100`
      );
      return response(200, { success: true, requests: rows });
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      if (body.action === 'associate') return await handleAssociate(event, admin, body);
      if (body.action === 'dismiss') {
        const { rowCount } = await pool.query(
          `UPDATE password_reset_requests
              SET status = 'dismissed', resolved_by = $1, resolved_at = NOW()
            WHERE id = $2 AND status = 'pending'`,
          [admin.userId || null, Number(body.id)]
        );
        return response(rowCount ? 200 : 404, rowCount ? { success: true } : { success: false, error: 'Pedido não encontrado' });
      }
      return response(400, { success: false, error: 'Ação inválida' });
    }

    return response(405, { success: false, error: 'Método não permitido' });
  } catch (error) {
    if (error.status) return response(error.status, { success: false, error: error.message });
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return response(401, { success: false, error: 'Sessão inválida' });
    }
    console.error('[password-reset]', error);
    return response(500, { success: false, error: 'Erro interno do servidor' });
  }
};

exports.__test = { GENERIC_MESSAGE };
