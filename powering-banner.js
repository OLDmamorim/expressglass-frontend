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
      `/.netlify/functions/powering-kpis?portal_id=${portalId}&mes=${mes}&ano=${ano}&dia=${new Date().getDate()}`
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
      if (!kpis) throw new Error('kpis null');
      fillKpis(kpis);
    } catch (e) {
      console.warn('[PoweringEG banner]', e.message);
      // Manter o shell com traços em vez de remover
      const grid = document.getElementById('pegGrid');
      if (grid) grid.innerHTML = ['Serviços','Objetivo','Tx. Rep.','Desvio Dia'].map(l => `
        <div class="peg-kpi"><div class="peg-lbl">${l}</div><div class="peg-val" style="color:#475569">—</div></div>
      `).join('');
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
