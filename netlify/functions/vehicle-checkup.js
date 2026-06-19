// netlify/functions/vehicle-checkup.js
const https = require('https');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function verifyToken(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  if (!h.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(h.substring(7), JWT_SECRET);
}

function analyzeVehicle(images) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_API_KEY) return reject(new Error('ANTHROPIC_API_KEY não configurada'));

    const content = [];
    images.forEach(img => {
      if (!img || !img.base64) return;
      content.push({ type: 'text', text: `Imagem — ${img.angle || 'Ângulo'}:` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.base64 }
      });
    });

    content.push({
      type: 'text',
      text: `Estas são fotos de uma viatura automóvel antes de intervenção numa oficina de vidros.
Identifica TODOS os danos visíveis na carroçaria: riscos, amolgadelas, lascagens, vidros partidos/fissurados, danos nos para-choques, retrovisores partidos, etc.
Não incluas sujidade, pó, ou desgaste normal.

Para cada dano, responde com:
- angle: ângulo da foto onde está (usa exatamente o nome indicado antes de cada imagem)
- description: descrição concisa em português de Portugal (máx 60 caracteres)
- severity: "minor" (risco pequeno/desgaste), "moderate" (risco/amolgadela visível), "major" (dano significativo/estrutural)

Responde EXCLUSIVAMENTE em JSON válido, sem texto adicional:
{"damages":[{"angle":"...","description":"...","severity":"..."}],"has_damage":true}

Se não houver danos visíveis: {"damages":[],"has_damage":false}`
    });

    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content }]
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
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Erro Claude API'));
          const text = parsed.content?.[0]?.text || '';
          const m = text.match(/\{[\s\S]*\}/);
          resolve(m ? JSON.parse(m[0]) : { damages: [], has_damage: false });
        } catch (e) {
          reject(new Error('Erro ao processar resposta IA: ' + e.message));
        }
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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'POST only' }) };

  try {
    verifyToken(event);
    const d = JSON.parse(event.body || '{}');
    const images = (d.images || []).filter(img => img && img.base64);
    if (!images.length) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Pelo menos uma imagem é obrigatória' }) };

    const result = await analyzeVehicle(images);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: result }) };
  } catch (err) {
    console.error('vehicle-checkup:', err);
    const code = err.message.includes('autenticado') ? 401 : 500;
    return { statusCode: code, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
