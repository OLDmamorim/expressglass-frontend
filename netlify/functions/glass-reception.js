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

  let client;
  try {
    client = await pool.connect();
    const user = verifyToken(event);
    await ensureTable(client);

    // ── GET ────────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const p = event.queryStringParameters || {};

      // ── List portals accessible to this user (for history dropdown) ──────────
      if (p.list_portals === 'true') {
        let pq, pVals;
        if (user.role === 'admin') {
          pq = `SELECT id, name FROM portals ORDER BY name`;
          pVals = [];
        } else {
          const ids = user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []);
          pq = `SELECT id, name FROM portals WHERE id = ANY($1) ORDER BY name`;
          pVals = [ids];
        }
        const { rows: pRows } = await client.query(pq, pVals);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: pRows }) };
      }

      // ── History query ─────────────────────────────────────────────────────────
      if (p.history === 'true') {
        let hq = `
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
        const hVals = [];
        let hIdx = 1;

        // Portal access control
        if (user.role === 'user') {
          hq += ` AND gr.portal_id = $${hIdx++}`; hVals.push(user.portalId);
        } else if (user.role !== 'admin') {
          const ids = user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []);
          if (ids.length) { hq += ` AND gr.portal_id = ANY($${hIdx++})`; hVals.push(ids); }
        }

        if (p.portal_id) { hq += ` AND gr.portal_id = $${hIdx++}`; hVals.push(parseInt(p.portal_id)); }
        if (p.from_date) { hq += ` AND gr.created_at >= $${hIdx++}`; hVals.push(p.from_date); }
        if (p.to_date)   { hq += ` AND gr.created_at < ($${hIdx++}::date + INTERVAL '1 day')`; hVals.push(p.to_date); }
        if (p.search) {
          const s = '%' + p.search.trim().toLowerCase() + '%';
          hq += ` AND (LOWER(gr.eurocode) LIKE $${hIdx} OR LOWER(gr.order_ref) LIKE $${hIdx} OR LOWER(a.plate) LIKE $${hIdx})`;
          hVals.push(s); hIdx++;
        }

        hq += ` ORDER BY gr.created_at DESC LIMIT 1000`;
        const { rows: hRows } = await client.query(hq, hVals);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: hRows }) };
      }

      // ── By appointment IDs (for scan results status check) ───────────────────
      if (p.appointment_ids) {
        const ids = String(p.appointment_ids).split(',').map(Number).filter(Boolean);
        if (!ids.length) return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
        const { rows: recRows } = await client.query(
          `SELECT id, appointment_id, status FROM glass_receptions WHERE appointment_id = ANY($1) ORDER BY created_at DESC`,
          [ids]
        );
        // Return latest reception per appointment_id
        const latest = {};
        recRows.forEach(r => { if (!latest[r.appointment_id]) latest[r.appointment_id] = r; });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: Object.values(latest) }) };
      }

      // ── Default: pending list ─────────────────────────────────────────────────
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

      // When admin (no portalId) links to an appointment, resolve portal from the appointment
      let resolvedPortalId = user.portalId || null;
      let resolvedPortalName = d.portal_name || null;
      if (d.appointment_id && !resolvedPortalId) {
        const aptRow = await client.query(
          `SELECT a.portal_id, p.name AS portal_name FROM appointments a LEFT JOIN portals p ON p.id = a.portal_id WHERE a.id = $1`,
          [d.appointment_id]
        );
        if (aptRow.rows.length) {
          resolvedPortalId = aptRow.rows[0].portal_id || resolvedPortalId;
          resolvedPortalName = resolvedPortalName || aptRow.rows[0].portal_name;
        }
      }

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
        resolvedPortalId, resolvedPortalName,
        status
      ]);

      // When glass is matched to an appointment: set status ST (received) and propagate order_ref
      if (d.appointment_id) {
        await client.query(
          `UPDATE appointments SET status = 'ST', updated_at = NOW() WHERE id = $1`,
          [d.appointment_id]
        );
        if (d.order_ref) {
          await client.query(
            `UPDATE appointments SET order_ref = $1 WHERE id = $2 AND (order_ref IS NULL OR order_ref = '')`,
            [d.order_ref, d.appointment_id]
          );
        }
        if (d.eurocode) {
          await client.query(
            `UPDATE appointments SET glass_eurocode = $1 WHERE id = $2 AND (glass_eurocode IS NULL OR glass_eurocode = '')`,
            [d.eurocode, d.appointment_id]
          );
        }
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

    // ── DELETE ─────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const id = body.id || (event.path || '').split('/').filter(Boolean).pop();
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'ID obrigatório' }) };
      if (!['admin', 'coordenador', 'coordinator'].includes(user.role)) {
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };
      }
      await client.query(`DELETE FROM glass_receptions WHERE id = $1`, [parseInt(id)]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };

  } catch (err) {
    console.error('glass-reception:', err);
    const code = err.message.includes('autenticado') ? 401 : 500;
    return { statusCode: code, headers, body: JSON.stringify({ success: false, error: err.message }) };
  } finally {
    if (client) client.release();
  }
};
