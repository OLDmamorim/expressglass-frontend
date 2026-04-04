// netlify/functions/notify-commercial.js
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const https = require('https');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function sendTelegram(chatId, text) {
  return new Promise((resolve) => {
    if (!TELEGRAM_BOT_TOKEN) return resolve({ ok: false, error: 'No token' });
    const body = JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'HTML' });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ ok: false, error: 'parse error', raw: data }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
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
    jwt.verify(authHeader.substring(7), JWT_SECRET);

    const { appointment_id } = JSON.parse(event.body || '{}');
    if (!appointment_id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'appointment_id em falta' }) };

    const { rows } = await pool.query(`
      SELECT a.plate, a.car, a.date, a.executed, a.not_done_reason,
             a.commercial_user_id, u.username AS commercial_name,
             u.telegram_chat_id, p.name AS portal_name
      FROM appointments a
      LEFT JOIN users u ON u.id = a.commercial_user_id
      LEFT JOIN portals p ON p.id = a.portal_id
      WHERE a.id = $1
    `, [appointment_id]);

    if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Não encontrado' }) };

    const appt = rows[0];

    if (!appt.commercial_user_id) return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: false, reason: 'Sem comercial' }) };
    if (!appt.telegram_chat_id) return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: false, reason: 'Sem telegram_chat_id' }) };

    const dataStr = appt.date
      ? new Date(appt.date + 'T12:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';

    const msg = appt.executed === true
      ? `✅ <b>Serviço Realizado</b>\n\n🚗 <b>${appt.plate}</b> — ${appt.car || '—'}\n📅 ${dataStr}\n🏪 ${appt.portal_name || '—'}`
      : `❌ <b>Serviço Não Realizado</b>\n\n🚗 <b>${appt.plate}</b> — ${appt.car || '—'}\n📅 ${dataStr}\n🏪 ${appt.portal_name || '—'}\n📝 Motivo: ${appt.not_done_reason || '—'}`;

    const tgResult = await sendTelegram(appt.telegram_chat_id, msg);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: tgResult.ok === true, tg: tgResult }) };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
