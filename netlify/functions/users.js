const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  normalizeEmail,
  isValidEmail,
  uniqueUsername,
  createInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  ensureAccountSchema
} = require('../lib/account-access');
const { sendAccountInvite } = require('../lib/account-email');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const VALID_ROLES = new Set(['admin', 'user', 'coordenador', 'comercial']);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function portalIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(Number)
    .filter(value => Number.isInteger(value) && value > 0))];
}

async function auditLog({ userId, username, action, entityId, details, event }) {
  try {
    const ip = event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null;
    const userAgent = event?.headers?.['user-agent'] || null;
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, ip, user_agent)
       VALUES ($1, $2, $3, 'user', $4, $5, $6, $7)`,
      [
        userId || null,
        username || null,
        action,
        entityId ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        ip,
        userAgent
      ]
    );
  } catch (error) {
    console.warn('[users-audit]', error.message);
  }
}

function accessError(data) {
  const role = data.role || 'user';
  if (!VALID_ROLES.has(role)) return 'Cargo inválido';
  if (role === 'user' && (!Number.isInteger(Number(data.portal_id)) || Number(data.portal_id) <= 0)) {
    return 'Técnicos devem ter um portal atribuído';
  }
  if (role === 'coordenador' && portalIds(data.portal_ids).length === 0) {
    return 'Coordenadores devem ter pelo menos um portal atribuído';
  }
  const commercialIds = data.assigned_portal_ids || data.portal_ids;
  if (role === 'comercial' && portalIds(commercialIds).length === 0) {
    return 'Comerciais devem ter pelo menos um SM atribuído';
  }
  return null;
}

async function syncUserAccess(client, userId, data) {
  const role = data.role || 'user';
  const coordinatedIds = role === 'comercial'
    ? portalIds(data.assigned_portal_ids || data.portal_ids)
    : portalIds(data.portal_ids);

  await client.query('DELETE FROM coordinator_portals WHERE user_id = $1', [userId]);
  if (role === 'coordenador' || role === 'comercial') {
    for (const portalId of coordinatedIds) {
      await client.query(
        'INSERT INTO coordinator_portals (user_id, portal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, portalId]
      );
    }
  }

  await client.query('DELETE FROM consultable_portals WHERE user_id = $1', [userId]);
  if (role === 'coordenador') {
    const coordinated = new Set(coordinatedIds);
    const consultable = portalIds(data.consultable_portal_ids)
      .filter(portalId => !coordinated.has(portalId));
    for (const portalId of consultable) {
      await client.query(
        'INSERT INTO consultable_portals (user_id, portal_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, portalId]
      );
    }
  }
}

async function createInvitation(client, userId, email, createdBy) {
  const token = createInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = inviteExpiresAt();

  await client.query(`
    UPDATE account_invites
    SET revoked_at = NOW()
    WHERE user_id = $1
      AND accepted_at IS NULL
      AND revoked_at IS NULL
  `, [userId]);
  await client.query(`
    INSERT INTO account_invites (user_id, email, token_hash, expires_at, created_by)
    VALUES ($1, $2, $3, $4, $5)
  `, [userId, email, tokenHash, expiresAt.toISOString(), createdBy || null]);

  return { token, expiresAt };
}

async function emailExists(client, email, excludeUserId) {
  if (!email) return false;
  const values = [email];
  let query = 'SELECT id FROM users WHERE LOWER(email) = LOWER($1)';
  if (excludeUserId) {
    values.push(excludeUserId);
    query += ' AND id <> $2';
  }
  query += ' LIMIT 1';
  const { rows } = await client.query(query, values);
  return rows.length > 0;
}

async function usernameExists(client, username, excludeUserId) {
  const values = [username];
  let query = 'SELECT id FROM users WHERE LOWER(username) = LOWER($1)';
  if (excludeUserId) {
    values.push(excludeUserId);
    query += ' AND id <> $2';
  }
  query += ' LIMIT 1';
  const { rows } = await client.query(query, values);
  return rows.length > 0;
}

async function loadAdminUsers() {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.email, u.account_status, u.email_verified_at,
           u.portal_id, u.role, u.created_at, u.updated_at,
           u.telegram_chat_id, u.telegram_chat_id_2, u.assigned_portal_ids,
           u.plain_password, p.name AS portal_name,
           invitation.expires_at AS invite_expires_at
    FROM users u
    LEFT JOIN portals p ON u.portal_id = p.id
    LEFT JOIN LATERAL (
      SELECT ai.expires_at
      FROM account_invites ai
      WHERE ai.user_id = u.id
        AND ai.accepted_at IS NULL
        AND ai.revoked_at IS NULL
      ORDER BY ai.created_at DESC
      LIMIT 1
    ) invitation ON TRUE
    ORDER BY u.username ASC
  `);

  const users = [];
  for (const user of rows) {
    const item = {
      id: user.id,
      username: user.username,
      email: user.email || null,
      accountStatus: user.account_status || 'active',
      emailVerifiedAt: user.email_verified_at || null,
      inviteExpiresAt: user.invite_expires_at || null,
      portalId: user.portal_id,
      portalName: user.portal_name,
      role: user.role,
      telegramChatId: user.telegram_chat_id || null,
      telegramChatId2: user.telegram_chat_id_2 || null,
      assigned_portal_ids: user.assigned_portal_ids || [],
      plain_password: user.plain_password || null,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    };

    if (user.role === 'coordenador' || user.role === 'comercial') {
      const assigned = await pool.query(
        'SELECT portal_id FROM coordinator_portals WHERE user_id = $1',
        [user.id]
      );
      item.portalIds = assigned.rows.map(row => row.portal_id);
      if (item.portalIds.length > 0) {
        const names = await pool.query(
          'SELECT id, name FROM portals WHERE id = ANY($1)',
          [item.portalIds]
        );
        item.portalNames = names.rows.map(row => row.name);
        item.portalName = item.portalNames.join(', ');
      }
    }

    if (user.role === 'coordenador') {
      try {
        const consultable = await pool.query(
          'SELECT portal_id FROM consultable_portals WHERE user_id = $1',
          [user.id]
        );
        item.consultablePortalIds = consultable.rows.map(row => row.portal_id);
      } catch (error) {
        item.consultablePortalIds = [];
      }
    }

    users.push(item);
  }
  return users;
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Não autenticado');
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    const isAdmin = decoded.role === 'admin';
    const isCoordinator = decoded.role === 'coordenador';
    if (!isAdmin && !isCoordinator) throw new Error('Acesso negado');

    await ensureAccountSchema(pool);

    if (event.httpMethod === 'GET') {
      if (isCoordinator) {
        const { rows } = await pool.query(`
          SELECT u.id, u.username, u.email, u.role, u.telegram_chat_id
          FROM users u
          WHERE u.role = 'comercial'
          ORDER BY u.username ASC
        `);
        return response(200, {
          success: true,
          data: rows.map(user => ({
            id: user.id,
            username: user.username,
            email: user.email || null,
            role: user.role,
            telegramChatId: user.telegram_chat_id || null
          }))
        });
      }
      return response(200, { success: true, data: await loadAdminUsers() });
    }

    if (!isAdmin) throw new Error('Acesso negado: apenas administradores');

    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');

      if (data.action === 'resend_invite') {
        const userId = Number(data.user_id);
        if (!Number.isInteger(userId)) return response(400, { success: false, error: 'Utilizador inválido' });
        const { rows } = await pool.query(
          'SELECT id, username, email, account_status FROM users WHERE id = $1',
          [userId]
        );
        const user = rows[0];
        if (!user || !user.email) return response(404, { success: false, error: 'Utilizador ou email não encontrado' });
        if (user.account_status !== 'invited') {
          return response(400, { success: false, error: 'A conta já está ativa' });
        }

        const client = await pool.connect();
        let invitation;
        try {
          await client.query('BEGIN');
          invitation = await createInvitation(client, user.id, user.email, decoded.userId);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        const emailResult = await sendAccountInvite({
          email: user.email,
          name: user.username,
          username: user.username,
          token: invitation.token
        });
        await auditLog({
          userId: decoded.userId,
          username: decoded.username,
          action: 'account_invite_resent',
          entityId: user.id,
          details: { emailSent: emailResult.sent },
          event
        });
        return response(200, {
          success: true,
          emailSent: emailResult.sent,
          warning: emailResult.sent ? null : emailResult.error
        });
      }

      const inviteByEmail = data.invite_by_email === true;
      const email = normalizeEmail(data.email);
      const validationError = accessError(data);
      if (validationError) return response(400, { success: false, error: validationError });
      if (inviteByEmail && !isValidEmail(email)) {
        return response(400, { success: false, error: 'Indica um email válido para enviar o convite' });
      }
      if (!inviteByEmail && (!data.username || !data.password)) {
        return response(400, { success: false, error: 'Username e password são obrigatórios' });
      }
      if (!inviteByEmail && String(data.password).length < 6) {
        return response(400, { success: false, error: 'A password deve ter no mínimo 6 caracteres' });
      }
      const role = data.role || 'user';
      const registrationRequestId = data.registration_request_id === undefined
        ? null
        : Number(data.registration_request_id);
      if (registrationRequestId !== null && (!Number.isInteger(registrationRequestId) || registrationRequestId <= 0)) {
        return response(400, { success: false, error: 'Pedido de acesso inválido' });
      }
      const coordinatedPortalIds = role === 'comercial'
        ? portalIds(data.assigned_portal_ids || data.portal_ids)
        : portalIds(data.portal_ids);
      const primaryPortalId = role === 'admin'
        ? null
        : role === 'user'
          ? Number(data.portal_id)
          : (Number(data.portal_id) || coordinatedPortalIds[0]);

      const client = await pool.connect();
      let newUser;
      let invitation = null;
      try {
        await client.query('BEGIN');
        if (email && await emailExists(client, email)) {
          await client.query('ROLLBACK');
          return response(400, { success: false, error: 'Já existe uma conta com este email' });
        }

        let username;
        if (inviteByEmail) {
          username = await uniqueUsername(client, data.username || data.name, email);
        } else {
          username = String(data.username).trim().slice(0, 50);
          if (!username || await usernameExists(client, username)) {
            await client.query('ROLLBACK');
            return response(400, { success: false, error: username ? 'Username já existe' : 'Username inválido' });
          }
        }

        const passwordHash = inviteByEmail
          ? await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)
          : await bcrypt.hash(data.password, 10);
        const { rows } = await client.query(`
          INSERT INTO users (
            username, email, password_hash, plain_password, account_status,
            portal_id, role, telegram_chat_id, telegram_chat_id_2,
            assigned_portal_ids, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
          RETURNING id, username, email, portal_id, role, account_status
        `, [
          username,
          email || null,
          passwordHash,
          inviteByEmail ? null : data.password,
          inviteByEmail ? 'invited' : 'active',
          primaryPortalId,
          role,
          data.telegram_chat_id || null,
          data.telegram_chat_id_2 || null,
          role === 'comercial' ? coordinatedPortalIds : [],
        ]);
        newUser = rows[0];
        await syncUserAccess(client, newUser.id, data);
        if (inviteByEmail) {
          invitation = await createInvitation(client, newUser.id, email, decoded.userId);
        }
        if (registrationRequestId) {
          await client.query(
            "UPDATE registration_requests SET status = 'approved' WHERE id = $1 AND status = 'pending'",
            [registrationRequestId]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      let emailResult = { sent: false };
      if (invitation) {
        emailResult = await sendAccountInvite({
          email,
          name: data.name || newUser.username,
          username: newUser.username,
          token: invitation.token
        });
      }

      await auditLog({
        userId: decoded.userId,
        username: decoded.username,
        action: inviteByEmail ? 'user_invited' : 'user_created',
        entityId: newUser.id,
        details: { createdUsername: newUser.username, emailSent: emailResult.sent },
        event
      });
      return response(201, {
        success: true,
        data: newUser,
        invited: inviteByEmail,
        emailSent: inviteByEmail ? emailResult.sent : null,
        warning: inviteByEmail && !emailResult.sent ? emailResult.error : null
      });
    }

    if (event.httpMethod === 'PUT') {
      const id = Number((event.path || '').split('/').pop());
      const data = JSON.parse(event.body || '{}');
      if (!Number.isInteger(id) || id <= 0) {
        return response(400, { success: false, error: 'Utilizador inválido' });
      }

      const existingResult = await pool.query(
        'SELECT id, username, email, account_status, portal_id, role FROM users WHERE id = $1',
        [id]
      );
      const existingUser = existingResult.rows[0];
      if (!existingUser) {
        return response(404, { success: false, error: 'Utilizador não encontrado' });
      }

      const username = data.username === undefined
        ? undefined
        : String(data.username).trim().slice(0, 50);
      const email = data.email === undefined ? undefined : normalizeEmail(data.email);
      if (email && !isValidEmail(email)) {
        return response(400, { success: false, error: 'Email inválido' });
      }
      const resultingEmail = email === undefined ? normalizeEmail(existingUser.email) : email;
      if (existingUser.account_status === 'invited' && !isValidEmail(resultingEmail)) {
        return response(400, { success: false, error: 'Uma conta pendente precisa de um email válido' });
      }
      if (data.password && String(data.password).length < 6) {
        return response(400, { success: false, error: 'A password deve ter no mínimo 6 caracteres' });
      }
      if (username !== undefined && !username) {
        return response(400, { success: false, error: 'Username inválido' });
      }
      if (username && await usernameExists(pool, username, id)) {
        return response(400, { success: false, error: 'Username já existe' });
      }
      if (email && await emailExists(pool, email, id)) {
        return response(400, { success: false, error: 'Já existe uma conta com este email' });
      }

      const mergedAccess = {
        ...data,
        role: data.role || existingUser.role,
        portal_id: data.portal_id === undefined ? existingUser.portal_id : data.portal_id
      };
      if (
        ['coordenador', 'comercial'].includes(mergedAccess.role) &&
        data.portal_ids === undefined &&
        data.assigned_portal_ids === undefined
      ) {
        const assigned = await pool.query(
          'SELECT portal_id FROM coordinator_portals WHERE user_id = $1',
          [id]
        );
        mergedAccess.portal_ids = assigned.rows.map(row => row.portal_id);
        if (mergedAccess.role === 'comercial') {
          mergedAccess.assigned_portal_ids = mergedAccess.portal_ids;
        }
      }
      if (mergedAccess.role === 'coordenador' && data.consultable_portal_ids === undefined) {
        const consultable = await pool.query(
          'SELECT portal_id FROM consultable_portals WHERE user_id = $1',
          [id]
        );
        mergedAccess.consultable_portal_ids = consultable.rows.map(row => row.portal_id);
      }
      const validationError = accessError(mergedAccess);
      if (validationError) return response(400, { success: false, error: validationError });

      const updates = [];
      const values = [];
      const add = (column, value) => {
        values.push(value);
        updates.push(`${column} = $${values.length}`);
      };

      if (username !== undefined) add('username', username);
      if (email !== undefined) add('email', email || null);
      if (data.password) {
        add('password_hash', await bcrypt.hash(data.password, 10));
        add('plain_password', data.password);
        add('account_status', 'active');
        updates.push('password_set_at = NOW()');
      }
      if (data.role === 'admin') {
        add('portal_id', null);
      } else if (data.portal_id !== undefined) {
        add('portal_id', Number(data.portal_id) || null);
      }
      if (data.role) add('role', data.role);
      if (data.telegram_chat_id !== undefined) add('telegram_chat_id', data.telegram_chat_id || null);
      if (data.telegram_chat_id_2 !== undefined) add('telegram_chat_id_2', data.telegram_chat_id_2 || null);
      if (data.assigned_portal_ids !== undefined) {
        add('assigned_portal_ids', portalIds(data.assigned_portal_ids));
      } else if (data.role && data.role !== 'comercial') {
        add('assigned_portal_ids', []);
      }
      updates.push('updated_at = NOW()');
      values.push(id);

      const client = await pool.connect();
      let updatedUser;
      let replacementInvitation = null;
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `UPDATE users SET ${updates.join(', ')}
           WHERE id = $${values.length}
           RETURNING id, username, email, portal_id, role, account_status`,
          values
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          return response(404, { success: false, error: 'Utilizador não encontrado' });
        }
        updatedUser = rows[0];
        await syncUserAccess(client, id, mergedAccess);
        if (data.password) {
          await client.query(`
            UPDATE account_invites
            SET revoked_at = NOW()
            WHERE user_id = $1
              AND accepted_at IS NULL
              AND revoked_at IS NULL
          `, [id]);
        } else if (
          existingUser.account_status === 'invited' &&
          email !== undefined &&
          email !== normalizeEmail(existingUser.email)
        ) {
          replacementInvitation = await createInvitation(
            client,
            id,
            resultingEmail,
            decoded.userId
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      let emailResult = { sent: false };
      if (replacementInvitation) {
        emailResult = await sendAccountInvite({
          email: resultingEmail,
          name: updatedUser.username,
          username: updatedUser.username,
          token: replacementInvitation.token
        });
      }
      await auditLog({
        userId: decoded.userId,
        username: decoded.username,
        action: 'user_updated',
        entityId: id,
        details: {
          updatedUsername: updatedUser.username,
          replacementInviteSent: replacementInvitation ? emailResult.sent : null
        },
        event
      });
      return response(200, {
        success: true,
        data: updatedUser,
        invited: Boolean(replacementInvitation),
        emailSent: replacementInvitation ? emailResult.sent : null,
        warning: replacementInvitation && !emailResult.sent ? emailResult.error : null
      });
    }

    if (event.httpMethod === 'DELETE') {
      const id = Number((event.path || '').split('/').pop());
      if (!Number.isInteger(id) || id <= 0) {
        return response(400, { success: false, error: 'Utilizador inválido' });
      }
      await pool.query('DELETE FROM coordinator_portals WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM consultable_portals WHERE user_id = $1', [id]);
      const { rows } = await pool.query(
        'DELETE FROM users WHERE id = $1 RETURNING id, username',
        [id]
      );
      if (rows.length === 0) return response(404, { success: false, error: 'Utilizador não encontrado' });
      await auditLog({
        userId: decoded.userId,
        username: decoded.username,
        action: 'user_deleted',
        entityId: rows[0].id,
        details: { deletedUsername: rows[0].username },
        event
      });
      return response(200, { success: true, data: rows[0] });
    }

    return response(405, { success: false, error: `Método ${event.httpMethod} não permitido` });
  } catch (error) {
    console.error('[users]', error);
    if (error.code === '23505') {
      return response(400, { success: false, error: 'Username ou email já existente' });
    }
    if (error.message.includes('Não autenticado') || error.message.includes('Acesso negado')) {
      return response(403, { success: false, error: error.message });
    }
    return response(500, { success: false, error: 'Erro interno do servidor' });
  }
};

exports.__test = { accessError };
