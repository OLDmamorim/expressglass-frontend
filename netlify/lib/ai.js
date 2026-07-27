// netlify/lib/ai.js
// Camada única de acesso à IA, partilhada por todas as funções.
// Usa a OpenAI por omissão e, se falhar (chave em falta, sem saldo, erro da
// API), tenta a Anthropic como reserva — assim uma conta sem créditos não
// deixa a aplicação sem IA.
// Devolve sempre no formato { content: [{ type:'text', text }] } para quem
// chama não ter de mudar a forma como lê a resposta.
const https = require('https');

function postJson(hostname, path, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) } },
      (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch (e) { reject(new Error('Resposta inválida da IA: ' + String(data).slice(0, 300))); }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// Converte mensagens no formato Anthropic (incluindo blocos de imagem) para o
// formato de chat da OpenAI.
function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of (messages || [])) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const parts = (m.content || []).map((b) => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'image' && b.source) {
        const mt = b.source.media_type || 'image/jpeg';
        return { type: 'image_url', image_url: { url: `data:${mt};base64,${b.source.data}` } };
      }
      return null;
    }).filter(Boolean);
    out.push({ role: m.role, content: parts });
  }
  return out;
}

async function callOpenAI({ system, messages, max_tokens, model }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY não configurada');
  const body = JSON.stringify({
    model: model || 'gpt-4o-mini',
    max_tokens: max_tokens || 1000,
    messages: toOpenAIMessages(system, messages)
  });
  const { status, body: resp } = await postJson('api.openai.com', '/v1/chat/completions', {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + key
  }, body);
  if (status !== 200 || resp.error) throw new Error('OpenAI: ' + ((resp.error && resp.error.message) || ('HTTP ' + status)));
  return { content: [{ type: 'text', text: resp.choices?.[0]?.message?.content || '' }] };
}

async function callAnthropic({ system, messages, max_tokens, fallbackModel }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada');
  const payload = { model: fallbackModel || 'claude-sonnet-4-6', max_tokens: max_tokens || 1000, messages: messages || [] };
  if (system) payload.system = system;
  const { status, body: resp } = await postJson('api.anthropic.com', '/v1/messages', {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01'
  }, JSON.stringify(payload));
  if (status !== 200 || resp.error) throw new Error('Anthropic: ' + ((resp.error && resp.error.message) || ('HTTP ' + status)));
  return { content: [{ type: 'text', text: resp.content?.[0]?.text || '' }] };
}

// Tenta a OpenAI primeiro; se falhar, tenta a Anthropic.
async function callAI(opts) {
  const errs = [];
  for (const fn of [callOpenAI, callAnthropic]) {
    try { return await fn(opts || {}); }
    catch (e) { errs.push(e.message); }
  }
  throw new Error(errs.join(' | ') || 'Nenhum fornecedor de IA configurado');
}

module.exports = { callAI };
