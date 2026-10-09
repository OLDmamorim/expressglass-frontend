// audit-log.js — Netlify Function para consultar logs de auditoria
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const auth = event.headers?.authorization || '';
    const decoded = jwt.verify(auth.substring(7), JWT_SECRET);

    const p = event.queryStringParameters || {};
    const entity    = p.entity    || null;
    const entity_id = p.entity_id || null;

    // O histórico de UM serviço é visível a quem já consegue abrir o cartão —
    // é o registo do trabalho deles. A consulta livre do log continua só para
    // admin, porque aí dá para varrer a actividade de toda a gente.
    const historicoDeUmServico = entity === 'appointment' && entity_id;
    if (!historicoDeUmServico && decoded.role !== 'admin') throw new Error('Acesso negado');

    // ...mas "quem consegue abrir o cartão" tem de ser verificado: sem isto,
    // qualquer utilizador autenticado leria o histórico de qualquer serviço,
    // incluindo morada, cliente e telefone de portais a que não tem acesso.
    if (historicoDeUmServico && decoded.role !== 'admin') {
      const { rows: apptRows } = await pool.query(
        'SELECT portal_id FROM appointments WHERE id = $1 LIMIT 1',
        [entity_id]
      );
      if (!apptRows.length) throw new Error('Agendamento não encontrado');
      const permitidos = new Set([
        ...(decoded.portalIds || []),
        ...(decoded.consultablePortalIds || []),
        ...(decoded.portalId ? [decoded.portalId] : [])
      ]);
      if (!permitidos.has(apptRows[0].portal_id)) throw new Error('Acesso negado');
    }

    const page   = parseInt(p.page  || '1');
    const limit  = parseInt(p.limit || '50');
    const action = p.action || null;
    const user   = p.user   || null;
    const offset = (page - 1) * limit;

    let where = [];
    let vals  = [];
    let i     = 1;

    if (entity)    { where.push(`entity = $${i++}`);    vals.push(entity); }
    if (entity_id) { where.push(`entity_id = $${i++}`); vals.push(String(entity_id)); }
    if (action) { where.push(`action = $${i++}`); vals.push(action); }
    if (user)   { where.push(`(username ILIKE $${i} OR CAST(user_id AS TEXT) = $${i+1})`); vals.push(`%${user}%`); vals.push(user); i += 2; }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const { rows } = await pool.query(`
      SELECT id, user_id, username, action, entity, entity_id, details, ip, user_agent, created_at
      FROM audit_log
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `, [...vals, limit, offset]);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM audit_log ${whereClause}`, vals
    );

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        data: rows,
        total: parseInt(countRows[0].count),
        page, limit
      })
    };

  } catch (e) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
