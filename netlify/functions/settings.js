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
  serviceTimes: { 
    PB_L: 90, LT_L: 45, OC_L: 60, REP_L: 30, POL_L: 45,
    PB_P: 120, LT_P: 60, OC_P: 90, REP_P: 45, POL_P: 60
  },
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
    const user = verifyToken(event);
    console.log('Settings request:', event.httpMethod, 'user:', user.username, 'role:', user.role);

    // GET - Obter configurações
    if (event.httpMethod === 'GET') {
      const { rows } = await pool.query(
        "SELECT value FROM settings WHERE key = 'global' LIMIT 1"
      );
      
      if (rows.length > 0) {
        const saved = JSON.parse(rows[0].value);
        console.log('Settings loaded from DB:', JSON.stringify(saved).substring(0, 200));
        // Merge: defaults primeiro, saved por cima
        const merged = { 
          ...DEFAULT_SETTINGS, 
          ...saved,
          serviceTimes: { ...DEFAULT_SETTINGS.serviceTimes, ...(saved.serviceTimes || {}) }
        };
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: merged }) };
      }
      
      console.log('No settings in DB, returning defaults');
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: DEFAULT_SETTINGS }) };
    }

    // PUT - Guardar configurações (admin only)
    if (event.httpMethod === 'PUT') {
      if (user.role !== 'admin') {
        console.log('Settings PUT rejected: role is', user.role);
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Apenas administradores' }) };
      }

      const data = JSON.parse(event.body || '{}');
      const settingsJson = JSON.stringify(data);
      console.log('Saving settings:', settingsJson.substring(0, 200));

      await pool.query(`
        INSERT INTO settings (key, value, updated_at) 
        VALUES ('global', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
      `, [settingsJson]);

      console.log('Settings saved successfully');
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
