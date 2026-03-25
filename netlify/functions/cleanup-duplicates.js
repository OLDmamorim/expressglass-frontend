// netlify/functions/cleanup-duplicates.js
// Remove agendamentos duplicados (mesma matrícula + portal + status != ST)
// Mantém o registo mais antigo (menor id). Apenas admin.

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Auth — apenas admin
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) throw new Error('Sem token');
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Apenas admin');
  } catch (e) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }

  try {
    // GET — apenas pré-visualizar duplicados sem apagar
    if (event.httpMethod === 'GET') {
      // Contar total de registos para diagnóstico
      const { rows: countRows } = await pool.query(`SELECT COUNT(*) as total FROM appointments`);
      const totalRecords = parseInt(countRows[0].total);

      const { rows } = await pool.query(`
        SELECT
          portal_id,
          date,
          UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) AS plate_norm,
          COUNT(*) AS total,
          ARRAY_AGG(id ORDER BY id ASC) AS ids,
          ARRAY_AGG(plate ORDER BY id ASC) AS plates,
          ARRAY_AGG(status ORDER BY id ASC) AS statuses,
          ARRAY_AGG(created_at ORDER BY id ASC) AS created_ats
        FROM appointments
        GROUP BY portal_id, date, UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g'))
        HAVING COUNT(*) > 1
        ORDER BY total DESC
      `);

      const duplicates = rows.map(r => ({
        portal_id: r.portal_id,
        plate_norm: r.plate_norm,
        total: parseInt(r.total),
        keep_id: r.ids[0],           // mais antigo
        delete_ids: r.ids.slice(1),  // todos os outros
        plates: r.plates,
        statuses: r.statuses,
        created_ats: r.created_ats
      }));

      const totalToDelete = duplicates.reduce((sum, d) => sum + d.delete_ids.length, 0);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          totalRecords,
          duplicateGroups: duplicates.length,
          toDelete: totalToDelete,
          preview: duplicates
        })
      };
    }

    // POST — apagar duplicados
    if (event.httpMethod === 'POST') {
      // Encontrar todos os ids a apagar (incluindo os ST)
      const { rows } = await pool.query(`
        SELECT ARRAY_AGG(id ORDER BY id ASC) AS ids
        FROM appointments
        GROUP BY portal_id, date, UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g'))
        HAVING COUNT(*) > 1
      `);

      const idsToDelete = [];
      for (const row of rows) {
        // Mantém o primeiro (mais antigo), apaga os restantes
        idsToDelete.push(...row.ids.slice(1));
      }

      if (idsToDelete.length === 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, deleted: 0, message: 'Sem duplicados encontrados' })
        };
      }

      // 2. Apagar
      const result = await pool.query(
        `DELETE FROM appointments WHERE id = ANY($1) RETURNING id`,
        [idsToDelete]
      );

      console.log(`🧹 Limpeza: ${result.rows.length} duplicados removidos`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          deleted: result.rows.length,
          deletedIds: result.rows.map(r => r.id)
        })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };

  } catch (error) {
    console.error('❌ Erro cleanup-duplicates:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
