const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const {
  ensureAccountSchema,
  hashInviteToken,
  passwordError
} = require('../lib/account-access');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
};

function response(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function validTokenShape(token) {
  return typeof token === 'string' && token.length >= 32 && token.length <= 200;
}

async function findInvite(client, tokenHash, lock) {
  const suffix = lock ? ' FOR UPDATE OF ai' : '';
  const { rows } = await client.query(`
    SELECT ai.id, ai.user_id, ai.email, ai.expires_at, ai.accepted_at, ai.revoked_at,
           u.username, u.account_status
    FROM account_invites ai
    JOIN users u ON u.id = ai.user_id
    WHERE ai.token_hash = $1
    LIMIT 1${suffix}
  `, [tokenHash]);
  return rows[0] || null;
}

function inviteProblem(invite) {
  if (!invite || invite.revoked_at) return { status: 404, error: 'Convite inválido' };
  if (invite.accepted_at) return { status: 409, error: 'Este convite já foi utilizado' };
  if (invite.account_status !== 'invited') {
    return { status: 409, error: 'Esta conta já está ativa' };
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return { status: 410, error: 'Este convite expirou. Pede um novo convite ao administrador.' };
  }
  return null;
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return response(405, { success: false, error: 'Método não permitido' });
  }

  try {
    await ensureAccountSchema(pool);
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {};
    const token = event.httpMethod === 'GET'
      ? event.queryStringParameters?.token
      : body.token;

    if (!validTokenShape(token)) {
      return response(400, { success: false, error: 'Convite inválido' });
    }

    const tokenHash = hashInviteToken(token);

    if (event.httpMethod === 'GET') {
      const invite = await findInvite(pool, tokenHash, false);
      const problem = inviteProblem(invite);
      if (problem) return response(problem.status, { success: false, error: problem.error });
      return response(200, {
        success: true,
        data: {
          email: invite.email,
          username: invite.username,
          expiresAt: invite.expires_at
        }
      });
    }

    const invalidPassword = passwordError(body.password);
    if (invalidPassword) {
      return response(400, { success: false, error: invalidPassword });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invite = await findInvite(client, tokenHash, true);
      const problem = inviteProblem(invite);
      if (problem) {
        await client.query('ROLLBACK');
        return response(problem.status, { success: false, error: problem.error });
      }

      const passwordHash = await bcrypt.hash(body.password, 12);
      await client.query(`
        UPDATE users
        SET password_hash = $1,
            plain_password = NULL,
            account_status = 'active',
            email_verified_at = NOW(),
            password_set_at = NOW(),
            updated_at = NOW()
        WHERE id = $2
      `, [passwordHash, invite.user_id]);
      await client.query(
        'UPDATE account_invites SET accepted_at = NOW() WHERE id = $1',
        [invite.id]
      );
      await client.query(`
        UPDATE account_invites
        SET revoked_at = NOW()
        WHERE user_id = $1
          AND id <> $2
          AND accepted_at IS NULL
          AND revoked_at IS NULL
      `, [invite.user_id, invite.id]);
      await client.query('COMMIT');

      try {
        await pool.query(
          `INSERT INTO audit_log (user_id, username, action, entity, entity_id, details)
           VALUES ($1, $2, 'account_activated', 'user', $3, $4)`,
          [invite.user_id, invite.username, String(invite.user_id), JSON.stringify({ method: 'email_invite' })]
        );
      } catch (auditError) {
        console.warn('[account-invite-audit]', auditError.message);
      }

      return response(200, {
        success: true,
        message: 'Password definida. A conta está ativa.'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[account-invite]', error);
    return response(500, { success: false, error: 'Erro interno do servidor' });
  }
};

exports.__test = { validTokenShape, inviteProblem };
