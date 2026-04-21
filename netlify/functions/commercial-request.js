// netlify/functions/commercial-request.js
// Recebe pedido de serviço do comercial, sugere SM, guarda na DB

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'expressglass-secret-key-change-in-production';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const https = require('https');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function sendTelegram(chatId, text) {
  return new Promise((resolve) => {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return resolve({ ok: false });
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', () => resolve({ ok: false }));
    req.write(body);
    req.end();
  });
}

function verifyToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(auth.substring(7), JWT_SECRET);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const user = verifyToken(event);
    console.log('[CR] user JWT:', JSON.stringify(user));

    // ── GET — pedidos pendentes para um portal (coordenador) ou próprios (comercial) ──────────────
    if (event.httpMethod === 'GET') {
      const p = event.queryStringParameters || {};
      const portalId = p.portal_id ? parseInt(p.portal_id) : null;

      // Comercial a ver os seus próprios pedidos
      if (p.mine === '1') {
        const { rows } = await pool.query(`
          SELECT cr.*, po.name as portal_name
          FROM commercial_requests cr
          LEFT JOIN portals po ON po.id = cr.confirmed_portal_id
          WHERE cr.commercial_id = $1
          ORDER BY cr.created_at DESC
          LIMIT 100
        `, [user.id || user.userId]);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, requests: rows }) };
      }

      // Buscar pedidos novos (pending) para este SM, dos últimos 7 dias
      let rows;
      if (portalId) {
        ({ rows } = await pool.query(`
          SELECT cr.*, u.username as commercial_name
          FROM commercial_requests cr
          JOIN users u ON u.id = cr.commercial_id
          WHERE cr.confirmed_portal_id = $1
            AND cr.status = 'pending'
            AND cr.created_at > NOW() - INTERVAL '7 days'
          ORDER BY cr.created_at DESC
        `, [portalId]));
      } else {
        ({ rows } = await pool.query(`
          SELECT cr.*, u.username as commercial_name
          FROM commercial_requests cr
          JOIN users u ON u.id = cr.commercial_id
          WHERE cr.commercial_id = $1
          ORDER BY cr.created_at DESC
          LIMIT 50
        `, [user.id]));
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, requests: rows }) };
    }

    // ── POST — criar pedido ───────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      // Se ?all=1 (admin sem portal seleccionado), buscar todos os pedidos pendentes
      const qp = event.queryStringParameters || {};
      if (qp.all === '1') {
        const { rows } = await pool.query(`
          SELECT cr.*, u.username as commercial_name
          FROM commercial_requests cr
          JOIN users u ON u.id = cr.commercial_id
          WHERE cr.status = 'pending'
            AND cr.created_at > NOW() - INTERVAL '7 days'
          ORDER BY cr.created_at DESC
        `);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, requests: rows }) };
      }

      const body = JSON.parse(event.body || '{}');
      const { plate, service_file, locality, confirmed_portal_id, service_type, phone, entity, notes, car } = body;

      if (!plate || !locality) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Matrícula e localidade são obrigatórios' }) };
      }

      // Portais SM afectos ao comercial (vêm do JWT via user.portals)
      const userRow = await pool.query('SELECT assigned_portal_ids FROM users WHERE id = $1', [user.id || user.userId]);
      const rawIds = userRow.rows[0]?.assigned_portal_ids;
      console.log('[CR] userId:', user.id || user.userId, 'rawIds:', JSON.stringify(rawIds));
      // PostgreSQL INTEGER[] pode vir como array JS ou como string "{1,2}"
      let assignedIds = [];
      if (Array.isArray(rawIds)) {
        assignedIds = rawIds;
      } else if (typeof rawIds === 'string' && rawIds.length > 2) {
        // formato "{1,2}" → [1,2]
        assignedIds = rawIds.replace(/[{}]/g,'').split(',').map(Number).filter(n => !isNaN(n));
      }
      console.log('[CR] assignedIds após parse:', JSON.stringify(assignedIds));

      // Fallback: usar portalIds do JWT (array de IDs directamente)
      if (!assignedIds.length && user.portalIds && user.portalIds.length) {
        assignedIds = user.portalIds.map(id => parseInt(id));
      }

      // Fallback 2: buscar todos os SM se ainda vazio (admin/teste)
      if (!assignedIds.length) {
        const allSM = await pool.query("SELECT id FROM portals WHERE portal_type = 'sm'");
        assignedIds = allSM.rows.map(r => r.id);
      }

      if (!assignedIds.length) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Sem SMs configurados no sistema.' }) };
      }

      // Garantir que são inteiros
      assignedIds = assignedIds.map(id => parseInt(id)).filter(id => !isNaN(id));

      // Calcular próximo dia útil (excluindo hoje)
      const diasPT = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
      const nowLocal = new Date(new Date().toLocaleString('en-US', {timeZone: 'Europe/Lisbon'}));
      let nextWeekday = new Date(nowLocal);
      nextWeekday.setDate(nextWeekday.getDate() + 1);
      while (nextWeekday.getDay() === 0 || nextWeekday.getDay() === 6) {
        nextWeekday.setDate(nextWeekday.getDate() + 1);
      }
      const nextWeekdayLabel = diasPT[nextWeekday.getDay()];
      const nextWeekdayISO = nextWeekday.toISOString().slice(0, 10);

      // ── Sugestão de SM ─────────────────────────────────────────────────
      // Contar agendamentos de hoje + amanhã para cada SM afecto
      // e sugerir o que tem mais disponibilidade
      let suggested = null;

      if (!confirmed_portal_id) {
        const availRes = await pool.query(`
          SELECT p.id, p.name, p.max_daily,
            COALESCE(
              (SELECT COUNT(*) FROM appointments a
               WHERE a.portal_id = p.id
                 AND a.date = CURRENT_DATE
                 AND a.executed IS NOT TRUE), 0
            ) AS today_count,
            COALESCE(
              (SELECT COUNT(*) FROM appointments a
               WHERE a.portal_id = p.id
                 AND a.date = $2::date
                 AND a.executed IS NOT TRUE), 0
            ) AS tomorrow_count,
            COALESCE(
              (SELECT COUNT(*) FROM appointments a
               WHERE a.portal_id = p.id
                 AND a.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
                 AND a.executed IS NOT TRUE), 0
            ) AS week_count
          FROM portals p
          WHERE p.id = ANY($1::int[])
            AND p.portal_type = 'sm'
          ORDER BY week_count ASC, today_count ASC, tomorrow_count ASC
        `, [assignedIds, nextWeekdayISO]);

        const portals = availRes.rows.map(p => ({
          id: p.id,
          name: p.name,
          max_daily: p.max_daily || 8,
          today_count: parseInt(p.today_count),
          tomorrow_count: parseInt(p.tomorrow_count),
          week_count: parseInt(p.week_count),
          next_weekday_label: nextWeekdayLabel,
          today_available: (p.max_daily || 8) - parseInt(p.today_count),
          tomorrow_available: (p.max_daily || 8) - parseInt(p.tomorrow_count),
        }));

        suggested = portals[0] || null; // o menos ocupado hoje
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, action: 'suggest', portals, suggested })
        };
      }

      // ── Confirmar e guardar pedido ─────────────────────────────────────
      const { rows: inserted } = await pool.query(`
        INSERT INTO commercial_requests
          (commercial_id, plate, service_file, locality, confirmed_portal_id, status, service_type, phone, entity, notes, car)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
        RETURNING *
      `, [user.id || user.userId, plate.toUpperCase(), service_file || null, locality, confirmed_portal_id,
          service_type || null, phone || null, entity || null, notes || null, car || null]);

      // Criar também o registo em appointments (Por Agendar no SM)
      await pool.query(`
        INSERT INTO appointments
          (portal_id, plate, car, service, locality, notes, phone, client_name, status, confirmed, commercial_user_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NE', false, $9, NOW())
        ON CONFLICT DO NOTHING
      `, [
        confirmed_portal_id,
        plate.toUpperCase(),
        car || '',
        service_type || 'PB',
        locality,
        [service_file ? 'Ficha: ' + service_file : null, notes].filter(Boolean).join(' | ') || 'Pedido comercial',
        phone || null,
        entity || null,
        user.id || user.userId,
      ]);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, action: 'created', request: inserted[0] })
      };
    }

    // ── PUT — actualizar status do pedido ─────────────────────────────────
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const { id, status, plate, commercial_id, action } = body;

      // Acção especial: cliente não atendeu → notificar comercial por Telegram
      if (action === 'no_answer' && id) {
        const { rows: crRows } = await pool.query(`
          SELECT cr.plate, u.telegram_chat_id, u.username
          FROM commercial_requests cr
          JOIN users u ON u.id = cr.commercial_id
          WHERE cr.id = $1
        `, [id]);
        if (crRows.length && crRows[0].telegram_chat_id) {
          const cr = crRows[0];
          const msg = `📞 <b>Cliente não atendeu</b>

🚗 <b>${cr.plate}</b>

O coordenador tentou contactar o cliente mas não obteve resposta.
O pedido continua pendente — irá tentar novamente em breve.`;
          await sendTelegram(crRows[0].telegram_chat_id, msg);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      if (id && status) {
        await pool.query('UPDATE commercial_requests SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
      } else if (plate && commercial_id && status) {
        // Cancelamento por matrícula (ao apagar appointment)
        await pool.query(
          "UPDATE commercial_requests SET status = $1, updated_at = NOW() WHERE plate = $2 AND commercial_id = $3 AND status != 'done'",
          [status, plate.toUpperCase(), commercial_id]
        );
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: '{}' };

  } catch (err) {
    console.error('[commercial-request]', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};