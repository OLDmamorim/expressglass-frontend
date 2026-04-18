// telegram-bot.js — Netlify Function (webhook do Telegram)
// Regista o webhook em: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://agendamentosm.netlify.app/.netlify/functions/telegram-bot

const https = require('https');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DB = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const API_BASE = 'https://api.telegram.org/bot' + BOT_TOKEN;

// Estado da conversa em memória (por chat_id)
// Netlify Functions são stateless — usamos a DB para persistir estado
const STATES = {};

// ── Helpers Telegram ──────────────────────────────────────────────────────────
function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(API_BASE + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMessage(chat_id, text, extra = {}) {
  return tgRequest('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });
}

function sendButtons(chat_id, text, buttons) {
  return tgRequest('sendMessage', {
    chat_id, text, parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });
}

// ── Estado persistente na DB ──────────────────────────────────────────────────
async function getState(chat_id) {
  const { rows } = await DB.query(
    "SELECT state FROM telegram_bot_states WHERE chat_id = $1", [String(chat_id)]
  );
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].state); } catch { return null; }
}

async function setState(chat_id, state) {
  await DB.query(
    `INSERT INTO telegram_bot_states (chat_id, state, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET state = $2, updated_at = NOW()`,
    [String(chat_id), JSON.stringify(state)]
  );
}

async function clearState(chat_id) {
  await DB.query("DELETE FROM telegram_bot_states WHERE chat_id = $1", [String(chat_id)]);
}

// ── Autenticar utilizador pelo telegram_chat_id ───────────────────────────────
async function getUserByChatId(chat_id) {
  const { rows } = await DB.query(
    "SELECT id, username, role, assigned_portal_ids FROM users WHERE telegram_chat_id = $1 OR telegram_chat_id_2 = $1 LIMIT 1",
    [String(chat_id)]
  );
  return rows[0] || null;
}

// ── Buscar SMs disponíveis para o comercial ───────────────────────────────────
async function getAvailableSMs(user) {
  let assignedIds = user.assigned_portal_ids || [];
  if (typeof assignedIds === 'string') {
    assignedIds = assignedIds.replace(/[{}]/g,'').split(',').map(Number).filter(n => !isNaN(n));
  }
  if (!assignedIds.length) {
    const { rows } = await DB.query("SELECT id FROM portals WHERE portal_type = 'sm'");
    assignedIds = rows.map(r => r.id);
  }

  // Próximo dia útil
  const now = new Date(new Date().toLocaleString('en-US', {timeZone: 'Europe/Lisbon'}));
  let next = new Date(now);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  const nextISO = next.toISOString().slice(0,10);
  const diasPT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const nextLabel = diasPT[next.getDay()];

  const { rows } = await DB.query(`
    SELECT p.id, p.name,
      COALESCE((SELECT COUNT(*) FROM appointments a WHERE a.portal_id = p.id AND a.date = CURRENT_DATE AND a.executed IS NOT TRUE), 0) AS hoje,
      COALESCE((SELECT COUNT(*) FROM appointments a WHERE a.portal_id = p.id AND a.date = $2::date AND a.executed IS NOT TRUE), 0) AS proximo,
      COALESCE((SELECT COUNT(*) FROM appointments a WHERE a.portal_id = p.id AND a.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14 AND a.executed IS NOT TRUE), 0) AS semana,
      p.max_daily
    FROM portals p
    WHERE p.id = ANY($1::int[]) AND p.portal_type = 'sm'
    ORDER BY semana ASC, hoje ASC
  `, [assignedIds, nextISO]);

  return { portals: rows, nextLabel };
}

// ── Criar pedido ──────────────────────────────────────────────────────────────
async function criarPedido(user, state) {
  const { plate, service_type, locality, phone, car, entity, notes, portal_id } = state;

  // Inserir em commercial_requests
  const { rows } = await DB.query(`
    INSERT INTO commercial_requests
      (commercial_id, plate, locality, service_type, phone, car, entity, notes, confirmed_portal_id, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW(), NOW())
    RETURNING id
  `, [user.id, plate.toUpperCase(), locality, service_type, phone || null, car || null, entity || null, notes || null, portal_id]);

  // Inserir em appointments
  await DB.query(`
    INSERT INTO appointments
      (portal_id, plate, car, service, locality, phone, client_name, notes, status, confirmed, commercial_user_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NE', false, $9, NOW())
  `, [
    portal_id,
    plate.toUpperCase(),
    car || '',
    service_type || 'PB',
    locality,
    phone || null,
    entity || null,
    notes ? 'Pedido Telegram: ' + notes : 'Pedido Telegram',
    user.id,
  ]);

  return rows[0].id;
}

