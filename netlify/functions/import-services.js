// netlify/functions/import-services.js
// Importação em massa de serviços a partir do Excel (admin-only)
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function verifyAdmin(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  const token = authHeader.substring(7);
  const decoded = jwt.verify(token, JWT_SECRET);
  if (decoded.role !== 'admin') throw new Error('Acesso negado: apenas administradores');
  return decoded;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  }

  try {
    verifyAdmin(event);

    const { services } = JSON.parse(event.body || '{}');

    if (!services || !Array.isArray(services) || services.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Nenhum serviço para importar' }) };
    }

    const results = { created: 0, updated: 0, errors: 0, details: [] };

    for (const svc of services) {
      try {
        if (!svc.portal_id || !svc.plate) {
          results.errors++;
          results.details.push({ plate: svc.plate || '?', status: 'error', error: 'portal_id ou matrícula em falta' });
          continue;
        }

        // Se já existe em qualquer estado → ignorar sempre (incluindo ST)
        const existing = await pool.query(
          `SELECT id FROM appointments 
           WHERE portal_id = $1
             AND UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) = UPPER(REGEXP_REPLACE($2, '[^A-Z0-9]', '', 'g'))
           LIMIT 1`,
          [svc.portal_id, String(svc.plate).trim()]
        );

        if (existing.rows.length > 0) {
          results.skipped = (results.skipped || 0) + 1;
          results.details.push({ plate: svc.plate, portal_id: svc.portal_id, status: 'skipped' });
        } else {
          // Criar novo serviço
          const hasAutoDate = !!svc.date;
          const insertQ = `
            INSERT INTO appointments (
              date, period, plate, car, service, locality, status,
              notes, address, extra, phone, km, sortIndex, "glassOrdered",
              auto_imported, portal_id, created_at, updated_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
            ) RETURNING id
          `;
          await pool.query(insertQ, [
            svc.date || null,
            svc.period || null,
            String(svc.plate).trim(),
            svc.car || null,
            svc.service || null,
            null,                           // locality
            svc.status || 'NE',
            svc.notes || null,
            null,                           // address
            svc.extra || null,
            svc.phone || null,
            null,                           // km
            1,                              // sortIndex
            false,                          // glassOrdered
            hasAutoDate,                    // auto_imported: true se veio com data do Excel
            svc.portal_id,
            svc.createdAt || new Date().toISOString(),
            new Date().toISOString()
          ]);
          results.created++;
          results.details.push({ plate: svc.plate, portal_id: svc.portal_id, status: 'created' });
        }
      } catch (err) {
        results.errors++;
        results.details.push({ plate: svc.plate || '?', status: 'error', error: err.message });
      }
    }

    console.log(`📥 Importação: ${results.created} criados, ${results.updated} atualizados, ${results.errors} erros`);

    // Atualizar data da última importação nos portais afetados
    const affectedPortals = new Set(services.map(s => s.portal_id).filter(Boolean));
    for (const portalId of affectedPortals) {
      try {
        await pool.query(
          'UPDATE portals SET last_import_at = $1 WHERE id = $2',
          [new Date().toISOString(), portalId]
        );
      } catch (e) {
        console.warn('Erro ao atualizar last_import_at:', e);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: results })
    };

  } catch (error) {
    console.error('❌ Erro na importação:', error);
    if (error.message.includes('Não autenticado') || error.message.includes('Acesso negado')) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Erro interno do servidor' }) };
  }
};
