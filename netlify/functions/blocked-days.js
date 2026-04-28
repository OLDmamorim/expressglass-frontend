// netlify/functions/blocked-days.js
// Gestão de dias bloqueados (feriados e outros).
// GET  — lista dias bloqueados (portal_id + globais)
// POST — bloquear um dia
// DELETE — desbloquear um dia

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

// Feriados nacionais PT (fixos e calculados) para 2025 e 2026
function getHolidaysPT() {
  const holidays = [];

  // Anos a pré-carregar
  [2025, 2026, 2027].forEach(y => {
    // Fixos
    const fixed = [
      `${y}-01-01`, // Ano Novo
      `${y}-04-25`, // 25 de Abril
      `${y}-05-01`, // Dia do Trabalhador
      `${y}-06-10`, // Dia de Portugal
      `${y}-08-15`, // Assunção de Nossa Senhora
      `${y}-10-05`, // Implantação da República
      `${y}-11-01`, // Todos os Santos
      `${y}-12-01`, // Restauração da Independência
      `${y}-12-08`, // Imaculada Conceição
      `${y}-12-25`, // Natal
    ];
    fixed.forEach(d => holidays.push({ date: d, reason: nameForDate(d), is_holiday: true }));

    // Páscoa (algoritmo de Gauss)
    const easter = calcEaster(y);
    const goodFriday = new Date(easter); goodFriday.setDate(goodFriday.getDate() - 2);
    holidays.push({ date: toISO(goodFriday), reason: 'Sexta-feira Santa', is_holiday: true });
    holidays.push({ date: toISO(easter), reason: 'Páscoa', is_holiday: true });
    // Corpo de Deus (60 dias após Páscoa) — feriado municipal em muitos concelhos
    const corpusChristi = new Date(easter); corpusChristi.setDate(corpusChristi.getDate() + 60);
    holidays.push({ date: toISO(corpusChristi), reason: 'Corpo de Deus', is_holiday: true });
  });

  return holidays;
}

function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function calcEaster(y) {
  const a = y % 19, b = Math.floor(y/100), c = y % 100;
  const d = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15) % 30;
  const i = Math.floor(c/4), k = c % 4;
  const l = (32+2*e+2*i-h-k) % 7;
  const m = Math.floor((a+11*h+22*l)/451);
  const month = Math.floor((h+l-7*m+114)/31);
  const day = ((h+l-7*m+114) % 31) + 1;
  return new Date(y, month-1, day);
}

function nameForDate(d) {
  const m = d.slice(5);
  const names = {
    '01-01':'Ano Novo','04-25':'25 de Abril','05-01':'Dia do Trabalhador',
    '06-10':'Dia de Portugal','08-15':'Assunção de Nossa Senhora',
    '10-05':'Implantação da República','11-01':'Todos os Santos',
    '12-01':'Restauração da Independência','12-08':'Imaculada Conceição','12-25':'Natal'
  };
  return names[m] || 'Feriado';
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_days (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      portal_id INTEGER REFERENCES portals(id) ON DELETE CASCADE,
      reason TEXT,
      is_holiday BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(date, portal_id)
    )
  `);
  // Índice para queries rápidas
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_blocked_days_date ON blocked_days(date)`);
}

async function seedHolidays() {
  // Inserir feriados nacionais se ainda não existirem (portal_id = NULL = global)
  const holidays = getHolidaysPT();
  for (const h of holidays) {
    await pool.query(`
      INSERT INTO blocked_days (date, portal_id, reason, is_holiday)
      VALUES ($1, NULL, $2, TRUE)
      ON CONFLICT (date, portal_id) DO NOTHING
    `, [h.date, h.reason]).catch(() => {});
  }
}

function verifyToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(auth.substring(7), JWT_SECRET);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const user = verifyToken(event);
    await ensureTable();

    const p = event.queryStringParameters || {};
    const portalId = p.portal_id ? parseInt(p.portal_id) : null;

    // ── GET — listar dias bloqueados (globais + do portal) ──
    if (event.httpMethod === 'GET') {
      // Na primeira chamada, garantir feriados semeados
      await seedHolidays();

      const { rows } = await pool.query(`
        SELECT id, date, portal_id, reason, is_holiday
        FROM blocked_days
        WHERE portal_id IS NULL OR portal_id = $1
        ORDER BY date
      `, [portalId]);

      // Normalizar datas para YYYY-MM-DD
      const result = rows.map(r => ({
        ...r,
        date: r.date instanceof Date ? toISO(r.date) : String(r.date).slice(0,10)
      }));

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, blocked: result }) };
    }

    // ── POST — bloquear dia ──
    if (event.httpMethod === 'POST') {
      if (user.role !== 'admin' && user.role !== 'coordenador') {
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };
      }

      const body = JSON.parse(event.body || '{}');
      const { date, reason, is_holiday, global: isGlobal } = body;
      if (!date) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Data obrigatória' }) };

      // Admin pode criar global; coordenador só para o seu portal
      const targetPortalId = (user.role === 'admin' && isGlobal) ? null : portalId;

      const { rows } = await pool.query(`
        INSERT INTO blocked_days (date, portal_id, reason, is_holiday)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (date, portal_id) DO UPDATE SET reason = EXCLUDED.reason, is_holiday = EXCLUDED.is_holiday
        RETURNING *
      `, [date, targetPortalId, reason || 'Dia bloqueado', is_holiday || false]);

      const r = rows[0];
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, blocked: { ...r, date: String(r.date).slice(0,10) } }) };
    }

    // ── DELETE — desbloquear dia ──
    if (event.httpMethod === 'DELETE') {
      if (user.role !== 'admin' && user.role !== 'coordenador') {
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };
      }

      const body = JSON.parse(event.body || '{}');
      const { date, remove_global } = body;
      if (!date) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Data obrigatória' }) };

      if (user.role === 'admin' && remove_global) {
        // Admin pode remover entrada global
        await pool.query('DELETE FROM blocked_days WHERE date = $1 AND portal_id IS NULL', [date]);
      } else {
        // Coordenador: remover entrada do portal; se só havia global, criar excepção negativa
        await pool.query('DELETE FROM blocked_days WHERE date = $1 AND portal_id = $2', [date, portalId]);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: '{}' };

  } catch (err) {
    console.error('[blocked-days]', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
