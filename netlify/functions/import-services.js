// netlify/functions/import-services.js
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  }

  try {
    verifyAdmin(event);
    const { services } = JSON.parse(event.body || '{}');

    if (!services || !Array.isArray(services) || services.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Nenhum serviço para importar' }) };
    }

    const results = { created: 0, updated: 0, skipped: 0, errors: 0, details: [] };

    // Garantir colunas car e n_obra em mycar_services
    try {
      await pool.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS car TEXT`);
      await pool.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS n_obra VARCHAR(50)`);
    } catch(e) { console.warn('Migration mycar_services warning:', e.message); }

    for (const svc of services) {
      try {
        if (!svc.portal_id || !svc.plate) {
          results.errors++;
          results.details.push({ plate: svc.plate || '?', status: 'error', error: 'portal_id ou matrícula em falta' });
          continue;
        }

        // Verificar se já existe
        const existing = await pool.query(
          `SELECT id, date, period, car, phone, extra, notes, auto_imported, confirmed, status, order_ref, reception_ref
           FROM appointments
           WHERE portal_id = $1
           AND UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) = UPPER(REGEXP_REPLACE($2, '[^A-Z0-9]', '', 'g'))
           LIMIT 1`,
          [svc.portal_id, String(svc.plate).trim()]
        );

        if (existing.rows.length > 0) {
          // ── SERVIÇO JÁ EXISTE ──
          const row = existing.rows[0];
          const hasDateInDB = !!row.date;
          const hasDateInExcel = !!svc.date;

          const updateFields = [];
          const updateVals = [];
          let idx = 1;

          // Actualizar carro se Excel tem valor
          if (svc.car && svc.car !== 'Sem modelo') {
            updateFields.push(`car = $${idx++}`);
            updateVals.push(svc.car);
          }
          // Actualizar phone se Excel tem valor (sobrescrever)
          if (svc.phone) {
            updateFields.push(`phone = $${idx++}`);
            updateVals.push(svc.phone);
          }
          // Actualizar extra (segurado/nome) se Excel tem valor
          if (svc.extra) {
            updateFields.push(`extra = $${idx++}`);
            updateVals.push(svc.extra);
          }
          // Actualizar notes (eurocode) se Excel tem valor
          if (svc.notes) {
            updateFields.push(`notes = $${idx++}`);
            updateVals.push(svc.notes);
          }
          // Actualizar damage_details se Excel tem valor
          if (svc.damage_details) {
            updateFields.push(`damage_details = $${idx++}`);
            updateVals.push(svc.damage_details);
          }
          // Actualizar n_obra se Excel tem valor
          if (svc.n_obra) {
            updateFields.push(`n_obra = $${idx++}`);
            updateVals.push(svc.n_obra);
          }

          // Actualizar order_ref se Excel tem valor e BD está vazio
          if (svc.order_ref && !row.order_ref) {
            updateFields.push(`order_ref = $${idx++}`);
            updateVals.push(svc.order_ref);
          }
          // Actualizar reception_ref se Excel tem valor e BD está vazio
          if (svc.reception_ref && !row.reception_ref) {
            updateFields.push(`reception_ref = $${idx++}`);
            updateVals.push(svc.reception_ref);
          }
          // Status upgrade baseado em enc/rec
          const newStatusUpgrade = svc.reception_ref && row.status !== 'ST' ? 'ST'
            : (svc.order_ref && !svc.reception_ref && row.status === 'NE' ? 'VE' : null);
          if (newStatusUpgrade) {
            updateFields.push(`status = $${idx++}`);
            updateVals.push(newStatusUpgrade);
          }

          // Se NÃO está na agenda mas Excel tem data → colocar na agenda
          if (!hasDateInDB && hasDateInExcel) {
            updateFields.push(`date = $${idx++}`);
            updateVals.push(svc.date);
            updateFields.push(`period = $${idx++}`);
            updateVals.push(svc.period || null);
            updateFields.push(`auto_imported = $${idx++}`);
            updateVals.push(true);
            updateFields.push(`confirmed = $${idx++}`);
            updateVals.push(false);
          }
          // Se JÁ está na agenda → nunca mexer em date/period/confirmed

          if (updateFields.length > 0) {
            updateFields.push(`updated_at = $${idx++}`);
            updateVals.push(new Date().toISOString());
            updateVals.push(row.id);
            await pool.query(
              `UPDATE appointments SET ${updateFields.join(', ')} WHERE id = $${idx}`,
              updateVals
            );
            results.updated++;
            results.details.push({
              plate: svc.plate,
              portal_id: svc.portal_id,
              status: 'updated',
              reason: !hasDateInDB && hasDateInExcel ? 'agendado + dados atualizados' : 'dados atualizados'
            });
          } else {
            results.skipped++;
            results.details.push({ plate: svc.plate, portal_id: svc.portal_id, status: 'skipped' });
          }

        } else {
          // ── SERVIÇO NOVO ──
          const hasAutoDate = !!svc.date;

          const insertStatus = svc.reception_ref ? 'ST' : (svc.order_ref ? 'VE' : (svc.status || 'NE'));
          await pool.query(
            `INSERT INTO appointments (
              date, period, plate, car, service, locality, status,
              notes, address, extra, phone, km, sortIndex, "glassOrdered",
              auto_imported, confirmed, damage_details, n_obra, order_ref, reception_ref, portal_id, created_at, updated_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
            ) RETURNING id`,
            [
              svc.date || null,
              svc.period || null,
              String(svc.plate).trim(),
              svc.car || null,
              svc.service || null,
              null,           // locality
              insertStatus,
              svc.notes || null,
              null,           // address
              svc.extra || null,
              svc.phone || null,
              null,           // km
              1,              // sortIndex
              false,          // glassOrdered
              hasAutoDate,    // auto_imported
              false,          // confirmed
              svc.damage_details || null,
              svc.n_obra || null,
              svc.order_ref || null,
              svc.reception_ref || null,
              svc.portal_id,
              svc.createdAt || new Date().toISOString(),
              new Date().toISOString()
            ]
          );

          results.created++;
          results.details.push({ plate: svc.plate, portal_id: svc.portal_id, status: 'created' });
        }

        // Atualizar mycar_services com car e n_obra se a matrícula constar no mural
        if (svc.car || svc.n_obra) {
          const myCols = [];
          const myVals = [];
          let myIdx = 1;
          if (svc.car) { myCols.push(`car = $${myIdx++}`); myVals.push(svc.car); }
          if (svc.n_obra) { myCols.push(`n_obra = $${myIdx++}`); myVals.push(svc.n_obra); }
          myCols.push(`updated_at = $${myIdx++}`);
          myVals.push(new Date().toISOString());
          myVals.push(String(svc.plate).replace(/[^A-Z0-9]/gi, '').toUpperCase());
          try {
            await pool.query(
              `UPDATE mycar_services
               SET ${myCols.join(', ')}
               WHERE UPPER(REGEXP_REPLACE(matricula, '[^A-Z0-9]', '', 'g')) = $${myIdx}`,
              myVals
            );
          } catch(e) { console.warn('mycar_services update warning:', e.message); }
        }

      } catch (err) {
        results.errors++;
        results.details.push({ plate: svc.plate || '?', status: 'error', error: err.message });
      }
    }

    console.log(`📥 Importação: ${results.created} criados, ${results.updated} atualizados, ${results.skipped} sem alteração, ${results.errors} erros`);

    // Atualizar data da última importação nos portais afetados
    const affectedPortals = new Set(services.map(s => s.portal_id).filter(Boolean));
    for (const portalId of affectedPortals) {
      try {
        await pool.query('UPDATE portals SET last_import_at = $1 WHERE id = $2', [new Date().toISOString(), portalId]);
      } catch (e) {
        console.warn('Erro ao atualizar last_import_at:', e);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: results }) };

  } catch (error) {
    console.error('❌ Erro na importação:', error);
    if (error.message.includes('Não autenticado') || error.message.includes('Acesso negado')) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Erro interno do servidor' }) };
  }
};
