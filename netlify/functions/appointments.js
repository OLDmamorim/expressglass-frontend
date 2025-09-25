// netlify/functions/appointments.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // ---------- GET ----------
    if (event.httpMethod === 'GET') {
      const q = `
        SELECT id, date, period, plate, car, service, locality, status,
               notes, address, extra, phone, km, sortIndex, created_at, updated_at
        FROM appointments
        ORDER BY date ASC NULLS LAST, sortIndex ASC NULLS LAST, created_at ASC
      `;
      const { rows } = await pool.query(q);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    // ---------- POST ----------
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');

      if (!data.plate || !data.car || !data.service || !data.locality) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Campos obrigatórios: plate, car, service, locality' }) };
      }

      const q = `
        INSERT INTO appointments (
          date, period, plate, car, service, locality, status,
          notes, address, extra, phone, km, sortIndex, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        ) RETURNING *
      `;
      const v = [
        data.date || null,
        data.period || null,
        String(data.plate).trim(),
        String(data.car).trim(),
        data.service || null,
        data.locality || null,
        data.status || 'NE',
        data.notes || null,
        data.address || null,
        data.extra || null,
        data.phone || null,
        data.km || null,                    // ← NOVO: quilómetros
        data.sortIndex || 1,                // ← NOVO: ordem (default 1)
        new Date().toISOString(),
        new Date().toISOString()
      ];

      const { rows } = await pool.query(q, v);
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ---------- PUT ----------
    if (event.httpMethod === 'PUT') {
      const id = (event.path || '').split('/').pop();
      const data = JSON.parse(event.body || '{}');

      const q = `
        UPDATE appointments SET
          date = $1, period = $2, plate = $3, car = $4,
          service = $5, locality = $6, status = $7,
          notes = $8, address = $9, extra = $10, phone = $11,
          km = $12, sortIndex = $13, updated_at = $14
        WHERE id = $15
        RETURNING *
      `;
      const v = [
        data.date || null,
        data.period || null,
        data.plate ? String(data.plate).trim() : null,
        data.car ? String(data.car).trim() : null,
        data.service || null,
        data.locality || null,
        data.status || 'NE',
        data.notes || null,
        data.address || null,
        data.extra || null,
        data.phone || null,
        data.km || null,                    // ← NOVO: quilómetros
        data.sortIndex || null,             // ← NOVO: ordem na rota
        new Date().toISOString(),
        id
      ];

      const { rows } = await pool.query(q, v);
      if (!rows.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ---------- DELETE ----------
    if (event.httpMethod === 'DELETE') {
      const id = (event.path || '').split('/').pop();
      const { rows } = await pool.query('DELETE FROM appointments WHERE id = $1 RETURNING *', [id]);
      if (!rows.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: `Método ${event.httpMethod} não permitido` }) };

  } catch (err) {
    console.error('Erro na function appointments:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};