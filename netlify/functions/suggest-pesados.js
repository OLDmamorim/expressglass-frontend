// netlify/functions/suggest-pesados.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

// Fórmula Haversine — distância em km entre dois pontos
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{}' };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
    jwt.verify(authHeader.substring(7), JWT_SECRET);

    const { lat, lng, date } = JSON.parse(event.body || '{}');
    if (!lat || !lng || !date) return {
      statusCode: 400, headers,
      body: JSON.stringify({ success: false, error: 'lat, lng e date obrigatórios' })
    };

    // Buscar todos os portais pesados
    const { rows: portals } = await pool.query(`
      SELECT id, name, base_lat, base_lng, max_daily
      FROM portals
      WHERE portal_type = 'pesados'
        AND base_lat IS NOT NULL AND base_lng IS NOT NULL
      ORDER BY name
    `);

    if (!portals.length) return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, suggestions: [] })
    };

    // Para cada portal, contar serviços nesse dia
    const portalIds = portals.map(p => p.id);
    const { rows: counts } = await pool.query(`
      SELECT portal_id, COUNT(*) as total
      FROM appointments
      WHERE portal_id = ANY($1)
        AND date = $2
        AND (executed IS NULL OR executed = false)
      GROUP BY portal_id
    `, [portalIds, date]);

    const countMap = {};
    counts.forEach(c => { countMap[c.portal_id] = parseInt(c.total); });

    // Calcular sugestões
    const suggestions = portals.map(p => {
      const dist = haversine(parseFloat(lat), parseFloat(lng), parseFloat(p.base_lat), parseFloat(p.base_lng));
      const servicos = countMap[p.id] || 0;
      const max = p.max_daily || 4;
      const disponivel = servicos < max;
      let score = dist; // base: distância
      if (!disponivel) score += 500; // penalizar se cheio
      return {
        portal_id: p.id,
        name: p.name,
        dist_km: Math.round(dist),
        servicos_dia: servicos,
        max_daily: max,
        disponivel,
        score
      };
    }).sort((a, b) => a.score - b.score);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, suggestions })
    };

  } catch (err) {
    console.error('suggest-pesados error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
