// netlify/functions/settings.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function verifyToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  const token = authHeader.substring(7);
  return jwt.verify(token, JWT_SECRET);
}

// Valores default
const DEFAULT_SETTINGS = {
  serviceTimes: { PB: 90, LT: 45, OC: 60, REP: 30, POL: 45 },
  avgSpeedKmh: 50,
  fuelPer100km: 7.5,
  fuelPricePerLiter: 1.65
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    verifyToken(event);

    // GET - Obter configurações
    if (event.httpMethod === 'GET') {
      const { rows } = await pool.query(
        "SELECT value FROM settings WHERE key = 'global' LIMIT 1"
      );
      
      const settings = rows.length > 0 ? JSON.parse(rows[0].value) : DEFAULT_SETTINGS;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: { ...DEFAULT_SETTINGS, ...settings } })
      };
    }

    // PUT - Guardar configurações (admin only)
    if (event.httpMethod === 'PUT') {
      const user = verifyToken(event);
      if (user.role !== 'admin') {
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Apenas administradores' }) };
      }

      const data = JSON.parse(event.body || '{}');
      const settingsJson = JSON.stringify(data);

      await pool.query(`
        INSERT INTO settings (key, value, updated_at) 
        VALUES ('global', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
      `, [settingsJson]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };

  } catch (error) {
    console.error('Erro settings:', error);
    if (error.message.includes('Não autenticado')) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Erro interno' }) };
  }
};
