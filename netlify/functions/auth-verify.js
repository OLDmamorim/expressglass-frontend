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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Token não fornecido' }) };
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const query = `
      SELECT u.id, u.username, u.portal_id, u.role,
             p.name as portal_name, p.departure_address, p.localities, p.portal_type, p.vehicle_plate
      FROM users u
      LEFT JOIN portals p ON u.portal_id = p.id
      WHERE u.id = $1
    `;
    const { rows } = await pool.query(query, [decoded.userId]);

    if (rows.length === 0) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Utilizador não encontrado' }) };
    }

    const user = rows[0];

    // Coordenador E Comercial: buscar portais atribuídos
    let multiPortals = [];
    if (user.role === 'coordenador' || user.role === 'comercial') {
      const cp = await pool.query(`
        SELECT p.id, p.name, p.departure_address, p.localities, p.portal_type, p.vehicle_plate
        FROM coordinator_portals cp
        JOIN portals p ON cp.portal_id = p.id
        WHERE cp.user_id = $1
        ORDER BY p.name
      `, [user.id]);

      multiPortals = cp.rows.map(p => ({
        id: p.id,
        name: p.name,
        departureAddress: p.departure_address,
        localities: p.localities,
        portalType: p.portal_type || 'sm',
        vehiclePlate: p.vehicle_plate || null
      }));
    }

    const userData = {
      id: user.id,
      username: user.username,
      role: user.role,
      portal: user.portal_id ? {
        id: user.portal_id,
        name: user.portal_name,
        departureAddress: user.departure_address,
        localities: user.localities,
        portalType: user.portal_type || 'sm',
        vehiclePlate: user.vehicle_plate || null
      } : (multiPortals.length > 0 ? multiPortals[0] : null)
    };

    // Adicionar lista de portais para coordenador e comercial
    if ((user.role === 'coordenador' || user.role === 'comercial') && multiPortals.length > 0) {
      userData.portals = multiPortals;
    }

    // Coordenador: buscar portais de consulta (read-only)
    if (user.role === 'coordenador') {
      const consult = await pool.query(`
        SELECT p.id, p.name, p.departure_address, p.localities, p.portal_type, p.vehicle_plate
        FROM consultable_portals cpc
        JOIN portals p ON cpc.portal_id = p.id
        WHERE cpc.user_id = $1
        ORDER BY p.name
      `, [user.id]);

      const consultablePortals = consult.rows.map(p => ({
        id: p.id,
        name: p.name,
        departureAddress: p.departure_address,
        localities: p.localities,
        portalType: p.portal_type || 'sm',
        vehiclePlate: p.vehicle_plate || null,
        readOnly: true
      }));

      if (consultablePortals.length > 0) {
        userData.consultablePortals = consultablePortals;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: userData }) };

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Token expirado' }) };
    }
    if (error.name === 'JsonWebTokenError') {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Token inválido' }) };
    }
    console.error('❌ Erro ao verificar token:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Erro interno do servidor' }) };
  }
};
