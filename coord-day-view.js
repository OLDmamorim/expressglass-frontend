// coord-day-view.js
// Vista alternativa (desktop) para coordenadores com VÁRIAS lojas/portais.
// Em vez da vista semanal de uma loja, escolhe-se um DIA e vêem-se os
// serviços de cada loja do coordenador lado a lado (uma coluna por loja).
(function () {
  'use strict';

  const STATUS = { NE: '#EF4444', VE: '#F59E0B', ST: '#10B981' };
  // Paleta para o cabeçalho de cada coluna (uma cor por loja, por ordem)
  const COL_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#a16207', '#7c3aed',
    '#0891b2', '#db2777', '#ea580c', '#4f46e5', '#0d9488', '#b91c1c', '#15803d'];

  let selectedDate = null;          // Date do dia mostrado
  const dataByPortal = {};          // portalId -> array de agendamentos (cache)
  let _loadingToken = 0;

  function portals() { return (window.coordPortals || []).slice(); }
  function canUse() {
    const role = window.authClient?.getUser?.()?.role || '';
    return (role === 'admin' || role === 'coordenador' || role === 'pesados_coord') && portals().length > 1;
  }

  // ── Helpers de data ────────────────────────────────────────────────────
  function iso(d) { return (typeof localISO === 'function') ? localISO(d) : d.toISOString().slice(0, 10); }
  function addD(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); r.setHours(0, 0, 0, 0); return r; }
  function fromIso(s) { return new Date(s + 'T00:00:00'); }

  // ── Helpers de serviço (reutiliza os globais do script.js se existirem) ─
  function allServices(a) {
    if (typeof window.getAllServices === 'function') return window.getAllServices(a);
    const primary = a.service ? [{ service: a.service }] : [];
    let extra = a.extra_services || [];
    if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch (e) { extra = []; } }
    if (!Array.isArray(extra)) extra = [];
    return [...primary, ...extra];
  }
  function totalTime(a) {
    if (typeof window.getTotalServiceTime === 'function') { try { return window.getTotalServiceTime(a); } catch (e) {} }
    return allServices(a).length * 30;
  }

  // ── Fetch por portal (uma vez; filtramos por dia no cliente) ────────────
  async function fetchPortal(p) {
    if (dataByPortal[p.id]) return dataByPortal[p.id];
    try {
      const resp = await window.authClient.authenticatedFetch('/.netlify/functions/appointments?portal_id=' + p.id);
      const data = await resp.json();
      const arr = (data && data.success && Array.isArray(data.data)) ? data.data : [];
      if (typeof window.sanitizeAppointmentText === 'function') arr.forEach(window.sanitizeAppointmentText);
      dataByPortal[p.id] = arr;
    } catch (e) {
      console.warn('[coord-day-view] erro portal', p.name, e);
      dataByPortal[p.id] = [];
    }
    return dataByPortal[p.id];
  }

  function periodRank(a, ptype) {
    const p = a.period || '';
    if (ptype === 'loja') return p === 'Manhã' ? 0 : p === 'Tarde' ? 1 : 2;
    const m = /^(\d{1,2})/.exec(p);
    if (m) return parseInt(m[1], 10);
    if (a.first_of_day) return -2;
    if (a.second_of_day) return -1;
    return (a.sortIndex != null ? a.sortIndex : 99);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ── Cor base do card, igual à vista semanal, mas por portal da coluna ───
  //   loja      → cor pelo estado do stock (NE/VE/ST)
  //   recalibra → verde se realizado, âmbar caso contrário
  //   sm/pesados→ cor da localidade (mapa de cores do próprio portal)
  function cardColor(a, portal) {
    const ptype = portal.portalType;
    if (ptype === 'loja') return STATUS[a.status] || '#9CA3AF';
    if (ptype === 'recalibra') return a.executed === true ? '#10B981' : '#F59E0B';
    const locs = portal.localities || {};
    if (a.locality && locs[a.locality]) return locs[a.locality];
    if (typeof getLocColor === 'function') { try { return getLocColor(a.locality); } catch (e) {} }
    return '#64748b';
  }
  function grad(hex) {
    if (typeof gradFromBase === 'function') { try { return gradFromBase(hex); } catch (e) {} }
    return { c1: hex, c2: hex };
  }
  function textOn(hex) {
    if (typeof textColorForBg === 'function') { try { return textColorForBg(hex); } catch (e) {} }
    return '#fff';
  }

  // ── Card (cores como na vista semanal) ──────────────────────────────────
  function card(a, portal) {
    const ptype = portal.portalType;
    const base = cardColor(a, portal);
    const g = grad(base);
    const txt = textOn(base);
    const soft = txt === '#fff' ? 'rgba(255,255,255,.82)' : 'rgba(0,0,0,.6)';
    const badgeBg = txt === '#fff' ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.12)';
    const badgeTx = txt === '#fff' ? '#0f172a' : '#0f172a';
    // Estado do stock: barra à esquerda (só SM/Pesados, tal como na semanal)
    const statusBar = (ptype === 'loja' || ptype === 'recalibra') ? '' : `border-left:5px solid ${STATUS[a.status] || '#475569'};`;
    const plate = esc((a.plate || '').toUpperCase());
    const car = esc((a.car || '').toUpperCase());
    const servs = allServices(a).map(s => esc(s.service)).filter(Boolean);
    const mins = totalTime(a);
    const period = esc(a.period || '');
    const loc = ptype !== 'loja' ? esc(a.locality || '') : '';
    const exec = a.executed === true
      ? '<span style="font-weight:900;">✓</span>'
      : a.executed === false ? '<span style="font-weight:900;">✗</span>' : '';
    const preAg = a.confirmed === false
      ? '<span style="font-size:9px;font-weight:800;color:#b45309;background:#fef3c7;border-radius:4px;padding:1px 5px;">⏳ p/ confirmar</span>' : '';
    const svcBadges = servs.map(s =>
      `<span style="font-size:10px;font-weight:800;background:${badgeBg};color:${badgeTx};border-radius:4px;padding:1px 5px;">${s}</span>`).join(' ');
    const periodBadge = period
      ? `<span style="font-size:10px;font-weight:800;background:${badgeBg};color:${badgeTx};border-radius:4px;padding:1px 6px;">${period}</span>` : '';
    return `
      <div style="background:linear-gradient(135deg,${g.c1},${g.c2});${statusBar}color:${txt};border-radius:8px;padding:8px 10px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.15);">
        <div style="display:flex;align-items:center;gap:6px;justify-content:space-between;">
          <span style="font-size:15px;font-weight:900;letter-spacing:.5px;">${plate || '—'}</span>
          <span style="display:flex;align-items:center;gap:5px;">${periodBadge}${exec}</span>
        </div>
        ${car ? `<div style="font-size:11px;font-weight:600;margin-top:1px;color:${soft};">${car}</div>` : ''}
        ${loc ? `<div style="font-size:11px;margin-top:2px;color:${soft};">📍 ${loc}</div>` : ''}
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:5px;">
          ${svcBadges}
          <span style="font-size:10px;font-weight:700;margin-left:auto;color:${soft};">${mins}min</span>
        </div>
        ${preAg ? `<div style="margin-top:5px;">${preAg}</div>` : ''}
      </div>`;
  }

  function column(p, idx) {
    const color = COL_COLORS[idx % COL_COLORS.length];
    const list = (dataByPortal[p.id] || [])
      .filter(a => a.date && String(a.date).slice(0, 10) === iso(selectedDate))
      .sort((x, y) => (periodRank(x, p.portalType) - periodRank(y, p.portalType)) ||
        String(x.plate || '').localeCompare(String(y.plate || '')));
    const totalMin = list.reduce((s, a) => s + totalTime(a), 0);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    const tempo = totalMin ? (h ? h + 'h' + (m ? String(m).padStart(2, '0') : '') : m + 'min') : '—';
    const body = list.length
      ? list.map(a => card(a, p)).join('')
      : '<div style="text-align:center;color:#94a3b8;font-size:12px;font-weight:600;padding:24px 0;">Sem serviços</div>';
    return `
      <div style="flex:0 0 240px;display:flex;flex-direction:column;min-width:0;">
        <div style="background:${color};color:#fff;border-radius:10px 10px 0 0;padding:9px 12px;position:sticky;top:0;z-index:1;">
          <div style="font-size:14px;font-weight:900;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name)}</div>
          <div style="font-size:11px;font-weight:700;opacity:.9;margin-top:2px;">${list.length} serviço${list.length === 1 ? '' : 's'} · ${tempo}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:8px;flex:1;overflow-y:auto;">${body}</div>
      </div>`;
  }

  function renderBody() {
    const wrap = document.getElementById('cdvColumns');
    if (!wrap) return;
    wrap.innerHTML = portals().map((p, i) => column(p, i)).join('');
    const lbl = document.getElementById('cdvDateLabel');
    if (lbl) lbl.textContent = selectedDate.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const inp = document.getElementById('cdvDateInput');
    if (inp) inp.value = iso(selectedDate);
  }

  function setLoading(on) {
    const el = document.getElementById('cdvLoading');
    if (el) el.style.display = on ? 'flex' : 'none';
  }

  async function loadAll(force) {
    if (force) for (const k in dataByPortal) delete dataByPortal[k];
    const token = ++_loadingToken;
    setLoading(true);
    await Promise.all(portals().map(fetchPortal));
    if (token !== _loadingToken) return; // outro load mais recente venceu
    setLoading(false);
    renderBody();
  }

  function close() { document.getElementById('cdvOverlay')?.remove(); }

  function open() {
    if (!canUse()) return;
    const base = (typeof currentMobileDay !== 'undefined' && currentMobileDay) ? currentMobileDay : new Date();
    selectedDate = new Date(base); selectedDate.setHours(0, 0, 0, 0);

    let ov = document.getElementById('cdvOverlay');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'cdvOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:#f1f5f9;z-index:10001;display:flex;flex-direction:column;';
    ov.innerHTML = `
      <div style="background:#0f172a;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span style="font-size:17px;font-weight:800;">📆 Vista por Dia — todas as lojas</span>
        <button id="cdvClose" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;padding:7px 16px;font-size:14px;font-weight:700;cursor:pointer;">✕ Fechar</button>
      </div>
      <div style="background:#fff;border-bottom:1px solid #e2e8f0;padding:10px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;flex-wrap:wrap;">
        <button id="cdvPrev" style="background:#f1f5f9;border:none;border-radius:8px;padding:8px 14px;font-size:16px;font-weight:800;cursor:pointer;">‹</button>
        <div id="cdvDateLabel" style="font-size:15px;font-weight:800;color:#0f766e;min-width:220px;text-align:center;text-transform:capitalize;"></div>
        <button id="cdvNext" style="background:#f1f5f9;border:none;border-radius:8px;padding:8px 14px;font-size:16px;font-weight:800;cursor:pointer;">›</button>
        <input type="date" id="cdvDateInput" style="padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;">
        <button id="cdvToday" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:700;cursor:pointer;">Hoje</button>
        <button id="cdvRefresh" title="Atualizar dados" style="background:#0f766e;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:700;cursor:pointer;margin-left:auto;">🔄 Atualizar</button>
      </div>
      <div style="flex:1;position:relative;overflow:hidden;">
        <div id="cdvLoading" style="position:absolute;inset:0;background:rgba(248,250,252,.85);z-index:2;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#475569;">A carregar…</div>
        <div id="cdvColumns" style="display:flex;gap:12px;padding:16px 20px;height:100%;overflow-x:auto;overflow-y:hidden;align-items:stretch;box-sizing:border-box;"></div>
      </div>`;
    document.body.appendChild(ov);

    document.getElementById('cdvClose').onclick = close;
    document.getElementById('cdvPrev').onclick = () => { selectedDate = addD(selectedDate, -1); renderBody(); };
    document.getElementById('cdvNext').onclick = () => { selectedDate = addD(selectedDate, 1); renderBody(); };
    document.getElementById('cdvToday').onclick = () => { const t = new Date(); t.setHours(0, 0, 0, 0); selectedDate = t; renderBody(); };
    document.getElementById('cdvRefresh').onclick = () => loadAll(true);
    document.getElementById('cdvDateInput').onchange = function () { if (this.value) { selectedDate = fromIso(this.value); renderBody(); } };

    renderBody();
    loadAll(false);
  }
  window.openCoordDayView = open;

  // ── Botão na nav-bar desktop ────────────────────────────────────────────
  function updateButton() {
    const btn = document.getElementById('btnCoordDayView');
    if (!btn) return;
    btn.style.display = canUse() ? '' : 'none';
    if (canUse() && !btn._bound) { btn._bound = true; btn.onclick = open; }
  }

  function init() {
    updateButton();
    document.addEventListener('portalReady', () => setTimeout(updateButton, 300));
    setInterval(updateButton, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
