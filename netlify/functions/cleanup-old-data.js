// netlify/functions/cleanup-old-data.js
// Corre automaticamente uma vez por dia (via Netlify Scheduled Functions)
// Apaga agendamentos realizados há mais de 6 meses

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const RETENTION_MONTHS = 6;

exports.handler = async (event) => {
  // Aceitar chamada manual (GET com token) ou automática (scheduled)
  const isScheduled = event.source === 'scheduled';
  const isManual = event.httpMethod === 'POST';

  if (!isScheduled && !isManual) {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    // Apagar agendamentos realizados há mais de 6 meses
    const { rowCount: apptDeleted } = await pool.query(`
      DELETE FROM appointments
      WHERE (executed = true OR status = 'RE')
        AND date < $1::date
    `, [cutoffISO]);

    // Apagar pedidos comerciais fechados há mais de 6 meses
    const { rowCount: crDeleted } = await pool.query(`
      DELETE FROM commercial_requests
      WHERE status IN ('done', 'cancelled')
        AND updated_at < NOW() - INTERVAL '${RETENTION_MONTHS} months'
    `);

    // Apagar logs de auditoria com mais de 1 ano
    const { rowCount: auditDeleted } = await pool.query(`
      DELETE FROM audit_log
      WHERE created_at < NOW() - INTERVAL '12 months'
    `);

    // Registar na auditoria
    await pool.query(`
      INSERT INTO audit_log (username, action, details, created_at)
      VALUES ('system', 'data_cleanup', $1, NOW())
    `, [JSON.stringify({
      cutoff: cutoffISO,
      appointments_deleted: apptDeleted,
      commercial_requests_deleted: crDeleted,
      audit_logs_deleted: auditDeleted
    })]);

    console.log(`[cleanup] appointments: ${apptDeleted}, commercial_requests: ${crDeleted}, audit_logs: ${auditDeleted}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        cutoff: cutoffISO,
        deleted: {
          appointments: apptDeleted,
          commercial_requests: crDeleted,
          audit_logs: auditDeleted
        }
      })
    };

  } catch (e) {
    console.error('[cleanup]', e.message);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
