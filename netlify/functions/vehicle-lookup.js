// netlify/functions/vehicle-lookup.js
// "Identificar veículo": os dados da viatura pela matrícula (marca, modelo,
// VIN, motor, potência e os pormenores da versão), pedidos ao PoweringEG.
//  - GET ?matricula=BC30RQ[&novamente=1]
// A chave do PoweringEG fica aqui no servidor (nunca vai para o browser).

const https = require('https');
const jwt   = require('jsonwebtoken');

const JWT_SECRET    = process.env.JWT_SECRET    || 'expressglass-secret-key-change-in-production';
const POWERING_KEY  = process.env.POWERING_EG_API_KEY;
const POWERING_HOST = process.env.POWERING_EG_HOST || 'poweringeg.pt';

function pedirPowering(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: POWERING_HOST, path: `/api/external${path}`, method: 'GET', headers: { 'X-API-Key': POWERING_KEY } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* não é JSON */ }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const erro = new Error((json && (json.error || json.message)) || `PoweringEG HTTP ${res.statusCode}`);
            erro.statusCode = res.statusCode;
            reject(erro);
            return;
          }
          if (!json) { reject(new Error('Resposta inválida do PoweringEG')); return; }
          resolve(json);
        });
      }
    );
    // A primeira consulta de uma matrícula pode demorar; as seguintes vêm logo.
    req.setTimeout(25000, () => req.destroy(new Error('A consulta está a demorar. Tente outra vez daqui a pouco.')));
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
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };

  try {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
    jwt.verify(auth.substring(7), JWT_SECRET);
  } catch (_) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Não autenticado' }) };
  }
  if (!POWERING_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'POWERING_EG_API_KEY não configurada' }) };
  }

  const p = event.queryStringParameters || {};
  const matricula = String(p.matricula || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^([A-Z]{2}|\d{2}){3}$/.test(matricula)) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'A matrícula tem 3 pares de letras ou algarismos (ex.: BC-30-RQ).' }) };
  }

  try {
    const r = await pedirPowering(`/viatura?matricula=${encodeURIComponent(matricula)}${p.novamente === '1' ? '&novamente=1' : ''}`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: !!r.ok, ...r }) };
  } catch (error) {
    const status = error.statusCode === 400 ? 400 : 502;
    if (status !== 400) console.error('❌ vehicle-lookup:', error.message);
    return { statusCode: status, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
