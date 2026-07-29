const crypto = require('crypto');

const INVITE_HOURS = 48;
const schemaPromises = new WeakMap();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function usernameBase(value, email) {
  const source = String(value || '').trim() || normalizeEmail(email).split('@')[0] || 'utilizador';
  const normalized = source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/[._-]{2,}/g, '.');
  return (normalized || 'utilizador').slice(0, 50);
}

async function uniqueUsername(client, preferred, email) {
  const base = usernameBase(preferred, email);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const ending = suffix === 0 ? '' : String(suffix + 1);
    const candidate = (base.slice(0, 50 - ending.length) + ending).slice(0, 50);
    const existing = await client.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [candidate]
    );
    if (existing.rows.length === 0) return candidate;
  }
  throw new Error('Não foi possível gerar um username disponível');
}

function passwordError(password) {
  const value = String(password || '');
  if (value.length < 8) return 'A password deve ter pelo menos 8 caracteres';
  if (!/[A-Za-zÀ-ÿ]/.test(value) || !/\d/.test(value)) {
    return 'A password deve incluir letras e números';
  }
  return null;
}

function createInviteToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function inviteExpiresAt(now = new Date()) {
  return new Date(now.getTime() + INVITE_HOURS * 60 * 60 * 1000);
}

async function runSchema(pool) {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ');
  await pool.query("UPDATE users SET account_status = 'active' WHERE account_status IS NULL OR account_status = ''");
  await pool.query("ALTER TABLE users ALTER COLUMN account_status SET DEFAULT 'active'");
  await pool.query('ALTER TABLE users ALTER COLUMN account_status SET NOT NULL');
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON users (LOWER(email))
    WHERE email IS NOT NULL AND email <> ''
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_invites (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_account_invites_user
    ON account_invites (user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coordinator_portals (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, portal_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultable_portals (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, portal_id)
    )
  `);
}

function ensureAccountSchema(pool) {
  if (!schemaPromises.has(pool)) {
    const promise = runSchema(pool).catch(error => {
      schemaPromises.delete(pool);
      throw error;
    });
    schemaPromises.set(pool, promise);
  }
  return schemaPromises.get(pool);
}

module.exports = {
  INVITE_HOURS,
  normalizeEmail,
  isValidEmail,
  usernameBase,
  uniqueUsername,
  passwordError,
  createInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  ensureAccountSchema
};
