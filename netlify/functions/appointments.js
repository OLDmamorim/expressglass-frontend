// CORREÇÃO PARA: expressglass-backend/netlify/functions/appointments.js
// Substituir o conteúdo completo do ficheiro por este código

const { Pool } = require('pg');

// Configuração da base de dados Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
});

exports.handler = async (event, context) => {
  console.log('🚀 Função appointments chamada:', event.httpMethod, event.path);
  
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Responder a OPTIONS (preflight CORS)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    await client.connect();
    console.log('✅ Conectado à base de dados');

    // GET - Listar todos os agendamentos
    if (event.httpMethod === 'GET') {
      console.log('📋 Listando agendamentos...');
      
      const query = `
        SELECT id, date, period, plate, car, service, locality, status, 
               notes, address, extra, created_at, updated_at
        FROM appointments 
        ORDER BY date ASC, period ASC, created_at ASC
      `;
      
      const result = await pool.query(query);
      console.log(`✅ ${result.rows.length} agendamentos encontrados`);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: result.rows
        })
      };
    }

    // POST - Criar novo agendamento
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      console.log('➕ Criando agendamento:', data);
      
      // Validações básicas
      if (!data.plate || !data.car || !data.service || !data.locality) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Campos obrigatórios: plate, car, service, locality'
          })
        };
      }
      
      // INCLUIR address na inserção
      const query = `
        INSERT INTO appointments (
          date, period, plate, car, service, locality, status, 
          notes, address, extra, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        ) RETURNING *
      `;
      
      const values = [
        data.date || null,
        data.period || null,
        data.plate.trim(),
        data.car.trim(),
        data.service,
        data.locality,
        data.status || 'NE',
        data.notes || null,
        data.address || null, // ← CAMPO CORRIGIDO
        data.extra || null,
        new Date().toISOString(),
        new Date().toISOString()
      ];
      
      console.log('📤 Inserindo valores:', values);
      
      const result = await client.query(query, values);
      console.log('✅ Agendamento criado:', result.rows[0]);
      
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          data: result.rows[0]
        })
      };
    }

    // PUT - Atualizar agendamento
    if (event.httpMethod === 'PUT') {
      const pathParts = event.path.split('/');
      const id = pathParts[pathParts.length - 1];
      const data = JSON.parse(event.body);
      
      console.log('✏️ Atualizando agendamento:', { id, data });
      
      // INCLUIR address na atualização
      const query = `
        UPDATE appointments SET 
          date = $1, period = $2, plate = $3, car = $4, 
          service = $5, locality = $6, status = $7, 
          notes = $8, address = $9, extra = $10, updated_at = $11
        WHERE id = $12 
        RETURNING *
      `;
      
      const values = [
        data.date || null,
        data.period || null,
        data.plate ? data.plate.trim() : null,
        data.car ? data.car.trim() : null,
        data.service || null,
        data.locality || null,
        data.status || 'NE',
        data.notes || null,
        data.address || null, // ← CAMPO CORRIGIDO
        data.extra || null,
        new Date().toISOString(),
        id
      ];
      
      console.log('📤 Atualizando valores:', values);
      
      const result = await client.query(query, values);
      
      if (result.rows.length === 0) {
        console.log('❌ Agendamento não encontrado:', id);
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Agendamento não encontrado'
          })
        };
      }
      
      console.log('✅ Agendamento atualizado:', result.rows[0]);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: result.rows[0]
        })
      };
    }

    // DELETE - Eliminar agendamento
    if (event.httpMethod === 'DELETE') {
      const pathParts = event.path.split('/');
      const id = pathParts[pathParts.length - 1];
      
      console.log('🗑️ Eliminando agendamento:', id);
      
      const query = 'DELETE FROM appointments WHERE id = $1 RETURNING *';
      const result = await client.query(query, [id]);
      
      if (result.rows.length === 0) {
        console.log('❌ Agendamento não encontrado para eliminar:', id);
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Agendamento não encontrado'
          })
        };
      }
      
      console.log('✅ Agendamento eliminado:', result.rows[0]);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: result.rows[0]
        })
      };
    }

    // Método não suportado
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: `Método ${event.httpMethod} não permitido`
      })
    };

  } catch (error) {
    console.error('❌ Erro na função appointments:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  } finally {
    try {
      await client.end();
      console.log('🔌 Conexão à base de dados fechada');
    } catch (e) {
      console.warn('⚠️ Erro ao fechar conexão:', e.message);
    }
  }
};
