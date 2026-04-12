// netlify/functions/powering-kpis.js
const https = require('https');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const POWERING_EG_API_KEY = process.env.POWERING_EG_API_KEY;
const POWERING_EG_HOST = 'poweringeg-3c9mozlh.manus.space';
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function httpsGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: POWERING_EG_HOST,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${POWERING_EG_API_KEY}`,
        'X-API-Key': POWERING_EG_API_KEY,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (!POWERING_EG_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'POWERING_EG_API_KEY nao configurada' }) };
  }

  const params = event.queryStringParameters || {};

  // Acao auxiliar: listar lojas (para debug/mapeamento)
  if (params.action === 'lojas') {
    try {
      const result = await httpsGet('/api/external/lojas');
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
    }
  }

  // Acao auxiliar: ver resultados brutos de uma loja (debug)
  if (params.action === 'resultados' && params.lojaId) {
    try {
      const now = new Date();
      const mes = params.mes ? parseInt(params.mes) : now.getMonth() + 1;
      const ano = params.ano ? parseInt(params.ano) : now.getFullYear();
      const result = await httpsGet(`/api/external/resultados?mes=${mes}&ano=${ano}&lojaId=${params.lojaId}`);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
    }
  }

  // Obter lojaId: via query param direto OU via JWT -> BD
  let lojaId = params.lojaId ? parseInt(params.lojaId) : null;
  const portalIdParam = params.portalId ? parseInt(params.portalId) : null;

  if (!lojaId) {
    // Tentar via portalId query param (coordenadores/admin que trocam portal)
    const portalIdToLookup = portalIdParam || null;

    // Ou via JWT
    let portalId = portalIdToLookup;
    if (!portalId) {
      const authHeader = event.headers.authorization || event.headers.Authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'lojaId ou portalId obrigatorio' }) };
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        portalId = decoded.portal_id || decoded.portalId;
      } catch(err) {
        return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Token invalido' }) };
      }
    }

    if (!portalId) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, kpis: null, reason: 'sem_portal' }) };
    }

    try {
      const result = await pool.query(
        'SELECT powering_eg_loja_id FROM portals WHERE id = $1',
        [portalId]
      );
      if (!result.rows.length || !result.rows[0].powering_eg_loja_id) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, kpis: null, reason: 'sem_mapeamento' }) };
      }
      lojaId = result.rows[0].powering_eg_loja_id;
    } catch(err) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'DB error: ' + err.message }) };
    }
  }

  // Buscar KPIs no PoweringEG
  try {
    const now = new Date();
    const mes = now.getMonth() + 1;
    const ano = now.getFullYear();

    const resultado = await httpsGet(`/api/external/resultados?mes=${mes}&ano=${ano}&lojaId=${lojaId}`);

    if (!resultado.success || !resultado.data || resultado.data.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, kpis: null, mes, ano }) };
    }

    const loja = resultado.data[0];
    const servicos = loja.servicos_realizados ?? loja.servicos ?? loja.realizados ?? null;
    const objetivo = loja.objetivo ?? loja.meta ?? loja.target ?? null;
    const taxa     = loja.taxa_reparacao ?? loja.taxa ?? loja.conversion_rate ?? null;

    const kpis = {
      servicos,
      objetivo,
      taxa: taxa !== null ? Math.round(taxa * 100) / 100 : null,
      nps: loja.nps ?? null,
      mes,
      ano,
      nomeLoja: loja.nome ?? loja.name ?? null,
      desvio: (servicos !== null && objetivo !== null) ? servicos - objetivo : null,
      desvioPercent: (servicos !== null && objetivo !== null && objetivo > 0)
        ? Math.round(((servicos / objetivo) * 100) - 100)
        : null,
    };

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, kpis, mes, ano }) };

  } catch (err) {
    console.error('PoweringEG KPI error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
