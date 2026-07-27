// netlify/functions/vehicle-checkup.js
const jwt = require('jsonwebtoken');
const { callAI } = require('../lib/ai');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

function verifyToken(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  if (!h.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(h.substring(7), JWT_SECRET);
}

async function analyzeVehicle(images) {
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

  const result = await callAI({
    messages: [{ role: 'user', content }],
    max_tokens: 800,
    model: 'gpt-4o'
  });

  try {
    const text = result.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { damages: [], has_damage: false };
  } catch (e) {
    throw new Error('Erro ao processar resposta IA: ' + e.message);
  }
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
