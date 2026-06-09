const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function verifyToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(auth.substring(7), JWT_SECRET);
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_checkins (
      id SERIAL PRIMARY KEY,
      portal_id INTEGER REFERENCES portals(id) ON DELETE CASCADE,
      user_id INTEGER,
      user_name TEXT,
      date DATE NOT NULL,
      checkin_at TIMESTAMPTZ,
      checkout_at TIMESTAMPTZ,
      checkin_auto BOOLEAN DEFAULT FALSE,
      checkout_auto BOOLEAN DEFAULT FALSE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(portal_id, date)
    )
  `);
}

// Portugal: UTC+1 Apr–Oct (WEST/summer), UTC+0 Nov–Mar (WET/winter)
function lisbonTs(dateStr, h, m) {
  const month = new Date(dateStr + 'T12:00:00Z').getUTCMonth();
  const offset = (month >= 3 && month <= 9) ? '+01:00' : '+00:00';
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${offset}`;
}

function parsePeriodMinutes(period) {
  if (!period) return null;
  const m = String(period).match(/^(\d{1,2}):(\d{2})/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  return null;
}

async function calcAutoCheckout(portalId, dateStr) {
  const { rows } = await pool.query(`
    SELECT period, travel_time, return_time
    FROM appointments
    WHERE portal_id = $1 AND date = $2
    ORDER BY "sortIndex" ASC NULLS LAST
  `, [portalId, dateStr]);

  if (!rows.length) return null;

  const firstMins = parsePeriodMinutes(rows[0].period);
  let cur = firstMins !== null ? firstMins : 9 * 60;

  for (const row of rows) {
    cur += (parseInt(row.travel_time) || 30) + 45;
  }
  const last = rows[rows.length - 1];
  cur += (parseInt(last.return_time) || 30);

  const h = Math.floor(cur / 60) % 24;
  const m = cur % 60;
  return lisbonTs(dateStr, h, m);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const user = verifyToken(event);
    await ensureTable();

    const params = event.queryStringParameters || {};
    const portalId = parseInt(params.portal_id || user.portalId || user.portalIds?.[0]);
    if (!portalId) return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem portal' }) };

    // GET
    if (event.httpMethod === 'GET') {
      if (params.history === 'true') {
        const { rows } = await pool.query(`
          SELECT tc.*, p.name AS portal_name,
            EXTRACT(EPOCH FROM (tc.checkout_at - tc.checkin_at)) / 3600 AS hours_total
          FROM team_checkins tc
          LEFT JOIN portals p ON p.id = tc.portal_id
          WHERE tc.portal_id = $1
          ORDER BY tc.date DESC
          LIMIT 60
        `, [portalId]);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
      }
      const date = params.date || new Date().toISOString().slice(0, 10);
      const { rows } = await pool.query(
        'SELECT * FROM team_checkins WHERE portal_id = $1 AND date = $2',
        [portalId, date]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] || null }) };
    }

    // POST
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action, date: dateParam } = body;
      const date = dateParam || new Date().toISOString().slice(0, 10);
      const userId = user.id || user.userId || null;
      const userName = user.name || user.username || null;
      const now = new Date().toISOString();

      if (action === 'checkin') {
        await pool.query(`
          INSERT INTO team_checkins (portal_id, user_id, user_name, date, checkin_at, checkin_auto)
          VALUES ($1,$2,$3,$4,$5,false)
          ON CONFLICT (portal_id, date) DO UPDATE
            SET checkin_at=$5, checkin_auto=false, updated_at=NOW()
        `, [portalId, userId, userName, date, now]);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (action === 'checkout') {
        const autoCheckinTime = lisbonTs(date, 9, 0);
        await pool.query(`
          INSERT INTO team_checkins (portal_id, user_id, user_name, date, checkin_at, checkin_auto, checkout_at, checkout_auto)
          VALUES ($1,$2,$3,$4,$5,true,$6,false)
          ON CONFLICT (portal_id, date) DO UPDATE SET
            checkin_at   = COALESCE(team_checkins.checkin_at, $5),
            checkin_auto = CASE WHEN team_checkins.checkin_at IS NULL THEN true ELSE team_checkins.checkin_auto END,
            checkout_at  = $6,
            checkout_auto = false,
            updated_at   = NOW()
        `, [portalId, userId, userName, date, autoCheckinTime, now]);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (action === 'autofill') {
        const checkinDefault = lisbonTs(date, 9, 0);
        const checkoutDefault = await calcAutoCheckout(portalId, date);
        await pool.query(`
          INSERT INTO team_checkins (portal_id, user_id, user_name, date, checkin_at, checkin_auto, checkout_at, checkout_auto)
          VALUES ($1,$2,$3,$4,$5,true,$6,$7)
          ON CONFLICT (portal_id, date) DO UPDATE SET
            checkin_at  = COALESCE(team_checkins.checkin_at,  $5),
            checkin_auto= CASE WHEN team_checkins.checkin_at  IS NULL THEN true ELSE team_checkins.checkin_auto  END,
            checkout_at = COALESCE(team_checkins.checkout_at, $6),
            checkout_auto=CASE WHEN team_checkins.checkout_at IS NULL AND $6 IS NOT NULL THEN $7 ELSE team_checkins.checkout_auto END,
            updated_at  = NOW()
        `, [portalId, userId, userName, date, checkinDefault, checkoutDefault, checkoutDefault !== null]);

        const { rows } = await pool.query(
          'SELECT * FROM team_checkins WHERE portal_id = $1 AND date = $2',
          [portalId, date]
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] || null }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Ação inválida' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não suportado' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
