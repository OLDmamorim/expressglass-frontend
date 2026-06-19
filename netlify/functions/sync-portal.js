// netlify/functions/sync-portal.js
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
    // Migration guards — safe to run repeatedly
    try {
      await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS n_obra VARCHAR(50)`);
      await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS order_ref TEXT`);
      await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reception_ref TEXT`);
      await pool.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS car TEXT`);
      await pool.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS n_obra VARCHAR(50)`);
    } catch(e) { console.warn('Migration warning:', e.message); }

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

    const results = { created: 0, updated: 0, skipped: 0, errors: 0, deleted, error_samples: [] };
    const todayISO = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    // Lookup em lote de TODOS os registos deste portal (incluindo realizados).
    // Regra: mesma matrícula = mesmo registo, nunca duplicar — apenas atualizar.
    // Ordenar executados por último para que o Map fique com o não-realizado quando existe um de cada.
    const { rows: existingRows } = await pool.query(
      `SELECT id, date, UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) AS plate_norm
       FROM appointments
       WHERE portal_id = $1
         AND UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) = ANY($2::text[])
       ORDER BY (executed IS TRUE) ASC`,
      [portal_id, Array.from(excelNorms)]
    );
    const existingByPlate = new Map(existingRows.map(r => [r.plate_norm, r]));

    // Lookup por n_obra para todos os estados (incluindo realizados).
    const excelNObras = services.map(s => s.n_obra).filter(Boolean);
    let existingByNObra = new Map();
    if (excelNObras.length > 0) {
      const { rows: nObraRows } = await pool.query(
        `SELECT id, date, n_obra, UPPER(REGEXP_REPLACE(plate, '[^A-Z0-9]', '', 'g')) AS plate_norm
         FROM appointments
         WHERE portal_id = $1 AND n_obra = ANY($2::text[])
         ORDER BY (executed IS TRUE) ASC`,
        [portal_id, excelNObras]
      );
      existingByNObra = new Map(nObraRows.map(r => [r.n_obra, r]));
    }

    // Dados existentes nunca são apagados: campos simples só se preenchem
    // quando vazios; notas/extra acrescentam o que o Excel traz de novo.
    // Os parâmetros levam cast ::text explícito porque, quando vêm a null,
    // o Postgres não consegue inferir o tipo só a partir do CASE/POSITION
    // (erro "could not determine data type of parameter").
    const mergeText = (col, idx) => `${col}=CASE
         WHEN ${idx}::text IS NULL OR ${idx}::text='' THEN ${col}
         WHEN ${col} IS NULL OR ${col}='' THEN ${idx}::text
         WHEN POSITION(${idx}::text IN ${col}) > 0 THEN ${col}
         ELSE ${col} || ' | ' || ${idx}::text END`;

    async function processService(svc) {
      const plateNorm = norm(svc.plate);
      if (!plateNorm) { results.errors++; return; }

      try {
        // Priorizar match por n_obra; fallback para plate
        const existing = (svc.n_obra && existingByNObra.get(String(svc.n_obra))) || existingByPlate.get(plateNorm);

        if (existing) {
          // Já agendado — atualizar dados e data se necessário
          const existingDate = existing.date ? String(existing.date).slice(0, 10) : null;
          const excelDate = svc.date ? String(svc.date).slice(0, 10) : null;
          const shouldUpdateDate = excelDate && excelDate >= todayISO && (!existingDate || existingDate < todayISO);

          if (shouldUpdateDate) {
            await pool.query(
              `UPDATE appointments SET date=$1, period=$2,
               car=COALESCE(NULLIF(car,''),$3), ${mergeText('notes','$4')}, ${mergeText('extra','$5')},
               phone=COALESCE(NULLIF(phone,''),$6), client_name=COALESCE(NULLIF(client_name,''),$7),
               n_obra=COALESCE(NULLIF(n_obra,''),$10), auto_imported=true, confirmed=false, updated_at=$8,
               order_ref=COALESCE(NULLIF(order_ref,''),$11), reception_ref=COALESCE(NULLIF(reception_ref,''),$12) WHERE id=$9`,
              [excelDate, svc.period||null, svc.car||null, svc.notes||null, svc.extra||null, svc.phone||null, svc.client_name||null, now, existing.id, svc.n_obra||null, normalizeOrderRef(svc.order_ref), normalizeReceptionRef(svc.reception_ref)]
            );
          } else {
            await pool.query(
              `UPDATE appointments SET
               car=COALESCE(NULLIF(car,''),$1), ${mergeText('notes','$2')}, ${mergeText('extra','$3')},
               phone=COALESCE(NULLIF(phone,''),$4), client_name=COALESCE(NULLIF(client_name,''),$5),
               n_obra=COALESCE(NULLIF(n_obra,''),$7), updated_at=$6,
               order_ref=COALESCE(NULLIF(order_ref,''),$9), reception_ref=COALESCE(NULLIF(reception_ref,''),$10) WHERE id=$8`,
              [svc.car||null, svc.notes||null, svc.extra||null, svc.phone||null, svc.client_name||null, now, svc.n_obra||null, existing.id, normalizeOrderRef(svc.order_ref), normalizeReceptionRef(svc.reception_ref)]
            );
          }
          results.updated++;
        } else {
          // Não existe → criar
          await pool.query(
            `INSERT INTO appointments (
               date, period, plate, car, service, locality, status,
               notes, extra, phone, client_name, n_obra, km, sortIndex, "glassOrdered",
               auto_imported, confirmed, portal_id, created_at, updated_at,
               order_ref, reception_ref
             ) VALUES ($1,$2,$3,$4,$5,null,$6,$7,$8,$9,$10,$11,null,1,false,$12,false,$13,$14,$15,$16,$17)`,
            [
              svc.date||null, svc.period||null,
              String(svc.plate).trim(), svc.car||null, svc.service||null,
              svc.status||'NE', svc.notes||null, svc.extra||null, svc.phone||null,
              svc.client_name||null, svc.n_obra||null,
              !!svc.date, portal_id,
              svc.createdAt||now, now,
              normalizeOrderRef(svc.order_ref), normalizeReceptionRef(svc.reception_ref)
            ]
          );
          results.created++;
        }

        // Sincronizar car e n_obra no mural mycar_services se a matrícula constar
        if (svc.car || svc.n_obra) {
          const myCols = [];
          const myVals = [];
          let myIdx = 1;
          if (svc.car) { myCols.push(`car = $${myIdx++}`); myVals.push(svc.car); }
          if (svc.n_obra) { myCols.push(`n_obra = $${myIdx++}`); myVals.push(svc.n_obra); }
          myCols.push(`updated_at = $${myIdx++}`);
          myVals.push(now);
          myVals.push(plateNorm);
          try {
            await pool.query(
              `UPDATE mycar_services SET ${myCols.join(', ')} WHERE UPPER(REGEXP_REPLACE(matricula, '[^A-Z0-9]', '', 'g')) = $${myIdx}`,
              myVals
            );
          } catch(e) { console.warn('mycar_services sync warning:', e.message); }
        }

      } catch (err) {
        console.error('Erro svc', svc.plate, err.message);
        results.errors++;
        if (results.error_samples.length < 5) results.error_samples.push(`${svc.plate}: ${err.message}`);
      }
    }

    // Processar com concorrência limitada (em vez de 1 a 1) para caber dentro
    // do tempo limite da function mesmo em portais com muitos serviços.
    const CONCURRENCY = 8;
    for (let i = 0; i < services.length; i += CONCURRENCY) {
      const chunk = services.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(processService));
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
