// netlify/functions/reports.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };

  try {
    const token = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    jwt.verify(token, JWT_SECRET);
  } catch(e) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Não autenticado' }) };
  }

  const params = event.queryStringParameters || {};
  const portalId = params.portal_id ? parseInt(params.portal_id) : null;
  const dateFrom = params.date_from; // YYYY-MM-DD
  const dateTo   = params.date_to;   // YYYY-MM-DD

  if (!portalId || !dateFrom || !dateTo) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'portal_id, date_from, date_to obrigatórios' }) };
  }

  try {
    // 1. Totais gerais
    const { rows: totals } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE date BETWEEN $2 AND $3) AS total_agendados,
        COUNT(*) FILTER (WHERE date BETWEEN $2 AND $3 AND executed = true) AS total_realizados,
        COUNT(*) FILTER (WHERE date BETWEEN $2 AND $3 AND executed = false) AS total_nao_realizados,
        COALESCE(SUM(km) FILTER (WHERE date BETWEEN $2 AND $3), 0) AS total_km,
        COUNT(*) FILTER (WHERE date IS NULL) AS total_pendentes
      FROM appointments
      WHERE portal_id = $1
    `, [portalId, dateFrom, dateTo]);

    // 2. Por localidade
    const { rows: byLocality } = await pool.query(`
      SELECT
        COALESCE(locality, 'Sem localidade') AS locality,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE executed = true) AS realizados,
        COALESCE(SUM(km), 0) AS km
      FROM appointments
      WHERE portal_id = $1 AND date BETWEEN $2 AND $3
      GROUP BY locality
      ORDER BY total DESC
    `, [portalId, dateFrom, dateTo]);

    // 3. Por dia da semana
    const { rows: byWeekday } = await pool.query(`
      SELECT
        TO_CHAR(date, 'ID') AS dow_num,
        TO_CHAR(date, 'Day') AS dow_name,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE executed = true) AS realizados
      FROM appointments
      WHERE portal_id = $1 AND date BETWEEN $2 AND $3
      GROUP BY dow_num, dow_name
      ORDER BY dow_num
    `, [portalId, dateFrom, dateTo]);

    // 4. Por semana (evolução)
    const { rows: byWeek } = await pool.query(`
      SELECT
        DATE_TRUNC('week', date)::date AS week_start,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE executed = true) AS realizados,
        COALESCE(SUM(km), 0) AS km
      FROM appointments
      WHERE portal_id = $1 AND date BETWEEN $2 AND $3
      GROUP BY week_start
      ORDER BY week_start
    `, [portalId, dateFrom, dateTo]);

    // 5. Por tipo de serviço
    const { rows: byService } = await pool.query(`
      SELECT
        COALESCE(service, 'Outro') AS service,
        COUNT(*) AS total
      FROM appointments
      WHERE portal_id = $1 AND date BETWEEN $2 AND $3
      GROUP BY service
      ORDER BY total DESC
    `, [portalId, dateFrom, dateTo]);

    // 6. Portal info
    const { rows: portalInfo } = await pool.query(
      'SELECT name, portal_type FROM portals WHERE id = $1', [portalId]
    );

    // 7. Dias com serviços (para média diária)
    const { rows: diasRows } = await pool.query(`
      SELECT COUNT(DISTINCT date) AS dias_com_servicos
      FROM appointments
      WHERE portal_id = $1 AND date BETWEEN $2 AND $3
    `, [portalId, dateFrom, dateTo]);

    // 8. Totais de tempo (travel_time em minutos)
    const { rows: timeRows } = await pool.query(`
      SELECT
        COALESCE(SUM(travel_time), 0) AS total_travel_min,
        COUNT(*) FILTER (WHERE travel_time > 0) AS servicos_com_tempo
      FROM appointments
      WHERE portal_id = $1 AND date BETWEEN $2 AND $3
    `, [portalId, dateFrom, dateTo]);

    // 9. Serviços por comercial
    const { rows: byComercial } = await pool.query(`
      SELECT
        u.username AS comercial_name,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE a.executed = true) AS realizados,
        COUNT(*) FILTER (WHERE a.executed = false AND a.not_done_reason IS NOT NULL) AS nao_realizados,
        COUNT(*) FILTER (WHERE a.executed IS NULL) AS pendentes,
        ROUND(AVG(
          CASE WHEN a.date IS NOT NULL AND a.created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (a.date::timestamp - a.created_at)) / 86400
          ELSE NULL END
        )::numeric, 1) AS media_dias
      FROM appointments a
      JOIN users u ON u.id = a.commercial_user_id
      WHERE a.portal_id = $1 AND a.date BETWEEN $2 AND $3
        AND a.commercial_user_id IS NOT NULL
      GROUP BY u.username
      ORDER BY total DESC
    `, [portalId, dateFrom, dateTo]);

    // 10. Motivos de não realização
    const { rows: byMotivo } = await pool.query(`
      SELECT
        not_done_reason AS motivo,
        COUNT(*) AS total
      FROM appointments
      WHERE portal_id = $1 AND date BETWEEN $2 AND $3
        AND executed = false AND not_done_reason IS NOT NULL
      GROUP BY not_done_reason
      ORDER BY total DESC
    `, [portalId, dateFrom, dateTo]);

    // 11. Tempo de execução por tipo de serviço
    const { rows: byServiceTime } = await pool.query(`
      SELECT
        COALESCE(service, 'PB') AS service,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE executed = true) AS realizados,
        COUNT(*) FILTER (WHERE calibration = true) AS com_calibragem
      FROM appointments
      WHERE portal_id = $1 AND date BETWEEN $2 AND $3
      GROUP BY service
      ORDER BY total DESC
    `, [portalId, dateFrom, dateTo]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        portal: portalInfo[0] || {},
        period: { from: dateFrom, to: dateTo },
        totals: {
          ...totals[0],
          dias_com_servicos: parseInt(diasRows[0]?.dias_com_servicos) || 0,
          total_travel_min: parseInt(timeRows[0]?.total_travel_min) || 0
        },
        byLocality,
        byWeekday,
        byWeek,
        byService,
        byComercial,
        byMotivo,
        byServiceTime
      })
    };
  } catch(e) {
    console.error('Erro reports:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
