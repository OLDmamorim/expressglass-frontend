// netlify/functions/powering-kpis.js
// Proxy seguro para a API do PoweringEG.
// Aceita ?portal_id=X (resolve powering_loja_id via DB) ou ?loja_id=X directo.
// Aceita ?action=lojas para listar lojas do PoweringEG.

const https = require('https');
const jwt   = require('jsonwebtoken');
const { Pool } = require('pg');

const JWT_SECRET    = process.env.JWT_SECRET    || 'expressglass-secret-key-change-in-production';
const POWERING_KEY  = process.env.POWERING_EG_API_KEY;
const POWERING_HOST = 'poweringeg-3c9mozlh.manus.space';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function fetchPowering(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: POWERING_HOST,
        path: `/api/external${path}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${POWERING_KEY}`, 'Content-Type': 'application/json' },
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('Resposta inválida do PoweringEG')); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET')     return { statusCode: 405, headers, body: '{}' };

  try {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
    jwt.verify(auth.substring(7), JWT_SECRET);

    if (!POWERING_KEY) throw new Error('POWERING_EG_API_KEY não configurada');

    const p = event.queryStringParameters || {};

    // Listar lojas
    if (p.action === 'lojas') {
      const data = await fetchPowering('/lojas');
      const lojas = (data.data || data.lojas || data.resultados || [])
        .map(l => ({ id: l.id, nome: l.nome, numeroLoja: l.numeroLoja }));
      return { statusCode: 200, headers, body: JSON.stringify({ total: lojas.length, lojas }) };
    }

    const now = new Date();
    const mes = parseInt(p.mes || now.getMonth() + 1);
    const ano = parseInt(p.ano || now.getFullYear());

    let lojaId = p.loja_id ? parseInt(p.loja_id) : null;

    if (!lojaId && p.portal_id) {
      const { rows } = await pool.query(
        'SELECT powering_loja_id FROM portals WHERE id = $1 LIMIT 1',
        [parseInt(p.portal_id)]
      );
      lojaId = rows[0]?.powering_loja_id ?? null;
    }

    if (!lojaId) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: false, error: 'Portal sem powering_loja_id configurado', reason: 'sem_portal' })
      };
    }

    const data = await fetchPowering(`/resultados/${lojaId}?mes=${mes}&ano=${ano}`);

    // Modo debug — devolve resposta raw para diagnóstico
    if (p.debug === '1') {
      return { statusCode: 200, headers, body: JSON.stringify({ debug: true, raw: data, lojaId }) };
    }

    const r = data.resultado || data.resultados?.[0] || data;

    const kpis = {
      servicos:      r.totalServicos  ?? r.servicos ?? 0,
      objetivo:      r.objetivoMensal ?? r.objetivo ?? 0,
      taxa:          r.taxaReparacao  ?? r.taxa ?? r.mediaReparacao ?? 0,
      desvioPercent: r.desvioPercent  ?? r.desvio ?? null,
    };

    if (kpis.desvioPercent == null && kpis.objetivo > 0) {
      const diasNoMes = new Date(ano, mes, 0).getDate();
      const diaActual = (ano === now.getFullYear() && mes === now.getMonth() + 1) ? now.getDate() : diasNoMes;
      const esperado  = kpis.objetivo * (diaActual / diasNoMes);
      kpis.desvioPercent = esperado > 0 ? Math.round(((kpis.servicos / esperado) - 1) * 10000) / 100 : 0;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, kpis, mes, ano, lojaId }) };

  } catch (err) {
    console.error('[powering-kpis]', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
