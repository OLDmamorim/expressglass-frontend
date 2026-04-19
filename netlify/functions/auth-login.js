// netlify/functions/auth-login.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

// ── Rate Limiting ────────────────────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const BLOCK_MINUTES = 15;

async function checkRateLimit(identifier, event) {
  const ip = event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const key = identifier + ':' + ip;
  
  const { rows } = await pool.query(`
    SELECT attempts, blocked_until
    FROM login_attempts
    WHERE identifier = $1
  `, [key]);

  if (rows.length > 0) {
    const row = rows[0];
    // Verificar se está bloqueado
    if (row.blocked_until && new Date(row.blocked_until) > new Date()) {
      const remaining = Math.ceil((new Date(row.blocked_until) - new Date()) / 60000);
      throw new Error(`Demasiadas tentativas. Tente novamente em ${remaining} minuto(s).`);
    }
  }
}

async function recordFailedAttempt(identifier, event) {
  const ip = event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const key = identifier + ':' + ip;

  await pool.query(`
    INSERT INTO login_attempts (identifier, attempts, last_attempt)
    VALUES ($1, 1, NOW())
    ON CONFLICT (identifier) DO UPDATE
      SET attempts = login_attempts.attempts + 1,
          last_attempt = NOW(),
          blocked_until = CASE
            WHEN login_attempts.attempts + 1 >= $2
            THEN NOW() + INTERVAL '${BLOCK_MINUTES} minutes'
            ELSE NULL
          END
  `, [key, MAX_ATTEMPTS]);
}

async function clearAttempts(identifier, event) {
  const ip = event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const key = identifier + ':' + ip;
  await pool.query('DELETE FROM login_attempts WHERE identifier = $1', [key]);
}

async function auditLog({ user_id, username, action, details, event }) {
  try {
    const ip = event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null;
    const ua = event?.headers?.['user-agent'] || null;
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, details, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id || null, username || null, action,
       details ? JSON.stringify(details) : null, ip, ua]
    );
  } catch (e) {
    console.warn('[audit]', e.message);
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  }

  try {
    const { username, password } = JSON.parse(event.body || '{}');

    if (!username || !password) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Username e password são obrigatórios' }) };
    }

    // Verificar rate limit antes de consultar a DB
    try {
      await checkRateLimit(username, event);
    } catch (rateLimitError) {
      await auditLog({ username, action: 'login_blocked', details: { reason: rateLimitError.message }, event });
      return { statusCode: 429, headers, body: JSON.stringify({ success: false, error: rateLimitError.message }) };
    }

    const query = `
      SELECT u.id, u.username, u.password_hash, u.portal_id, u.role,
             p.name as portal_name, p.departure_address, p.localities, p.portal_type
      FROM users u
      LEFT JOIN portals p ON u.portal_id = p.id
      WHERE u.username = $1
    `;
    const { rows } = await pool.query(query, [username]);

    if (rows.length === 0) {
      // Log tentativa falhada (utilizador inexistente)
      await recordFailedAttempt(username, event);
      await auditLog({ action: 'login_failed', username, details: { reason: 'user_not_found' }, event });
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Credenciais inválidas' }) };
    }

    const user = rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      // Log tentativa falhada (password errada)
      await recordFailedAttempt(username, event);
      await auditLog({ user_id: user.id, username: user.username, action: 'login_failed', details: { reason: 'wrong_password' }, event });
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Credenciais inválidas' }) };
    }

    const tokenPayload = {
      userId: user.id,
      username: user.username,
      portalId: user.portal_id,
      portalName: user.portal_name,
      role: user.role
    };

    // Coordenador E Comercial: buscar portais atribuídos
    let multiPortals = [];
    if (user.role === 'coordenador' || user.role === 'comercial') {
      const cp = await pool.query(`
        SELECT p.id, p.name, p.departure_address, p.localities, p.portal_type
        FROM coordinator_portals cp
        JOIN portals p ON cp.portal_id = p.id
        WHERE cp.user_id = $1
        ORDER BY p.name
      `, [user.id]);

      multiPortals = cp.rows.map(p => ({
        id: p.id,
        name: p.name,
        departureAddress: p.departure_address,
        localities: p.localities,
        portalType: p.portal_type || 'sm'
      }));

      tokenPayload.portalIds = multiPortals.map(p => p.id);
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    const userData = {
      id: user.id,
      username: user.username,
      role: user.role,
      portal: user.portal_id ? {
        id: user.portal_id,
        name: user.portal_name,
        departureAddress: user.departure_address,
        localities: user.localities,
        portalType: user.portal_type || 'sm'
      } : (multiPortals.length > 0 ? multiPortals[0] : null)
    };

    if ((user.role === 'coordenador' || user.role === 'comercial') && multiPortals.length > 0) {
      userData.portals = multiPortals;
    }

    // Limpar tentativas após login bem-sucedido
    await clearAttempts(username, event);

    // Log login bem-sucedido
    await auditLog({
      user_id: user.id,
      username: user.username,
      action: 'login',
      details: { role: user.role, portal: user.portal_name || null },
      event
    });

    console.log(`✅ Login bem-sucedido: ${username} (${user.role})`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, token, user: userData })
    };

  } catch (error) {
    console.error('❌ Erro no login:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Erro interno do servidor' }) };
  }
};
