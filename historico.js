// ===== HISTÓRICO DE SERVIÇOS =====
(function () {
  'use strict';

  // ── Modal HTML ─────────────────────────────────────────────
  const MODAL_HTML = `
<div id="historicoModal" style="display:none;position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.55);align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 0;">
  <div style="background:#fff;border-radius:16px;width:min(98vw,1200px);margin:auto;box-shadow:0 24px 80px rgba(0,0,0,0.25);border:1px solid #e2e8f0;">

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid #e2e8f0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">🕘</span>
        <span style="color:#0f172a;font-size:17px;font-weight:800;">Histórico de Serviços</span>
        <span id="historicoCount" style="background:#f1f5f9;color:#64748b;font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;">—</span>
      </div>
      <button onclick="window.historicoModal.close()" style="background:none;border:none;color:#94a3b8;font-size:24px;cursor:pointer;line-height:1;padding:0 4px;">&times;</button>
    </div>

    <!-- Filters -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;padding:16px 24px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">De</label>
        <input type="date" id="histFilterFrom" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;color:#1e293b;font-size:13px;padding:6px 10px;outline:none;" oninput="window.historicoModal.render()">
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Até</label>
        <input type="date" id="histFilterTo" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;color:#1e293b;font-size:13px;padding:6px 10px;outline:none;" oninput="window.historicoModal.render()">
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Estado</label>
        <select id="histFilterStatus" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;color:#1e293b;font-size:13px;padding:6px 10px;outline:none;cursor:pointer;" onchange="window.historicoModal.render()">
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
        <input type="text" id="histFilterSearch" placeholder="Matrícula, carro, cliente…" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;color:#1e293b;font-size:13px;padding:6px 10px;outline:none;width:100%;" oninput="window.historicoModal.render()">
      </div>
      <div style="display:flex;align-items:flex-end;gap:6px;">
        <button onclick="window.historicoModal.resetFilters()" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;color:#64748b;font-size:12px;font-weight:600;padding:7px 14px;cursor:pointer;">↺ Limpar</button>
      </div>
    </div>

    <!-- Table -->
    <div style="overflow-x:auto;max-height:60vh;overflow-y:auto;" id="historicoTableWrap">
      <table style="width:100%;border-collapse:collapse;font-size:13px;" id="historicoTable">
        <thead>
          <tr style="position:sticky;top:0;background:#f1f5f9;z-index:1;">
            <th style="padding:10px 12px;text-align:left;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;white-space:nowrap;cursor:pointer;" onclick="window.historicoModal.sort('date')">Data ↕</th>
            <th style="padding:10px 12px;text-align:left;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;white-space:nowrap;">Matrícula</th>
            <th style="padding:10px 12px;text-align:left;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;">Carro</th>
            <th style="padding:10px 12px;text-align:left;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;">Serviço</th>
            <th style="padding:10px 12px;text-align:left;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;">Localidade</th>
            <th style="padding:10px 12px;text-align:left;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;">Cliente</th>
            <th style="padding:10px 12px;text-align:left;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;">Estado</th>
            <th style="padding:10px 12px;text-align:left;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;">Notas</th>
          </tr>
        </thead>
        <tbody id="historicoTbody"></tbody>
      </table>
      <div id="historicoEmpty" style="display:none;padding:48px 24px;text-align:center;color:#94a3b8;font-size:14px;">
        Nenhum serviço encontrado com os filtros selecionados.
      </div>
    </div>

    <!-- Footer -->
    <div style="display:flex;justify-content:flex-end;padding:14px 24px;border-top:1px solid #e2e8f0;gap:8px;background:#f8fafc;border-radius:0 0 16px 16px;">
      <button onclick="window.historicoModal.print()" style="display:inline-flex;align-items:center;gap:6px;background:#1e40af;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;padding:8px 18px;cursor:pointer;">🖨️ Imprimir</button>
      <button onclick="window.historicoModal.close()" style="background:#e2e8f0;border:none;border-radius:8px;color:#374151;font-size:13px;font-weight:600;padding:8px 18px;cursor:pointer;">Fechar</button>
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

  // For Pesados portals, locality is stored as the first segment of notes
  // e.g. "Matosinhos | Cliente | Código..." → "Matosinhos"
  function getLocality(a) {
    if (a.notes) {
      const m = a.notes.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-\.]+?)\s*\|/);
      if (m) return m[1].trim();
    }
    return a.locality || '—';
  }

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

    // Base filter: date + search (no status yet)
    const baseRows = appts.filter(a => {
      if (!a.date) return false;
      if (from && a.date < from) return false;
      if (to   && a.date > to)   return false;
      if (search) {
        const hay = [a.plate, a.car, a.client_name, a.locality, a.service, a.notes].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Count badge always includes nao_realizado (shows full total)
    const totalCount = status ? baseRows.filter(a => getStatus(a) === status).length : baseRows.length;

    // Display rows: if no status selected, hide nao_realizado by default
    let rows = baseRows.filter(a => {
      if (status) return getStatus(a) === status;
      return getStatus(a) !== 'nao_realizado';
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

    if (count) count.textContent = totalCount + (totalCount === 1 ? ' serviço' : ' serviços');

    if (rows.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    tbody.innerHTML = rows.map((a, i) => {
      const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
      return `<tr style="background:${bg};transition:background 0.1s;" onmouseenter="this.style.background='#eff6ff'" onmouseleave="this.style.background='${bg}'">
        <td style="padding:10px 12px;color:#64748b;white-space:nowrap;border-bottom:1px solid #f1f5f9;">${fmtDate(a.date)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;"><span style="font-family:monospace;font-weight:700;color:#1e293b;letter-spacing:0.5px;">${(a.plate||'—').toUpperCase()}</span></td>
        <td style="padding:10px 12px;color:#374151;border-bottom:1px solid #f1f5f9;">${a.car||'—'}</td>
        <td style="padding:10px 12px;color:#374151;border-bottom:1px solid #f1f5f9;">${a.service||'—'}</td>
        <td style="padding:10px 12px;color:#64748b;border-bottom:1px solid #f1f5f9;">${getLocality(a)}</td>
        <td style="padding:10px 12px;color:#64748b;border-bottom:1px solid #f1f5f9;">${a.client_name||'—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">${statusBadge(a)}</td>
        <td style="padding:10px 12px;color:#64748b;font-size:12px;border-bottom:1px solid #f1f5f9;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(a.notes||'').replace(/"/g,"'")}">
          ${a.not_done_reason ? `<em style="color:#dc2626;">Motivo: ${a.not_done_reason}</em><br><span style="color:#9ca3af;font-size:11px;">${fmtDate(a.date)}</span>` : (a.notes || '<span style="color:#cbd5e1;">—</span>')}
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

  function print() {
    const appts = window.appointments || [];
    const from   = document.getElementById('histFilterFrom')?.value || '';
    const to     = document.getElementById('histFilterTo')?.value || '';
    const status = document.getElementById('histFilterStatus')?.value || '';
    const search = (document.getElementById('histFilterSearch')?.value || '').toLowerCase().trim();

    const baseRowsPrint = appts.filter(a => {
      if (!a.date) return false;
      if (from && a.date < from) return false;
      if (to   && a.date > to)   return false;
      if (search) {
        const hay = [a.plate, a.car, a.client_name, a.locality, a.service, a.notes].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    let rows = baseRowsPrint.filter(a => {
      if (status) return getStatus(a) === status;
      return getStatus(a) !== 'nao_realizado';
    });
    rows.sort((a, b) => {
      const av = a[_sortField] || ''; const bv = b[_sortField] || '';
      return av < bv ? _sortDir : av > bv ? -_sortDir : 0;
    });

    const statusLabel = { realizado: 'Realizado', nao_realizado: 'Não Realizado', vidro_retirado: 'Vidro Retirado', pre_agendado: 'Pré-agendado', pendente: 'Pendente' };
    const statusColor = { realizado: '#16a34a', nao_realizado: '#dc2626', vidro_retirado: '#2563eb', pre_agendado: '#d97706', pendente: '#6b7280' };

    const tableRows = rows.map((a, i) => {
      const s = getStatus(a);
      const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
      const nota = a.not_done_reason ? `Motivo: ${a.not_done_reason} — ${fmtDate(a.date)}` : (a.notes || '—');
      return `<tr style="background:${bg};">
        <td>${fmtDate(a.date)}</td>
        <td><strong>${(a.plate||'—').toUpperCase()}</strong></td>
        <td>${a.car||'—'}</td>
        <td>${a.service||'—'}</td>
        <td>${getLocality(a)}</td>
        <td>${a.client_name||'—'}</td>
        <td><span style="display:inline-block;background:${statusColor[s]||'#6b7280'};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${statusLabel[s]||'—'}</span></td>
        <td>${nota}</td>
      </tr>`;
    }).join('');

    const filterInfo = [
      from ? `De: ${fmtDate(from)}` : '',
      to   ? `Até: ${fmtDate(to)}`  : '',
      status ? `Estado: ${statusLabel[status]||status}` : '',
      search ? `Pesquisa: "${search}"` : ''
    ].filter(Boolean).join('  •  ');

    const html = `<!DOCTYPE html><html lang="pt-PT"><head><meta charset="UTF-8">
<title>Histórico de Serviços</title>
<style>
  @page { margin: 12mm; size: A4 landscape; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; background: #fff; }
  h1 { font-size: 18px; font-weight: 800; margin-bottom: 4px; }
  .meta { font-size: 11px; color: #555; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1e293b; color: #fff; padding: 7px 8px; text-align: left; font-size: 11px; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>🕘 Histórico de Serviços</h1>
<div class="meta">Impresso em ${new Date().toLocaleDateString('pt-PT', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}${filterInfo ? '  •  ' + filterInfo : ''}  •  ${rows.length} serviço(s)</div>
<table>
  <thead><tr><th>Data</th><th>Matrícula</th><th>Carro</th><th>Serviço</th><th>Localidade</th><th>Cliente</th><th>Estado</th><th>Notas</th></tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;

    const w = window.open('', '_blank', 'width=1000,height=700');
    if (w) { w.document.write(html); w.document.close(); }
    else alert('Ativa os pop-ups para imprimir.');
  }

  window.historicoModal = { open, close, render, sort, resetFilters, print };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
