// netlify/functions/glass-alerts.js
// Alertas operacionais de vidros:
//  - stalled_stock: vidro em stock (ST) sem data de serviço há mais de N dias
//  - pending_orders: vidro encomendado (VE) sem receção há mais de N dias
// Admin vê tudo; coordenadores vêem apenas os seus portais.
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
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'GET only' }) };

  let user;
  try {
    const token = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    user = jwt.verify(token, JWT_SECRET);
    if (!['admin', 'coordenador', 'coordinator'].includes(user.role)) throw new Error('Acesso negado');
  } catch (e) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Não autorizado' }) };
  }

  const p = event.queryStringParameters || {};
  const stockDays = Math.max(1, parseInt(p.stock_days) || 5);
  const orderDays = Math.max(1, parseInt(p.order_days) || 7);

  // Restrição de portais para coordenadores
  let portalFilter = '';
  const baseVals = [];
  if (user.role !== 'admin') {
    const ids = user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []);
    if (!ids.length) return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { stalled_stock: [], pending_orders: [] } }) };
    portalFilter = ' AND a.portal_id = ANY($2)';
    baseVals.push(ids);
  }

  const cols = `
    a.id, a.plate, a.car, a.date, a.status, a.order_ref, a.reception_ref,
    a.locality, a.updated_at, po.name AS portal_name,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - a.updated_at)) / 86400))::int AS days_waiting
  `;

  try {
    // Vidro em stock sem serviço agendado
    const { rows: stalledStock } = await pool.query(`
      SELECT ${cols}
      FROM appointments a
      LEFT JOIN portals po ON po.id = a.portal_id
      WHERE a.status = 'ST'
        AND COALESCE(a.executed, false) = false
        AND a.date IS NULL
        AND a.updated_at < NOW() - ($1 || ' days')::interval
        ${portalFilter}
      ORDER BY a.updated_at ASC
      LIMIT 200
    `, [stockDays, ...baseVals]);

    // Vidro encomendado sem receção
    const { rows: pendingOrders } = await pool.query(`
      SELECT ${cols}
      FROM appointments a
      LEFT JOIN portals po ON po.id = a.portal_id
      WHERE a.status = 'VE'
        AND COALESCE(a.executed, false) = false
        AND a.updated_at < NOW() - ($1 || ' days')::interval
        ${portalFilter}
      ORDER BY a.updated_at ASC
      LIMIT 200
    `, [orderDays, ...baseVals]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: { stalled_stock: stalledStock, pending_orders: pendingOrders, stock_days: stockDays, order_days: orderDays }
      })
    };
  } catch (e) {
    console.error('glass-alerts error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
