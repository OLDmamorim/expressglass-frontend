// netlify/functions/registration-request.js
// Variáveis de ambiente a adicionar no Netlify:
//   GMAIL_USER=egpowering@gmail.com
//   GMAIL_APP_PASSWORD=emdn zhxr opjw vdjn
//   ADMIN_EMAIL=egpowering@gmail.com

const { Pool }   = require('pg');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');

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

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
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
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `✍️ Novo pedido de acesso — ${name}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:#1d4ed8;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h2 style="color:#fff;margin:0;">✍️ Novo pedido de acesso</h2>
        </div>
        <div style="background:#f8fafc;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;">
          <p style="color:#374151;margin:0 0 16px;">Um novo utilizador solicitou acesso ao portal de agendamentos:</p>
          <table style="font-size:14px;width:100%;">
            <tr><td style="color:#6b7280;padding:6px 0;width:110px;">Nome</td><td style="font-weight:700;">${name}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0;">Email</td><td>${email}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0;">Loja/Região</td><td>${portal_name || '—'}</td></tr>
            <tr><td style="color:#6b7280;padding:6px 0;">Cargo</td><td>${roleLabel}</td></tr>
          </table>
          <div style="margin-top:18px;padding:12px;background:#fffbeb;border-radius:8px;font-size:13px;color:#92400e;">
            Acede ao painel admin → tab Utilizadores para criar a conta.
          </div>
        </div>
      </div>`,
  });
}

async function emailBoasVindas({ to, name, username, password }) {
  await sendEmail({
    to,
    subject: '🎉 Conta criada — ExpressGlass Agendamentos',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:#059669;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h2 style="color:#fff;margin:0;">🎉 A tua conta foi criada!</h2>
        </div>
        <div style="background:#f8fafc;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;">
          <p style="color:#374151;margin:0 0 16px;">Olá <strong>${name}</strong>, os teus dados de acesso são:</p>
          <div style="background:#fff;border:2px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
            <div style="margin-bottom:12px;">
              <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Username</div>
              <div style="font-size:22px;font-weight:800;color:#1e293b;letter-spacing:1px;">${username}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Password</div>
              <div style="font-size:22px;font-weight:800;color:#1d4ed8;letter-spacing:2px;">${password}</div>
            </div>
          </div>
          <a href="https://agendamentosm.netlify.app/login.html"
             style="display:block;text-align:center;background:#1d4ed8;color:#fff;padding:13px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">
            Aceder ao portal →
          </a>
          <p style="margin-top:14px;font-size:12px;color:#9ca3af;text-align:center;">Altera a password após o primeiro login.</p>
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

  const p = event.queryStringParameters || {};

  try {
    // POST — submeter pedido (sem auth)
    if (event.httpMethod === 'POST') {
      await ensureTable();
      const body = JSON.parse(event.body || '{}');
      const { name, email, portal_name, role } = body;

      if (!name || !email || !role)
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Preencha nome, email e cargo.' }) };

      const dup = await pool.query(
        "SELECT id FROM registration_requests WHERE email=$1 AND status='pending'",
        [email.toLowerCase().trim()]
      );
      if (dup.rows.length > 0)
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Já existe um pedido pendente para este email.' }) };

      await pool.query(
        'INSERT INTO registration_requests (name,email,portal_name,role) VALUES ($1,$2,$3,$4)',
        [name.trim(), email.toLowerCase().trim(), portal_name || null, role]
      );

      // Notificar admin (não bloqueia)
      emailNovoPedido({ name: name.trim(), email: email.toLowerCase().trim(), portal_name, role })
        .catch(e => console.warn('[email admin]', e.message));

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Pedido enviado! O administrador irá criar a sua conta em breve.' }) };
    }

    // GET — listar pedidos pendentes (admin auth)
    if (event.httpMethod === 'GET') {
      const auth = event.headers.authorization || event.headers.Authorization || '';
      if (!auth.startsWith('Bearer ')) return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
      jwt.verify(auth.substring(7), JWT_SECRET);
      await ensureTable();
      const { rows } = await pool.query(
        "SELECT * FROM registration_requests WHERE status='pending' ORDER BY created_at DESC"
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, requests: rows }) };
    }

    // PUT — aprovar/rejeitar + email de boas-vindas
    if (event.httpMethod === 'PUT') {
      const auth = event.headers.authorization || event.headers.Authorization || '';
      if (!auth.startsWith('Bearer ')) return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
      jwt.verify(auth.substring(7), JWT_SECRET);

      const body = JSON.parse(event.body || '{}');
      const { id, status, welcome_email } = body;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'ID em falta' }) };

      await pool.query('UPDATE registration_requests SET status=$1 WHERE id=$2', [status || 'approved', id]);

      if (welcome_email?.to && welcome_email?.username && welcome_email?.password) {
        emailBoasVindas(welcome_email).catch(e => console.warn('[email boas-vindas]', e.message));
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: '{}' };

  } catch (err) {
    console.error('[registration-request]', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
