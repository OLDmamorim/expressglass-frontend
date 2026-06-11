// netlify/functions/appointments.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function normalizeOrderRef(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith('enc.axial')) return s;
  if (/^\d+$/.test(s)) return `Enc.Axial ${s}`;
  return s;
}

function normalizeReceptionRef(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith('rec.')) return s;
  if (/^\d+$/.test(s)) return `Rec.${s}`;
  return s;
}

function getUserFromToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  const token = authHeader.substring(7);
  return jwt.verify(token, JWT_SECRET);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Auto-migração: garantir colunas novas sem precisar de correr SQL manual
  try {
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS glass_removed_date DATE`);
  } catch(migErr) { console.warn('Migration warning:', migErr.message); }

  try {
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS second_of_day BOOLEAN DEFAULT FALSE`);
  } catch(migErr) { console.warn('Migration second_of_day warning:', migErr.message); }

  try {
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS n_obra VARCHAR(50)`);
  } catch(migErr) { console.warn('Migration n_obra warning:', migErr.message); }

  try {
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS order_ref TEXT`);
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS glass_eurocode TEXT`);
  } catch(migErr) { console.warn('Migration order_ref/eurocode warning:', migErr.message); }

  try {
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS not_done_at TIMESTAMPTZ`);
  } catch(migErr) { console.warn('Migration not_done_at warning:', migErr.message); }

  try {
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reception_ref TEXT`);
  } catch(migErr) { console.warn('Migration reception_ref warning:', migErr.message); }

  try {
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS comp_sales_desc TEXT`);
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS comp_sales_nif VARCHAR(20)`);
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS comp_sales_name VARCHAR(255)`);
    await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS comp_sales_faturado BOOLEAN DEFAULT FALSE`);
  } catch(migErr) { console.warn('Migration comp_sales warning:', migErr.message); }

  // Migração: actualizar constraint de service para incluir RV e OUT
  try {
    await pool.query(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_service_check`);
    await pool.query(`ALTER TABLE appointments ADD CONSTRAINT appointments_service_check CHECK (service IS NULL OR service IN ('PB', 'LT', 'OC', 'REP', 'POL', 'RV', 'OUT'))`);
  } catch(migErr) { console.warn('Migration service_check warning:', migErr.message); }

  try {
    const user = getUserFromToken(event);
    let portalId = user.portalId;
    const params = event.queryStringParameters || {};

    if (user.role === 'admin') {
      const reqId = params.portal_id
        ? parseInt(params.portal_id)
        : (() => { try { return JSON.parse(event.body || '{}')._portalId; } catch(e) { return null; } })();
      if (reqId) portalId = reqId;
    } else if (user.role === 'coordenador' || user.role === 'coordinator' || user.role === 'comercial') {
      let requestedId = params.portal_id ? parseInt(params.portal_id) : null;
      if (!requestedId && event.body) {
        try { requestedId = JSON.parse(event.body)._portalId; } catch(e) { console.warn('appointments _portalId parse warning:', e.message); }
      }
      if (requestedId) {
        const allowed = user.portalIds || (user.portalId ? [user.portalId] : []);
        if (allowed.includes(requestedId)) portalId = requestedId;
      }
      if (!portalId && user.portalIds?.length > 0) portalId = user.portalIds[0];
    }

    const isCrossPortalSearch = !!(params.search_eurocode || params.search_order_ref || params.search_plate);
    if (!portalId && !isCrossPortalSearch) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Utilizador sem portal atribuído' }) };
    }

    // ---------- GET ----------
    if (event.httpMethod === 'GET') {
      // Cross-portal search for glass reception matching
      if (params.search_eurocode || params.search_order_ref) {
        let allowedPortalIds;
        if (user.role === 'admin') {
          const { rows: allPortals } = await pool.query('SELECT id FROM portals');
          allowedPortalIds = allPortals.map(r => r.id);
        } else {
          const ids = user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []);
          allowedPortalIds = ids;
        }
        if (!allowedPortalIds.length) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };
        }

        const conditions = [];
        const vals = [allowedPortalIds];
        let idx = 2;

        if (params.search_eurocode) {
          // Normalize I↔1 and O↔0 to handle OCR character confusion
          conditions.push(`(
            REPLACE(REPLACE(LOWER(glass_eurocode), 'i', '1'), 'o', '0') = REPLACE(REPLACE(LOWER($${idx}), 'i', '1'), 'o', '0')
            OR REPLACE(REPLACE(LOWER(notes), 'i', '1'), 'o', '0') LIKE '%' || REPLACE(REPLACE(LOWER($${idx}), 'i', '1'), 'o', '0') || '%'
            OR REPLACE(REPLACE(LOWER(extra::text), 'i', '1'), 'o', '0') LIKE '%' || REPLACE(REPLACE(LOWER($${idx}), 'i', '1'), 'o', '0') || '%'
          )`);
          vals.push(params.search_eurocode.trim());
          idx++;
        }
        if (params.search_order_ref) {
          conditions.push(`(LOWER(order_ref) = LOWER($${idx}) OR notes LIKE '%' || $${idx} || '%' OR n_obra LIKE '%' || $${idx} || '%')`);
          vals.push(params.search_order_ref.trim());
          idx++;
        }
        if (params.search_plate) {
          // Normalize plate for comparison (remove dashes/spaces)
          conditions.push(`REGEXP_REPLACE(LOWER(a.plate), '[^a-z0-9]', '', 'g') = REGEXP_REPLACE(LOWER($${idx}), '[^a-z0-9]', '', 'g')`);
          vals.push(params.search_plate.trim());
          idx++;
        }

        const searchQ = `
          SELECT a.id, a.date, a.period, a.plate, a.car, a.service, a.locality, a.status,
                 a.notes, a.address, a.extra, a.phone, a.km, a.sortIndex, a."glassOrdered",
                 a.vehicle_type, a.travel_time, a.auto_imported, a.executed, a.confirmed,
                 a.calibration, a.first_of_day, a.second_of_day, a.not_done_reason, a.commercial_user_id,
                 a.return_km, a.return_time, a.client_name, a.damage_details, a.glass_removed, a.glass_removed_date,
                 a.custom_service_time, a.foreign_plate, a.extra_services, a.n_obra,
                 a.order_ref, a.glass_eurocode, a.reception_ref,
                 a.comp_sales_desc, a.comp_sales_nif, a.comp_sales_name, a.comp_sales_faturado,
                 a.created_at, a.updated_at, a.not_done_at, a.portal_id,
                 p.name AS portal_name
          FROM appointments a
          LEFT JOIN portals p ON p.id = a.portal_id
          WHERE a.portal_id = ANY($1)
            ${params.include_executed !== 'true' ? 'AND a.executed IS NOT TRUE' : ''}
            AND (a.date IS NULL OR a.date >= CURRENT_DATE - INTERVAL '180 days')
            AND (${conditions.join(' OR ')})
          ORDER BY a.date ASC NULLS LAST, a.created_at ASC
          LIMIT 50
        `;
        const { rows } = await pool.query(searchQ, vals);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
      }

      // Pending conclusion: appointments from previous days without a final service status
      if (params.pending_conclusion === 'true') {
        const { rows } = await pool.query(`
          SELECT id, date, period, plate, car, service, locality
          FROM appointments
          WHERE portal_id = $1
            AND date < CURRENT_DATE
            AND date >= CURRENT_DATE - INTERVAL '7 days'
            AND (
              executed IS NULL
              OR (executed = false AND (not_done_reason IS NULL OR not_done_reason = ''))
            )
            AND glass_removed IS NOT TRUE
          ORDER BY date ASC
        `, [portalId]);

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
      }

      const q = `
        SELECT id, date, period, plate, car, service, locality, status,
               notes, address, extra, phone, km, sortIndex, "glassOrdered",
               vehicle_type, travel_time, auto_imported, executed, confirmed,
               calibration, first_of_day, second_of_day, not_done_reason, commercial_user_id,
               return_km, return_time, client_name, damage_details, glass_removed, glass_removed_date,
               custom_service_time, foreign_plate, extra_services, n_obra,
               order_ref, glass_eurocode, reception_ref,
               comp_sales_desc, comp_sales_nif, comp_sales_name, comp_sales_faturado,
               created_at, updated_at, not_done_at
        FROM appointments
        WHERE portal_id = $1
        ORDER BY date ASC NULLS LAST, sortIndex ASC NULLS LAST, created_at ASC
      `;
      const { rows } = await pool.query(q, [portalId]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    // ---------- POST ----------
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');

      if (!data.plate || !data.car) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Campos obrigatórios: plate, car' }) };
      }

      const dupCheck = await pool.query(
        `SELECT id FROM appointments
         WHERE portal_id = $1
           AND UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) = UPPER(REGEXP_REPLACE($2, '[^A-Z0-9]', '', 'g'))
         LIMIT 1`,
        [portalId, String(data.plate).trim()]
      );
      if (dupCheck.rows.length > 0) {
        return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'Matrícula já existe', existingId: dupCheck.rows[0].id }) };
      }

      const createdAt = data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString();
      const q = `
        INSERT INTO appointments (
          date, period, plate, car, service, locality, status,
          notes, address, extra, phone, km, sortIndex, "glassOrdered",
          vehicle_type, travel_time, confirmed, calibration, first_of_day, second_of_day,
          not_done_reason, commercial_user_id, return_km, return_time, client_name, damage_details,
          glass_removed_date, custom_service_time, foreign_plate, extra_services, n_obra,
          order_ref, glass_eurocode, portal_id, created_at, updated_at,
          comp_sales_desc, comp_sales_nif, comp_sales_name, comp_sales_faturado
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40
        ) RETURNING *
      `;
      const v = [
        data.date || null, data.period || null,
        String(data.plate).trim(), String(data.car).trim(),
        data.service || null, data.locality || null, data.status || 'NE',
        data.notes || null, data.address || null, data.extra || null,
        data.phone || null, data.km || null, data.sortIndex || 1,
        data.glassOrdered || false,
        data.vehicleType || data.vehicle_type || 'L',
        data.travelTime || data.travel_time || null,
        data.confirmed !== undefined ? data.confirmed : true,
        data.calibration || false, data.first_of_day || false, data.second_of_day || false,
        data.not_done_reason || null,
        data.commercial_user_id ? parseInt(data.commercial_user_id) : null,
        data.return_km != null ? parseInt(data.return_km) : null,
        data.return_time != null ? parseInt(data.return_time) : null,
        data.client_name || null,
        data.damage_details || null,
        data.glass_removed_date || null,
        data.custom_service_time ? parseInt(data.custom_service_time) : null,
        data.foreign_plate === true,
        data.extra_services ? JSON.stringify(data.extra_services) : null,
        data.n_obra || null,
        normalizeOrderRef(data.order_ref),
        data.glass_eurocode || data.eurocode || null,
        portalId, createdAt, new Date().toISOString(),
        data.comp_sales_desc || null,
        data.comp_sales_nif || null,
        data.comp_sales_name || null,
        data.comp_sales_faturado === true
      ];
      const { rows } = await pool.query(q, v);
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ---------- PUT ----------
    if (event.httpMethod === 'PUT') {
      const id = (event.path || '').split('/').pop();
      const data = JSON.parse(event.body || '{}');

      // Ler valores atuais para preservar executed e not_done_reason
      // Admin e coordenadores: procurar por id primeiro, depois verificar autorização
      const isAdmin = user.role === 'admin';
      const isCoord = user.role === 'coordinator' || user.role === 'coordenador';
      const checkResult = await pool.query(
        'SELECT id, portal_id, executed, not_done_reason, not_done_at, glass_removed, glass_removed_date FROM appointments WHERE id = $1',
        [id]
      );
      if (checkResult.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
      }
      const existing = checkResult.rows[0];
      // Verificar autorização: admin pode tudo; coord verifica portalIds; outros verificam portal exacto
      if (!isAdmin) {
        const allowedPortals = isCoord
          ? (user.portalIds || (user.portalId ? [user.portalId] : []))
          : [portalId];
        if (!allowedPortals.includes(existing.portal_id)) {
          return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão para editar este agendamento' }) };
        }
      }
      const effectivePortalId = existing.portal_id;
      const executedVal = data.executed !== undefined ? data.executed : existing.executed;
      const notDoneReasonVal = data.not_done_reason !== undefined ? data.not_done_reason : existing.not_done_reason;
      // Set not_done_at when reason is first set; clear it when reason is cleared; otherwise keep existing.
      // If existing record already had a reason but not_done_at is NULL (pre-migration), fill it now.
      const notDoneAtVal = notDoneReasonVal
        ? (existing.not_done_reason ? (existing.not_done_at || new Date().toISOString()) : new Date().toISOString())
        : null;

      const q = `
        UPDATE appointments SET
          date = $1, period = $2, plate = $3, car = $4,
          service = $5, locality = $6, status = $7,
          notes = $8, address = $9, extra = $10, phone = $11,
          km = $12, sortIndex = $13, "glassOrdered" = $14,
          vehicle_type = $15, travel_time = $16, auto_imported = $17,
          executed = $18, confirmed = $19, calibration = $20,
          first_of_day = $21, second_of_day = $22, not_done_reason = $23, commercial_user_id = $24,
          return_km = $25, return_time = $26, client_name = $27, damage_details = $28, glass_removed = $29, extra_services = $30,
          glass_removed_date = $31, n_obra = $32, updated_at = $33, not_done_at = $36, reception_ref = $37,
          comp_sales_desc = $38, comp_sales_nif = $39, comp_sales_name = $40, comp_sales_faturado = $41,
          order_ref = $42, glass_eurocode = $43
        WHERE id = $34 AND portal_id = $35
        RETURNING *
      `;
      const v = [
        data.date || null, data.period || null,
        data.plate ? String(data.plate).trim() : null,
        data.car ? String(data.car).trim() : null,
        data.service || null, data.locality || null, data.status || 'NE',
        data.notes || null, data.address || null, data.extra || null,
        data.phone || null, data.km || null, data.sortIndex || null,
        data.glassOrdered !== undefined ? data.glassOrdered : null,
        data.vehicleType || data.vehicle_type || 'L',
        data.travelTime || data.travel_time || null,
        data.auto_imported !== undefined ? data.auto_imported : false,
        executedVal,
        data.confirmed !== undefined ? data.confirmed : true,
        data.calibration === true,
        data.first_of_day === true,
        data.second_of_day === true,
        notDoneReasonVal,
        data.commercial_user_id !== undefined ? (data.commercial_user_id || null) : existing.commercial_user_id,
        data.return_km != null ? parseInt(data.return_km) : null,
        data.return_time != null ? parseInt(data.return_time) : null,
        data.client_name !== undefined ? (data.client_name || null) : null,
        data.damage_details !== undefined ? (data.damage_details || null) : null,
        data.glass_removed !== undefined ? (!!data.glass_removed) : (existing.glass_removed || false),
        JSON.stringify(data.extra_services !== undefined ? (data.extra_services || []) : (existing.extra_services || [])),
        data.glass_removed_date !== undefined ? (data.glass_removed_date || null) : (existing.glass_removed_date || null),
        data.n_obra !== undefined ? (data.n_obra || null) : null,
        new Date().toISOString(), id, effectivePortalId, notDoneAtVal,
        data.reception_ref !== undefined ? normalizeReceptionRef(data.reception_ref) : null,
        data.comp_sales_desc !== undefined ? (data.comp_sales_desc || null) : null,
        data.comp_sales_nif !== undefined ? (data.comp_sales_nif || null) : null,
        data.comp_sales_name !== undefined ? (data.comp_sales_name || null) : null,
        data.comp_sales_faturado !== undefined ? (!!data.comp_sales_faturado) : false,
        data.order_ref !== undefined ? normalizeOrderRef(data.order_ref) : null,
        data.glass_eurocode !== undefined ? (data.glass_eurocode || null) : null
      ];
      const { rows } = await pool.query(q, v);
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ---------- DELETE ----------
    if (event.httpMethod === 'DELETE') {
      const id = (event.path || '').split('/').pop();
      console.log(`🗑️ DELETE - ID: ${id}, Portal: ${portalId}`);

      const checkResult = await pool.query('SELECT id, portal_id, plate FROM appointments WHERE id = $1', [id]);
      if (checkResult.rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
      }
      const appt = checkResult.rows[0];
      if (appt.portal_id !== portalId) {
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Não tem permissão' }) };
      }

      const { rows } = await pool.query(
        'DELETE FROM appointments WHERE id = $1 AND portal_id = $2 RETURNING *',
        [id, portalId]
      );
      if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
      console.log(`✅ DELETE - ${id} eliminado | plate: ${rows[0].plate} | car: ${rows[0].car} | locality: ${rows[0].locality} | date: ${rows[0].date}`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: `Método ${event.httpMethod} não permitido` }) };

  } catch (err) {
    console.error('Erro na function appointments:', err);
    if (err.message === 'Não autenticado' || err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado ou token inválido' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
