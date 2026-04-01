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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        portal: portalInfo[0] || {},
        period: { from: dateFrom, to: dateTo },
        totals: totals[0],
        byLocality,
        byWeekday,
        byWeek,
        byService
      })
    };
  } catch(e) {
    console.error('Erro reports:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
