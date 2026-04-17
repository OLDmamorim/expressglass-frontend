// ═══════════════════════════════════════════════════════════════════════════
// BANNER POWERING EG — KPIs mensais do portal activo
// Fonte: proxy /.netlify/functions/powering-kpis (usa powering_loja_id da DB)
// Corre para TODOS os roles sem excepção.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const BANNER_ID = 'poweringEGBanner';

  // ── Mês/ano actuais ────────────────────────────────────────────────────
  function getMonthMeta() {
    const now = new Date();
    return {
      mes: now.getMonth() + 1,
      ano: now.getFullYear(),
      label: now.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' })
               .replace(/^\w/, c => c.toUpperCase()),
    };
  }

  // ── Cores dinâmicas ────────────────────────────────────────────────────
  function kpiColor(val, greenMin, orangeMin) {
    if (val == null || isNaN(val)) return '#94a3b8';
    if (val >= greenMin)  return '#4ade80';
    if (val >= orangeMin) return '#fb923c';
    return '#f87171';
  }

  // ── Shell com skeleton enquanto carrega ────────────────────────────────
  function buildShell(portalName, monthLabel) {
    const el = document.createElement('div');
    el.id = BANNER_ID;
    el.innerHTML = `
      <style>
        #${BANNER_ID} {
          background: #0b1e38;
          border-left: 4px solid #3b82f6;
          padding: 10px 16px 13px;
          font-family: 'Figtree', system-ui, sans-serif;
        }
        #${BANNER_ID} .peg-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        #${BANNER_ID} .peg-name {
          font-size: 11px;
          font-weight: 800;
          color: #94a3b8;
          letter-spacing: 0.7px;
          text-transform: uppercase;
        }
        #${BANNER_ID} .peg-name em { color: #60a5fa; font-style: normal; margin-right: 5px; }
        #${BANNER_ID} .peg-month  { font-size: 11px; color: #64748b; font-weight: 600; }
        #${BANNER_ID} .peg-grid   {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px 8px;
        }
        #${BANNER_ID} .peg-lbl {
          font-size: 9px; font-weight: 700; color: #64748b;
          text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1px;
        }
        #${BANNER_ID} .peg-val {
          font-size: 21px; font-weight: 900; line-height: 1;
          color: #f1f5f9; font-variant-numeric: tabular-nums; transition: color .3s;
        }
        #${BANNER_ID} .peg-skel {
          background: linear-gradient(90deg,#1e3a5f 25%,#2a4e7c 50%,#1e3a5f 75%);
          background-size: 200% 100%;
          animation: pegSweep 1.4s ease-in-out infinite;
          border-radius: 4px; height: 22px; width: 55%;
        }
        @keyframes pegSweep {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      </style>
      <div class="peg-head">
        <div class="peg-name"><em>📊</em>${(portalName || 'Portal').toUpperCase()}</div>
        <div class="peg-month">${monthLabel}</div>
      </div>
      <div class="peg-grid" id="pegGrid">
        ${['Serviços','Objetivo','Tx. Rep.','Desvio Dia'].map(l => `
          <div class="peg-kpi">
            <div class="peg-lbl">${l}</div>
            <div class="peg-skel"></div>
          </div>`).join('')}
      </div>
    `;
    return el;
  }

  // ── Preencher KPIs com dados reais da API ─────────────────────────────
  // kpis = { servicos, objetivo, taxa, desvioPercent } devolvido pelo proxy
  function fillKpis(kpis) {
    const grid = document.getElementById('pegGrid');
    if (!grid) return;

    const servicos   = kpis.servicos   ?? 0;
    const objetivo   = kpis.objetivo   ?? '—';
    const taxa       = kpis.taxa       ?? 0;   // taxa de reparação (%)
    const desvio     = kpis.desvioPercent ?? 0; // desvio % calculado pelo proxy

    const cSvc  = servicos > 0 ? '#4ade80' : '#94a3b8';
    const cObj  = '#e2e8f0';
    const cTx   = kpiColor(taxa,   40, 20);
    const cDev  = kpiColor(desvio,  0, -10);
    const devSign = desvio >= 0 ? '+' : '-';

    grid.innerHTML = `
      <div class="peg-kpi">
        <div class="peg-lbl">Serviços</div>
        <div class="peg-val" style="color:${cSvc}">${servicos}</div>
      </div>
      <div class="peg-kpi">
        <div class="peg-lbl">Objetivo</div>
        <div class="peg-val" style="color:${cObj}">${objetivo}</div>
      </div>
      <div class="peg-kpi">
        <div class="peg-lbl">Tx. Rep.</div>
        <div class="peg-val" style="color:${cTx}">${Math.round(taxa)}%</div>
      </div>
      <div class="peg-kpi">
        <div class="peg-lbl">Desvio Dia</div>
        <div class="peg-val" style="color:${cDev}">${devSign}${Math.abs(Math.round(desvio))}%</div>
      </div>
    `;
  }

  // ── Inserção no DOM ────────────────────────────────────────────────────
  function insertBanner(el) {
    const try_ = fn => { try { return fn(); } catch(_) { return false; } };
    [
      // 1.º — logo após o portalSwitcher
      () => { const s = document.getElementById('portalSwitcher');
              if (!s?.parentNode) return false;
              s.parentNode.insertBefore(el, s.nextSibling); return true; },
      // 2.º — antes da schedule-container ou calendarSection
      () => { const s = document.querySelector('.schedule-container, #calendarSection');
              if (!s?.parentNode) return false;
              s.parentNode.insertBefore(el, s); return true; },
      // 3.º — após nav-bar
      () => { const n = document.querySelector('.nav-bar');
              if (!n?.parentNode) return false;
              n.parentNode.insertBefore(el, n.nextSibling); return true; },
      // fallback
      () => { document.body.appendChild(el); return true; },
    ].some(fn => try_(fn));
  }

  // ── Obter powering_loja_id do portal activo ────────────────────────────
  // ── Ler portal_id e nome do select visível ────────────────────────────
  function getActivePortal() {
    const sel = document.getElementById('portalSwitcherSelect');
    if (sel && sel.value) {
      const opt = sel.options[sel.selectedIndex];
      return { portalId: sel.value, name: opt?.text?.trim() || 'Portal' };
    }
    return {
      portalId: window.currentPortalId || window.authClient?.getUser?.()?.portal_id || null,
      name: window.currentPortalName || 'Portal',
    };
  }

  // ── Chamar proxy powering-kpis — passa portal_id, proxy resolve loja ──
  async function fetchKpis(portalId) {
    const { mes, ano } = getMonthMeta();
    const r = await window.authClient.authenticatedFetch(
      `/.netlify/functions/powering-kpis?portal_id=${portalId}&mes=${mes}&ano=${ano}`
    );
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'PoweringEG sem dados');
    return d.kpis;
  }

  // ── Init principal ─────────────────────────────────────────────────────
  async function initBanner() {
    if (document.getElementById(BANNER_ID)) return;
    if (!window.authClient?.getUser?.()) return;

    const { portalId, name } = getActivePortal();
    const { label } = getMonthMeta();
    const shell = buildShell(name, label);
    insertBanner(shell);

    if (!portalId) {
      // Select ainda não tem valor — remover shell para que o próximo trigger tente de novo
      shell.remove();
      return;
    }

    try {
      const kpis = await fetchKpis(portalId);
      if (!kpis) throw new Error('kpis null — powering-kpis.js antigo em produção?');
      fillKpis(kpis);
    } catch (e) {
      console.warn('[PoweringEG banner]', e.message);
      shell.remove();
    }
  }

  // ── Re-render ao mudar de portal ──────────────────────────────────────
  function rebuildBanner() {
    document.getElementById(BANNER_ID)?.remove();
    setTimeout(() => initBanner().catch(() => {}), 150);
  }

  // ── Ouvir mudanças no portalSwitcherSelect ────────────────────────────
  function attachSwitcherListener() {
    const sel = document.getElementById('portalSwitcherSelect');
    if (!sel || sel._pegListenerAttached) return;
    sel._pegListenerAttached = true;
    sel.addEventListener('change', rebuildBanner);
  }

  // ── Triggers (sem guard de role — corre para todos) ───────────────────
  initBanner().catch(() => {});
  window.addEventListener('portalReady',   () => {
    attachSwitcherListener();
    initBanner().catch(() => {});
  });
  window.addEventListener('portalChanged', rebuildBanner);
  setTimeout(() => { attachSwitcherListener(); initBanner().catch(() => {}); }, 900);
  setTimeout(() => { attachSwitcherListener(); initBanner().catch(() => {}); }, 2500);
  setTimeout(() => { attachSwitcherListener(); initBanner().catch(() => {}); }, 4000);

})();


