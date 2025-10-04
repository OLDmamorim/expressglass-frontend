// netlify/functions/users.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
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

    // ---------- GET - Listar todos os utilizadores ----------
    if (event.httpMethod === 'GET') {
      const query = `
        SELECT u.id, u.username, u.portal_id, u.role, u.created_at, u.updated_at,
               p.name as portal_name
        FROM users u
        LEFT JOIN portals p ON u.portal_id = p.id
        ORDER BY u.username ASC
      `;
      
      const { rows } = await pool.query(query);
      
      // Não retornar password_hash
      const users = rows.map(user => ({
        id: user.id,
        username: user.username,
        portalId: user.portal_id,
        portalName: user.portal_name,
        role: user.role,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      }));
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: users })
      };
    }

    // ---------- POST - Criar novo utilizador ----------
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');

      if (!data.username || !data.password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Username e password são obrigatórios' 
          })
        };
      }

      // Verificar se username já existe
      const checkUser = await pool.query(
        'SELECT id FROM users WHERE username = $1',
        [data.username]
      );

      if (checkUser.rows.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Username já existe' 
          })
        };
      }

      // Validar portal_id se não for admin
      if (data.role !== 'admin' && !data.portal_id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Utilizadores normais devem ter um portal atribuído' 
          })
        };
      }

      // Hash da password
      const passwordHash = await bcrypt.hash(data.password, 10);

      const query = `
        INSERT INTO users (username, password_hash, portal_id, role, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, username, portal_id, role, created_at, updated_at
      `;
      
      const values = [
        data.username.trim(),
        passwordHash,
        data.portal_id || null,
        data.role || 'user',
        new Date().toISOString(),
        new Date().toISOString()
      ];

      const { rows } = await pool.query(query, values);
      
      console.log(`✅ Utilizador criado: ${data.username}`);
      
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, data: rows[0] })
      };
    }

    // ---------- PUT - Atualizar utilizador ----------
    if (event.httpMethod === 'PUT') {
      const id = (event.path || '').split('/').pop();
      const data = JSON.parse(event.body || '{}');

      // Se password foi fornecida, fazer hash
      let passwordHash = null;
      if (data.password) {
        passwordHash = await bcrypt.hash(data.password, 10);
      }

      // Construir query dinâmica
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (data.username) {
        updates.push(`username = $${paramIndex++}`);
        values.push(data.username.trim());
      }

      if (passwordHash) {
        updates.push(`password_hash = $${paramIndex++}`);
        values.push(passwordHash);
      }

      if (data.portal_id !== undefined) {
        updates.push(`portal_id = $${paramIndex++}`);
        values.push(data.portal_id || null);
      }

      if (data.role) {
        updates.push(`role = $${paramIndex++}`);
        values.push(data.role);
      }

      updates.push(`updated_at = $${paramIndex++}`);
      values.push(new Date().toISOString());

      values.push(id);

      const query = `
        UPDATE users 
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, username, portal_id, role, created_at, updated_at
      `;

      const { rows } = await pool.query(query, values);
      
      if (rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Utilizador não encontrado' 
          })
        };
      }

      console.log(`✅ Utilizador atualizado: ${rows[0].username}`);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: rows[0] })
      };
    }

    // ---------- DELETE - Eliminar utilizador ----------
    if (event.httpMethod === 'DELETE') {
      const id = (event.path || '').split('/').pop();

      const { rows } = await pool.query(
        'DELETE FROM users WHERE id = $1 RETURNING id, username',
        [id]
      );
      
      if (rows.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Utilizador não encontrado' 
          })
        };
      }

      console.log(`✅ Utilizador eliminado: ${rows[0].username}`);
      
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
    console.error('❌ Erro na gestão de utilizadores:', error);
    
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
