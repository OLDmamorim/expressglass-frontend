// weekly-reminder.js
// Terças e quintas-feiras às 10h: popup para coordenadores com processos > 7 dias
(function () {
  'use strict';

  const STORAGE_KEY = 'eg_weekly_reminder';

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function isDayOk() {
    const d = new Date().getDay(); // 2=Terça, 4=Quinta
    return d === 2 || d === 4;
  }

  function wasDismissed() {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return v.date === todayKey();
    } catch (e) { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayKey() })); } catch (e) {}
  }

  function isCoordOrAdmin() {
    const role = window.authClient?.getUser?.()?.role;
    return role === 'coordenador' || role === 'admin';
  }

  function getOverdue() {
    const appts = window.appointments || [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return appts.filter(a => {
      if (a.date) return false;
      if (!a.createdAt) return false;
      const d = new Date(a.createdAt); d.setHours(0, 0, 0, 0);
      return Math.floor((today - d) / 86400000) >= 7;
    });
  }

  function check() {
    if (!isDayOk() || wasDismissed() || !isCoordOrAdmin()) return;
    const overdue = getOverdue();
    if (!overdue.length) return;
    _show(overdue);
  }

  function _show(appts) {
    window._wrAppts = appts;
    const el = document.getElementById('weeklyReminderModal');
    if (!el) return;
    document.getElementById('wrCount').textContent = appts.length;
    el.style.display = 'flex';
  }

  function verProcessos() {
    document.getElementById('weeklyReminderModal').style.display = 'none';
    _renderList(window._wrAppts || []);
    document.getElementById('weeklyReminderListModal').style.display = 'flex';
  }

  function jaTratei() {
    markDismissed();
    document.getElementById('weeklyReminderModal').style.display = 'none';
  }

  function closeList() {
    markDismissed();
    document.getElementById('weeklyReminderListModal').style.display = 'none';
  }

  function imprimirLista() {
    const appts = window._wrAppts || [];
    const today = new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const rows = appts.map(a => {
      const created = a.createdAt ? new Date(a.createdAt) : null;
      const dateStr = created ? created.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
      const nToday = new Date(); nToday.setHours(0, 0, 0, 0);
      if (created) created.setHours(0, 0, 0, 0);
      const dias = created ? Math.floor((nToday - created) / 86400000) : 0;
      return `<tr>
        <td>${dateStr}</td>
        <td style="font-weight:700">${a.plate || '—'}</td>
        <td>${(a.car || '—').toUpperCase()}</td>
        <td>${a.notes || '—'}</td>
        <td style="text-align:center;font-weight:700;color:#b45309">${dias} dias</td>
      </tr>`;
    }).join('');

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Processos por tratar — ${today}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; font-size: 13px; }
        h2 { margin-bottom: 4px; }
        p { color: #555; margin-bottom: 16px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1e3a5f; color: #fff; padding: 8px 10px; text-align: left; }
        td { border: 1px solid #d1d5db; padding: 7px 10px; }
        tr:nth-child(even) td { background: #f9fafb; }
      </style>
    </head><body>
      <h2>⚠️ Processos por tratar (+ de 7 dias)</h2>
      <p>Impresso em ${today} · ${appts.length} processo(s)</p>
      <table>
        <thead><tr><th>Data Criação</th><th>Matrícula</th><th>Carro</th><th>Observações</th><th>Dias aberto</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  function _renderList(appts) {
    const tbody = document.getElementById('wrListBody');
    const countEl = document.getElementById('wrListCount');
    if (!tbody) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    tbody.innerHTML = appts.map(a => {
      const created = a.createdAt ? new Date(a.createdAt) : null;
      const dateStr = created
        ? new Date(a.createdAt).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '—';
      if (created) created.setHours(0, 0, 0, 0);
      const dias = created ? Math.floor((today - created) / 86400000) : 0;
      const diasColor = dias >= 30 ? '#dc2626' : dias >= 14 ? '#ea580c' : '#b45309';
      return `<tr>
        <td style="font-size:12px;white-space:nowrap">${dateStr}</td>
        <td style="font-weight:800;font-size:14px">${a.plate || '—'}</td>
        <td style="font-size:13px">${(a.car || '—').toUpperCase()}</td>
        <td style="font-size:12px;color:#6b7280;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.notes || '—'}</td>
        <td style="text-align:center"><span style="background:${diasColor}20;color:${diasColor};padding:3px 8px;border-radius:6px;font-weight:700;font-size:12px">${dias}d</span></td>
      </tr>`;
    }).join('');
    if (countEl) countEl.textContent = appts.length;
  }

  // Schedule check at 10:00 on Tue/Thu
  function schedule() {
    if (!isDayOk()) return;
    const now = new Date();
    const ten = new Date(now); ten.setHours(10, 0, 0, 0);
    const msUntil = ten - now;
    if (msUntil <= 0) {
      // already past 10:00 — check after data is ready
      waitForData(check);
    } else {
      setTimeout(() => waitForData(check), msUntil);
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
    // Build modals dynamically
    _buildModals();
    schedule();
    // Also re-check when portal/data reloads (e.g. portal switch)
    document.addEventListener('portalReady', () => setTimeout(check, 600));
  }

  function _buildModals() {
    if (document.getElementById('weeklyReminderModal')) return;

    // Alert modal
    const alert = document.createElement('div');
    alert.id = 'weeklyReminderModal';
    alert.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;align-items:center;justify-content:center;';
    alert.innerHTML = `
      <div style="background:#fff;border-radius:20px;max-width:420px;width:90%;padding:32px 28px;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center">
        <div style="font-size:48px;margin-bottom:12px">⚠️</div>
        <h2 style="margin:0 0 10px;font-size:20px;color:#1e3a5f">Processos por tratar</h2>
        <p style="margin:0 0 24px;font-size:16px;color:#374151">
          Tens <strong id="wrCount" style="font-size:22px;color:#b45309">0</strong> processos<br>com mais de 7 dias por tratar.
        </p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button onclick="weeklyReminder.verProcessos()"
            style="flex:1;background:#1e3a5f;color:#fff;border:none;padding:12px 20px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer">
            📋 Ver processos
          </button>
          <button onclick="weeklyReminder.jaTratei()"
            style="flex:1;background:#e5e7eb;color:#374151;border:none;padding:12px 20px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer">
            ✅ Já tratei
          </button>
        </div>
      </div>`;
    document.body.appendChild(alert);

    // List modal
    const list = document.createElement('div');
    list.id = 'weeklyReminderListModal';
    list.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;align-items:center;justify-content:center;';
    list.innerHTML = `
      <div style="background:#fff;border-radius:20px;max-width:720px;width:96%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25);">
        <div style="padding:20px 24px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div>
            <h3 style="margin:0 0 3px;font-size:17px;color:#1e3a5f">⚠️ Processos com +7 dias por tratar</h3>
            <span style="font-size:13px;color:#9ca3af"><span id="wrListCount">0</span> processo(s)</span>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <button onclick="weeklyReminder.imprimir()"
              style="background:#e5e7eb;border:none;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">
              🖨️ Imprimir
            </button>
            <button onclick="weeklyReminder.closeList()"
              style="background:#1e3a5f;color:#fff;border:none;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">
              Fechar
            </button>
          </div>
        </div>
        <div style="overflow-y:auto;flex:1;padding:16px 20px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:#f1f5f9">
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;white-space:nowrap">DATA CRIAÇÃO</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:700">MATRÍCULA</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:700">CARRO</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:700">OBSERVAÇÕES</th>
                <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6b7280;font-weight:700">DIAS</th>
              </tr>
            </thead>
            <tbody id="wrListBody"></tbody>
          </table>
        </div>
      </div>`;
    document.body.appendChild(list);
  }

  window.weeklyReminder = { verProcessos, jaTratei, closeList, imprimir: imprimirLista };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