// ═══════════════════════════════════════════════════════════════════════════
// pesados-coord.js — Vista da coordenadora de Pesados
// Carregado em todos os portais; só activa se role === 'pesados_coord'
// (ou admin/coordenador para visualização da grelha)
// ═══════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Utilitário de distância ───────────────────────────────────────────────
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  }

  // ─── Estado global do módulo ───────────────────────────────────────────────
  const state = {
    portals: [],         // portais pesados
    appointments: {},    // { portal_id: [appointments] }
    weekStart: null,     // segunda-feira da semana visível
    suggestions: [],     // sugestões da última pesquisa de localidade
    newServiceLat: null,
    newServiceLng: null,
    newServiceAddress: '',
    selectedDate: null,
  };

  // ─── Inicialização ─────────────────────────────────────────────────────────
  function init() {
    const role = window.authClient?.getUser?.()?.role;
    if (!['pesados_coord','admin','coordenador'].includes(role)) return;

    hideDefaultView();
    buildView();
    setWeekStart(getMonday(new Date()));
    loadData();
  }

  function hideDefaultView() {
    const role = window.authClient?.getUser?.()?.role;
    if (role !== 'pesados_coord') return;
    const ids = ['calendarSection','portalSwitcher','addAppointmentBtn','totalizador'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function getMonday(d) {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const m = new Date(d);
    m.setDate(diff);
    m.setHours(0,0,0,0);
    return m;
  }

  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function fmtDate(d) {
    return d.toISOString().split('T')[0];
  }

  function fmtDatePT(d) {
    return d.toLocaleDateString('pt-PT', { weekday:'short', day:'2-digit', month:'2-digit' });
  }

  // ─── Construir HTML da vista ───────────────────────────────────────────────
  function buildView() {
    const container = document.createElement('div');
    container.id = 'pesadosView';
    container.innerHTML = `
      <style>
        #pesadosView {
          padding: 16px;
          font-family: system-ui, sans-serif;
          color: #1e293b;
          max-width: 1200px;
          margin: 0 auto;
        }
        #pesadosView .pv-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          flex-wrap: wrap;
          gap: 10px;
        }
        #pesadosView .pv-title {
          font-size: 20px;
          font-weight: 800;
          color: #0f2944;
        }
        #pesadosView .pv-title span {
          font-size: 13px;
          font-weight: 500;
          color: #64748b;
          margin-left: 8px;
        }
        #pesadosView .pv-week-nav {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 600;
          color: #0f2944;
        }
        #pesadosView .pv-btn {
          background: #0f2944;
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #pesadosView .pv-btn.secondary {
          background: #f1f5f9;
          color: #0f2944;
        }
        #pesadosView .pv-btn:hover { opacity: 0.85; }
        #pesadosView .pv-grid-wrap {
          overflow-x: auto;
        }
        #pesadosView .pv-grid {
          display: grid;
          min-width: 600px;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        #pesadosView .pv-col-header {
          background: #0f2944;
          color: #fff;
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 700;
          text-align: center;
        }
        #pesadosView .pv-day-label {
          background: #f8fafc;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          color: #475569;
          border-bottom: 1px solid #e2e8f0;
          border-right: 1px solid #e2e8f0;
        }
        #pesadosView .pv-cell {
          background: #fff;
          padding: 8px;
          border-bottom: 1px solid #f1f5f9;
          border-right: 1px solid #f1f5f9;
          min-height: 70px;
          vertical-align: top;
        }
        #pesadosView .pv-cell.today { background: #f0f9ff; }
        #pesadosView .pv-capacity {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 20px;
          margin-bottom: 4px;
          display: inline-block;
        }
        #pesadosView .cap-green  { background: #dcfce7; color: #166534; }
        #pesadosView .cap-yellow { background: #fef9c3; color: #854d0e; }
        #pesadosView .cap-red    { background: #fee2e2; color: #991b1b; }
        #pesadosView .pv-appt {
          font-size: 11px;
          background: #e0f2fe;
          border-left: 3px solid #0284c7;
          border-radius: 4px;
          padding: 3px 6px;
          margin-bottom: 3px;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        #pesadosView .pv-appt.executed {
          background: #dcfce7;
          border-left-color: #16a34a;
          color: #166534;
        }
        #pesadosView .pv-appt.not-done {
          background: #fee2e2;
          border-left-color: #dc2626;
          color: #991b1b;
        }
        #pesadosView .pv-add-btn {
          width: 100%;
          margin-top: 3px;
          background: none;
          border: 1px dashed #cbd5e1;
          border-radius: 4px;
          color: #94a3b8;
          font-size: 11px;
          padding: 3px;
          cursor: pointer;
        }
        #pesadosView .pv-add-btn:hover { border-color: #0f2944; color: #0f2944; }

        /* Modal novo serviço pesados */
        #pvNewServiceModal {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 9999;
          align-items: center;
          justify-content: center;
        }
        #pvNewServiceModal.open { display: flex; }
        #pvNewServiceModal .pvModal-box {
          background: #fff;
          border-radius: 16px;
          padding: 24px;
          width: 100%;
          max-width: 540px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        }
        #pvNewServiceModal h3 {
          font-size: 18px;
          font-weight: 800;
          color: #0f2944;
          margin-bottom: 16px;
        }
        #pvNewServiceModal label {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
          display: block;
          margin-bottom: 4px;
          margin-top: 12px;
        }
        #pvNewServiceModal input, #pvNewServiceModal select {
          width: 100%;
          padding: 10px 12px;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          font-size: 14px;
          box-sizing: border-box;
          outline: none;
        }
        #pvNewServiceModal input:focus, #pvNewServiceModal select:focus {
          border-color: #0f2944;
        }
        .pv-suggestions {
          margin-top: 14px;
        }
        .pv-suggestions h4 {
          font-size: 12px;
          font-weight: 700;
          color: #475569;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .pv-sug-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 2px solid #e2e8f0;
          border-radius: 10px;
          margin-bottom: 8px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .pv-sug-item:hover { border-color: #0f2944; background: #f8fafc; }
        .pv-sug-item.selected { border-color: #0f2944; background: #eff6ff; }
        .pv-sug-item.best { border-color: #16a34a; }
        .pv-sug-dot {
          width: 12px; height: 12px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .dot-green  { background: #16a34a; }
        .dot-yellow { background: #ca8a04; }
        .dot-red    { background: #dc2626; }
        .pv-sug-name { font-weight: 700; font-size: 14px; flex: 1; }
        .pv-sug-info { font-size: 11px; color: #64748b; }
        .pv-sug-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 20px;
        }
        .pvModal-actions {
          display: flex;
          gap: 8px;
          margin-top: 20px;
          justify-content: flex-end;
        }
        #pvLoadingMsg {
          text-align: center;
          color: #64748b;
          font-size: 13px;
          padding: 12px;
        }
      </style>

      <div class="pv-header">
        <div class="pv-title">🚛 Pesados <span>Coordenação Nacional</span></div>
        <div class="pv-week-nav">
          <button class="pv-btn secondary" onclick="window.pvPrevWeek()">‹</button>
          <span id="pvWeekLabel">—</span>
          <button class="pv-btn secondary" onclick="window.pvNextWeek()">›</button>
          <button class="pv-btn secondary" onclick="window.pvThisWeek()">Hoje</button>
        </div>
        <button class="pv-btn" onclick="window.pvOpenNewService()">+ Novo Serviço</button>
      </div>

      <div class="pv-grid-wrap">
        <div class="pv-grid" id="pvGrid"></div>
      </div>

      <!-- Modal novo serviço -->
      <div id="pvNewServiceModal">
        <div class="pvModal-box">
          <h3>🚛 Novo Serviço Pesados</h3>

          <label>Data do Serviço *</label>
          <input type="date" id="pvDate" oninput="window.pvOnDateChange()" />

          <label>Localidade / Morada do Cliente *</label>
          <input type="text" id="pvAddress" placeholder="Ex: Empresa XPTO, Aveiro"
            oninput="window.pvOnAddressInput(this.value)" autocomplete="off" />
          <div id="pvAddressStatus" style="font-size:11px;color:#64748b;margin-top:3px;"></div>

          <div class="pv-suggestions" id="pvSuggestions" style="display:none">
            <h4>🗺️ SM Sugerido</h4>
            <div id="pvSugList"></div>
          </div>

          <div id="pvLoadingMsg" style="display:none">A calcular sugestão...</div>

          <div class="pvModal-actions">
            <button class="pv-btn secondary" onclick="window.pvCloseNewService()">Cancelar</button>
            <button class="pv-btn" id="pvProceedBtn" onclick="window.pvProceed()" disabled
              style="opacity:0.4">Abrir Agenda do SM →</button>
          </div>
        </div>
      </div>
    `;

    const role = window.authClient?.getRole?.();
    if (role === 'pesados_coord') {
      // Coordenadora: vista pesados é a vista principal
      document.body.insertBefore(container, document.body.firstChild);
    } else {
      // Admin/coordinator: inserir como secção após o header normal
      container.style.marginTop = '12px';
      // Adicionar título colapsável
      const toggle = document.createElement('div');
      toggle.id = 'pvToggle';
      toggle.style.cssText = 'cursor:pointer;background:#0f2944;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;font-size:14px;margin:12px 0 0;display:flex;justify-content:space-between;align-items:center;';
      toggle.innerHTML = '🚛 Vista Pesados <span id="pvToggleArrow">▼</span>';
      toggle.onclick = () => {
        const vis = container.style.display !== 'none';
        container.style.display = vis ? 'none' : 'block';
        document.getElementById('pvToggleArrow').textContent = vis ? '▶' : '▼';
      };
      // Inserir no final do body — sempre funciona independente do layout
      document.body.appendChild(toggle);
      document.body.appendChild(container);
    }

    // Criar modal de novo serviço fora do container para z-index correto
    document.body.appendChild(document.getElementById('pvNewServiceModal'));
  }

  // ─── Navegação semanal ─────────────────────────────────────────────────────
  function setWeekStart(d) {
    state.weekStart = d;
    const end = addDays(d, 4);
    document.getElementById('pvWeekLabel').textContent =
      d.toLocaleDateString('pt-PT',{day:'2-digit',month:'short'}) + ' – ' +
      end.toLocaleDateString('pt-PT',{day:'2-digit',month:'short',year:'numeric'});
    loadData();
  }

  window.pvPrevWeek  = () => setWeekStart(addDays(state.weekStart, -7));
  window.pvNextWeek  = () => setWeekStart(addDays(state.weekStart, 7));
  window.pvThisWeek  = () => setWeekStart(getMonday(new Date()));

  // ─── Carregar dados ────────────────────────────────────────────────────────
  async function loadData() {
    const token = window.authClient?.getToken?.();
    if (!token) return;

    try {
      // Buscar portais pesados
      if (!state.portals.length) {
        const r = await window.authClient.authenticatedFetch('/.netlify/functions/get-portals?type=pesados');
        const d = await r.json();
        state.portals = (d.portals || []).filter(p => p.portal_type === 'pesados');
      }

      // Buscar agendamentos da semana para todos os portais pesados
      const dateFrom = fmtDate(state.weekStart);
      const dateTo   = fmtDate(addDays(state.weekStart, 4));
      const portalIds = state.portals.map(p => p.id);

      for (const pid of portalIds) {
        const r = await window.authClient.authenticatedFetch(
          `/.netlify/functions/get-appointments?portal_id=${pid}&date_from=${dateFrom}&date_to=${dateTo}`
        );
        const d = await r.json();
        state.appointments[pid] = d.appointments || [];
      }

      renderGrid();
    } catch (e) {
      console.error('pvLoadData error:', e);
    }
  }

  // ─── Renderizar grelha ─────────────────────────────────────────────────────
  function renderGrid() {
    const grid = document.getElementById('pvGrid');
    if (!grid || !state.portals.length) return;

    const cols = state.portals.length + 1; // +1 coluna de dias
    grid.style.gridTemplateColumns = `90px repeat(${state.portals.length}, 1fr)`;

    const today = fmtDate(new Date());
    let html = '';

    // Cabeçalho
    html += '<div class="pv-col-header" style="background:#1e3a5f"></div>';
    state.portals.forEach(p => {
      html += `<div class="pv-col-header">${p.name}</div>`;
    });

    // Linhas por dia (seg a sex)
    for (let i = 0; i < 5; i++) {
      const day = addDays(state.weekStart, i);
      const dayStr = fmtDate(day);
      const isToday = dayStr === today;

      html += `<div class="pv-day-label">${fmtDatePT(day)}</div>`;

      state.portals.forEach(p => {
        const appts = (state.appointments[p.id] || []).filter(a => a.date === dayStr);
        const max = p.max_daily || 4;
        const n = appts.length;
        let capClass = 'cap-green';
        if (n >= max) capClass = 'cap-red';
        else if (n === max - 1) capClass = 'cap-yellow';

        html += `<div class="pv-cell${isToday?' today':''}">`;
        html += `<span class="pv-capacity ${capClass}">${n}/${max}</span><br>`;

        appts.forEach(a => {
          const cls = a.executed ? 'executed' : a.not_done_reason ? 'not-done' : '';
          html += `<div class="pv-appt ${cls}" title="${a.plate} — ${a.locality||''}"
            onclick="window.pvViewAppt(${a.id},${p.id})">
            🚗 ${a.plate}${a.car ? ' '+a.car : ''}
          </div>`;
        });

        html += `<button class="pv-add-btn" onclick="window.pvOpenNewServiceFor('${dayStr}',${p.id})">+ adicionar</button>`;
        html += '</div>';
      });
    }

    grid.innerHTML = html;
  }

  // ─── Modal novo serviço ────────────────────────────────────────────────────
  window.pvOpenNewService = function(date, portalId) {
    state.selectedPortalId = portalId || null;
    state.newServiceLat = null;
    state.newServiceLng = null;
    state.newServiceAddress = '';
    state.suggestions = [];

    // Remover modal anterior se existir
    const oldModal = document.getElementById('pvNewServiceModal');
    if (oldModal) oldModal.remove();

    // Criar modal de raiz
    const modal = document.createElement('div');
    modal.id = 'pvNewServiceModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:540px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);margin:16px;">
        <h3 style="font-size:18px;font-weight:800;color:#0f2944;margin:0 0 16px;">🚛 Novo Serviço Pesados</h3>
        <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Data do Serviço *</label>
        <input type="date" id="pvDate" value="${date || fmtDate(new Date())}"
          style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px;"
          oninput="window.pvOnDateChange()" />
        <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Localidade / Morada do Cliente *</label>
        <input type="text" id="pvAddress" placeholder="Ex: Empresa XPTO, Aveiro"
          style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;"
          autocomplete="off" />
        <div id="pvAddressStatus" style="font-size:11px;color:#64748b;margin-top:3px;"></div>
        <div id="pvSuggestions" style="display:none;margin-top:14px;">
          <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">🗺️ SM Sugerido</div>
          <div id="pvSugList"></div>
        </div>
        <div id="pvLoadingMsg" style="display:none;text-align:center;color:#64748b;font-size:13px;padding:12px;">A calcular sugestão...</div>
        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end;">
          <button onclick="window.pvCloseNewService()"
            style="background:#f1f5f9;color:#0f2944;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;">Cancelar</button>
          <button id="pvProceedBtn" onclick="window.pvProceed()" disabled
            style="background:#0f2944;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;opacity:0.4;">Abrir Agenda do SM →</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Inicializar Google Places Autocomplete
    setTimeout(initPvAddressAutocomplete, 150);

    // Se já tem portal definido, pré-selecionar
    if (portalId) renderSuggestionsWithPreselect(portalId);
  };

  window.pvOpenNewServiceFor = function(date, portalId) {
    window.pvOpenNewService(date, portalId);
  };

  window.pvCloseNewService = function() {
    document.getElementById('pvNewServiceModal')?.remove();
  };

  window.pvOnDateChange = function() {
    if (state.newServiceLat && state.newServiceLng) {
      fetchSuggestions();
    }
  };

  // Debounce para pesquisa de morada (fallback sem Google)
  window.pvOnAddressInput = function(val) {
    state.newServiceAddress = val;
  };

  // Inicializar Google Places Autocomplete — mesmo que o resto do sistema usa
  function initPvAddressAutocomplete() {
    const input = document.getElementById('pvAddress');
    if (!input || input._pvAcInit) return;
    if (!(window.google && google.maps && google.maps.places)) {
      setTimeout(initPvAddressAutocomplete, 800);
      return;
    }
    try {
      const ac = new google.maps.places.Autocomplete(input, {
        fields: ['name', 'formatted_address', 'geometry'],
        componentRestrictions: { country: 'pt' }
      });
      input._pvAcInit = true;
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (!place?.geometry?.location) return;
        const status = document.getElementById('pvAddressStatus');
        const txt = [place.name, place.formatted_address].filter(Boolean).join(' - ');
        input.value = txt;
        state.newServiceAddress = txt;
        state.newServiceLat = place.geometry.location.lat();
        state.newServiceLng = place.geometry.location.lng();
        if (status) status.textContent = '📍 ' + (place.formatted_address || txt);
        fetchSuggestions();
      });
    } catch(e) { console.warn('pvAutocomplete:', e); }
  }

  async function fetchSuggestions() {
    const date = document.getElementById('pvDate').value;
    if (!date || !state.newServiceLat || !state.newServiceLng) return;

    document.getElementById('pvLoadingMsg').style.display = 'block';
    document.getElementById('pvSuggestions').style.display = 'none';

    try {
      const r = await window.authClient.authenticatedFetch('/.netlify/functions/suggest-pesados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: state.newServiceLat, lng: state.newServiceLng, date })
      });
      const d = await r.json();

      document.getElementById('pvLoadingMsg').style.display = 'none';

      if (d.success && d.suggestions?.length) {
        state.suggestions = d.suggestions;
        renderSuggestions(d.suggestions);
      }
    } catch(e) {
      document.getElementById('pvLoadingMsg').style.display = 'none';
    }
  }

  function renderSuggestions(suggestions) {
    const list = document.getElementById('pvSugList');
    list.innerHTML = '';

    suggestions.forEach((s, idx) => {
      const dotClass = s.servicos_dia >= s.max_daily ? 'dot-red' :
                       s.servicos_dia >= s.max_daily - 1 ? 'dot-yellow' : 'dot-green';
      const capText = `${s.servicos_dia}/${s.max_daily} serviços`;
      const isBest = idx === 0;
      const isSelected = state.selectedPortalId === s.portal_id;

      const el = document.createElement('div');
      el.className = `pv-sug-item${isBest?' best':''}${isSelected?' selected':''}`;
      el.dataset.portalId = s.portal_id;
      el.innerHTML = `
        <div class="pv-sug-dot ${dotClass}"></div>
        <div>
          <div class="pv-sug-name">${s.name}</div>
          <div class="pv-sug-info">📍 ${s.dist_km} km · ${capText}</div>
        </div>
        ${isBest ? '<span class="pv-sug-badge cap-green">✓ Sugerido</span>' : ''}
        ${!s.disponivel ? '<span class="pv-sug-badge cap-red">Lotado</span>' : ''}
      `;
      el.addEventListener('click', () => selectSM(s.portal_id));
      list.appendChild(el);
    });

    document.getElementById('pvSuggestions').style.display = 'block';

    // Auto-selecionar o melhor se não há seleção manual
    if (!state.selectedPortalId && suggestions.length) {
      selectSM(suggestions[0].portal_id);
    }
  }

  function renderSuggestionsWithPreselect(portalId) {
    if (state.suggestions.length) {
      renderSuggestions(state.suggestions);
    }
    selectSM(portalId);
  }

  function selectSM(portalId) {
    state.selectedPortalId = portalId;
    document.querySelectorAll('.pv-sug-item').forEach(el => {
      el.classList.toggle('selected', parseInt(el.dataset.portalId) === portalId);
    });
    const btn = document.getElementById('pvProceedBtn');
    btn.disabled = false;
    btn.style.opacity = '1';
  }

  // ─── Avançar — abrir modal do SM selecionado ───────────────────────────────
  window.pvProceed = function() {
    const portalId = state.selectedPortalId;
    const date = document.getElementById('pvDate').value;
    const address = document.getElementById('pvAddress').value;

    if (!portalId) return;

    window.pvCloseNewService();

    // Mudar para o portal selecionado e abrir modal de novo agendamento
    // Usar a função existente de change portal se disponível
    if (typeof window.switchPortal === 'function') {
      window.switchPortal(portalId, function() {
        openAppointmentModal(date, address);
      });
    } else if (typeof window.changeActivePortal === 'function') {
      window.changeActivePortal(portalId);
      setTimeout(() => openAppointmentModal(date, address), 500);
    } else {
      // Fallback: abrir modal diretamente se a função global existir
      openAppointmentModal(date, address);
    }
  };

  function openAppointmentModal(date, address) {
    // Tentar abrir o modal de novo agendamento do sistema existente
    const addBtn = document.getElementById('addAppointmentBtn');
    if (addBtn) {
      addBtn.style.display = 'block';
      addBtn.click();
    }

    // Pré-preencher data e localidade após um tick
    setTimeout(() => {
      const dateInput = document.getElementById('appointmentDate');
      if (dateInput && date) dateInput.value = date;

      // Pré-preencher localidade se o campo existir
      const localityInput = document.getElementById('appointmentLocality');
      const localityText  = document.getElementById('selectedLocalityText');
      if (address && localityInput) {
        // Usar a função de autocomplete se disponível
        if (typeof window.setLocalityValue === 'function') {
          window.setLocalityValue(address);
        } else if (localityText) {
          localityText.textContent = address;
        }
      }
    }, 300);
  }

  // ─── Ver agendamento existente ─────────────────────────────────────────────
  window.pvViewAppt = function(apptId, portalId) {
    if (typeof window.changeActivePortal === 'function') {
      window.changeActivePortal(portalId);
    }
    setTimeout(() => {
      if (typeof window.openEditModal === 'function') {
        window.openEditModal(apptId);
      }
    }, 400);
  };

  // ─── Arrancar ─────────────────────────────────────────────────────────────
  let _pvInited = false;
  window._pvDebug = [];

  function tryInit(source) {
    const role = window.authClient?.getUser?.()?.role;
    window._pvDebug.push({source: source||'?', time: Date.now(), role, _pvInited});
    if (_pvInited) return;
    if (!['pesados_coord','admin','coordenador'].includes(role)) return;
    _pvInited = true;
    try {
      init();
      window._pvDebug.push({source: 'init-done', time: Date.now()});
    } catch(e) {
      window._pvDebug.push({source: 'init-ERROR', error: e.message, time: Date.now()});
      console.error('PV init error:', e);
    }
  }

  // Múltiplos triggers para garantir inicialização independente do timing
  tryInit('immediate');
  window.addEventListener('portalReady', () => tryInit('portalReady'));
  setTimeout(() => tryInit('500ms'), 500);
  setTimeout(() => tryInit('1500ms'), 1500);
  setTimeout(() => tryInit('3000ms'), 3000);

})();
