// netlify/functions/agenda-ai.js
const https = require('https');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function callAnthropic(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_API_KEY) return reject(new Error('ANTHROPIC_API_KEY não configurada'));

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
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
    // Verificar autenticação (coordenador ou admin)
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Não autenticado');
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    if (!['admin', 'coordenador'].includes(decoded.role)) throw new Error('Acesso negado');

    const { messages, context } = JSON.parse(event.body || '{}');
    if (!messages || !messages.length) throw new Error('Mensagens em falta');

    const systemPrompt = `És um assistente especializado em otimização de rotas para a ExpressGlass, empresa de substituição de vidros automóveis em Portugal.
O teu objetivo é ajudar o coordenador a decidir o melhor dia para agendar um novo serviço numa determinada localidade, tendo em conta:
- Os serviços já agendados nos próximos 14 dias
- A proximidade geográfica entre localidades (usa o teu conhecimento sobre Portugal)
- A carga de trabalho por dia (máximo recomendado: 6-7 serviços/dia)
- A eficiência da rota (agrupar serviços próximos no mesmo dia)

Portal: ${context?.portal || 'SM'}
Base de partida: ${context?.base || '—'}
Data atual: ${context?.today || new Date().toISOString().slice(0,10)}

Agenda dos próximos 14 dias:
${context?.days?.length ? context.days.map(d =>
  `- ${d.weekday} ${d.date}: ${d.count} serviço(s) — Localidades: ${d.localities || '—'} — KM estimado: ${d.totalKm}km`
).join('\n') : 'Sem serviços agendados.'}

Responde sempre em português europeu, de forma concisa e direta (máximo 3-4 linhas). Sugere sempre um dia específico com justificação clara. Se a pergunta for fora do âmbito de agendamentos, redireciona educadamente.`;

    const result = await callAnthropic(systemPrompt, messages);

    if (result.error) throw new Error(result.error.message || 'Erro da API');

    const reply = result.content?.[0]?.text || 'Sem resposta.';
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, reply }) };

  } catch (error) {
    console.error('agenda-ai error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
