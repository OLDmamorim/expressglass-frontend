// netlify/functions/sync-portal.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function norm(plate) {
  return String(plate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'POST only' }) };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) throw new Error('Sem token');
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Apenas admin');
  } catch (e) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }

  try {
    const { portal_id, services } = JSON.parse(event.body || '{}');

    if (!portal_id || !Array.isArray(services)) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'portal_id e services são obrigatórios' }) };
    }

    const excelNorms = new Set(services.map(s => norm(s.plate)).filter(Boolean));
    if (excelNorms.size === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Nenhuma matrícula válida no Excel' }) };
    }

    const { rows: portalRows } = await pool.query(
      `SELECT portal_type FROM portals WHERE id = $1 LIMIT 1`,
      [portal_id]
    );
    const isLoja = portalRows[0]?.portal_type === 'loja';

    // Apagar pendentes (sem data) que não estão no Excel
    const delResult = await pool.query(
      `DELETE FROM appointments WHERE portal_id = $1 AND date IS NULL RETURNING id`,
      [portal_id]
    );
    const deleted = delResult.rowCount;

    const results = { created: 0, updated: 0, skipped: 0, errors: 0, deleted };
    const todayISO = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    for (const svc of services) {
      const plateNorm = norm(svc.plate);
      if (!plateNorm) { results.errors++; continue; }

      try {
        const { rows } = await pool.query(
          `SELECT id, date FROM appointments
           WHERE portal_id = $1
             AND UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) = $2
             AND date IS NOT NULL
           LIMIT 1`,
          [portal_id, plateNorm]
        );

        if (rows.length > 0) {
          // Já agendado — atualizar dados e data se necessário
          const existing = rows[0];
          const existingDate = existing.date ? String(existing.date).slice(0, 10) : null;
          const excelDate = svc.date ? String(svc.date).slice(0, 10) : null;
          const shouldUpdateDate = excelDate && excelDate >= todayISO && (!existingDate || existingDate < todayISO);

          if (shouldUpdateDate) {
            await pool.query(
              `UPDATE appointments SET date=$1, period=$2, car=$3, notes=$4, extra=$5, phone=$6, client_name=$7, auto_imported=true, confirmed=false, updated_at=$8 WHERE id=$9`,
              [excelDate, svc.period||null, svc.car||null, svc.notes||null, svc.extra||null, svc.phone||null, svc.client_name||null, now, existing.id]
            );
          } else {
            await pool.query(
              `UPDATE appointments SET car=$1, notes=$2, extra=$3, phone=$4, client_name=$5, updated_at=$6 WHERE id=$7`,
              [svc.car||null, svc.notes||null, svc.extra||null, svc.phone||null, svc.client_name||null, now, existing.id]
            );
          }
          results.updated++;
          continue;
        }

        // Não existe → criar
        await pool.query(
          `INSERT INTO appointments (
             date, period, plate, car, service, locality, status,
             notes, extra, phone, client_name, km, sortIndex, "glassOrdered",
             auto_imported, confirmed, portal_id, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,null,$6,$7,$8,$9,$10,null,1,false,$11,false,$12,$13,$14)`,
          [
            svc.date||null, svc.period||null,
            String(svc.plate).trim(), svc.car||null, svc.service||null,
            svc.status||'NE', svc.notes||null, svc.extra||null, svc.phone||null,
            svc.client_name||null,
            !!svc.date, portal_id,
            svc.createdAt||now, now
          ]
        );
        results.created++;

      } catch (err) {
        console.error('Erro svc', svc.plate, err.message);
        results.errors++;
      }
    }

    console.log(`🔄 Sync portal ${portal_id}: ${results.created} criados, ${results.updated} atualizados, ${results.skipped} ignorados, ${deleted} apagados`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: results })
    };

  } catch (error) {
    console.error('❌ Erro sync-portal:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
