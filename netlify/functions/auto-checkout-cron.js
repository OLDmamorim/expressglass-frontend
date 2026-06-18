// Runs daily at 20:00 UTC (= 20:00 Lisbon winter / 21:00 Lisbon summer).
// Sets checkout_at = 18:00 Lisbon for any portal that checked in but never checked out.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Portugal: UTC+1 Apr–Oct (WEST/summer), UTC+0 Nov–Mar (WET/winter)
function lisbonTs(dateStr, h, m) {
  const month = new Date(dateStr + 'T12:00:00Z').getUTCMonth();
  const offset = (month >= 3 && month <= 9) ? '+01:00' : '+00:00';
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${offset}`;
}

exports.handler = async () => {
  try {
    const now = new Date();
    const month = now.getUTCMonth();
    const lisbonOffsetHours = (month >= 3 && month <= 9) ? 1 : 0;
    const lisbonNow = new Date(now.getTime() + lisbonOffsetHours * 3600 * 1000);
    const today = lisbonNow.toISOString().slice(0, 10);

    const checkout18 = lisbonTs(today, 18, 0);

    const { rows } = await pool.query(`
      UPDATE team_checkins
      SET   checkout_at   = $1,
            checkout_auto = true,
            updated_at    = NOW()
      WHERE date        = $2
        AND checkin_at  IS NOT NULL
        AND checkout_at IS NULL
      RETURNING portal_id
    `, [checkout18, today]);

    console.log(`[auto-checkout] ${today}: ${rows.length} portal(s) → 18:00`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, date: today, updated: rows.length })
    };
  } catch (e) {
    console.error('[auto-checkout] error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
