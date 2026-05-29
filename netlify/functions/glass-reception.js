// netlify/functions/glass-reception.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function verifyToken(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  if (!h.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(h.substring(7), JWT_SECRET);
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS glass_receptions (
      id           SERIAL PRIMARY KEY,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      order_ref    TEXT,
      eurocode     TEXT,
      raw_label_text TEXT,
      technician_id  INTEGER,
      technician_name TEXT,
      portal_id    INTEGER,
      portal_name  TEXT,
      status       VARCHAR(20) DEFAULT 'pending',
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const client = await pool.connect();
  try {
    const user = verifyToken(event);
    await ensureTable(client);

    // ── GET ────────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const p = event.queryStringParameters || {};

      let q = `
        SELECT gr.*,
               a.plate    AS apt_plate,
               a.car      AS apt_car,
               a.locality AS apt_locality,
               a.service  AS apt_service,
               a.date     AS apt_date,
               po.name    AS portal_label
        FROM glass_receptions gr
        LEFT JOIN appointments a  ON a.id = gr.appointment_id
        LEFT JOIN portals po      ON po.id = gr.portal_id
        WHERE 1=1
      `;
      const vals = [];
      let idx = 1;

      if (p.status) { q += ` AND gr.status = $${idx++}`; vals.push(p.status); }

      // Técnicos só vêem do seu portal
      if (user.role === 'user') { q += ` AND gr.portal_id = $${idx++}`; vals.push(user.portalId); }

      q += ` ORDER BY gr.created_at DESC LIMIT 300`;

      const { rows } = await client.query(q, vals);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    // ── POST ───────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const d = JSON.parse(event.body || '{}');
      const status = d.appointment_id ? 'confirmed' : 'pending';

      const { rows } = await client.query(`
        INSERT INTO glass_receptions
          (order_ref, eurocode, raw_label_text, appointment_id,
           technician_id, technician_name, portal_id, portal_name, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
      `, [
        d.order_ref || null, d.eurocode || null, d.raw_label_text || null,
        d.appointment_id || null,
        user.userId || user.id, user.username,
        user.portalId || null, d.portal_name || null,
        status
      ]);

      // Propagate order_ref to the appointment so coordinators can see it on the card
      if (d.appointment_id && d.order_ref) {
        await client.query(
          `UPDATE appointments SET order_ref = $1, updated_at = NOW() WHERE id = $2 AND (order_ref IS NULL OR order_ref = '')`,
          [d.order_ref, d.appointment_id]
        );
      }

      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ── PUT ────────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'PUT') {
      const d = JSON.parse(event.body || '{}');
      const id = d.id || (event.path || '').split('/').filter(Boolean).pop();

      const updates = ['updated_at = NOW()'];
      const vals = [];
      let idx = 1;

      if (d.appointment_id !== undefined) { updates.push(`appointment_id = $${idx++}`); vals.push(d.appointment_id); }
      if (d.status)                        { updates.push(`status = $${idx++}`);          vals.push(d.status); }
      vals.push(id);

      const { rows } = await client.query(
        `UPDATE glass_receptions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        vals
      );

      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Não encontrado' }) };

      // Ao marcar como received → muda status do agendamento para ST
      if (d.status === 'received' && rows[0].appointment_id) {
        await client.query(
          `UPDATE appointments SET status = 'ST', updated_at = NOW() WHERE id = $1`,
          [rows[0].appointment_id]
        );
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };

  } catch (err) {
    console.error('glass-reception:', err);
    const code = err.message.includes('autenticado') ? 401 : 500;
    return { statusCode: code, headers, body: JSON.stringify({ success: false, error: err.message }) };
  } finally {
    client.release();
  }
};
