// netlify/functions/users.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function verifyAdmin(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  const token = authHeader.substring(7);
  const decoded = jwt.verify(token, JWT_SECRET);
  if (decoded.role !== 'admin') throw new Error('Acesso negado: apenas administradores');
  return decoded;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // GET: admin vê tudo; coordenador só vê comerciais (para o dropdown)
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Não autenticado');
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    const isAdmin = decoded.role === 'admin';
    const isCoordenador = decoded.role === 'coordenador';
    if (!isAdmin && !isCoordenador) throw new Error('Acesso negado');

    // ---------- GET ----------
    if (event.httpMethod === 'GET') {
      // Coordenador: só lista comerciais para o dropdown
      if (isCoordenador) {
        const { rows } = await pool.query(
          `SELECT u.id, u.username, u.role, u.telegram_chat_id
           FROM users u
           WHERE u.role = 'comercial'
           ORDER BY u.username ASC`
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows.map(u => ({
          id: u.id, username: u.username, role: u.role,
          telegramChatId: u.telegram_chat_id || null
        })) }) };
      }

      // Admin: query completa
      const query = `
        SELECT u.id, u.username, u.plain_password, u.portal_id, u.role, u.created_at, u.updated_at,
               u.telegram_chat_id, u.telegram_chat_id_2, p.name as portal_name
        FROM users u
        LEFT JOIN portals p ON u.portal_id = p.id
        ORDER BY u.username ASC
      `;
      const { rows } = await pool.query(query);

      const users = [];
      for (const user of rows) {
        const u = {
          id: user.id,
          username: user.username,
          plain_password: user.plain_password || null,
          portalId: user.portal_id,
          portalName: user.portal_name,
          role: user.role,
          telegramChatId: user.telegram_chat_id || null,
          telegramChatId2: user.telegram_chat_id_2 || null,
          createdAt: user.created_at,
          updatedAt: user.updated_at
        };

        // Coordenador e Comercial: carregar lista de portais
        if (user.role === 'coordenador' || user.role === 'comercial') {
          const cp = await pool.query(
            'SELECT portal_id FROM coordinator_portals WHERE user_id = $1',
            [user.id]
          );
          u.portalIds = cp.rows.map(r => r.portal_id);
          if (u.portalIds.length > 0) {
            const pNames = await pool.query(
              'SELECT id, name FROM portals WHERE id = ANY($1)',
              [u.portalIds]
            );
            u.portalNames = pNames.rows.map(r => r.name);
            u.portalName = u.portalNames.join(', ');
          }
        }

        users.push(u);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: users }) };
    }

    // ---------- POST/PUT/DELETE: apenas admin ----------
    if (!isAdmin) throw new Error('Acesso negado: apenas administradores');

    // ---------- POST ----------
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');

      if (!data.username || !data.password) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Username e password são obrigatórios' }) };
      }

      const checkUser = await pool.query('SELECT id FROM users WHERE username = $1', [data.username]);
      if (checkUser.rows.length > 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Username já existe' }) };
      }

      if (data.role === 'user' && !data.portal_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Técnicos devem ter um portal atribuído' }) };
      }

      const passwordHash = await bcrypt.hash(data.password, 10);
      const query = `
        INSERT INTO users (username, password_hash, plain_password, portal_id, role, telegram_chat_id, telegram_chat_id_2, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, username, portal_id, role
      `;
      const values = [
        data.username.trim(),
        passwordHash,
        data.password,
        data.portal_id || null,
        data.role || 'user',
        data.telegram_chat_id || null,
        data.telegram_chat_id_2 || null,
        new Date().toISOString(),
        new Date().toISOString()
      ];

      const { rows } = await pool.query(query, values);
      const newUser = rows[0];

      // Coordenador e Comercial: guardar lista de portais
      if ((data.role === 'coordenador' || data.role === 'comercial') && data.portal_ids && data.portal_ids.length > 0) {
        for (const pid of data.portal_ids) {
          await pool.query(
            'INSERT INTO coordinator_portals (user_id, portal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [newUser.id, pid]
          );
        }
      }

      console.log('Utilizador criado:', data.username, '(' + data.role + ')');
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: newUser }) };
    }

    // ---------- PUT ----------
    if (event.httpMethod === 'PUT') {
      const id = (event.path || '').split('/').pop();
      const data = JSON.parse(event.body || '{}');

      let passwordHash = null;
      if (data.password) {
        passwordHash = await bcrypt.hash(data.password, 10);
      }

      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (data.username)              { updates.push('username = $'          + paramIndex++); values.push(data.username.trim()); }
      if (passwordHash)               { updates.push('password_hash = $'     + paramIndex++); values.push(passwordHash); }
      if (data.password)              { updates.push('plain_password = $'    + paramIndex++); values.push(data.password); }
      if (data.portal_id !== undefined){ updates.push('portal_id = $'        + paramIndex++); values.push(data.portal_id || null); }
      if (data.role)                  { updates.push('role = $'              + paramIndex++); values.push(data.role); }
      if (data.telegram_chat_id !== undefined) { updates.push('telegram_chat_id = $' + paramIndex++); values.push(data.telegram_chat_id || null); }
      if (data.telegram_chat_id_2 !== undefined) { updates.push('telegram_chat_id_2 = $' + paramIndex++); values.push(data.telegram_chat_id_2 || null); }
      if (data.assigned_portal_ids !== undefined) { updates.push('assigned_portal_ids = $' + paramIndex++); values.push(data.assigned_portal_ids || []); }

      updates.push('updated_at = $' + paramIndex++);
      values.push(new Date().toISOString());
      values.push(id);

      const query = 'UPDATE users SET ' + updates.join(', ') + ' WHERE id = $' + paramIndex + ' RETURNING id, username, portal_id, role';
      const { rows } = await pool.query(query, values);

      if (rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Utilizador não encontrado' }) };
      }

      // Coordenador e Comercial: atualizar lista de portais
      if ((data.role === 'coordenador' || data.role === 'comercial') && data.portal_ids) {
        await pool.query('DELETE FROM coordinator_portals WHERE user_id = $1', [id]);
        for (const pid of data.portal_ids) {
          await pool.query(
            'INSERT INTO coordinator_portals (user_id, portal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, pid]
          );
        }
      } else if (data.role && data.role !== 'coordenador' && data.role !== 'comercial') {
        await pool.query('DELETE FROM coordinator_portals WHERE user_id = $1', [id]);
      }

      console.log('Utilizador atualizado:', rows[0].username);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ---------- DELETE ----------
    if (event.httpMethod === 'DELETE') {
      const id = (event.path || '').split('/').pop();
      await pool.query('DELETE FROM coordinator_portals WHERE user_id = $1', [id]);
      const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, username', [id]);
      if (rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Utilizador não encontrado' }) };
      }
      console.log('Utilizador eliminado:', rows[0].username);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método ' + event.httpMethod + ' não permitido' }) };

  } catch (error) {
    console.error('Erro na gestão de utilizadores:', error);
    if (error.message.includes('Não autenticado') || error.message.includes('Acesso negado')) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Erro interno do servidor' }) };
  }
};
