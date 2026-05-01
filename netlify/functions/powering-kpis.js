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
        headers: { 'X-API-Key': POWERING_KEY, 'Content-Type': 'application/json' },
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
    const mesPedido = parseInt(p.mes || now.getMonth() + 1);
    const anoPedido = parseInt(p.ano || now.getFullYear());

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

    const data = await fetchPowering(`/resultados/${lojaId}?mes=${mesPedido}&ano=${anoPedido}`);

    // Modo debug — devolve resposta raw para diagnóstico
    if (p.debug === '1') {
      return { statusCode: 200, headers, body: JSON.stringify({ debug: true, raw: data, lojaId }) };
    }

    // ✅ Pegar SEMPRE no último resultado disponível na lista
    // (PoweringEG devolve histórico; o último é o mais recente com dados)
    const lista = data.resultados || [];
    const r = lista[lista.length - 1] || {};

    const servicos = r.totalServicos  ?? 0;
    const objetivo = r.objetivoMensal ?? 0;
    const taxa     = r.taxaReparacao != null ? Math.round(r.taxaReparacao * 100) : 0;

    // Mês/ano efetivamente usados (do registo encontrado)
    const mesEfetivo = r.mes || mesPedido;
    const anoEfetivo = r.ano || anoPedido;

    // Desvio diário com dias úteis — replica fórmula do dashboard PoweringEG
    function contarDiasUteis(ano, mes, ate) {
      let count = 0;
      const fim = ate !== undefined ? ate : new Date(ano, mes, 0).getDate();
      for (let d = 1; d <= fim; d++) {
        const dow = new Date(ano, mes - 1, d).getDay();
        if (dow !== 0 && dow !== 6) count++;
      }
      return count;
    }

    // Determinar dia de referência:
    // - Se mês efetivo é o actual → usar dia de hoje
    // - Caso contrário (mês passado) → usar último dia do mês (mês concluído)
    const hojeMes = now.getMonth() + 1;
    const hojeAno = now.getFullYear();
    const ultimoDiaDoMes = new Date(anoEfetivo, mesEfetivo, 0).getDate();
    const diaAtual = p.dia ? parseInt(p.dia) :
                     (anoEfetivo === hojeAno && mesEfetivo === hojeMes)
                     ? now.getDate()
                     : ultimoDiaDoMes;

    // PoweringEG: passados = até 2 dias antes de hoje; mês = até penúltimo dia
    // Math.max(1, ...) protege contra divisão por zero no início do mês
    const diasUteisPassados = Math.max(1, contarDiasUteis(anoEfetivo, mesEfetivo, diaAtual - 2));
    const diasUteisMes      = Math.max(1, contarDiasUteis(anoEfetivo, mesEfetivo, ultimoDiaDoMes - 1));
    const esperado          = objetivo * (diasUteisPassados / diasUteisMes);
    const desvioPercent     = esperado > 0
      ? Math.round(((servicos / esperado) - 1) * 1000) / 10
      : 0;

    const kpis = { servicos, objetivo, taxa, desvioPercent };

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, kpis, mes: mesEfetivo, ano: anoEfetivo, lojaId }) };

  } catch (err) {
    console.error('[powering-kpis]', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
