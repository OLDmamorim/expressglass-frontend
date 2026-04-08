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

    const days = context?.days || [];
    const today = context?.today || new Date().toISOString().slice(0,10);

    // Pré-calcular: dias com a mesma localidade e dias disponíveis (< 5 serviços)
    const diasComLocalidade = days.filter(d =>
      d.localities && d.localities.toLowerCase().includes((context?.lastLocality || '').toLowerCase()) && d.count < 5
    );
    const diasDisponiveis = days.filter(d => d.count < 5);
    const diasCheios = days.filter(d => d.count >= 5);

    const systemPrompt = `És um assistente especializado em otimização de rotas para a ExpressGlass, empresa de substituição de vidros automóveis em Portugal.

REGRAS OBRIGATÓRIAS (seguir sempre por esta ordem de prioridade):
1. NUNCA sugeres um dia com 5 ou mais serviços já agendados — é o máximo absoluto.
2. PRIMEIRO tenta sugerir um dia que já tenha serviços na mesma localidade ou localidade próxima — agrupa para eficiência de rota.
3. Se não houver dia com essa localidade disponível (com menos de 5 serviços), sugere o dia com menos serviços nos próximos 14 dias.
4. Indica sempre o número de serviços que o dia já tem e quantos ficaria a ter.
5. Se todos os dias estiverem cheios (5+ serviços), diz isso claramente e sugere a semana seguinte.

Portal: ${context?.portal || 'SM'}
Base de partida: ${context?.base || '—'}
Data atual: ${today}

AGENDA DOS PRÓXIMOS 14 DIAS:
${days.length ? days.map(d => {
  const cheio = d.count >= 5 ? ' ⛔ CHEIO' : d.count >= 4 ? ' ⚠️ quase cheio' : '';
  return `- ${d.weekday} ${d.date}: ${d.count}/5 serviços${cheio} — Localidades: ${d.localities || '—'}`;
}).join('\n') : 'Sem serviços agendados — qualquer dia está disponível.'}

${diasCheios.length ? `DIAS CHEIOS (não sugerir): ${diasCheios.map(d => d.date).join(', ')}` : ''}

Responde em português europeu, de forma concisa (máximo 4 linhas). Sê direto: diz o dia, quantos serviços já tem, e porquê é a melhor opção.`;

    const result = await callAnthropic(systemPrompt, messages);

    if (result.error) throw new Error(result.error.message || 'Erro da API');

    const reply = result.content?.[0]?.text || 'Sem resposta.';
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, reply }) };

  } catch (error) {
    console.error('agenda-ai error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
