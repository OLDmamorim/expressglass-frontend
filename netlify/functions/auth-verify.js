// netlify/functions/auth-verify.js
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Método não permitido' })
    };
  }

  try {
    // Extrair token do header Authorization
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Token não fornecido' 
        })
      };
    }

    const token = authHeader.substring(7); // Remove "Bearer "

    // Verificar e decodificar token
    const decoded = jwt.verify(token, JWT_SECRET);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: {
          userId: decoded.userId,
          username: decoded.username,
          portalId: decoded.portalId,
          portalName: decoded.portalName,
          role: decoded.role
        }
      })
    };

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Token expirado' 
        })
      };
    }

    if (error.name === 'JsonWebTokenError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Token inválido' 
        })
      };
    }

    console.error('❌ Erro ao verificar token:', error);
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
