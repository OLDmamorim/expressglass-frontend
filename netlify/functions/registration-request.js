// netlify/functions/registration-request.js

const { Pool }   = require('pg');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { normalizeEmail, isValidEmail } = require('../lib/account-access');

const JWT_SECRET  = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const GMAIL_USER  = process.env.GMAIL_USER;
const GMAIL_PASS  = process.env.GMAIL_APP_PASSWORD;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || GMAIL_USER;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Content-Type': 'application/json',
};

function verifyAdmin(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
  const decoded = jwt.verify(auth.substring(7), JWT_SECRET);
  if (decoded.role !== 'admin') throw new Error('Acesso negado');
  return decoded;
}

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendEmail({ to, subject, html }) {
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.warn('[email] credenciais Gmail não configuradas');
    return;
  }
  await createTransporter().sendMail({
    from: `"ExpressGlass Agendamentos" <${GMAIL_USER}>`,
    to, subject, html,
  });
}

async function emailNovoPedido({ name, email, portal_name, role }) {
  const roleLabel = { coordenador:'Coordenador', user:'Técnico', comercial:'Comercial' }[role] || role;
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePortal = escapeHtml(portal_name || '—');
  const safeRole = escapeHtml(roleLabel);
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Novo pedido de acesso — ${String(name || '').replace(/[\r\n]/g, ' ')}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:#1d4ed8;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h2 style="color:#fff;margin:0;">✍️ Novo pedido de acesso</h2>
        </div>
        <div style="background:#f8fafc;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;">
          <p style="color:#374151;margin:0 0 16px;">Um novo utilizador solicitou acesso ao portal de agendamentos:</p>
          <table style="font-size:14px;width:100%;">
            <tr><td style="color:#6b7280;padding:6px 0;width:110px;">Nome</td><td style="font-weight:700;">${safeName}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0;">Email</td><td>${safeEmail}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0;">Loja/Região</td><td>${safePortal}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0;">Cargo</td><td>${safeRole}</td></tr>
          </table>
          <div style="margin-top:18px;padding:12px;background:#fffbeb;border-radius:8px;font-size:13px;color:#92400e;">
            Acede ao painel admin → tab Utilizadores para criar a conta.
          </div>
        </div>
      </div>`,
  });
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registration_requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      portal_name TEXT,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    // POST — submeter pedido (sem auth)
    if (event.httpMethod === 'POST') {
      await ensureTable();
      const body = JSON.parse(event.body || '{}');
      const { name, email, portal_name, role } = body;
      const normalizedEmail = normalizeEmail(email);
      const normalizedName = String(name || '').trim();
      const normalizedPortalName = String(portal_name || '').trim().slice(0, 160);

      if (!normalizedName || !isValidEmail(normalizedEmail) || !['coordenador', 'user', 'comercial'].includes(role))
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Preencha nome, email e cargo.' }) };

      const dup = await pool.query(
        "SELECT id FROM registration_requests WHERE email=$1 AND status='pending'",
        [normalizedEmail]
      );
      if (dup.rows.length > 0)
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Já existe um pedido pendente para este email.' }) };

      await pool.query(
        'INSERT INTO registration_requests (name,email,portal_name,role) VALUES ($1,$2,$3,$4)',
        [normalizedName.slice(0, 120), normalizedEmail, normalizedPortalName || null, role]
      );

      // Notificar admin (não bloqueia)
      emailNovoPedido({
        name: normalizedName.slice(0, 120),
        email: normalizedEmail,
        portal_name: normalizedPortalName,
        role
      })
        .catch(e => console.warn('[email admin]', e.message));

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Pedido enviado! O administrador irá criar a sua conta em breve.' }) };
    }

    // GET — listar pedidos pendentes (admin auth)
    if (event.httpMethod === 'GET') {
      verifyAdmin(event);
      await ensureTable();
      const { rows } = await pool.query(
        "SELECT * FROM registration_requests WHERE status='pending' ORDER BY created_at DESC"
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, requests: rows }) };
    }

    // PUT — atualizar estado do pedido (a conta é criada no endpoint users)
    if (event.httpMethod === 'PUT') {
      verifyAdmin(event);

      const body = JSON.parse(event.body || '{}');
      const { id, status } = body;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'ID em falta' }) };
      if (!['approved', 'rejected'].includes(status)) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Estado inválido' }) };
      }

      await pool.query('UPDATE registration_requests SET status=$1 WHERE id=$2', [status, id]);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: '{}' };

  } catch (err) {
    console.error('[registration-request]', err.message);
    if (err.message === 'Não autenticado' || err.message === 'Acesso negado') {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: err.message }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
