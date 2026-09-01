// netlify/functions/sm-efficiency.js
//
// Eficiência dos SMs para consumo do PoweringEG.
//
// Ao contrário do reports.js, que serve um portal de cada vez a um utilizador
// com sessão iniciada, este devolve todos os SMs de uma vez e autentica-se por
// chave: do outro lado está um servidor, não uma pessoa.
//
// As linhas vêm com o powering_loja_id já resolvido, para o PoweringEG não
// precisar de saber o que é um portal.

const { Pool } = require('pg');
const crypto = require('crypto');
const { limitarAoPassado, juntarPorPortal } = require('../lib/sm-efficiency');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Só o serviço móvel. Os Recalibras são acompanhados por outra via e não
// entram aqui — misturá-los tornaria as médias ilegíveis.
const TIPOS_SM = ['sm'];

/** Comparação em tempo constante: uma chave não se compara com ===. */
function chaveValida(recebida) {
  const esperada = process.env.EGAGENDA_API_KEY;
  if (!esperada) return false;
  const a = Buffer.from(String(recebida || ''));
  const b = Buffer.from(esperada);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };
  }

  const recebida = event.headers['x-api-key'] || event.headers['X-API-Key'];
  if (!chaveValida(recebida)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Chave inválida' }) };
  }

  const p = event.queryStringParameters || {};
  const dateFrom = p.date_from;
  const dateTo = p.date_to;

  if (!DATA_VALIDA.test(String(dateFrom)) || !DATA_VALIDA.test(String(dateTo))) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'date_from e date_to obrigatórios, no formato YYYY-MM-DD' }),
    };
  }
  if (dateFrom > dateTo) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'date_from depois de date_to' }) };
  }

  const ate = limitarAoPassado(dateTo, new Date().toISOString());

  try {
    const { rows: portais } = await pool.query(
      `SELECT id, name, portal_type, powering_loja_id, vehicle_plate
         FROM portals
        WHERE portal_type = ANY($1)
        ORDER BY name`,
      [TIPOS_SM]
    );

    if (portais.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, periodo: { de: dateFrom, ate }, sms: [] }),
      };
    }

    const ids = portais.map(r => r.id);
    const args = [ids, dateFrom, ate];

    const { rows: totais } = await pool.query(
      `SELECT portal_id,
              COUNT(*)                                  AS agendados,
              COUNT(*) FILTER (WHERE executed = true)   AS realizados,
              COUNT(*) FILTER (WHERE executed = false)  AS nao_realizados,
              COALESCE(SUM(km), 0)                      AS km,
              COALESCE(SUM(travel_time), 0)             AS minutos_estrada
         FROM appointments
        WHERE portal_id = ANY($1) AND date BETWEEN $2::date AND $3::date
        GROUP BY portal_id`,
      args
    );

    const { rows: tempos } = await pool.query(
      `SELECT portal_id,
              COUNT(*)                                                                    AS dias_registados,
              COALESCE(SUM(EXTRACT(EPOCH FROM (checkout_at - checkin_at)) / 3600.0), 0)   AS horas
         FROM team_checkins
        WHERE portal_id = ANY($1) AND date BETWEEN $2::date AND $3::date
          AND checkin_at IS NOT NULL AND checkout_at IS NOT NULL
        GROUP BY portal_id`,
      args
    );

    const { rows: motivos } = await pool.query(
      `SELECT portal_id, not_done_reason AS motivo, COUNT(*) AS total
         FROM appointments
        WHERE portal_id = ANY($1) AND date BETWEEN $2::date AND $3::date
          AND executed = false
        GROUP BY portal_id, not_done_reason`,
      args
    );

    const { rows: comerciais } = await pool.query(
      `SELECT a.portal_id,
              u.username                                 AS comercial,
              COUNT(*)                                   AS agendados,
              COUNT(*) FILTER (WHERE a.executed = true)  AS realizados
         FROM appointments a
         JOIN users u ON u.id = a.commercial_user_id
        WHERE a.portal_id = ANY($1) AND a.date BETWEEN $2::date AND $3::date
        GROUP BY a.portal_id, u.username`,
      args
    );

    // Detalhe: onde é que o SM andou, e o que fez em cada dia. É o que se abre
    // quando se olha para uma zona em particular; a lista geral não o usa, mas
    // vem junto para não obrigar a uma segunda ida à rede — são poucas linhas.
    const { rows: localidades } = await pool.query(
      `SELECT portal_id,
              COALESCE(NULLIF(TRIM(locality), ''), 'Sem localidade') AS localidade,
              COUNT(*)                                  AS agendados,
              COUNT(*) FILTER (WHERE executed = true)   AS realizados,
              COALESCE(SUM(km), 0)                      AS km
         FROM appointments
        WHERE portal_id = ANY($1) AND date BETWEEN $2::date AND $3::date
        GROUP BY portal_id, COALESCE(NULLIF(TRIM(locality), ''), 'Sem localidade')`,
      args
    );

    const { rows: dias } = await pool.query(
      `SELECT tc.portal_id,
              tc.date::text                                                  AS data,
              tc.checkin_at,
              tc.checkout_at,
              EXTRACT(EPOCH FROM (tc.checkout_at - tc.checkin_at)) / 3600.0  AS horas,
              COUNT(a.id) FILTER (WHERE a.executed = true)                   AS realizados,
              COALESCE(SUM(a.km) FILTER (WHERE a.executed = true), 0)        AS km
         FROM team_checkins tc
         LEFT JOIN appointments a ON a.portal_id = tc.portal_id AND a.date = tc.date
        WHERE tc.portal_id = ANY($1) AND tc.date BETWEEN $2::date AND $3::date
        GROUP BY tc.portal_id, tc.date, tc.checkin_at, tc.checkout_at
        ORDER BY tc.date ASC`,
      args
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        // O fim devolvido é o efectivo, não o pedido: quem consome tem de saber
        // que período é que estes números cobrem.
        periodo: { de: dateFrom, ate },
        sms: juntarPorPortal(portais, totais, tempos, motivos, comerciais, localidades, dias),
      }),
    };
  } catch (e) {
    console.error('Erro sm-efficiency:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
