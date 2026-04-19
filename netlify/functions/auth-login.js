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
      await auditLog({ action: 'login_failed', username, details: { reason: 'user_not_found' }, event });
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Credenciais inválidas' }) };
    }

    const user = rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      // Log tentativa falhada (password errada)
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
