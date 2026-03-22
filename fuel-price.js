// netlify/functions/fuel-price.js
// Busca preço médio do gasóleo da DGEG
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const https = require('https');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

// Postos de referência verificados
const REFERENCE_STATIONS = [67080, 63285, 62630, 64640, 65167];

function verifyToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(authHeader.substring(7), JWT_SECRET);
}

// Buscar preço usando https nativo (sem AbortSignal.timeout)
function fetchStationPrice(stationId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    const url = 'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/GetDadosPostoMapa?id=' + stationId + '&f=json';

    const req = https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const json = JSON.parse(data);
          if (json.status && json.resultado && json.resultado.Combustiveis) {
            const gasoleo = json.resultado.Combustiveis.find(c =>
              c.TipoCombustivel && c.TipoCombustivel.toLowerCase().includes('leo simples')
            );
            if (gasoleo && gasoleo.Preco) {
              const price = parseFloat(gasoleo.Preco.replace(' €/litro', '').replace(',', '.'));
              if (!isNaN(price) && price > 0) {
                console.log('Posto ' + stationId + ': ' + price + ' €/L');
                return resolve(price);
              }
            }
          }
          resolve(null);
        } catch (e) {
          console.warn('Posto ' + stationId + ' parse error:', e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      clearTimeout(timer);
      console.warn('Posto ' + stationId + ' network error:', e.message);
      resolve(null);
    });

    req.end();
  });
}

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

  try {
    verifyToken(event);

    // Cache de 6 horas
    try {
      const cached = await pool.query("SELECT value, updated_at FROM settings WHERE key = 'fuel_price' LIMIT 1");
      if (cached.rows.length > 0) {
        const age = Date.now() - new Date(cached.rows[0].updated_at).getTime();
        if (age < 6 * 60 * 60 * 1000) {
          const data = JSON.parse(cached.rows[0].value);
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { ...data, cached: true } }) };
        }
      }
    } catch (e) { console.warn('Cache check:', e.message); }

    // Buscar preços em paralelo
    console.log('Fetching DGEG prices...');
    const results = await Promise.all(REFERENCE_STATIONS.map(id => fetchStationPrice(id)));
    const prices = results.filter(p => p !== null);

    let result;
    if (prices.length > 0) {
      const avg = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 1000) / 1000;
      result = { price: avg, source: 'DGEG', stations: prices.length, date: new Date().toISOString(), prices: prices };
      console.log('DGEG avg: ' + avg + ' from ' + prices.length + ' stations');

      try {
        await pool.query(
          "INSERT INTO settings (key, value, updated_at) VALUES ('fuel_price', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
          [JSON.stringify(result)]
        );
      } catch (e) { console.warn('Cache save:', e.message); }
    } else {
      console.warn('DGEG unavailable, using fallback');
      try {
        const s = await pool.query("SELECT value FROM settings WHERE key = 'global' LIMIT 1");
        const g = s.rows.length > 0 ? JSON.parse(s.rows[0].value) : {};
        result = { price: g.fuelPricePerLiter || 1.95, source: 'manual', date: new Date().toISOString() };
      } catch (e) {
        result = { price: 1.95, source: 'default', date: new Date().toISOString() };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: result }) };

  } catch (error) {
    console.error('fuel-price error:', error.message);
    if (error.message.includes('Não autenticado')) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { price: 1.95, source: 'fallback', date: new Date().toISOString() } }) };
  }
};
