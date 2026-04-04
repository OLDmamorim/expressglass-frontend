// netlify/functions/notify-commercial.js
// Envia notificação Telegram ao comercial quando técnico conclui serviço

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegram(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN não configurado');
    return false;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    })
  });
  const data = await resp.json();
  if (!data.ok) console.error('Telegram error:', data);
  return data.ok;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Método não permitido' }) };
  }

  try {
    // Verificar autenticação
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Não autenticado');
    jwt.verify(authHeader.substring(7), JWT_SECRET);

    const { appointment_id } = JSON.parse(event.body || '{}');
    if (!appointment_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'appointment_id em falta' }) };
    }

    // Buscar dados do agendamento e do comercial
    const { rows } = await pool.query(`
      SELECT
        a.plate, a.car, a.date, a.executed, a.not_done_reason,
        a.commercial_user_id,
        u.username AS commercial_name,
        u.telegram_chat_id,
        p.name AS portal_name
      FROM appointments a
      LEFT JOIN users u ON u.id = a.commercial_user_id
      LEFT JOIN portals p ON p.id = a.portal_id
      WHERE a.id = $1
    `, [appointment_id]);

    if (!rows.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Agendamento não encontrado' }) };
    }

    const appt = rows[0];

    if (!appt.commercial_user_id) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: false, reason: 'Sem comercial atribuído' }) };
    }

    if (!appt.telegram_chat_id) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent: false, reason: 'Comercial sem Telegram configurado' }) };
    }

    // Construir mensagem
    const dataStr = appt.date
      ? new Date(appt.date + 'T12:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';

    let msg = '';
    if (appt.executed === true) {
      msg = `✅ <b>Serviço Realizado</b>\n\n` +
            `🚗 <b>${appt.plate}</b> — ${appt.car || '—'}\n` +
            `📅 ${dataStr}\n` +
            `🏪 ${appt.portal_name || '—'}`;
    } else {
      msg = `❌ <b>Serviço Não Realizado</b>\n\n` +
            `🚗 <b>${appt.plate}</b> — ${appt.car || '—'}\n` +
            `📅 ${dataStr}\n` +
            `🏪 ${appt.portal_name || '—'}\n` +
            `📝 Motivo: ${appt.not_done_reason || '—'}`;
    }

    const sent = await sendTelegram(appt.telegram_chat_id, msg);

    console.log(`📨 Notificação comercial ${appt.commercial_name}: ${sent ? 'enviada' : 'falhou'}`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, sent }) };

  } catch (error) {
    console.error('Erro notify-commercial:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
