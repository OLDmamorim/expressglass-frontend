// netlify/functions/mycar-services.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const { ensureImagesTable } = require('./lib/mycar-images');
const { ensureNotasTables } = require('./lib/mycar-notas-encomenda');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function getUserFromToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  const token = authHeader.substring(7);
  return jwt.verify(token, JWT_SECRET);
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mycar_services (
      id SERIAL PRIMARY KEY,
      matricula VARCHAR(20) NOT NULL,
      data_servico DATE,
      descricao TEXT,
      valor DECIMAL(10,2),
      eurocode VARCHAR(100),
      status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'tratado', 'rejeitado')),
      email_from VARCHAR(255),
      email_subject VARCHAR(500),
      email_received_at TIMESTAMP,
      portal_id INTEGER,
      notas TEXT,
      obs_tecnico TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS obs_tecnico TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS email_body TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS historico TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS car TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS n_obra VARCHAR(50)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS work_type VARCHAR(20)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS in_treatment BOOLEAN DEFAULT FALSE`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS email_subject_normalized TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS email_thread_id VARCHAR(64)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS email_message_id VARCHAR(500)`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMP`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS last_reply_body TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS advance_authorized_at TIMESTAMP`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS advance_authorized_reason TEXT`);
  await client.query(`ALTER TABLE mycar_services DROP CONSTRAINT IF EXISTS mycar_services_status_check`);
  await client.query(`UPDATE mycar_services SET status = 'realizado' WHERE status = 'tratado'`);
  await client.query(`ALTER TABLE mycar_services ADD CONSTRAINT mycar_services_status_check CHECK (status IN ('pendente', 'encomendado', 'realizado', 'faturado', 'rejeitado'))`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_matricula ON mycar_services(matricula)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_status ON mycar_services(status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_portal ON mycar_services(portal_id)`);
  await ensureImagesTable(client);
  await ensureNotasTables(client);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let user;
  try {
    user = getUserFromToken(event);
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
  }

  const client = await pool.connect();
  try {
    await ensureTable(client);

    // GET - listar serviços
    if (event.httpMethod === 'GET') {
      const { matricula, status, portal_id, images, image } = event.queryStringParameters || {};

      // Imagens dos emails: a lista de uma matrícula (sem os dados) e cada
      // imagem à parte, para a resposta nunca passar o limite do Netlify.
      const ownPortal = user.role !== 'admin' && user.portalId;
      if (images) {
        const params = [images.toUpperCase()];
        if (ownPortal) params.push(user.portalId);
        const { rows } = await client.query(
          `SELECT DISTINCT ON (img.checksum)
                  img.id, img.service_id, img.filename, img.content_type, img.size_bytes, img.email_date
             FROM mycar_service_images img
             JOIN mycar_services ms ON ms.id = img.service_id
            WHERE UPPER(ms.matricula) = $1
              ${ownPortal ? 'AND (ms.portal_id = $2 OR ms.portal_id IS NULL)' : ''}
            ORDER BY img.checksum, img.id`,
          params
        );
        rows.sort((a, b) => a.id - b.id);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
      }
      // Documentos (PDF das Notas de Encomenda): a lista de uma matrícula.
      const { documents, document } = event.queryStringParameters || {};
      if (documents) {
        const params = [documents.toUpperCase()];
        if (ownPortal) params.push(user.portalId);
        const { rows } = await client.query(
          `SELECT doc.id, doc.service_id, doc.kind, doc.reference, doc.filename, doc.content_type, doc.size_bytes
             FROM mycar_service_documents doc
             JOIN mycar_services ms ON ms.id = doc.service_id
            WHERE UPPER(ms.matricula) = $1
              ${ownPortal ? 'AND (ms.portal_id = $2 OR ms.portal_id IS NULL)' : ''}
            ORDER BY doc.id`,
          params
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
      }

      if (image || document) {
        // Uma foto de 6 MB passa dos 6 MB de resposta do Netlify em base64:
        // vai em partes (`part`), que o mural junta. O mesmo para os PDFs.
        const table = image ? 'mycar_service_images' : 'mycar_service_documents';
        const IMAGE_PART_CHARS = 4 * 1024 * 1024;
        const part = Math.max(0, parseInt(event.queryStringParameters.part, 10) || 0);
        const params = [parseInt(image || document, 10), part * IMAGE_PART_CHARS + 1, IMAGE_PART_CHARS];
        if (ownPortal) params.push(user.portalId);
        const { rows } = await client.query(
          `SELECT img.id, img.filename, img.content_type, LENGTH(img.data) AS data_length,
                  SUBSTR(img.data, $2::int, $3::int) AS chunk
             FROM ${table} img
             JOIN mycar_services ms ON ms.id = img.service_id
            WHERE img.id = $1
              ${ownPortal ? 'AND (ms.portal_id = $4 OR ms.portal_id IS NULL)' : ''}`,
          params
        );
        if (rows.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: image ? 'Imagem não encontrada' : 'Documento não encontrado' }) };
        }
        const img = rows[0];
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: {
          id: img.id, filename: img.filename, content_type: img.content_type,
          part, parts: Math.max(1, Math.ceil(img.data_length / IMAGE_PART_CHARS)),
          chunk: img.chunk
        } }) };
      }

      const conditions = [];
      const params = [];
      let idx = 1;

      if (matricula) {
        conditions.push(`UPPER(matricula) LIKE UPPER($${idx++})`);
        params.push(`%${matricula}%`);
      }
      if (status) {
        conditions.push(`status = $${idx++}`);
        params.push(status);
      }
      if (user.role !== 'admin' && user.portalId) {
        conditions.push(`(portal_id = $${idx++} OR portal_id IS NULL)`);
        params.push(user.portalId);
      } else if (portal_id) {
        conditions.push(`portal_id = $${idx++}`);
        params.push(parseInt(portal_id));
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await client.query(
        `SELECT ms.*,
                apt.status    AS glass_status,
                apt.order_ref AS apt_order_ref,
                -- A mesma foto pode estar em vários vidros da matrícula: conta só
                -- no primeiro serviço que a tem, para a soma por matrícula bater
                -- certo com a galeria.
                (SELECT COUNT(*)::int FROM mycar_service_images img
                  WHERE img.service_id = ms.id
                    AND NOT EXISTS (
                      SELECT 1 FROM mycar_service_images first_img
                        JOIN mycar_services first_ms ON first_ms.id = first_img.service_id
                       WHERE first_img.checksum = img.checksum
                         AND first_img.service_id < img.service_id
                         AND REGEXP_REPLACE(UPPER(first_ms.matricula), '[^A-Z0-9]', '', 'g')
                           = REGEXP_REPLACE(UPPER(ms.matricula), '[^A-Z0-9]', '', 'g'))
                ) AS image_count,
                (SELECT COUNT(*)::int FROM mycar_service_documents doc WHERE doc.service_id = ms.id) AS document_count
         FROM mycar_services ms
         LEFT JOIN LATERAL (
           SELECT status, order_ref
           FROM appointments
           WHERE REGEXP_REPLACE(UPPER(plate), '[^A-Z0-9]', '', 'g')
               = REGEXP_REPLACE(UPPER(ms.matricula), '[^A-Z0-9]', '', 'g')
             AND executed IS NOT TRUE
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1
         ) apt ON true
         ${where}
         ORDER BY ms.email_received_at DESC NULLS LAST, ms.created_at DESC`,
        params
      );

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    // PATCH - atualizar status de um serviço (ou marcar como visto)
    if (event.httpMethod === 'PATCH') {
      const { id, status, notas, obs_tecnico, viewed, work_type, matricula, in_treatment } = JSON.parse(event.body || '{}');

      // Bulk: togglear em tratamento por matrícula
      if (matricula && in_treatment !== undefined && !id) {
        const portalCond = user.role !== 'admin' && user.portalId
          ? 'AND (portal_id = $3 OR portal_id IS NULL)'
          : '';
        const params = [in_treatment, matricula.toUpperCase()];
        if (user.role !== 'admin' && user.portalId) params.push(user.portalId);
        await client.query(
          `UPDATE mycar_services SET in_treatment = $1 WHERE UPPER(matricula) = $2 ${portalCond}`,
          params
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Marcar como visto (pode ser sem status)
      if (id && viewed && !status) {
        await client.query(
          `UPDATE mycar_services SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = $1`,
          [id]
        );
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (!id || !status) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'id e status são obrigatórios' }) };
      }
      if (!['pendente', 'encomendado', 'realizado', 'faturado', 'rejeitado'].includes(status)) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Status inválido' }) };
      }

      const setClauses = [`status = $1`, `updated_at = NOW()`, `viewed_at = COALESCE(viewed_at, NOW())`];
      const params = [status];
      let idx = 2;

      if (notas !== undefined) {
        setClauses.push(`notas = $${idx++}`);
        params.push(notas);
      }
      if (obs_tecnico !== undefined) {
        setClauses.push(`obs_tecnico = $${idx++}`);
        params.push(obs_tecnico);
      }
      if (work_type !== undefined) {
        setClauses.push(`work_type = $${idx++}`);
        params.push(work_type);
      }
      params.push(id);

      const { rows } = await client.query(
        `UPDATE mycar_services SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
      );

      if (rows.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Serviço não encontrado' }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // POST - criar serviços manualmente
    if (event.httpMethod === 'POST') {
      const { services } = JSON.parse(event.body || '{}');

      if (!services || !Array.isArray(services) || services.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Nenhum serviço para criar' }) };
      }

      const created = [];
      for (const svc of services) {
        if (!svc.matricula) continue;
        const { rows } = await client.query(
          `INSERT INTO mycar_services
             (matricula, data_servico, descricao, valor, eurocode, status,
              email_from, email_subject, email_received_at, portal_id, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            svc.matricula.toUpperCase().trim(),
            svc.data_servico || null,
            svc.descricao || null,
            svc.valor !== undefined ? svc.valor : null,
            svc.eurocode || null,
            svc.status || 'pendente',
            svc.email_from || null,
            svc.email_subject || null,
            svc.email_received_at || new Date().toISOString(),
            svc.portal_id || user.portalId || null,
            svc.notas || null
          ]
        );
        created.push(rows[0]);
      }

      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: created, count: created.length }) };
    }

    // DELETE - apenas admin
    if (event.httpMethod === 'DELETE') {
      if (user.role !== 'admin') {
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Apenas administradores podem eliminar' }) };
      }
      const { id } = JSON.parse(event.body || '{}');
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'id é obrigatório' }) };
      }
      await client.query('DELETE FROM mycar_services WHERE id = $1', [id]);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };

  } catch (error) {
    console.error('❌ Erro mycar-services:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Erro interno do servidor' }) };
  } finally {
    client.release();
  }
};
