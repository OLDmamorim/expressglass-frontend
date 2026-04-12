// netlify/functions/powering-kpis.js
// Proxy seguro para a API do PoweringEG — a API key fica no servidor
const https = require('https');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const POWERING_API_KEY = process.env.POWERING_EG_API_KEY;
const POWERING_BASE = 'poweringeg-3c9mozlh.manus.space';

function fetchPowering(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: POWERING_BASE,
      path: `/api/external${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${POWERING_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Erro a parsear resposta PoweringEG')); }
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
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{}' };

  try {
    // Verificar autenticação
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Não autenticado');
    jwt.verify(authHeader.substring(7), JWT_SECRET);

    if (!POWERING_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'POWERING_EG_API_KEY não configurada' }) };
    }

    const params = event.queryStringParameters || {};
    const lojaId = params.loja_id;
    const now = new Date();
    const mes = parseInt(params.mes || now.getMonth() + 1);
    const ano = parseInt(params.ano || now.getFullYear());

    // Buscar resultados mensais da loja
    const path = lojaId
      ? `/resultados?mes=${mes}&ano=${ano}&lojaId=${lojaId}`
      : `/resultados?mes=${mes}&ano=${ano}`;

    const data = await fetchPowering(path);

    if (!data.success && !data.data) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: data.error || 'Sem dados' }) };
    }

    // Normalizar — pode vir como array ou objeto único
    const results = Array.isArray(data.data) ? data.data : [data.data];
    const loja = lojaId ? results.find(r => String(r.lojaId || r.id) === String(lojaId)) || results[0] : results[0];

    if (!loja) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Loja não encontrada' }) };
    }

    // Calcular KPIs do dia atual
    const diasUteisTotais = loja.diasUteis || loja.dias_uteis || 21;
    const diasPassados = loja.diasPassados || loja.dias_passados || Math.min(now.getDate(), diasUteisTotais);
    const servicos = parseInt(loja.servicos || loja.totalServicos || 0);
    const objetivo = parseInt(loja.objetivo || loja.meta || 0);
    const taxaRep = parseFloat(loja.taxaReposicao || loja.taxa_reposicao || loja.taxaRep || 0);

    // Objetivo diário e desvio
    const objetivoDiario = diasUteisTotais > 0 ? (objetivo / diasUteisTotais) : 0;
    const realDiario = diasPassados > 0 ? (servicos / diasPassados) : 0;
    const desvioPct = objetivoDiario > 0 ? (((realDiario - objetivoDiario) / objetivoDiario) * 100).toFixed(1) : null;
    const progressoPct = objetivo > 0 ? Math.round((servicos / objetivo) * 100) : 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        kpis: {
          servicos,
          objetivo,
          taxaRep: taxaRep.toFixed(1),
          desvioPct,
          progressoPct,
          diasPassados,
          diasUteisTotais,
          mes,
          ano,
          nomeLoja: loja.nome || loja.name || '',
        },
        raw: loja
      })
    };

  } catch (error) {
    console.error('powering-kpis error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