// ── Handler principal ─────────────────────────────────────────────────────────
async function handleUpdate(update) {
  const msg = update.message || update.callback_query?.message;
  const chat_id = msg?.chat?.id || update.callback_query?.from?.id;
  const text = update.message?.text;
  const callback_data = update.callback_query?.data;

  if (!chat_id) return;

  // Responder a callback_query
  if (update.callback_query) {
    await tgRequest('answerCallbackQuery', { callback_query_id: update.callback_query.id });
  }

  const input = text || callback_data || '';
  const user = await getUserByChatId(chat_id);
  const state = await getState(chat_id) || {};

  // ── /start ou /help ──────────────────────────────────────────────────────
  if (input === '/start' || input === '/help') {
    if (!user) {
      return sendMessage(chat_id, '❌ O teu Telegram não está associado a nenhuma conta ExpressGlass.\n\nPede ao administrador para associar o teu Chat ID: <code>' + chat_id + '</code>');
    }
    const nome = user.username;
    let menu = `👋 Olá, <b>${nome}</b>!\n\n`;
    if (user.role === 'comercial' || user.role === 'admin') {
      menu += '📋 /pedido — Fazer pedido de serviço\n';
      menu += '📊 /meus — Ver os meus pedidos\n';
    }
    menu += '\n<i>Chat ID: ' + chat_id + '</i>';
    return sendMessage(chat_id, menu);
  }

  // Verificar autenticação
  if (!user) {
    return sendMessage(chat_id, '❌ Conta não reconhecida. Chat ID: <code>' + chat_id + '</code>');
  }

  // Apenas comerciais e admins podem fazer pedidos
  if (user.role !== 'comercial' && user.role !== 'admin') {
    return sendMessage(chat_id, '❌ Não tens permissão para fazer pedidos de serviço.');
  }

  // ── /pedido — iniciar fluxo ───────────────────────────────────────────────
  if (input === '/pedido') {
    await setState(chat_id, { step: 'plate' });
    return sendMessage(chat_id, '🚗 <b>Novo Pedido de Serviço</b>\n\nIntroduza a <b>matrícula</b> (ex: AB-12-CD):');
  }

  // ── /meus — ver pedidos ───────────────────────────────────────────────────
  if (input === '/meus') {
    const { rows } = await DB.query(`
      SELECT cr.plate, cr.locality, cr.service_type, cr.status, cr.created_at, p.name as portal_name
      FROM commercial_requests cr
      LEFT JOIN portals p ON p.id = cr.confirmed_portal_id
      WHERE cr.commercial_id = $1
      ORDER BY cr.created_at DESC LIMIT 10
    `, [user.id]);

    if (!rows.length) return sendMessage(chat_id, '📋 Sem pedidos registados.');

    const statusEmoji = { pending: '🕐', done: '✅', cancelled: '🚫' };
    const lines = rows.map(r => {
      const d = new Date(r.created_at).toLocaleDateString('pt-PT');
      return `${statusEmoji[r.status] || '•'} <b>${r.plate}</b> — ${r.locality} — ${r.portal_name || '?'} (${d})`;
    });
    return sendMessage(chat_id, '📋 <b>Os teus pedidos:</b>\n\n' + lines.join('\n'));
  }

  // ── /cancelar — cancelar fluxo ────────────────────────────────────────────
  if (input === '/cancelar') {
    await clearState(chat_id);
    return sendMessage(chat_id, '❌ Pedido cancelado.');
  }

  // ── Fluxo de pedido ───────────────────────────────────────────────────────
  if (!state.step) {
    return sendMessage(chat_id, 'Envia /pedido para fazer um pedido de serviço ou /help para ajuda.');
  }

  // STEP 1: Matrícula
  if (state.step === 'plate') {
    const plate = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (plate.length < 6) return sendMessage(chat_id, '⚠️ Matrícula inválida. Tenta novamente (ex: AB-12-CD):');
    const formatted = plate.slice(0,2) + '-' + plate.slice(2,4) + '-' + plate.slice(4,6);
    await setState(chat_id, { ...state, step: 'service_type', plate: formatted });
    return sendButtons(chat_id, `✅ Matrícula: <b>${formatted}</b>\n\n🔧 Tipo de vidro:`, [
      [{ text: '🪟 Para-brisas (PB)', callback_data: 'svc:PB' }],
      [{ text: '🚪 Lateral (LT)', callback_data: 'svc:LT' }, { text: '🔵 Óculo (OC)', callback_data: 'svc:OC' }],
      [{ text: '🔧 Reparação (REP)', callback_data: 'svc:REP' }],
    ]);
  }

  // STEP 2: Tipo de serviço (callback)
  if (state.step === 'service_type' && callback_data?.startsWith('svc:')) {
    const svc = callback_data.split(':')[1];
    await setState(chat_id, { ...state, step: 'locality', service_type: svc });
    return sendMessage(chat_id, `✅ Tipo: <b>${svc}</b>\n\n📍 Qual a <b>localidade</b> do cliente?`);
  }

  // STEP 3: Localidade
  if (state.step === 'locality') {
    await setState(chat_id, { ...state, step: 'phone', locality: input });
    return sendMessage(chat_id, `✅ Localidade: <b>${input}</b>\n\n📞 <b>Contacto</b> do cliente (ou /skip para omitir):`);
  }

  // STEP 4: Contacto
  if (state.step === 'phone') {
    const phone = input === '/skip' ? null : input;
    await setState(chat_id, { ...state, step: 'car', phone });
    return sendMessage(chat_id, `✅ Contacto: <b>${phone || '—'}</b>\n\n🚗 <b>Modelo do carro</b> (ou /skip):`);
  }

  // STEP 5: Modelo
  if (state.step === 'car') {
    const car = input === '/skip' ? null : input.toUpperCase();
    await setState(chat_id, { ...state, step: 'sm', car });

    // Mostrar SMs disponíveis
    const { portals, nextLabel } = await getAvailableSMs(user);
    if (!portals.length) return sendMessage(chat_id, '❌ Sem SMs disponíveis.');

    const max = portals[0].max_daily || 8;
    const buttons = portals.map(p => {
      const dot = p.hoje >= max ? '🔴' : p.hoje >= max * 0.7 ? '🟡' : '🟢';
      return [{ text: `${dot} ${p.name} — Hoje: ${p.hoje}/${max} · ${nextLabel}: ${p.proximo}/${max}`, callback_data: 'sm:' + p.id }];
    });
    buttons.push([{ text: '❌ Cancelar', callback_data: 'cancel' }]);

    return sendButtons(chat_id, `✅ Carro: <b>${car || '—'}</b>\n\n🏢 Escolhe o <b>SM de destino</b>:`, buttons);
  }

  // STEP 6: Escolha do SM
  if (state.step === 'sm' && callback_data?.startsWith('sm:')) {
    const portal_id = parseInt(callback_data.split(':')[1]);
    await setState(chat_id, { ...state, step: 'confirm', portal_id });

    const { rows } = await DB.query("SELECT name FROM portals WHERE id = $1", [portal_id]);
    const portalName = rows[0]?.name || '?';

    const resumo = [
      `🚗 <b>Matrícula:</b> ${state.plate}`,
      `🔧 <b>Serviço:</b> ${state.service_type}`,
      `📍 <b>Localidade:</b> ${state.locality}`,
      `📞 <b>Contacto:</b> ${state.phone || '—'}`,
      `🚙 <b>Carro:</b> ${state.car || '—'}`,
      `🏢 <b>SM:</b> ${portalName}`,
    ].join('\n');

    return sendButtons(chat_id, `📋 <b>Confirmar pedido?</b>\n\n${resumo}`, [
      [{ text: '✅ Confirmar', callback_data: 'confirm:yes' }, { text: '❌ Cancelar', callback_data: 'cancel' }]
    ]);
  }

  // Cancelar em qualquer ponto
  if (callback_data === 'cancel') {
    await clearState(chat_id);
    return sendMessage(chat_id, '❌ Pedido cancelado.');
  }

  // STEP 7: Confirmação
  if (state.step === 'confirm' && callback_data === 'confirm:yes') {
    try {
      const id = await criarPedido(user, state);
      await clearState(chat_id);
      return sendMessage(chat_id, `✅ <b>Pedido criado com sucesso!</b>\n\nID: #${id}\nMatrícula: <b>${state.plate}</b>\nO coordenador será notificado.`);
    } catch (e) {
      await clearState(chat_id);
      return sendMessage(chat_id, '❌ Erro ao criar pedido: ' + e.message);
    }
  }
}

// ── Handler Netlify ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' };
  }
  try {
    const update = JSON.parse(event.body || '{}');
    await handleUpdate(update);
  } catch (e) {
    console.error('[telegram-bot]', e.message);
  }
  return { statusCode: 200, body: 'OK' };
};
