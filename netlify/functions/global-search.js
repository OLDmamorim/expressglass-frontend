// netlify/functions/global-search.js
// Pesquisa global por matrícula (ou ref. encomenda/eurocode) em:
//  - appointments (agendamentos)
//  - glass_receptions (receções/devoluções de vidro)
//  - mycar_services (mural MyCar)
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

  const q = (event.queryStringParameters?.q || '').trim();
  if (q.length < 3) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Mínimo 3 caracteres' }) };
  }

  const plateNorm = '%' + q.toUpperCase().replace(/[^A-Z0-9]/g, '') + '%';
  // Texto (encomenda/eurocode/nº obra): comparação sem pontuação, para que
  // "51-621" ou "Rec.5548" encontrem "Enc.Axial 51621" / "Rec.5548".
  const textLike = '%' + q.toLowerCase().replace(/[^a-z0-9]/g, '') + '%';
  const normCol = col => `LOWER(REGEXP_REPLACE(COALESCE(${col},''), '[^a-zA-Z0-9]', '', 'g'))`;

  // Restrição de portais para coordenadores
  const coordIds = user.role === 'admin'
    ? null
    : (user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []));
  if (coordIds && !coordIds.length) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { appointments: [], receptions: [], mycar: [] } }) };
  }

  try {
    // Agendamentos
    let aq = `
      SELECT a.id, a.plate, a.car, a.date, a.period, a.status, a.service, a.locality,
             a.order_ref, a.reception_ref, a.n_obra, a.client_name, a.executed,
             po.name AS portal_name
      FROM appointments a
      LEFT JOIN portals po ON po.id = a.portal_id
      WHERE (UPPER(REGEXP_REPLACE(a.plate, '[^A-Z0-9]', '', 'g')) LIKE $1
             OR ${normCol('a.order_ref')} LIKE $2 OR ${normCol('a.n_obra')} LIKE $2
             OR ${normCol('a.extra::text')} LIKE $2 OR ${normCol('a.notes')} LIKE $2)
    `;
    const aVals = [plateNorm, textLike];
    if (coordIds) { aq += ` AND a.portal_id = ANY($3)`; aVals.push(coordIds); }
    aq += ` ORDER BY a.date DESC NULLS LAST, a.created_at DESC LIMIT 50`;
    const { rows: appointments } = await pool.query(aq, aVals);

    // Receções de vidro
    let rq = `
      SELECT gr.id, gr.created_at, gr.eurocode, gr.order_ref, gr.status,
             gr.is_return, gr.return_reason, gr.technician_name,
             a.plate AS apt_plate, a.car AS apt_car, po.name AS portal_label
      FROM glass_receptions gr
      LEFT JOIN appointments a ON a.id = gr.appointment_id
      LEFT JOIN portals po ON po.id = gr.portal_id
      WHERE (UPPER(REGEXP_REPLACE(COALESCE(a.plate,''), '[^A-Z0-9]', '', 'g')) LIKE $1
             OR ${normCol('gr.eurocode')} LIKE $2 OR ${normCol('gr.order_ref')} LIKE $2)
    `;
    const rVals = [plateNorm, textLike];
    if (coordIds) { rq += ` AND gr.portal_id = ANY($3)`; rVals.push(coordIds); }
    rq += ` ORDER BY gr.created_at DESC LIMIT 50`;
    const { rows: receptions } = await pool.query(rq, rVals);

    // Mural MyCar
    let mycar = [];
    try {
      const { rows } = await pool.query(`
        SELECT id, matricula, car, data_servico, status, n_obra, created_at
        FROM mycar_services
        WHERE UPPER(REGEXP_REPLACE(matricula, '[^A-Z0-9]', '', 'g')) LIKE $1
           OR ${normCol('n_obra')} LIKE $2
        ORDER BY created_at DESC LIMIT 50
      `, [plateNorm, textLike]);
      mycar = rows;
    } catch (e) {
      console.warn('global-search mycar query:', e.message);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { appointments, receptions, mycar } }) };
  } catch (e) {
    console.error('global-search error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
