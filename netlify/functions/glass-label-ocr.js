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
            text: `Analisa esta guia/etiqueta de entrega de vidro automóvel de um transportador português (ex: A Sua Pressa, Garland, etc.).

Extrai APENAS estes dois campos:

1. Número de encomenda do CLIENTE (ExpressGlass) — é o número interno da ExpressGlass, NÃO o número de entrega do transportador.
   Procura NESTA ORDEM DE PRIORIDADE:
   a) "Encomendas Cliente nº XXXXX" ou "Enc. Cliente nº XXXXX" — este é o número CORRECTO
   b) "OBS: ... nº XXXXX" — normalmente contém o número de cliente no campo de observações
   c) "N.º Enc", "Enc." — referência de encomenda
   ⚠️ NÃO uses "PEDIDO:XXXXX" nem "COD AT:XXXXX" — esses são números INTERNOS do transportador, não são o número da encomenda do cliente.
   Exemplo correcto: "OBS:Encomendas Cliente nº 48932" → order_ref = "48932"

2. Eurocode do vidro — código com formato EXATO: 4 dígitos seguidos IMEDIATAMENTE de 3 ou mais caracteres alfanuméricos maiúsculos (ex: 6577AGACMVZ, 3739ABCDE, 7274AGAM1R).
   Procura em campos como PICK_LABELS, OBS, Observações.
   REGRA CRÍTICA para PICK_LABELS com formato "NNNN/DDDDLLLLL" (ex: "1605/6577AGACMVZ"):
   - O número ANTES da barra "/" (ex: 1605) é uma sequência — NÃO é o eurocode
   - O eurocode é o código COMPLETO APÓS a barra "/" (ex: 6577AGACMVZ)
   - NUNCA combines dígitos de antes da barra com letras de depois da barra

   ⚠️ ATENÇÃO CRÍTICA — confusão 1 vs I vs O vs 0:
   Nesta fonte de impressora térmica, o DÍGITO '1' (um) e a LETRA 'I' maiúscula são visualmente muito semelhantes. O mesmo para o DÍGITO '0' (zero) e a LETRA 'O'.
   Em eurocodes, os sistemas de vidro automóvel NÃO utilizam as letras 'I' nem 'O' no código para evitar exactamente esta confusão. Por isso:
   - Se vires um caracter que parece 'I' dentro do eurocode → é o DÍGITO '1'
   - Se vires um caracter que parece 'O' dentro do eurocode → é o DÍGITO '0'
   Exemplo: "7274AGAM1R" tem um dígito '1' a seguir a 'AGAM', NÃO a letra 'I'.

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

          // Always prefer "Encomendas Cliente nº XXXXX" over whatever the AI extracted.
          // This is the ExpressGlass internal order number matching PHC's numeros_encomendas.
          if (result.raw_text) {
            const encMatch = String(result.raw_text).match(/Encomendas?\s+Cliente\s+n[ºo°]?\s*\.?\s*(\d+)/i);
            if (encMatch) result.order_ref = encMatch[1];
          }

          // Always extract eurocode from raw_text via regex — more reliable than AI parsing.
          // Splits on "/" so "1605/6577AGACMVZ" yields ["1605", "6577AGACMVZ"] and finds 6577AGACMVZ.
          if (result.raw_text) {
            const rawUpper = String(result.raw_text).toUpperCase();
            const candidates = rawUpper.split(/[\s\/,;|:]+/)
              .map(t => t.replace(/^[^A-Z0-9]+/, '').replace(/[^A-Z0-9]+$/, ''))
              .filter(t => /^\d{4}[A-Z0-9]{3,}/.test(t))
              // Normalize I→1 and O→0 BEFORE the letter check so "COD AT:19113I76130"
              // becomes "19113176130" (all digits) and gets correctly rejected.
              .map(t => t.slice(0, 4) + t.slice(4).replace(/I/g, '1').replace(/O/g, '0'))
              // Real eurocodes always contain at least one letter after the first 4 digits.
              // Pure-digit strings (e.g. COD AT numbers) are not eurocodes.
              .filter(t => /[A-Z]/.test(t.slice(4)));
            if (candidates.length > 0) {
              result.eurocode = candidates.sort((a, b) => b.length - a.length)[0];
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
