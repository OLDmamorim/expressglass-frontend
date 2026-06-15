// route-optimization-alert.js
// Às 9h30, analisa os próximos 5 dias e avisa o coordenador quando a mesma
// localidade aparece em dias diferentes (poderiam ser agrupados numa só deslocação).
(function () {
  'use strict';

  const STORAGE_KEY = 'eg_route_opt';
  const ALERT_HOUR  = 9;
  const ALERT_MIN   = 30;
  const DAYS_AHEAD  = 5;
  const SKIP_LOCALITIES = new Set(['outra', '']);

  function todayKey() { return new Date().toISOString().slice(0, 10); }

  function wasDismissed() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').date === todayKey(); }
    catch (e) { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayKey() })); } catch (e) {}
  }

  function isCoordOrAdmin() {
    const r = window.authClient?.getUser?.()?.role;
    return r === 'coordenador' || r === 'coordinator' || r === 'admin';
  }

  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return days[d.getDay()] + ' ' + d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
  }

  function getConflicts() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const limit = new Date(today.getTime() + DAYS_AHEAD * 86400000);

    const relevant = (window.appointments || []).filter(a => {
      if (!a.date || !a.locality) return false;
      const loc = a.locality.trim().toLowerCase();
      if (SKIP_LOCALITIES.has(loc)) return false;
      const d = new Date(a.date + 'T00:00:00'); d.setHours(0, 0, 0, 0);
      return d >= today && d <= limit;
    });

    // Group by normalized locality (and portal, for multi-portal coordinators)
    const byKey = {};
    relevant.forEach(a => {
      const key = (a.locality || '').trim().toLowerCase() + '|' + (a.portal_id || '');
      if (!byKey[key]) byKey[key] = { locality: a.locality, portal_name: a.portal_name || null, appts: [] };
      byKey[key].appts.push(a);
    });

    const conflicts = [];
    Object.values(byKey).forEach(({ locality, portal_name, appts }) => {
      const uniqueDates = [...new Set(appts.map(a => a.date))].sort();
      if (uniqueDates.length >= 2) {
        conflicts.push({
          locality,
          portal_name,
          groups: uniqueDates.map(date => ({
            label: fmtDate(date),
            appts: appts.filter(a => a.date === date)
          }))
        });
      }
    });

    // Sort by locality name
    conflicts.sort((a, b) => a.locality.localeCompare(b.locality, 'pt'));
    return conflicts;
  }

  function check() {
    if (wasDismissed() || !isCoordOrAdmin()) return;
    const conflicts = getConflicts();
    if (!conflicts.length) return;
    _show(conflicts);
  }

  function _show(conflicts) {
    const modal = document.getElementById('routeOptModal');
    if (!modal) return;

    document.getElementById('routeOptCount').textContent = conflicts.length;

    document.getElementById('routeOptList').innerHTML = conflicts.map(c => {
      const header = c.portal_name
        ? `📍 ${c.locality} <span style="font-size:11px;color:#94a3b8;font-weight:400;">(${c.portal_name})</span>`
        : `📍 ${c.locality}`;
      const dayBlocks = c.groups.map(g => {
        const cards = g.appts.map(a => `
          <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 9px;min-width:88px;">
            <div style="font-weight:800;font-size:13px;color:#fbbf24;letter-spacing:.5px;">${a.plate || '—'}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:2px;line-height:1.2;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(a.car || '').toUpperCase() || '—'}</div>
          </div>`).join('');
        return `<div style="margin-top:8px;">
          <div style="display:inline-block;background:#1d4ed8;color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:6px;margin-bottom:5px;">${g.label}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${cards}</div>
        </div>`;
      }).join('<div style="text-align:center;color:#f59e0b;font-size:13px;margin:2px 0;">⇕</div>');
      return `<div style="margin-bottom:14px;padding:12px 14px;background:rgba(255,255,255,0.04);border-radius:12px;border-left:3px solid #f59e0b;">
        <div style="font-weight:700;font-size:14px;color:#fff;margin-bottom:4px;">${header}</div>
        ${dayBlocks}
        <div style="font-size:11px;color:#6b7280;margin-top:10px;">💡 Podem ser agrupados num só dia</div>
      </div>`;
    }).join('');

    modal.style.display = 'flex';
  }

  function dismiss() {
    markDismissed();
    document.getElementById('routeOptModal').style.display = 'none';
  }

  function _buildModal() {
    if (document.getElementById('routeOptModal')) return;
    const el = document.createElement('div');
    el.id = 'routeOptModal';
    el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    el.innerHTML = `
      <div style="background:#1e293b;border-radius:20px;max-width:480px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5);">
        <div style="padding:20px 20px 14px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
          <div style="font-size:32px;margin-bottom:8px;">🗺️</div>
          <h3 style="margin:0 0 5px;font-size:17px;color:#fff;">Sugestão de Reagrupamento de Rotas</h3>
          <p style="margin:0;font-size:13px;color:#94a3b8;">
            <span id="routeOptCount">0</span> localidade(s) com serviços em dias diferentes — próximos ${DAYS_AHEAD} dias
          </p>
        </div>
        <div id="routeOptList" style="overflow-y:auto;flex:1;padding:16px 20px;"></div>
        <div style="padding:14px 20px;border-top:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
          <button onclick="window._routeOptDismiss()"
            style="width:100%;background:#1d4ed8;color:#fff;border:none;padding:13px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;">
            ✅ Tomei conhecimento
          </button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  function schedule() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(ALERT_HOUR, ALERT_MIN, 0, 0);
    const ms = target - now;
    if (ms <= 0) {
      waitForData(check);
    } else {
      setTimeout(() => waitForData(check), ms);
    }
  }

  function waitForData(fn) {
    if (window.appointments?.length && window.authClient?.getUser?.()) {
      fn();
    } else {
      setTimeout(() => waitForData(fn), 800);
    }
  }

  function init() {
    _buildModal();
    schedule();
    document.addEventListener('portalReady', () => setTimeout(check, 800));
  }

  window._routeOptDismiss = dismiss;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
