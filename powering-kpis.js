// netlify/functions/powering-kpis.js
// Proxy seguro para a API do PoweringEG.
// Aceita ?portal_id=X (agendamentosm) OU ?loja_id=X (PoweringEG directo).
// Se receber portal_id, faz lookup do powering_loja_id na DB.

const https  = require('https');
const jwt    = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');

const JWT_SECRET     = process.env.JWT_SECRET     || 'expressglass-secret-key-change-in-production';
const POWERING_KEY   = process.env.POWERING_EG_API_KEY;
const POWERING_HOST  = 'poweringeg-3c9mozlh.manus.space';

// ── Fetch à API PoweringEG ────────────────────────────────────────────────
function fetchPowering(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: POWERING_HOST, path: `/api/external${path}`, method: 'GET',
        headers: { 'Authorization': `Bearer ${POWERING_KEY}`, 'Content-Type': 'application/json' } },
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

// ── Handler ───────────────────────────────────────────────────────────────
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
    // ── Autenticação JWT ────────────────────────────────────────────────
    const auth = event.headers.authorization || event.headers.Authorization || '';
    if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
    jwt.verify(auth.substring(7), JWT_SECRET);

    if (!POWERING_KEY) throw new Error('POWERING_EG_API_KEY não configurada');

    const p   = event.queryStringParameters || {};
    const now = new Date();
    const mes = parseInt(p.mes || now.getMonth() + 1);
    const ano = parseInt(p.ano || now.getFullYear());

    // ── Resolver lojaId ──────────────────────────────────────────────────
    let lojaId = p.loja_id ? parseInt(p.loja_id) : null;

    if (!lojaId && p.portal_id) {
      // Lookup na DB: portals.powering_loja_id
      const sql = neon(process.env.DATABASE_URL);
      const rows = await sql`
        SELECT powering_loja_id FROM portals WHERE id = ${parseInt(p.portal_id)} LIMIT 1
      `;
      lojaId = rows[0]?.powering_loja_id ?? null;
    }

    if (!lojaId) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: false, error: 'Portal sem powering_loja_id configurado' })
      };
    }

    // ── Chamar PoweringEG ────────────────────────────────────────────────
    const data = await fetchPowering(`/resultados/${lojaId}?mes=${mes}&ano=${ano}`);

    // Normalizar campos — a API pode variar ligeiramente
    const r = data.resultado || data.resultados?.[0] || data;
    const kpis = {
      servicos:     r.totalServicos    ?? r.servicos    ?? r.total        ?? 0,
      objetivo:     r.objetivoMensal   ?? r.objetivo    ?? r.meta         ?? 0,
      taxa:         r.taxaReparacao    ?? r.taxa        ?? r.mediaReparacao ?? 0,
      desvioPercent: r.desvioPercent   ?? r.desvio      ?? null,
    };

    // Se o proxy não devolver desvioPercent, calcular aqui
    if (kpis.desvioPercent == null && kpis.objetivo > 0) {
      const diasNoMes  = new Date(ano, mes, 0).getDate();
      const diaActual  = (ano === now.getFullYear() && mes === now.getMonth() + 1)
                         ? now.getDate() : diasNoMes;
      const esperado   = kpis.objetivo * (diaActual / diasNoMes);
      kpis.desvioPercent = esperado > 0
        ? Math.round(((kpis.servicos / esperado) - 1) * 100 * 100) / 100
        : 0;
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, kpis, mes, ano, lojaId })
    };

  } catch (err) {
    console.error('[powering-kpis]', err.message);
    return {
      statusCode: 200, headers,   // 200 para o banner não quebrar
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
