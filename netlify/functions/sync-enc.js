// netlify/functions/sync-enc.js
// Syncs order numbers (numeros_encomendas) and reception numbers
// (numeros_rececao_mercadorias) from PHC Excel export into appointments.
// Matched by plate (normalised) + portal_id (armazem).
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function normalizeOrderRef(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith('enc.axial')) return s;
  if (/^\d+$/.test(s)) return `Enc.Axial ${s}`;
  return s;
}

function verifyToken(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  if (!h.startsWith('Bearer ')) throw new Error('Não autenticado');
  const decoded = jwt.verify(h.substring(7), JWT_SECRET);
  if (!['admin', 'coordenador', 'coordinator'].includes(decoded.role)) throw new Error('Acesso negado');
  return decoded;
}

function normPlate(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };

  try {
    verifyToken(event);
    const { rows } = JSON.parse(event.body || '{}');
    if (!Array.isArray(rows) || rows.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Nenhum dado para sincronizar' }) };
    }

    const results = { updated: 0, not_found: 0, skipped: 0, details: [] };

    for (const row of rows) {
      const { plate, portal_id, enc, rec, ref } = row;
      if (!plate || !portal_id) { results.skipped++; continue; }

      // Find appointment by normalised plate + portal_id
      const { rows: found } = await pool.query(
        `SELECT id, status, order_ref, reception_ref, glass_eurocode
         FROM appointments
         WHERE portal_id = $1
           AND UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) = $2
         ORDER BY date DESC NULLS LAST, created_at DESC
         LIMIT 1`,
        [parseInt(portal_id), normPlate(plate)]
      );

      if (!found.length) {
        results.not_found++;
        results.details.push({ plate, status: 'not_found' });
        continue;
      }

      const apt = found[0];
      const updates = [];
      const vals = [];
      let idx = 1;

      if (enc && !apt.order_ref) {
        updates.push(`order_ref = $${idx++}`); vals.push(normalizeOrderRef(enc));
      }
      if (rec && !apt.reception_ref) {
        updates.push(`reception_ref = $${idx++}`); vals.push(String(rec));
      }
      if (ref && !apt.glass_eurocode) {
        updates.push(`glass_eurocode = $${idx++}`); vals.push(String(ref));
      }

      // Status upgrade: rec → ST, enc-only + current NE → VE
      let newStatus = null;
      if (rec && apt.status !== 'ST') newStatus = 'ST';
      else if (enc && !rec && apt.status === 'NE') newStatus = 'VE';
      if (newStatus) { updates.push(`status = $${idx++}`); vals.push(newStatus); }

      if (!updates.length) { results.skipped++; continue; }

      updates.push(`updated_at = NOW()`);
      vals.push(apt.id);

      await pool.query(
        `UPDATE appointments SET ${updates.join(', ')} WHERE id = $${idx}`,
        vals
      );

      results.updated++;
      results.details.push({ plate, status: 'updated', enc, rec, newStatus });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...results }) };
  } catch (err) {
    console.error('sync-enc:', err);
    return { statusCode: err.message.includes('autenticado') || err.message.includes('negado') ? 401 : 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
