// netlify/functions/mycar-services.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS car TEXT`);
  await client.query(`ALTER TABLE mycar_services ADD COLUMN IF NOT EXISTS n_obra VARCHAR(50)`);
  await client.query(`ALTER TABLE mycar_services DROP CONSTRAINT IF EXISTS mycar_services_status_check`);
  await client.query(`UPDATE mycar_services SET status = 'realizado' WHERE status = 'tratado'`);
  await client.query(`ALTER TABLE mycar_services ADD CONSTRAINT mycar_services_status_check CHECK (status IN ('pendente', 'encomendado', 'realizado', 'faturado', 'rejeitado'))`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_matricula ON mycar_services(matricula)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_status ON mycar_services(status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mycar_portal ON mycar_services(portal_id)`);
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
      const { matricula, status, portal_id } = event.queryStringParameters || {};

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
        `SELECT * FROM mycar_services ${where} ORDER BY email_received_at DESC NULLS LAST, created_at DESC`,
        params
      );

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows }) };
    }

    // PATCH - atualizar status de um serviço (ou marcar como visto)
    if (event.httpMethod === 'PATCH') {
      const { id, status, notas, obs_tecnico, viewed } = JSON.parse(event.body || '{}');

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
