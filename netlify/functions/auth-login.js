// netlify/functions/auth-login.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Chave secreta para JWT (deve estar nas variáveis de ambiente)
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d'; // Token válido por 7 dias

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Método não permitido' })
    };
  }

  try {
    const { username, password } = JSON.parse(event.body || '{}');

    // Validar dados de entrada
    if (!username || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Username e password são obrigatórios' 
        })
      };
    }

    // Buscar utilizador na base de dados
    const query = `
      SELECT u.id, u.username, u.password_hash, u.portal_id, u.role,
             p.name as portal_name, p.departure_address, p.localities
      FROM users u
      LEFT JOIN portals p ON u.portal_id = p.id
      WHERE u.username = $1
    `;
    
    const { rows } = await pool.query(query, [username]);

    if (rows.length === 0) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Credenciais inválidas' 
        })
      };
    }

    const user = rows[0];

    // Verificar password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Credenciais inválidas' 
        })
      };
    }

    // Gerar token JWT
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        portalId: user.portal_id,
        portalName: user.portal_name,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Preparar dados do utilizador (sem password)
    const userData = {
      id: user.id,
      username: user.username,
      role: user.role,
      portal: user.portal_id ? {
        id: user.portal_id,
        name: user.portal_name,
        departureAddress: user.departure_address,
        localities: user.localities
      } : null
    };

    console.log(`✅ Login bem-sucedido: ${username} (${user.role})`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        token,
        user: userData
      })
    };

  } catch (error) {
    console.error('❌ Erro no login:', error);
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
