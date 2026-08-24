// netlify/functions/glass-reception.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const {
  createCandidateIndex,
  findCandidates,
  normalizeEurocode: normalizeEurocodeMatch
} = require('../lib/glass-reception-match');
const {
  normalizeReceptionIds,
  assertBulkDeleteTargets
} = require('../lib/glass-reception-bulk-delete');

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

function normalizeReceptionRef(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith('rec.')) return s;
  if (/^\d+$/.test(s)) return `Rec.${s}`;
  return s;
}

function verifyToken(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  if (!h.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(h.substring(7), JWT_SECRET);
}

function parseEurocode(raw) {
  if (!raw) return { canonical: null, glassType: 'rede' };
  const s = String(raw).trim();
  if (s.startsWith('#')) return { canonical: s.slice(1).toUpperCase(), glassType: 'complementar' };
  if (s.startsWith('*')) return { canonical: s.slice(1).toUpperCase(), glassType: 'oem' };
  return { canonical: s.toUpperCase(), glassType: 'rede' };
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function canCoordinate(user) {
  return ['admin', 'coordenador', 'coordinator'].includes(user.role);
}

async function getAccessiblePortalIds(client, user, includeConsultable = true) {
  if (user.role === 'admin') {
    const { rows } = await client.query('SELECT id FROM portals');
    return rows.map(row => Number(row.id)).filter(Boolean);
  }

  const uid = Number(user.userId || user.id);
  if (!uid) {
    return [...new Set([
      ...(user.portalIds || []),
      ...(includeConsultable ? (user.consultablePortalIds || []) : []),
      ...(user.portalId ? [user.portalId] : [])
    ].map(Number).filter(Boolean))];
  }

  const consultableUnion = includeConsultable
    ? 'UNION SELECT portal_id FROM consultable_portals WHERE user_id = $1'
    : '';
  const { rows } = await client.query(`
    SELECT DISTINCT portal_id FROM (
      SELECT portal_id FROM coordinator_portals WHERE user_id = $1
      ${consultableUnion}
      UNION SELECT portal_id FROM users WHERE id = $1 AND portal_id IS NOT NULL
    ) accessible
    WHERE portal_id IS NOT NULL
  `, [uid]);

  return rows.map(row => Number(row.portal_id)).filter(Boolean);
}

function publicCandidate(candidate) {
  return {
    id: candidate.id,
    date: candidate.date,
    period: candidate.period,
    plate: candidate.plate,
    car: candidate.car,
    service: candidate.service,
    executed: candidate.executed,
    portal_id: candidate.portal_id,
    portal_name: candidate.portal_name,
    eurocode_match: candidate.eurocode_match,
    order_match: candidate.order_match,
    match_score: candidate.match_score
  };
}

async function associateReception(client, user, receptionId, appointmentId, allowedPortalIds) {
  await client.query('BEGIN');
  try {
    const { rows: receptionRows } = await client.query(
      `SELECT * FROM glass_receptions WHERE id = $1 FOR UPDATE`,
      [receptionId]
    );
    if (!receptionRows.length) throw httpError('Receção não encontrada', 404);
    const reception = receptionRows[0];
    if (reception.status !== 'pending') {
      throw httpError('Esta receção já foi tratada entretanto', 409);
    }
    if (user.role !== 'admin' && !allowedPortalIds.includes(Number(reception.portal_id))) {
      throw httpError('Sem acesso a esta receção', 403);
    }

    const { rows: appointmentRows } = await client.query(`
      SELECT a.id, a.portal_id, a.plate, a.car, a.service, a.date, a.executed,
             a.order_ref, a.glass_eurocode, a.n_obra, a.notes, a.extra,
             p.name AS portal_name,
             COALESCE(p.auto_receive_glass, true) AS auto_receive
      FROM appointments a
      LEFT JOIN portals p ON p.id = a.portal_id
      WHERE a.id = $1
      FOR UPDATE OF a
    `, [appointmentId]);
    if (!appointmentRows.length) throw httpError('Agendamento não encontrado', 404);
    const appointment = appointmentRows[0];

    if (!allowedPortalIds.includes(Number(appointment.portal_id))) {
      throw httpError('Sem acesso ao portal deste agendamento', 403);
    }
    if (!findCandidates(reception, [appointment]).length) {
      throw httpError('Este agendamento não corresponde ao Eurocode ou à encomenda desta receção', 409);
    }

    if (reception.eurocode) {
      const { rows: existingRows } = await client.query(`
        SELECT id, eurocode FROM glass_receptions
        WHERE appointment_id = $1
          AND id != $2
          AND is_return = false
          AND status != 'return'
      `, [appointment.id, reception.id]);
      const eurocode = normalizeEurocodeMatch(reception.eurocode);
      if (existingRows.some(row => normalizeEurocodeMatch(row.eurocode) === eurocode)) {
        throw httpError(`Este Eurocode já está associado à matrícula ${appointment.plate || ''}`.trim(), 409);
      }
    }

    const nextStatus = appointment.auto_receive === false ? 'confirmed' : 'received';
    const { rows: updatedRows } = await client.query(`
      UPDATE glass_receptions
      SET appointment_id = $1,
          portal_id = $2,
          portal_name = $3,
          status = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [appointment.id, appointment.portal_id, appointment.portal_name, nextStatus, reception.id]);

    await client.query(`
      UPDATE appointments
      SET status = 'ST',
          reception_date = COALESCE(reception_date, $2::timestamptz::date),
          order_ref = CASE
            WHEN order_ref IS NULL OR TRIM(order_ref) = '' THEN $3
            ELSE order_ref
          END,
          glass_eurocode = CASE
            WHEN glass_eurocode IS NULL OR TRIM(glass_eurocode) = '' THEN $4
            ELSE glass_eurocode
          END,
          updated_at = NOW()
      WHERE id = $1
    `, [appointment.id, reception.created_at, normalizeOrderRef(reception.order_ref), reception.eurocode || null]);

    await client.query('COMMIT');
    return {
      ...updatedRows[0],
      apt_plate: appointment.plate,
      apt_car: appointment.car,
      apt_service: appointment.service,
      apt_date: appointment.date,
      portal_label: appointment.portal_name
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function reanalysePendingReceptions(client, user, receptionIds) {
  if (!canCoordinate(user)) throw httpError('Sem permissão', 403);

  const allowedPortalIds = await getAccessiblePortalIds(client, user, true);
  if (!allowedPortalIds.length) return { linked: [], unresolved: [], total: 0 };

  const requestedIds = (receptionIds || []).map(Number).filter(Boolean);
  const idFilter = requestedIds.length ? 'AND gr.id = ANY($2)' : '';
  const values = requestedIds.length ? [allowedPortalIds, requestedIds] : [allowedPortalIds];
  const { rows: pendingRows } = await client.query(`
    SELECT gr.*
    FROM glass_receptions gr
    WHERE gr.status = 'pending'
      AND gr.is_return = false
      AND gr.portal_id = ANY($1)
      ${idFilter}
    ORDER BY gr.created_at ASC
    LIMIT 300
  `, values);

  if (!pendingRows.length) return { linked: [], unresolved: [], total: 0 };

  const { rows: appointments } = await client.query(`
    SELECT a.id, a.date, a.period, a.plate, a.car, a.service, a.executed,
           a.portal_id, a.order_ref, a.glass_eurocode, a.n_obra, a.notes, a.extra,
           p.name AS portal_name
    FROM appointments a
    LEFT JOIN portals p ON p.id = a.portal_id
    WHERE a.portal_id = ANY($1)
      AND (a.date IS NULL OR a.date >= CURRENT_DATE - INTERVAL '365 days')
    ORDER BY a.date DESC NULLS LAST, a.created_at DESC
  `, [allowedPortalIds]);
  const appointmentIndex = createCandidateIndex(appointments);

  const linked = [];
  const unresolved = [];

  for (const reception of pendingRows) {
    const candidates = findCandidates(reception, appointmentIndex);
    if (candidates.length === 1) {
      try {
        const updated = await associateReception(
          client,
          user,
          reception.id,
          candidates[0].id,
          allowedPortalIds
        );
        linked.push(updated);
        continue;
      } catch (error) {
        if (![403, 404, 409].includes(error.statusCode)) throw error;
        unresolved.push({
          reception_id: reception.id,
          reason: error.message,
          candidates: candidates.map(publicCandidate)
        });
        continue;
      }
    }

    unresolved.push({
      reception_id: reception.id,
      reason: candidates.length > 1
        ? 'Foram encontrados vários agendamentos possíveis.'
        : 'Não foi encontrado um agendamento correspondente.',
      candidates: candidates.slice(0, 25).map(publicCandidate)
    });
  }

  return { linked, unresolved, total: pendingRows.length };
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
  // Return/damage columns (migration-safe)
  await client.query(`ALTER TABLE glass_receptions ADD COLUMN IF NOT EXISTS is_return   BOOLEAN DEFAULT false`);
  await client.query(`ALTER TABLE glass_receptions ADD COLUMN IF NOT EXISTS return_reason TEXT`);
  await client.query(`ALTER TABLE glass_receptions ADD COLUMN IF NOT EXISTS damage_photos JSONB`);
  await client.query(`ALTER TABLE glass_receptions ADD COLUMN IF NOT EXISTS label_photo TEXT`);
  await client.query(`ALTER TABLE glass_receptions ADD COLUMN IF NOT EXISTS carrier_guide TEXT`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS eurocode_cache (
      eurocode      TEXT PRIMARY KEY,
      glass_types   TEXT[] DEFAULT '{}',
      service_types TEXT[] DEFAULT '{}',
      car_models    TEXT[] DEFAULT '{}',
      seen_count    INT DEFAULT 1,
      last_seen     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`ALTER TABLE eurocode_cache ADD COLUMN IF NOT EXISTS service_types TEXT[] DEFAULT '{}'`);

  // Definição por loja: receção automática de vidros (ligada por omissão)
  await client.query(`ALTER TABLE portals ADD COLUMN IF NOT EXISTS auto_receive_glass BOOLEAN DEFAULT true`);

  // Receções associadas a uma matrícula, em lojas com receção automática,
  // deixam de precisar de confirmação: 'confirmed' → 'received'. Idempotente.
  await client.query(
    `UPDATE glass_receptions gr SET status = 'received', updated_at = NOW()
     FROM appointments a JOIN portals p ON p.id = a.portal_id
     WHERE gr.appointment_id = a.id
       AND gr.status = 'confirmed'
       AND COALESCE(p.auto_receive_glass, true) = true`
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS close_requests (
      id             SERIAL PRIMARY KEY,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      eurocode       TEXT,
      plate          TEXT,
      order_ref      TEXT,
      n_obra         TEXT,
      portal_id      INTEGER,
      portal_name    TEXT,
      notes          TEXT,
      status         VARCHAR(20) DEFAULT 'pending',
      requested_by   TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      done_at        TIMESTAMPTZ,
      done_by        TEXT
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
        let pRows;
        if (user.role === 'admin') {
          ({ rows: pRows } = await client.query(`SELECT id, name FROM portals ORDER BY name`));
        } else {
          const uid = user.userId || user.id;
          ({ rows: pRows } = await client.query(`
            SELECT DISTINCT p.id, p.name FROM portals p
            WHERE p.id IN (
              SELECT portal_id FROM coordinator_portals WHERE user_id = $1
              UNION
              SELECT portal_id FROM consultable_portals WHERE user_id = $1
              UNION
              SELECT portal_id FROM users WHERE id = $1 AND portal_id IS NOT NULL
            )
            ORDER BY p.name
          `, [uid]));
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: pRows }) };
      }

      // ── Definições de receção automática por loja ────────────────────────────
      if (p.portal_settings === 'true') {
        let sRows;
        if (user.role === 'admin') {
          ({ rows: sRows } = await client.query(
            `SELECT id, name, COALESCE(auto_receive_glass, true) AS auto_receive_glass FROM portals ORDER BY name`));
        } else {
          const uid = user.userId || user.id;
          ({ rows: sRows } = await client.query(`
            SELECT DISTINCT p.id, p.name, COALESCE(p.auto_receive_glass, true) AS auto_receive_glass FROM portals p
            WHERE p.id IN (
              SELECT portal_id FROM coordinator_portals WHERE user_id = $1
              UNION
              SELECT portal_id FROM users WHERE id = $1 AND portal_id IS NOT NULL
            )
            ORDER BY p.name
          `, [uid]));
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: sRows }) };
      }

      // ── Coordinator alerts: counts of items older than 1 hour per category ──────
      if (p.alerts === 'true') {
        const isAdmin = user.role === 'admin';
        const portalIds = user.portalIds?.length ? user.portalIds
          : (user.portalId ? [user.portalId] : []);
        const portalCond = isAdmin ? '' : `AND gr.portal_id = ANY($1)`;
        const vals = isAdmin ? [] : [portalIds];

        const [pendR, damR, retR, missR] = await Promise.all([
          client.query(`SELECT COUNT(*) AS n FROM glass_receptions gr
            WHERE gr.status IN ('pending','confirmed')
            AND gr.created_at < NOW() - INTERVAL '1 hour'
            AND gr.is_return = false ${portalCond}`, vals),
          client.query(`SELECT COUNT(*) AS n FROM glass_receptions gr
            WHERE gr.is_return = true AND gr.return_reason = 'partido'
            AND gr.status NOT IN ('reported','devolvido','received')
            AND gr.created_at < NOW() - INTERVAL '1 hour'
            ${portalCond}`, vals),
          client.query(`SELECT COUNT(*) AS n FROM glass_receptions gr
            WHERE gr.is_return = true AND COALESCE(gr.return_reason,'') != 'partido'
            AND gr.status NOT IN ('devolvido','reported')
            AND gr.created_at < NOW() - INTERVAL '1 hour'
            ${portalCond}`, vals),
          client.query(`SELECT COUNT(*) AS n FROM glass_receptions gr
            WHERE gr.status = 'missing' ${portalCond}`, vals),
        ]);

        const closeR = await client.query(
          `SELECT COUNT(*) AS n FROM close_requests WHERE status = 'pending' ${portalCond.replace(/gr\./g, '')}`,
          vals
        );

        return { statusCode: 200, headers, body: JSON.stringify({
          success: true,
          pending: parseInt(pendR.rows[0].n, 10) || 0,
          damaged: parseInt(damR.rows[0].n, 10) || 0,
          returns: parseInt(retR.rows[0].n, 10) || 0,
          missing: parseInt(missR.rows[0].n, 10) || 0,
          close_requests: parseInt(closeR.rows[0].n, 10) || 0,
        })};
      }

      // ── Today's receptions list (PHC daily reminder) ─────────────────────────
      if (p.today_list === 'true') {
        const isAdmin = user.role === 'admin';
        const portalIds = user.portalIds?.length ? user.portalIds
          : (user.portalId ? [user.portalId] : []);
        const portalCond = isAdmin ? '' : `AND gr.portal_id = ANY($1)`;
        const vals = isAdmin ? [] : [portalIds];

        const { rows } = await client.query(`
          SELECT gr.id, gr.eurocode, gr.order_ref, gr.status, gr.portal_id,
                 po.name AS portal_label,
                 a.plate AS apt_plate, a.car AS apt_car
          FROM glass_receptions gr
          LEFT JOIN portals po ON po.id = gr.portal_id
          LEFT JOIN appointments a ON a.id = gr.appointment_id
          WHERE gr.is_return = false
          AND gr.created_at::date = CURRENT_DATE
          ${portalCond}
          ORDER BY gr.created_at ASC
        `, vals);

        return { statusCode: 200, headers, body: JSON.stringify({
          success: true, data: rows, count: rows.length
        })};
      }

      // ── Close requests list ───────────────────────────────────────────────────
      if (p.close_requests === 'true') {
        const isAdmin = user.role === 'admin';
        const portalIds = user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []);
        const portalCond = isAdmin ? '' : `AND cr.portal_id = ANY($1)`;
        const vals = isAdmin ? [] : [portalIds];
        const { rows: crRows } = await client.query(`
          SELECT cr.*,
                 a.plate   AS apt_plate,
                 a.car     AS apt_car,
                 a.service AS apt_service
          FROM close_requests cr
          LEFT JOIN appointments a ON a.id = cr.appointment_id
          WHERE cr.status = 'pending'
          ${portalCond}
          ORDER BY cr.created_at DESC
        `, vals);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: crRows }) };
      }

      // ── History query ─────────────────────────────────────────────────────────
      if (p.history === 'true') {
        let hq = `
          SELECT gr.*,
                 a.plate         AS apt_plate,
                 a.car           AS apt_car,
                 a.locality      AS apt_locality,
                 a.service       AS apt_service,
                 a.date          AS apt_date,
                 a.reception_ref AS apt_reception_ref,
                 a.executed      AS apt_executed,
                 COALESCE(a.glass_eurocode,
                   CASE WHEN a.extra ~ '"eurocode"\\s*:\\s*"([^"]+)"'
                   THEN regexp_replace(a.extra, '.*"eurocode"\\s*:\\s*"([^"]+)".*', '\\1', 'g')
                   ELSE NULL END
                 ) AS apt_eurocode,
                 COALESCE(a.order_ref) AS apt_order_ref,
                 po.name         AS portal_label
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

        if (p.portal_id) { hq += ` AND (gr.portal_id = $${hIdx++} OR (gr.is_return = true AND gr.portal_id IS NULL))`; hVals.push(parseInt(p.portal_id)); }
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

      // ── Inventory: eurocode_cache × glass_receptions ─────────────────────────
      if (p.inventory === 'true') {
        const isAdmin = user.role === 'admin';
        const portalIds = user.portalIds?.length ? user.portalIds
          : (user.portalId ? [user.portalId] : []);

        const portalFilter = p.portal_id ? [parseInt(p.portal_id)]
          : (isAdmin ? null : portalIds);

        const { rows: invRows } = await client.query(`
          SELECT
            r.eurocode,
            CASE
              WHEN r.eurocode LIKE '#%' THEN ARRAY['complementar']::text[]
              WHEN r.eurocode LIKE '*%' THEN ARRAY['oem']::text[]
              ELSE ARRAY['rede']::text[]
            END                                AS glass_types,
            COALESCE(ec.service_types,  '{}')  AS service_types,
            COALESCE(ec.car_models,     '{}')  AS car_models,
            COALESCE(ec.seen_count,  0)        AS seen_count,
            ec.last_seen,
            COALESCE(r.received, 0)::int       AS received,
            COALESCE(r.consumed, 0)::int       AS consumed,
            COALESCE(r.returned, 0)::int       AS returned,
            GREATEST(0, COALESCE(r.received,0) - COALESCE(r.consumed,0) - COALESCE(r.returned,0))::int AS in_stock
          FROM (
            SELECT
              UPPER(TRIM(eurocode)) AS eurocode,
              COUNT(*) FILTER (WHERE is_return = false AND status NOT IN ('missing','return')) AS received,
              COUNT(*) FILTER (WHERE is_return = false AND status = 'consumed')               AS consumed,
              COUNT(*) FILTER (WHERE is_return = true  AND status NOT IN ('devolvido','reported')) AS returned
            FROM glass_receptions
            WHERE eurocode IS NOT NULL
            ${portalFilter ? 'AND portal_id = ANY($1)' : ''}
            GROUP BY UPPER(TRIM(eurocode))
          ) r
          LEFT JOIN eurocode_cache ec
            ON ec.eurocode = UPPER(regexp_replace(r.eurocode, '^[#*]+', ''))
          ORDER BY r.received DESC, r.eurocode ASC
          LIMIT 500
        `, portalFilter ? [portalFilter] : []);

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: invRows }) };
      }

      // ── Fotografias de um registo (carregadas a pedido) ─────────────────────
      if (p.photos) {
        const photoId = parseInt(p.photos, 10);
        if (!photoId) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'ID inválido' }) };
        const { rows: phRows } = await client.query(
          `SELECT id, portal_id, label_photo, damage_photos FROM glass_receptions WHERE id = $1`,
          [photoId]
        );
        if (!phRows.length) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Registo não encontrado' }) };
        const rec = phRows[0];
        if (user.role !== 'admin') {
          const allowed = await getAccessiblePortalIds(client, user, true);
          if (!allowed.includes(Number(rec.portal_id))) {
            return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({
          success: true,
          data: { id: rec.id, label_photo: rec.label_photo || null, damage_photos: rec.damage_photos || [] }
        })};
      }

      // ── Returns query (is_return=true, filtered by reason) ───────────────────
      if (p.returns) {
        const isErradoGroup = p.returns === 'errado_cancelado';
        // Nunca devolver as fotografias na listagem: sao base64 e faziam a
        // resposta ultrapassar o limite de 6 MB da lambda ("Response payload
        // size exceeded"). Vao so as contagens; as imagens seguem a pedido.
        let rq = `
          SELECT gr.id, gr.appointment_id, gr.order_ref, gr.eurocode,
                 gr.raw_label_text, gr.technician_id, gr.technician_name,
                 gr.portal_id, gr.portal_name, gr.status, gr.created_at,
                 gr.updated_at, gr.is_return, gr.return_reason, gr.carrier_guide,
                 (gr.label_photo IS NOT NULL) AS has_label_photo,
                 CASE WHEN jsonb_typeof(gr.damage_photos) = 'array'
                      THEN jsonb_array_length(gr.damage_photos) ELSE 0 END AS damage_photo_count,
                 po.name AS portal_label,
                 a.plate AS apt_plate, a.car AS apt_car
          FROM glass_receptions gr
          LEFT JOIN portals po      ON po.id = gr.portal_id
          LEFT JOIN appointments a  ON a.id  = gr.appointment_id
          WHERE gr.is_return = true
          AND ${isErradoGroup
            ? `gr.return_reason IN ('errado_cancelado','errado','desistencia','outro')`
            : `gr.return_reason = $1`}
        `;
        const rVals = isErradoGroup ? [] : [p.returns];
        let rIdx = isErradoGroup ? 1 : 2;
        if (user.role === 'user') {
          rq += ` AND gr.portal_id = $${rIdx++}`; rVals.push(user.portalId);
        } else if (user.role !== 'admin') {
          const ids = user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []);
          if (ids.length) { rq += ` AND gr.portal_id = ANY($${rIdx++})`; rVals.push(ids); }
        }
        rq += ` AND gr.status != 'devolvido' ORDER BY gr.created_at DESC LIMIT 500`;
        const { rows: rRows } = await client.query(rq, rVals);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rRows }) };
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

      // Portal access control — same logic as history/returns queries
      if (user.role === 'user') {
        q += ` AND gr.portal_id = $${idx++}`; vals.push(user.portalId);
      } else if (user.role !== 'admin') {
        const ids = await getAccessiblePortalIds(client, user, true);
        if (ids.length) { q += ` AND gr.portal_id = ANY($${idx++})`; vals.push(ids); }
      }

      q += ` ORDER BY gr.created_at DESC LIMIT 300`;

      const { rows } = await client.query(q, vals);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    // ── POST ───────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const d = JSON.parse(event.body || '{}');

      // ── Definir receção automática de uma loja (coordenador/admin) ────────────
      if (d.action === 'set_auto_receive') {
        if (!['admin', 'coordenador', 'coordinator'].includes(user.role)) {
          return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };
        }
        const pid = parseInt(d.portal_id);
        if (!pid) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'portal_id obrigatório' }) };
        const value = d.value !== false; // true por omissão
        await client.query(`UPDATE portals SET auto_receive_glass = $1 WHERE id = $2`, [value, pid]);
        // Ao LIGAR, receber já as receções associadas dessa loja que estavam à espera
        if (value) {
          await client.query(
            `UPDATE glass_receptions gr SET status = 'received', updated_at = NOW()
             FROM appointments a
             WHERE gr.appointment_id = a.id AND a.portal_id = $1 AND gr.status = 'confirmed'`,
            [pid]
          );
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, auto_receive_glass: value }) };
      }

      // ── Criar pedido de fecho de ficha ────────────────────────────────────────
      if (d.action === 'close_request') {
        const { appointment_id, eurocode, plate, order_ref, n_obra, notes, portal_id, portal_name } = d;
        const reqBy = user.name || user.email || null;
        const pid = portal_id || user.portalId || null;
        const { rows: crRows } = await client.query(`
          INSERT INTO close_requests (appointment_id, eurocode, plate, order_ref, n_obra, portal_id, portal_name, notes, requested_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `, [appointment_id || null, eurocode || null, plate || null, order_ref || null,
            n_obra || null, pid, portal_name || null, notes || null, reqBy]);
        return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: crRows[0] }) };
      }

      // ── Processar pedido de fecho (coordenador marca como Tratado) ────────────
      if (d.action === 'process_close_request') {
        const { id } = d;
        const { rows: crRows } = await client.query(`SELECT * FROM close_requests WHERE id = $1`, [id]);
        if (!crRows.length) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Pedido não encontrado' }) };
        const cr = crRows[0];

        // 1. Remover eurocode do stock: marcar glass_reception como consumed
        if (cr.appointment_id) {
          const ecCond = cr.eurocode
            ? `AND UPPER(REGEXP_REPLACE(eurocode, '^[#*]+', '')) = UPPER(REGEXP_REPLACE($2, '^[#*]+', ''))`
            : '';
          const ecVals = cr.eurocode ? [cr.appointment_id, cr.eurocode] : [cr.appointment_id];
          await client.query(`
            UPDATE glass_receptions
            SET status = 'consumed', updated_at = NOW()
            WHERE appointment_id = $1
              AND is_return = false
              AND status NOT IN ('consumed','missing','return')
              ${ecCond}
          `, ecVals).catch(() => {});

          // 2. Fechar o agendamento
          await client.query(
            `UPDATE appointments SET executed = true, updated_at = NOW() WHERE id = $1`,
            [cr.appointment_id]
          ).catch(() => {});
        }

        // 3. Marcar pedido como tratado
        const doneBy = user.name || user.email || null;
        await client.query(
          `UPDATE close_requests SET status = 'done', done_at = NOW(), done_by = $1 WHERE id = $2`,
          [doneBy, id]
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // When linked to an appointment, always derive portal from the appointment
      // (the user's JWT portal may differ from the appointment's portal — e.g. bragaadmin
      // belongs to "Braga" loja but receives glass for "Braga SM" appointments)
      let resolvedPortalId = d.portal_id || user.portalId || null;
      let resolvedPortalName = d.portal_name || null;
      let autoReceive = true; // por omissão, a loja tem receção automática
      let aptRow = null;
      if (d.appointment_id) {
        aptRow = await client.query(
          `SELECT a.portal_id, a.car, a.service, p.name AS portal_name,
                  COALESCE(p.auto_receive_glass, true) AS auto_receive
           FROM appointments a LEFT JOIN portals p ON p.id = a.portal_id WHERE a.id = $1`,
          [d.appointment_id]
        );
        if (aptRow.rows.length) {
          resolvedPortalId = aptRow.rows[0].portal_id || resolvedPortalId;
          resolvedPortalName = aptRow.rows[0].portal_name || resolvedPortalName;
          autoReceive = aptRow.rows[0].auto_receive !== false;
        }
      }

      // Com matrícula detetada: se a loja tem receção automática ligada, entra
      // direto como 'received' (sem confirmação); se desligada, fica 'confirmed'
      // à espera do coordenador. Sem associação → 'pending'.
      const status = d.status === 'missing' ? 'missing'
        : (d.is_return ? 'return'
          : (d.appointment_id ? (autoReceive ? 'received' : 'confirmed') : 'pending'));

      // Prevent duplicate reception of the same eurocode for the SAME appointment
      if (d.eurocode && !d.is_return && d.appointment_id) {
        const dupCheck = await client.query(
          `SELECT gr.id, a.plate FROM glass_receptions gr
           LEFT JOIN appointments a ON a.id = gr.appointment_id
           WHERE LOWER(REPLACE(REPLACE(gr.eurocode,'i','1'),'o','0')) = LOWER(REPLACE(REPLACE($1,'i','1'),'o','0'))
             AND gr.appointment_id = $2
             AND gr.status != 'return'`,
          [d.eurocode, d.appointment_id]
        );
        if (dupCheck.rows.length > 0) {
          const plates = dupCheck.rows.map(r => r.plate || '?').join(', ');
          return { statusCode: 409, headers, body: JSON.stringify({ error: `Eurocode já rececionado para: ${plates}` }) };
        }
      }

      const { rows } = await client.query(`
        INSERT INTO glass_receptions
          (order_ref, eurocode, raw_label_text, appointment_id,
           technician_id, technician_name, portal_id, portal_name, status,
           is_return, return_reason, damage_photos, label_photo, carrier_guide)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING *
      `, [
        normalizeOrderRef(d.order_ref), d.eurocode || null, d.raw_label_text || null,
        d.appointment_id || null,
        user.userId || user.id, user.username,
        resolvedPortalId, resolvedPortalName,
        status,
        d.is_return || false,
        d.return_reason || null,
        d.damage_photos ? JSON.stringify(d.damage_photos) : null,
        d.label_photo || null,
        d.carrier_guide || null
      ]);

      // When glass is matched to an appointment: set status ST (received) and propagate refs
      if (d.appointment_id && !d.is_return) {
        await client.query(
          `UPDATE appointments SET status = 'ST', reception_date = CURRENT_DATE, updated_at = NOW() WHERE id = $1`,
          [d.appointment_id]
        );
        if (d.order_ref) {
          await client.query(
            `UPDATE appointments SET order_ref = $1 WHERE id = $2 AND (order_ref IS NULL OR order_ref = '')`,
            [normalizeOrderRef(d.order_ref), d.appointment_id]
          );
        }
        if (d.eurocode) {
          await client.query(
            `UPDATE appointments SET glass_eurocode = $1 WHERE id = $2 AND (glass_eurocode IS NULL OR glass_eurocode = '')`,
            [d.eurocode, d.appointment_id]
          );
        }
      }

      // Learn eurocode → glass type + service type + car model from confirmed receptions
      if (d.appointment_id && !d.is_return && d.eurocode) {
        const { canonical, glassType } = parseEurocode(d.eurocode);
        const carModel   = aptRow?.rows[0]?.car     || null;
        const svcType    = aptRow?.rows[0]?.service || null;
        if (canonical) {
          await client.query(`
            INSERT INTO eurocode_cache (eurocode, glass_types, service_types, car_models, seen_count, last_seen)
            VALUES ($1, ARRAY[$2]::text[], $5::text[], $3::text[], 1, NOW())
            ON CONFLICT (eurocode) DO UPDATE SET
              glass_types = (
                SELECT array_agg(DISTINCT g) FROM unnest(array_append(eurocode_cache.glass_types, $2)) g
              ),
              service_types = CASE
                WHEN $6::text IS NULL OR $6::text = ANY(eurocode_cache.service_types)
                THEN eurocode_cache.service_types
                ELSE array_append(eurocode_cache.service_types, $6::text)
              END,
              car_models = CASE
                WHEN $4::text IS NULL OR $4::text = ANY(eurocode_cache.car_models)
                THEN eurocode_cache.car_models
                ELSE array_append(eurocode_cache.car_models, $4::text)
              END,
              seen_count = eurocode_cache.seen_count + 1,
              last_seen  = NOW()
          `, [canonical, glassType, carModel ? [carModel] : [], carModel,
              svcType ? [svcType] : [], svcType]).catch(() => {});
        }
      }

      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ── PUT ────────────────────────────────────────────────────────────────────
    if (event.httpMethod === 'PUT') {
      const d = JSON.parse(event.body || '{}');

      // Revisit historical orphan receptions using the current portal access
      // rules and matching normalisation. Unique matches are linked now;
      // ambiguous matches are returned to the coordinator for selection.
      if (d.action === 'reanalyse_pending') {
        const result = await reanalysePendingReceptions(client, user, d.reception_ids);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: result }) };
      }

      if (d.action === 'associate_reception') {
        if (!canCoordinate(user)) {
          return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };
        }
        const receptionId = Number(d.id);
        const appointmentId = Number(d.appointment_id);
        if (!receptionId || !appointmentId) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Receção e agendamento são obrigatórios' }) };
        }
        const allowedPortalIds = await getAccessiblePortalIds(client, user, true);
        const updated = await associateReception(client, user, receptionId, appointmentId, allowedPortalIds);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: updated }) };
      }

      // Backfill eurocode_cache from existing glass_receptions + appointments
      if (d.action === 'backfill_cache') {
        const { rows: bRows } = await client.query(`
          INSERT INTO eurocode_cache (eurocode, glass_types, service_types, car_models, seen_count, last_seen)
          SELECT
            UPPER(regexp_replace(gr.eurocode, '^[#*]+', '')) AS canonical,
            array_agg(DISTINCT CASE
              WHEN gr.eurocode LIKE '#%' THEN 'complementar'
              WHEN gr.eurocode LIKE '*%' THEN 'oem'
              ELSE 'rede'
            END) AS glass_types,
            COALESCE(
              array_agg(DISTINCT a.service) FILTER (WHERE a.service IS NOT NULL AND TRIM(a.service) != ''),
              '{}'::text[]
            ) AS service_types,
            COALESCE(
              array_agg(DISTINCT a.car) FILTER (WHERE a.car IS NOT NULL AND TRIM(a.car) != ''),
              '{}'::text[]
            ) AS car_models,
            COUNT(*) AS seen_count,
            MAX(gr.created_at) AS last_seen
          FROM glass_receptions gr
          LEFT JOIN appointments a ON a.id = gr.appointment_id
          WHERE gr.eurocode IS NOT NULL
            AND gr.is_return = false
          GROUP BY canonical
          ON CONFLICT (eurocode) DO UPDATE SET
            glass_types = (
              SELECT array_agg(DISTINCT g)
              FROM unnest(eurocode_cache.glass_types || EXCLUDED.glass_types) g
              WHERE g IS NOT NULL
            ),
            service_types = (
              SELECT array_agg(DISTINCT s)
              FROM unnest(COALESCE(eurocode_cache.service_types,'{}') || COALESCE(EXCLUDED.service_types,'{}')) s
              WHERE s IS NOT NULL AND TRIM(s) != ''
            ),
            car_models = (
              SELECT array_agg(DISTINCT c)
              FROM unnest(COALESCE(eurocode_cache.car_models,'{}') || COALESCE(EXCLUDED.car_models,'{}')) c
              WHERE c IS NOT NULL AND TRIM(c) != ''
            ),
            seen_count = GREATEST(eurocode_cache.seen_count, EXCLUDED.seen_count),
            last_seen  = GREATEST(eurocode_cache.last_seen,  EXCLUDED.last_seen)
          RETURNING eurocode
        `);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, count: bRows.length }) };
      }

      // Bulk sync: mark glasses consumed when linked appointment is Realizado
      if (d.action === 'sync_stock') {
        let allowedIds;
        if (user.role === 'admin') {
          const { rows: allP } = await client.query('SELECT id FROM portals');
          allowedIds = allP.map(r => r.id);
        } else {
          allowedIds = user.portalIds?.length ? user.portalIds : (user.portalId ? [user.portalId] : []);
        }
        if (!allowedIds.length) return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: [] }) };

        const { rows: consumed } = await client.query(`
          UPDATE glass_receptions gr
          SET status = 'consumed', updated_at = NOW()
          FROM appointments a
          WHERE gr.appointment_id = a.id
            AND a.executed = true
            AND gr.is_return = false
            AND gr.status NOT IN ('return', 'consumed')
            AND gr.portal_id = ANY($1)
          RETURNING gr.id, gr.eurocode, gr.order_ref, a.plate AS apt_plate, a.car AS apt_car
        `, [allowedIds]);

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: consumed }) };
      }

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

      // An orphan reception cannot be silently closed: it must first be tied
      // to the correct appointment so the plate/card are updated as well.
      if (d.status === 'received' && !rows[0].appointment_id) {
        await client.query(
          `UPDATE glass_receptions SET status = 'pending', updated_at = NOW() WHERE id = $1`,
          [rows[0].id]
        );
        return { statusCode: 409, headers, body: JSON.stringify({
          success: false,
          error: 'Associa primeiro esta receção ao agendamento correto.'
        }) };
      }

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
      if (!['admin', 'coordenador', 'coordinator'].includes(user.role)) {
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sem permissão' }) };
      }

      if (Array.isArray(body.ids)) {
        const ids = normalizeReceptionIds(body.ids);
        let transactionOpen = false;
        try {
          await client.query('BEGIN');
          transactionOpen = true;

          const { rows: targets } = await client.query(`
            SELECT id, portal_id, status, is_return
            FROM glass_receptions
            WHERE id = ANY($1::int[])
            FOR UPDATE
          `, [ids]);
          const allowedPortalIds = user.role === 'admin'
            ? []
            : await getAccessiblePortalIds(client, user, true);
          assertBulkDeleteTargets(ids, targets, allowedPortalIds, user.role === 'admin');

          const { rows: deleted } = await client.query(`
            DELETE FROM glass_receptions
            WHERE id = ANY($1::int[])
            RETURNING id
          `, [ids]);
          await client.query('COMMIT');
          transactionOpen = false;

          return { statusCode: 200, headers, body: JSON.stringify({
            success: true,
            count: deleted.length,
            deleted_ids: deleted.map(row => Number(row.id))
          }) };
        } catch (error) {
          if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      }

      const id = body.id || (event.path || '').split('/').filter(Boolean).pop();
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'ID obrigatório' }) };
      await client.query(`DELETE FROM glass_receptions WHERE id = $1`, [parseInt(id)]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };

  } catch (err) {
    console.error('glass-reception:', err);
    const msg = (err && err.message) ? err.message : String(err || 'Erro interno');
    const code = err?.statusCode || (msg.includes('autenticado') ? 401 : 500);
    return { statusCode: code, headers, body: JSON.stringify({ success: false, error: msg }) };
  } finally {
    if (client) client.release();
  }
};
