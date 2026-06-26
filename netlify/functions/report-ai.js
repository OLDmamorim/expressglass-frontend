// netlify/functions/report-ai.js
// Analisa os resultados de um relatório operacional e produz um comentário
// (o que está bem, o que está mal, o que melhorar). Usa a API da Anthropic.
const https = require('https');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function callAnthropic(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_API_KEY) return reject(new Error('ANTHROPIC_API_KEY não configurada'));
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: systemPrompt,
      messages
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Erro a parsear resposta: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Não autenticado');
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    if (!['admin', 'coordenador'].includes(decoded.role)) throw new Error('Acesso negado');

    const { report } = JSON.parse(event.body || '{}');
    if (!report) throw new Error('Dados do relatório em falta');

    const t = report.totals || {};
    const total = parseInt(t.total_agendados) || 0;
    const realiz = parseInt(t.total_realizados) || 0;
    const naoRealiz = parseInt(t.total_nao_realizados) || 0;
    const pendentes = parseInt(t.total_pendentes) || 0;
    const km = parseInt(t.total_km) || 0;
    const taxa = total > 0 ? Math.round((realiz / total) * 100) : 0;

    const locStr = (report.byLocality || []).slice(0, 15).map(r =>
      `  - ${r.locality}: ${r.total} serviços, ${r.realizados} realizados, ${parseInt(r.km)||0} km`
    ).join('\n') || '  (sem dados)';

    const comercialStr = (report.byComercial || []).map(r =>
      `  - ${r.comercial_name}: ${r.total} encaminhados, ${r.realizados} realizados, taxa ${r.total>0?Math.round((r.realizados/r.total)*100):0}%, média ${r.media_dias||'—'} dias`
    ).join('\n') || '  (nenhum)';

    const motivosStr = (report.byMotivo || []).map(r =>
      `  - ${r.motivo}: ${r.total}×`
    ).join('\n') || '  (nenhum)';

    const systemPrompt = `És um analista de operações da ExpressGlass, empresa de substituição de vidros automóveis em Portugal. Recebes os dados de um relatório mensal de um portal/loja e produzes uma análise executiva clara e útil para a gestão.

Estrutura a tua resposta EXACTAMENTE com estas secções (usa estes títulos com emoji):
✅ **O que está bem** — 2 a 4 pontos concretos baseados nos números.
⚠️ **O que está menos bom** — 2 a 4 pontos de preocupação (taxa de não realização alta, muitos pendentes, motivos recorrentes, comerciais com baixa taxa, etc.).
🎯 **Recomendações** — 2 a 4 ações concretas e práticas para melhorar.
📌 **Resumo** — 1 frase final com a avaliação global.

Regras:
- Português europeu, tom profissional mas direto.
- Baseia-te SÓ nos dados fornecidos. Não inventes números.
- Sê específico: cita localidades, comerciais, motivos e percentagens reais.
- Se a taxa de realização for ≥85% é boa; 70-85% razoável; <70% precisa de atenção.
- Não excedas ~25 linhas no total.`;

    const userMsg = `Portal: ${report.portal?.name || '—'}
Período: ${report.period?.from || '?'} a ${report.period?.to || '?'}

INDICADORES GERAIS:
- Agendados: ${total}
- Realizados: ${realiz} (taxa de realização: ${taxa}%)
- Não realizados: ${naoRealiz}
- Pendentes (sem data): ${pendentes}
- Km totais: ${km}

SERVIÇOS POR LOCALIDADE:
${locStr}

SERVIÇOS POR COMERCIAL:
${comercialStr}

MOTIVOS DE NÃO REALIZAÇÃO:
${motivosStr}

Analisa estes resultados.`;

    const result = await callAnthropic(systemPrompt, [{ role: 'user', content: userMsg }]);
    if (result.error) throw new Error(result.error.message || 'Erro da API');

    const reply = result.content?.[0]?.text || 'Sem resposta.';
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, analysis: reply }) };

  } catch (error) {
    console.error('report-ai error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
