// netlify/functions/appointments.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

// Extrair informações do utilizador do token
function getUserFromToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Não autenticado');
  }

  const token = authHeader.substring(7);
  const decoded = jwt.verify(token, JWT_SECRET);
  
  return decoded;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Verificar autenticação e obter portal_id do utilizador
    const user = getUserFromToken(event);
    const portalId = user.portalId;

    if (!portalId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: 'Utilizador sem portal atribuído' })
      };
    }

    // ---------- GET ----------
    if (event.httpMethod === 'GET') {
      const q = `
        SELECT id, date, period, plate, car, service, locality, status,
               notes, address, extra, phone, km, sortIndex, created_at, updated_at
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

      if (!data.plate || !data.car || !data.service || !data.locality) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Campos obrigatórios: plate, car, service, locality' }) };
      }

      // Usar createdAt do Excel se disponível, senão usar data atual
      const createdAt = data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString();
      
      const q = `
        INSERT INTO appointments (
          date, period, plate, car, service, locality, status,
          notes, address, extra, phone, km, sortIndex, portal_id, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
        ) RETURNING *
      `;
      const v = [
        data.date || null,
        data.period || null,
        String(data.plate).trim(),
        String(data.car).trim(),
        data.service || null,
        data.locality || null,
        data.status || 'NE',
        data.notes || null,
        data.address || null,
        data.extra || null,
        data.phone || null,
        data.km || null,
        data.sortIndex || 1,
        portalId, // Associar ao portal do utilizador
        createdAt, // Usar data do Excel ou data atual
        new Date().toISOString()
      ];

      const { rows } = await pool.query(q, v);
      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ---------- PUT ----------
    if (event.httpMethod === 'PUT') {
      const id = (event.path || '').split('/').pop();
      const data = JSON.parse(event.body || '{}');

      // Verificar se o agendamento pertence ao portal do utilizador
      const checkQuery = 'SELECT id FROM appointments WHERE id = $1 AND portal_id = $2';
      const checkResult = await pool.query(checkQuery, [id, portalId]);

      if (checkResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' })
        };
      }

      const q = `
        UPDATE appointments SET
          date = $1, period = $2, plate = $3, car = $4,
          service = $5, locality = $6, status = $7,
          notes = $8, address = $9, extra = $10, phone = $11,
          km = $12, sortIndex = $13, updated_at = $14
        WHERE id = $15 AND portal_id = $16
        RETURNING *
      `;
      const v = [
        data.date || null,
        data.period || null,
        data.plate ? String(data.plate).trim() : null,
        data.car ? String(data.car).trim() : null,
        data.service || null,
        data.locality || null,
        data.status || 'NE',
        data.notes || null,
        data.address || null,
        data.extra || null,
        data.phone || null,
        data.km || null,
        data.sortIndex || null,
        new Date().toISOString(),
        id,
        portalId
      ];

      const { rows } = await pool.query(q, v);
      if (!rows.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    // ---------- DELETE ----------
    if (event.httpMethod === 'DELETE') {
      const id = (event.path || '').split('/').pop();
      
      console.log(`🗑️ DELETE - Tentando eliminar ID: ${id}, Portal: ${portalId}`);
      
      // Primeiro verificar se o agendamento existe e qual o seu portal
      const checkQuery = 'SELECT id, portal_id, plate FROM appointments WHERE id = $1';
      const checkResult = await pool.query(checkQuery, [id]);
      
      if (checkResult.rows.length === 0) {
        console.log(`❌ DELETE - Agendamento ${id} não existe na base de dados`);
        return { 
          statusCode: 404, 
          headers, 
          body: JSON.stringify({ success: false, error: 'Agendamento não encontrado na base de dados' }) 
        };
      }
      
      const appointment = checkResult.rows[0];
      console.log(`📋 DELETE - Agendamento encontrado: ID=${appointment.id}, Portal=${appointment.portal_id}, Matrícula=${appointment.plate}`);
      
      if (appointment.portal_id !== portalId) {
        console.log(`⚠️ DELETE - Portal não corresponde! Agendamento pertence ao portal ${appointment.portal_id}, utilizador está no portal ${portalId}`);
        return { 
          statusCode: 403, 
          headers, 
          body: JSON.stringify({ success: false, error: 'Não tem permissão para eliminar este agendamento (pertence a outro portal)' }) 
        };
      }
      
      // Eliminar o agendamento
      const { rows } = await pool.query(
        'DELETE FROM appointments WHERE id = $1 AND portal_id = $2 RETURNING *',
        [id, portalId]
      );
      
      if (!rows.length) {
        console.log(`❌ DELETE - Falha ao eliminar (não devia acontecer)`);
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
      }
      
      console.log(`✅ DELETE - Agendamento ${id} eliminado com sucesso`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: rows[0] }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: `Método ${event.httpMethod} não permitido` }) };

  } catch (err) {
    console.error('Erro na function appointments:', err);
    
    if (err.message === 'Não autenticado' || err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: 'Não autenticado ou token inválido' })
      };
    }
    
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
