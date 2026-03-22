// netlify/functions/auth-verify.js
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

    // Buscar dados completos do utilizador e portal
    const query = `
      SELECT u.id, u.username, u.portal_id, u.role,
             p.name as portal_name, p.departure_address, p.localities, p.portal_type
      FROM users u
      LEFT JOIN portals p ON u.portal_id = p.id
      WHERE u.id = $1
    `;
    
    const { rows } = await pool.query(query, [decoded.userId]);

    if (rows.length === 0) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Utilizador não encontrado' 
        })
      };
    }

    const user = rows[0];

    // Buscar portais do coordenador
    let coordPortals = [];
    if (user.role === 'coordenador') {
      const cp = await pool.query(`
        SELECT p.id, p.name, p.departure_address, p.localities, p.portal_type
        FROM coordinator_portals cp
        JOIN portals p ON cp.portal_id = p.id
        WHERE cp.user_id = $1
        ORDER BY p.name
      `, [user.id]);
      coordPortals = cp.rows.map(p => ({
        id: p.id,
        name: p.name,
        departureAddress: p.departure_address,
        localities: p.localities,
        portalType: p.portal_type || 'sm'
      }));
    }

    // Preparar dados do utilizador
    const userData = {
      id: user.id,
      username: user.username,
      role: user.role,
      portal: user.portal_id ? {
        id: user.portal_id,
        name: user.portal_name,
        departureAddress: user.departure_address,
        localities: user.localities,
        portalType: user.portal_type || 'sm'
      } : (coordPortals.length > 0 ? coordPortals[0] : null)
    };

    // Adicionar lista de portais para coordenadores
    if (user.role === 'coordenador' && coordPortals.length > 0) {
      userData.portals = coordPortals;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: userData
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
