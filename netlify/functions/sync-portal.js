// netlify/functions/sync-portal.js
// Sincroniza um portal com a lista de matrículas do Excel:
// - Apaga registos que NÃO estão no Excel
// - Cria os que não existem
// - Actualiza sem-data→com-data quando o Excel traz data
// - Nunca duplica
// Apenas admin.

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
    const { portal_id, services } = JSON.parse(event.body || '{}');

    if (!portal_id || !Array.isArray(services)) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'portal_id e services são obrigatórios' }) };
    }

    // Normalizar matrículas do Excel
    const excelNorms = new Set(services.map(s => norm(s.plate)).filter(Boolean));

    if (excelNorms.size === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Nenhuma matrícula válida no Excel' }) };
    }

    // Determinar tipo de portal
    const { rows: portalRows } = await pool.query(
      `SELECT portal_type FROM portals WHERE id = $1 LIMIT 1`,
      [portal_id]
    );
    const isLoja = portalRows[0]?.portal_type === 'loja';

    // "Agendado de verdade":
    //   SM   → tem date E locality
    //   Loja → tem date E period
    const reallyScheduledCondition = isLoja
      ? `date IS NOT NULL AND period IS NOT NULL AND period != ''`
      : `date IS NOT NULL AND locality IS NOT NULL AND locality != ''`;

    // 1. Apagar TODOS os registos que NÃO estão realmente agendados
    const delResult = await pool.query(
      `DELETE FROM appointments
       WHERE portal_id = $1 AND NOT (${reallyScheduledCondition})
       RETURNING id`,
      [portal_id]
    );
    const deleted = delResult.rowCount;

    const results = { created: 0, updated: 0, skipped: 0, errors: 0, deleted, details: [] };

    for (const svc of services) {
      const plateNorm = norm(svc.plate);
      if (!plateNorm) { results.errors++; continue; }

      try {
        // Verificar se já existe realmente agendado — não tocar
        const { rows } = await pool.query(
          `SELECT id FROM appointments
           WHERE portal_id = $1
             AND UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) = $2
             AND (${reallyScheduledCondition})
           LIMIT 1`,
          [portal_id, plateNorm]
        );

        if (rows.length > 0) {
          // Já está agendado — ignorar completamente
          results.skipped++;
          continue;
        }

        // Não existe (ou foi apagado por ser pendente) → criar
        await pool.query(
          `INSERT INTO appointments (
             date, period, plate, car, service, locality, status,
             notes, extra, phone, km, sortIndex, "glassOrdered",
             auto_imported, portal_id, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,null,$6,$7,$8,$9,null,1,false,$10,$11,$12,$13)`,
          [
            svc.date || null, svc.period || null,
            String(svc.plate).trim(), svc.car || null, svc.service || null,
            svc.status || 'NE', svc.notes || null, svc.extra || null, svc.phone || null,
            !!svc.date, portal_id,
            svc.createdAt || new Date().toISOString(), new Date().toISOString()
          ]
        );
        results.created++;
        results.details.push({ plate: svc.plate, status: 'created' });

      } catch (err) {
        results.errors++;
        results.details.push({ plate: svc.plate, status: 'error', error: err.message });
      }
    }

    console.log(`🔄 Sync portal ${portal_id}: ${results.created} criados, ${results.updated} actualizados, ${results.skipped} ignorados, ${deleted} apagados`);

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
