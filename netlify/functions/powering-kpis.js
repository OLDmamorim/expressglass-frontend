// netlify/functions/powering-kpis.js
const https = require('https');

const POWERING_EG_API_KEY = process.env.POWERING_EG_API_KEY;
const POWERING_EG_BASE = 'poweringeg-3c9mozlh.manus.space';

function httpsGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: POWERING_EG_BASE,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${POWERING_EG_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data)); }
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
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'POWERING_EG_API_KEY não configurada' }) };
  }

  const { lojaId, action } = event.queryStringParameters || {};

  // Ação auxiliar: listar todas as lojas (para fazer o mapeamento portal → lojaId)
  if (action === 'lojas') {
    try {
      const result = await httpsGet('/api/external/lojas');
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
    }
  }

  if (!lojaId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'lojaId obrigatório' }) };
  }

  try {
    const now = new Date();
    const mes = now.getMonth() + 1;
    const ano = now.getFullYear();

    // Buscar resultados do mês atual para esta loja
    const resultado = await httpsGet(`/api/external/resultados?mes=${mes}&ano=${ano}&lojaId=${lojaId}`);

    if (!resultado.success || !resultado.data || resultado.data.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, kpis: null, mes, ano })
      };
    }

    const loja = resultado.data[0];

    // Normalizar campos — o PoweringEG pode usar nomes diferentes
    const kpis = {
      servicos:   loja.servicos_realizados ?? loja.servicos ?? loja.realizados ?? null,
      objetivo:   loja.objetivo ?? loja.meta ?? loja.target ?? null,
      taxa:       loja.taxa_reparacao ?? loja.taxa ?? loja.conversion_rate ?? null,
      nps:        loja.nps ?? null,
      mes,
      ano,
      nomeLoja:   loja.nome ?? loja.name ?? loja.loja ?? null,
    };

    // Calcular desvio se temos serviços e objetivo
    if (kpis.servicos !== null && kpis.objetivo !== null && kpis.objetivo > 0) {
      kpis.desvio = kpis.servicos - kpis.objetivo;
      kpis.desvioPercent = Math.round(((kpis.servicos / kpis.objetivo) * 100) - 100);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, kpis, mes, ano })
    };

  } catch (err) {
    console.error('PoweringEG KPI error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
