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

function verifyToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Não autenticado');
  return jwt.verify(auth.substring(7), JWT_SECRET);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const user = verifyToken(event);

    // ── GET — pedidos pendentes para um portal (coordenador) ──────────────
    if (event.httpMethod === 'GET') {
      const p = event.queryStringParameters || {};
      const portalId = p.portal_id ? parseInt(p.portal_id) : null;

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
      const body = JSON.parse(event.body || '{}');
      const { plate, service_file, locality, confirmed_portal_id } = body;

      if (!plate || !locality) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Matrícula e localidade são obrigatórios' }) };
      }

      // Portais SM afectos ao comercial (vêm do JWT via user.portals)
      const userRow = await pool.query('SELECT assigned_portal_ids FROM users WHERE id = $1', [user.id]);
      const rawIds = userRow.rows[0]?.assigned_portal_ids;
      console.log('[CR] user.id:', user.id, 'rawIds:', JSON.stringify(rawIds), 'type:', typeof rawIds);
      // PostgreSQL INTEGER[] pode vir como array JS ou como string "{1,2}"
      let assignedIds = [];
      if (Array.isArray(rawIds)) {
        assignedIds = rawIds;
      } else if (typeof rawIds === 'string' && rawIds.length > 2) {
        // formato "{1,2}" → [1,2]
        assignedIds = rawIds.replace(/[{}]/g,'').split(',').map(Number).filter(n => !isNaN(n));
      }
      console.log('[CR] assignedIds após parse:', JSON.stringify(assignedIds));

      // Fallback: usar portais do JWT se assigned_portal_ids ainda não configurado
      if (!assignedIds.length && user.portals) {
        assignedIds = user.portals
          .filter(p => (p.portalType || p.portal_type) === 'sm')
          .map(p => parseInt(p.id));
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
                 AND a.date = CURRENT_DATE + 1
                 AND a.executed IS NOT TRUE), 0
            ) AS tomorrow_count
          FROM portals p
          WHERE p.id = ANY($1::int[])
            AND p.portal_type = 'sm'
          ORDER BY today_count ASC, tomorrow_count ASC
        `, [assignedIds]);

        const portals = availRes.rows.map(p => ({
          id: p.id,
          name: p.name,
          max_daily: p.max_daily || 8,
          today_count: parseInt(p.today_count),
          tomorrow_count: parseInt(p.tomorrow_count),
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
          (commercial_id, plate, service_file, locality, confirmed_portal_id, status)
        VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING *
      `, [user.id, plate.toUpperCase(), service_file || null, locality, confirmed_portal_id]);

      // Criar também o registo em appointments (Por Agendar no SM)
      await pool.query(`
        INSERT INTO appointments
          (portal_id, plate, car, locality, notes, status, confirmed, commercial_user_id, created_at)
        VALUES ($1, $2, '', $3, $4, 'NE', false, $5, NOW())
        ON CONFLICT DO NOTHING
      `, [
        confirmed_portal_id,
        plate.toUpperCase(),
        locality,
        service_file ? 'Ficha: ' + service_file : 'Pedido comercial',
        user.id,
      ]);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, action: 'created', request: inserted[0] })
      };
    }

    return { statusCode: 405, headers, body: '{}' };

  } catch (err) {
    console.error('[commercial-request]', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
