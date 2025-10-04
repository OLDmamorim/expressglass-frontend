// netlify/functions/portals.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

// Verificar se o utilizador é admin
function verifyAdmin(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Não autenticado');
  }

  const token = authHeader.substring(7);
  const decoded = jwt.verify(token, JWT_SECRET);
  
  if (decoded.role !== 'admin') {
    throw new Error('Acesso negado: apenas administradores');
  }
  
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
    // Verificar autenticação de admin
    verifyAdmin(event);

    // ---------- GET - Listar todos os portais ----------
    if (event.httpMethod === 'GET') {
      const query = `
        SELECT id, name, departure_address, localities, created_at, updated_at,
               (SELECT COUNT(*) FROM users WHERE portal_id = portals.id) as user_count
        FROM portals
        ORDER BY name ASC
      `;
      
      const { rows } = await pool.query(query);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: rows })
      };
    }

    // ---------- POST - Criar novo portal ----------
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');

      if (!data.name || !data.departure_address) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Nome e morada de partida são obrigatórios' 
          })
        };
      }

      // Validar localities (deve ser um objeto JSON)
      let localities = data.localities || {};
      if (typeof localities === 'string') {
        try {
          localities = JSON.parse(localities);
        } catch (e) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              success: false, 
              error: 'Formato de localidades inválido' 
            })
          };
        }
      }

      const query = `
        INSERT INTO portals (name, departure_address, localities, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      
      const values = [
        data.name.trim(),
        data.departure_address.trim(),
        JSON.stringify(localities),
        new Date().toISOString(),
        new Date().toISOString()
      ];

      const { rows } = await pool.query(query, values);
      
      console.log(`✅ Portal criado: ${data.name}`);
      
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, data: rows[0] })
      };
    }

    // ---------- PUT - Atualizar portal ----------
    if (event.httpMethod === 'PUT') {
      const id = (event.path || '').split('/').pop();
      const data = JSON.parse(event.body || '{}');

      // Validar localities
      let localities = data.localities;
      if (typeof localities === 'string') {
        try {
          localities = JSON.parse(localities);
        } catch (e) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              success: false, 
              error: 'Formato de localidades inválido' 
            })
          };
        }
      }

      const query = `
        UPDATE portals 
        SET name = $1, 
            departure_address = $2, 
            localities = $3,
            updated_at = $4
        WHERE id = $5
        RETURNING *
      `;
      
      const values = [
        data.name?.trim(),
        data.departure_address?.trim(),
        JSON.stringify(localities),
        new Date().toISOString(),
        id
      ];

      const { rows } = await pool.query(query, values);
      
      if (rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Portal não encontrado' 
          })
        };
      }

      console.log(`✅ Portal atualizado: ${data.name}`);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: rows[0] })
      };
    }

    // ---------- DELETE - Eliminar portal ----------
    if (event.httpMethod === 'DELETE') {
      const id = (event.path || '').split('/').pop();

      // Verificar se há utilizadores associados
      const checkUsers = await pool.query(
        'SELECT COUNT(*) as count FROM users WHERE portal_id = $1',
        [id]
      );

      if (parseInt(checkUsers.rows[0].count) > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Não é possível eliminar portal com utilizadores associados' 
          })
        };
      }

      const { rows } = await pool.query(
        'DELETE FROM portals WHERE id = $1 RETURNING *',
        [id]
      );
      
      if (rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Portal não encontrado' 
          })
        };
      }

      console.log(`✅ Portal eliminado: ${rows[0].name}`);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: rows[0] })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: `Método ${event.httpMethod} não permitido` 
      })
    };

  } catch (error) {
    console.error('❌ Erro na gestão de portais:', error);
    
    if (error.message.includes('Não autenticado') || error.message.includes('Acesso negado')) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ success: false, error: error.message })
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: 'Erro interno do servidor' 
      })
    };
  }
};
