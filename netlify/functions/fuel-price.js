// netlify/functions/fuel-price.js
// Busca preço médio do gasóleo da DGEG (Direção-Geral de Energia e Geologia)
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

// Postos de referência (distribuídos pelo país) para calcular média
const REFERENCE_STATIONS = [
  67080,  // Galp Barreiro (Lisboa)
  62498,  // Porto
  63498,  // Braga
  65167,  // Coimbra
  64215,  // Aveiro
];

function verifyToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw new Error('Não autenticado');
  const token = authHeader.substring(7);
  return jwt.verify(token, JWT_SECRET);
}

// Buscar preço de um posto específico
async function fetchStationPrice(stationId) {
  try {
    const url = 'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/GetDadosPostoMapa?id=' + stationId + '&f=json';
    const resp = await fetch(url, { 
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    const data = await resp.json();
    
    if (data.status && data.resultado && data.resultado.Combustiveis) {
      // Procurar "Gasóleo simples"
      const gasoleo = data.resultado.Combustiveis.find(c => 
        c.TipoCombustivel && c.TipoCombustivel.toLowerCase().includes('gasóleo simples')
      );
      if (gasoleo && gasoleo.Preco) {
        // Formato: "1,999 €/litro" → 1.999
        const price = parseFloat(gasoleo.Preco.replace(' €/litro', '').replace(',', '.'));
        if (!isNaN(price) && price > 0) return price;
      }
    }
  } catch (e) {
    console.warn('Erro ao buscar posto ' + stationId + ':', e.message);
  }
  return null;
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

    // Verificar se temos cache recente (menos de 6 horas)
    try {
      const cached = await pool.query(
        "SELECT value, updated_at FROM settings WHERE key = 'fuel_price' LIMIT 1"
      );
      if (cached.rows.length > 0) {
        const cacheAge = Date.now() - new Date(cached.rows[0].updated_at).getTime();
        const sixHours = 6 * 60 * 60 * 1000;
        if (cacheAge < sixHours) {
          const data = JSON.parse(cached.rows[0].value);
          console.log('⛽ Preço do cache:', data.price, '€/L (idade:', Math.round(cacheAge/60000), 'min)');
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, data: { ...data, cached: true } })
          };
        }
      }
    } catch (e) {
      console.warn('Cache check failed:', e.message);
    }

    // Buscar preços frescos da DGEG
    console.log('⛽ A buscar preços da DGEG...');
    const prices = [];
    
    for (const stationId of REFERENCE_STATIONS) {
      const price = await fetchStationPrice(stationId);
      if (price) prices.push(price);
    }

    let result;
    
    if (prices.length > 0) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const rounded = Math.round(avg * 1000) / 1000; // 3 casas decimais
      
      result = {
        price: rounded,
        source: 'DGEG',
        stations: prices.length,
        date: new Date().toISOString(),
        prices: prices
      };
      
      console.log('⛽ Preço médio DGEG:', rounded, '€/L (de', prices.length, 'postos)');
      
      // Guardar em cache
      try {
        await pool.query(`
          INSERT INTO settings (key, value, updated_at)
          VALUES ('fuel_price', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [JSON.stringify(result)]);
      } catch (e) {
        console.warn('Erro ao guardar cache:', e.message);
      }
    } else {
      // Fallback: usar valor das configurações
      console.warn('⛽ DGEG indisponível, usando fallback');
      try {
        const settings = await pool.query("SELECT value FROM settings WHERE key = 'global' LIMIT 1");
        const globalSettings = settings.rows.length > 0 ? JSON.parse(settings.rows[0].value) : {};
        result = {
          price: globalSettings.fuelPricePerLiter || 1.65,
          source: 'manual',
          date: new Date().toISOString()
        };
      } catch (e) {
        result = { price: 1.65, source: 'default', date: new Date().toISOString() };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: result })
    };

  } catch (error) {
    console.error('Erro fuel-price:', error);
    if (error.message.includes('Não autenticado')) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }
    // Mesmo com erro, devolver um preço default
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ success: true, data: { price: 1.65, source: 'fallback', date: new Date().toISOString() } })
    };
  }
};
