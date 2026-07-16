// netlify/functions/glass-label-ocr.js
const https = require('https');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function verifyToken(event) {
  const h = event.headers.authorization || event.headers.Authorization || '';
  if (!h.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(h.substring(7), JWT_SECRET);
}

function callVision(imageBase64, mediaType) {
  return new Promise((resolve, reject) => {
    if (!ANTHROPIC_API_KEY) return reject(new Error('ANTHROPIC_API_KEY não configurada'));

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 }
          },
          {
            type: 'text',
            text: `Analisa esta etiqueta de vidro automóvel. Pode ser de um TRANSPORTADOR
português (ex: A Sua Pressa, Garland) OU de um FABRICANTE (ex: Pilkington, Saint-Gobain/
SEKURIT, AGC, Guardian, XYG, Fuyao, NordGlass). A etiqueta pode estar rodada — lê em
todas as orientações.

Extrai estes campos:

1. EUROCODE do vidro (o mais importante) — formato: 4 dígitos seguidos IMEDIATAMENTE de
   3 ou mais caracteres alfanuméricos maiúsculos (ex: 6577AGACMVZ, 2474AGNMVZ6C,
   8556AGNGYMVZ). Aparece frequentemente:
   - ao lado da marca/modelo do carro (ex: "VW PASSAT (B5) ... 8556AGNGYMVZ"),
   - por baixo de um código de barras,
   - ou em campos PICK_LABELS / OBS / Observações.
   Se estiver no formato "NNNN/DDDDLLLLL" (ex: "4370/2474AGNMVZ6C"), o número ANTES da
   barra "/" NÃO é o eurocode — o eurocode é o código COMPLETO APÓS a "/".
   ⚠️ Em eurocodes NÃO existem as letras 'I' nem 'O' — se vires 'I' é o dígito '1', se
   vires 'O' é o dígito '0'.
   ⚠️ NÃO confundas com "SAP Code" / "Batch number" (esses NÃO são o eurocode).

2. NÚMERO DE ENCOMENDA (se existir) — procura POR ESTA ORDEM:
   a) "CBS Encomendas"/"Encomendas Cliente" seguido de "Cliente nº XXXXX" → "XXXXX"
   b) "PEDIDO:XXXXX" ou "PEDIDO nº XXXXX" → "XXXXX"
   c) "Enc. Cliente nº XXXXX" ou "N.º Enc: XXXXX"
   ⚠️ Exclui "COD AT:XXXXX" (código fiscal) e "SAP Code" (código do fabricante).
   Numa etiqueta de fabricante pode não haver número de encomenda → coloca null.

IMPORTANTE: no campo "raw_text" devolve TODO o texto que consegues ler da etiqueta
(mesmo o que não usaste), para garantir que o eurocode não se perde.

Responde EXCLUSIVAMENTE em JSON válido, sem texto adicional:
{"order_ref": "...", "eurocode": "...", "raw_text": "..."}

Se não encontrares algum campo coloca null.`
          }
        ]
      }]
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
          const text = parsed.content?.[0]?.text || '';
          const m = text.match(/\{[\s\S]*\}/);
          const result = m ? JSON.parse(m[0]) : { order_ref: null, eurocode: null, raw_text: text };

          // Extract order_ref with cascading fallbacks from raw_text
          if (result.raw_text) {
            const rt = String(result.raw_text);
            // Priority 1: "CBS Encomendas ... Cliente nº XXXXX" or "Encomendas Cliente nº XXXXX"
            const encMatch = rt.match(/Encomendas?\s+Cliente\s+n[ºo°]?\s*\.?\s*(\d+)/i)
                          || rt.match(/CBS\s+Encomendas?[\s\S]{0,40}Cliente\s+n[ºo°]?\s*\.?\s*(\d+)/i);
            if (encMatch) { result.order_ref = encMatch[1]; }
            // Priority 2: standalone "Cliente nº XXXXX" (any context)
            else {
              const clienteMatch = rt.match(/Cliente\s+n[ºo°]?\s*\.?\s*(\d{4,})/i);
              if (clienteMatch) result.order_ref = clienteMatch[1];
            }
            // Priority 3: PEDIDO:XXXXX (carrier order number, useful for returns/damaged reports)
            if (!result.order_ref) {
              const pedidoMatch = rt.match(/PEDIDO\s*:?\s*(\d{3,})/i);
              if (pedidoMatch) result.order_ref = pedidoMatch[1];
            }
          }

          // Always extract eurocode from raw_text via regex — more reliable than AI parsing.
          // Splits on "/" so "1605/6577AGACMVZ" yields ["1605", "6577AGACMVZ"] and finds 6577AGACMVZ.
          if (result.raw_text) {
            const rawUpper = String(result.raw_text).toUpperCase();
            const candidates = [...new Set(rawUpper.split(/[\s\/,;|:]+/)
              .map(t => t.replace(/^[^A-Z0-9]+/, '').replace(/[^A-Z0-9]+$/, ''))
              .filter(t => /^\d{4}[A-Z0-9]{3,}/.test(t))
              .map(t => t.slice(0, 4) + t.slice(4).replace(/I/g, '1').replace(/O/g, '0'))
              .filter(t => /[A-Z]/.test(t.slice(4))))];
            if (candidates.length > 0) {
              result.eurocode = candidates.sort((a, b) => b.length - a.length)[0];
              result.all_eurocodes = candidates;
            }
          }

          // Normalize I→1 and O→0 in eurocode (covers AI-returned values not processed above)
          if (result.eurocode) {
            const ec = String(result.eurocode).toUpperCase();
            result.eurocode = ec.slice(0, 4) + ec.slice(4).replace(/I/g, '1').replace(/O/g, '0');
          }

          resolve(result);
        } catch (e) {
          reject(new Error('Erro ao processar resposta da IA: ' + e.message));
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
    const data = JSON.parse(event.body || '{}');
    if (!data.image_base64) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'image_base64 obrigatório' }) };

    const result = await callVision(data.image_base64, data.media_type || 'image/jpeg');
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: result }) };
  } catch (err) {
    console.error('glass-label-ocr:', err);
    const code = err.message.includes('autenticado') ? 401 : 500;
    return { statusCode: code, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
