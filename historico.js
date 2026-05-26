// ===== HISTÓRICO DE SERVIÇOS =====
(function () {
  'use strict';

  // ── Modal HTML ─────────────────────────────────────────────
  const MODAL_HTML = `
<div id="historicoModal" style="display:none;position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.7);align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 0;">
  <div style="background:#0f172a;border-radius:16px;width:min(98vw,1200px);margin:auto;box-shadow:0 24px 80px rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.08);">

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">🕘</span>
        <span style="color:#f1f5f9;font-size:17px;font-weight:800;">Histórico de Serviços</span>
        <span id="historicoCount" style="background:rgba(255,255,255,0.1);color:#94a3b8;font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;">—</span>
      </div>
      <button onclick="window.historicoModal.close()" style="background:none;border:none;color:#64748b;font-size:24px;cursor:pointer;line-height:1;padding:0 4px;">&times;</button>
    </div>

    <!-- Filters -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;padding:16px 24px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">De</label>
        <input type="date" id="histFilterFrom" style="background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#e2e8f0;font-size:13px;padding:6px 10px;outline:none;" oninput="window.historicoModal.render()">
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Até</label>
        <input type="date" id="histFilterTo" style="background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#e2e8f0;font-size:13px;padding:6px 10px;outline:none;" oninput="window.historicoModal.render()">
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Estado</label>
        <select id="histFilterStatus" style="background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#e2e8f0;font-size:13px;padding:6px 10px;outline:none;cursor:pointer;" onchange="window.historicoModal.render()">
          <option value="">Todos</option>
          <option value="realizado">✅ Realizado</option>
          <option value="nao_realizado">❌ Não Realizado</option>
          <option value="vidro_retirado">🪟 Vidro Retirado</option>
          <option value="pendente">⏳ Pendente</option>
          <option value="pre_agendado">📋 Pré-agendado</option>
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:160px;">
        <label style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Pesquisar</label>
        <input type="text" id="histFilterSearch" placeholder="Matrícula, carro, cliente…" style="background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#e2e8f0;font-size:13px;padding:6px 10px;outline:none;width:100%;" oninput="window.historicoModal.render()">
      </div>
      <div style="display:flex;align-items:flex-end;gap:6px;">
        <button onclick="window.historicoModal.resetFilters()" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#94a3b8;font-size:12px;font-weight:600;padding:7px 14px;cursor:pointer;">↺ Limpar</button>
      </div>
    </div>

    <!-- Table -->
    <div style="overflow-x:auto;max-height:60vh;overflow-y:auto;" id="historicoTableWrap">
      <table style="width:100%;border-collapse:collapse;font-size:13px;" id="historicoTable">
        <thead>
          <tr style="position:sticky;top:0;background:#0f172a;z-index:1;">
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;" onclick="window.historicoModal.sort('date')" class="hist-th-sort">Data ↕</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;">Matrícula</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.08);">Carro</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.08);">Serviço</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.08);">Localidade</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.08);">Cliente</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.08);">Estado</th>
            <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.08);">Notas</th>
          </tr>
        </thead>
        <tbody id="historicoTbody"></tbody>
      </table>
      <div id="historicoEmpty" style="display:none;padding:48px 24px;text-align:center;color:#475569;font-size:14px;">
        Nenhum serviço encontrado com os filtros selecionados.
      </div>
    </div>

  </div>
</div>`;

  // ── State ──────────────────────────────────────────────────
  let _sortField = 'date';
  let _sortDir = -1; // -1 = desc

  // ── Init ──────────────────────────────────────────────────
  function init() {
    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

    // Close on backdrop click
    document.getElementById('historicoModal').addEventListener('click', function (e) {
      if (e.target === this) close();
    });
  }

  // ── Helpers ───────────────────────────────────────────────
  function getStatus(a) {
    if (a.glass_removed) return 'vidro_retirado';
    if (a.executed === true) return 'realizado';
    if (a.executed === false && a.not_done_reason) return 'nao_realizado';
    if (a.confirmed === false) return 'pre_agendado';
    return 'pendente';
  }

  function statusBadge(a) {
    const s = getStatus(a);
    const map = {
      realizado:       { bg: '#16a34a', color: '#fff', label: '✅ Realizado' },
      nao_realizado:   { bg: '#dc2626', color: '#fff', label: '❌ Não Realizado' },
      vidro_retirado:  { bg: '#2563eb', color: '#fff', label: '🪟 Vidro Retirado' },
      pre_agendado:    { bg: '#f59e0b', color: '#fff', label: '⏳ Pré-agendado' },
      pendente:        { bg: '#475569', color: '#cbd5e1', label: '— Pendente' },
    };
    const { bg, color, label } = map[s] || map.pendente;
    return `<span style="display:inline-block;background:${bg};color:${color};font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap;">${label}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function defaultFrom() {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  }

  function defaultTo() {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    const appts = window.appointments || [];
    const from   = document.getElementById('histFilterFrom')?.value || '';
    const to     = document.getElementById('histFilterTo')?.value || '';
    const status = document.getElementById('histFilterStatus')?.value || '';
    const search = (document.getElementById('histFilterSearch')?.value || '').toLowerCase().trim();

    let rows = appts.filter(a => {
      if (!a.date) return false;
      if (from && a.date < from) return false;
      if (to   && a.date > to)   return false;
      if (status && getStatus(a) !== status) return false;
      if (search) {
        const hay = [a.plate, a.car, a.client_name, a.locality, a.service, a.notes].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Sort
    rows.sort((a, b) => {
      const av = _sortField === 'date' ? (a.date || '') : (a[_sortField] || '');
      const bv = _sortField === 'date' ? (b.date || '') : (b[_sortField] || '');
      return av < bv ? _sortDir : av > bv ? -_sortDir : 0;
    });

    const tbody = document.getElementById('historicoTbody');
    const empty = document.getElementById('historicoEmpty');
    const count = document.getElementById('historicoCount');

    if (!tbody) return;

    if (rows.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'block';
      if (count) count.textContent = '0';
      return;
    }

    if (empty) empty.style.display = 'none';
    if (count) count.textContent = rows.length + (rows.length === 1 ? ' serviço' : ' serviços');

    tbody.innerHTML = rows.map((a, i) => {
      const bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.025)';
      const notesText = [a.client_name ? '' : '', a.notes, a.not_done_reason ? `Motivo: ${a.not_done_reason}` : ''].filter(Boolean).join(' · ') || '—';
      return `<tr style="background:${bg};transition:background 0.1s;" onmouseenter="this.style.background='rgba(255,255,255,0.06)'" onmouseleave="this.style.background='${bg}'">
        <td style="padding:10px 12px;color:#94a3b8;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,0.04);">${fmtDate(a.date)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="font-family:monospace;font-weight:700;color:#f1f5f9;letter-spacing:0.5px;">${(a.plate||'—').toUpperCase()}</span></td>
        <td style="padding:10px 12px;color:#cbd5e1;border-bottom:1px solid rgba(255,255,255,0.04);">${a.car||'—'}</td>
        <td style="padding:10px 12px;color:#cbd5e1;border-bottom:1px solid rgba(255,255,255,0.04);">${a.service||'—'}</td>
        <td style="padding:10px 12px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.04);">${a.locality||'—'}</td>
        <td style="padding:10px 12px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.04);">${a.client_name||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);">${statusBadge(a)}</td>
        <td style="padding:10px 12px;color:#64748b;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(a.notes||'').replace(/"/g,"'")}">
          ${a.notes || a.not_done_reason ? `<span style="color:#94a3b8;">${a.not_done_reason ? `<em style="color:#f87171;">Motivo: ${a.not_done_reason}</em>` : (a.notes||'')}</span>` : '<span style="color:#334155;">—</span>'}
        </td>
      </tr>`;
    }).join('');
  }

  // ── Public API ────────────────────────────────────────────
  function open() {
    const modal = document.getElementById('historicoModal');
    if (!modal) return;
    // Set default date range
    const fromEl = document.getElementById('histFilterFrom');
    const toEl   = document.getElementById('histFilterTo');
    if (fromEl && !fromEl.value) fromEl.value = defaultFrom();
    if (toEl   && !toEl.value)   toEl.value   = defaultTo();
    modal.style.display = 'flex';
    render();
  }

  function close() {
    const modal = document.getElementById('historicoModal');
    if (modal) modal.style.display = 'none';
  }

  function sort(field) {
    if (_sortField === field) _sortDir = -_sortDir;
    else { _sortField = field; _sortDir = -1; }
    render();
  }

  function resetFilters() {
    const fromEl = document.getElementById('histFilterFrom');
    const toEl   = document.getElementById('histFilterTo');
    const stEl   = document.getElementById('histFilterStatus');
    const srEl   = document.getElementById('histFilterSearch');
    if (fromEl) fromEl.value = defaultFrom();
    if (toEl)   toEl.value   = defaultTo();
    if (stEl)   stEl.value   = '';
    if (srEl)   srEl.value   = '';
    render();
  }

  window.historicoModal = { open, close, render, sort, resetFilters };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
