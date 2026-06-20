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
    sel.addEventListener('change', () => { rebuildBanner(); rebuildBanner2(); });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BANNER 2 — Escovas da loja actual + Campeã nacional
  // ═══════════════════════════════════════════════════════════════════════
  const BANNER2_ID = 'poweringEGEscovasBanner';

  async function fetchVendasCompl(portalId) {
    const { mes, ano } = getMonthMeta();
    const r = await window.authClient.authenticatedFetch(
      `/.netlify/functions/powering-kpis?action=vendas-complementares&portal_id=${portalId}&mes=${mes}&ano=${ano}`
    );
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'sem dados complementares');
    return d;
  }

  function buildBanner2Shell() {
    const el = document.createElement('div');
    el.id = BANNER2_ID;
    el.style.cssText = [
      'background:#0b1e38',
      'border-left:4px solid #f59e0b',
      'border-top:1px solid #1e3a5f',
      'padding:8px 16px',
      'font-family:Figtree,system-ui,sans-serif',
      'display:flex',
      'align-items:center',
    ].join(';');
    el.innerHTML =
      '<div style="flex:1;display:flex;align-items:center;gap:10px;">' +
        '<div>' +
          '<div style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:1px;">🧹 Escovas este mês</div>' +
          '<div id="peg2Escovas" style="font-size:21px;font-weight:900;color:#94a3b8;font-variant-numeric:tabular-nums;line-height:1;">—</div>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;display:flex;align-items:center;gap:10px;border-left:1px solid #1e3a5f;padding-left:16px;min-width:0;">' +
        '<div style="min-width:0;">' +
          '<div style="font-size:9px;font-weight:700;color:#fbbf24;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:1px;">🏆 Loja campeã de vendas</div>' +
          '<div id="peg2Campea" style="font-size:14px;font-weight:800;color:#fde68a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;">—</div>' +
        '</div>' +
      '</div>';
    return el;
  }

  var _fmtEur = function(v) {
    return (v != null && !isNaN(v))
      ? new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
      : '—';
  };

  function _getField(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] != null) return obj[keys[i]];
    }
    return null;
  }

  function fillBanner2(data) {
    console.log('[PEG escovas] raw data:', JSON.stringify(data).slice(0, 500));

    // Tentar vários nomes de array possíveis
    var lista = data.lojas || data.resultados || data.data || data.vendas || data.items || [];
    if (!Array.isArray(lista)) lista = [];
    console.log('[PEG escovas] lista length:', lista.length, lista[0]);

    var currentId = parseInt(data.lojaId);

    // Tentar vários nomes de campo para id da loja
    var lojaAtual = lista.find(function(l) {
      var id = parseInt(_getField(l, ['lojaId', 'loja_id', 'id', 'lojaID']));
      return id === currentId;
    }) || {};

    // Tentar vários nomes de campo para escovas
    var escovasVal = _getField(lojaAtual, ['escovasVendas', 'escova_vendas', 'escovas', 'escovasTotal', 'escovas_vendas']);
    escovasVal = escovasVal != null ? parseFloat(escovasVal) : null;

    // Campeã: maior escovasVendas
    var campea = lista.reduce(function(best, l) {
      var v = parseFloat(_getField(l, ['escovasVendas', 'escova_vendas', 'escovas', 'escovasTotal', 'escovas_vendas']) || 0);
      var bv = parseFloat(_getField(best || {}, ['escovasVendas', 'escova_vendas', 'escovas', 'escovasTotal', 'escovas_vendas']) || 0);
      return v > bv ? l : best;
    }, null);

    var elEscovas = document.getElementById('peg2Escovas');
    var elCampea  = document.getElementById('peg2Campea');

    if (elEscovas) {
      elEscovas.textContent = _fmtEur(escovasVal);
      elEscovas.style.color = (escovasVal || 0) > 0 ? '#4ade80' : '#94a3b8';
    }
    if (elCampea && campea) {
      var nomeC  = _getField(campea, ['lojaNome', 'loja_nome', 'nome', 'lojaNome', 'lojaName']);
      var valC   = parseFloat(_getField(campea, ['escovasVendas', 'escova_vendas', 'escovas', 'escovasTotal', 'escovas_vendas']) || 0);
      var idC    = parseInt(_getField(campea, ['lojaId', 'loja_id', 'id', 'lojaID']));
      var isCurrent = !isNaN(currentId) && idC === currentId;
      elCampea.textContent = (nomeC || '?') + ' — ' + _fmtEur(valC);
      elCampea.style.color = isCurrent ? '#4ade80' : '#fde68a';
    }
  }

  function insertBanner2(el) {
    var b1 = document.getElementById(BANNER_ID);
    if (b1) {
      b1.insertAdjacentElement('afterend', el);
    } else {
      insertBanner(el);
    }
  }

  async function initBanner2() {
    if (document.getElementById(BANNER2_ID)) return;
    if (!window.authClient?.getUser?.()) return;
    var { portalId } = getActivePortal();
    if (!portalId) return;

    var shell = buildBanner2Shell();
    insertBanner2(shell);

    try {
      var data = await fetchVendasCompl(portalId);
      fillBanner2(data);
    } catch (e) {
      console.warn('[PoweringEG escovas]', e.message);
    }
  }

  function rebuildBanner2() {
    document.getElementById(BANNER2_ID)?.remove();
    setTimeout(() => initBanner2().catch(() => {}), 150);
  }

  // ── Triggers (sem guard de role — corre para todos) ───────────────────
  initBanner().catch(() => {});
  initBanner2().catch(() => {});
  window.addEventListener('portalReady', () => {
    attachSwitcherListener();
    initBanner().catch(() => {});
    initBanner2().catch(() => {});
  });
  window.addEventListener('portalChanged', () => { rebuildBanner(); rebuildBanner2(); });
  setTimeout(() => { attachSwitcherListener(); initBanner().catch(() => {}); initBanner2().catch(() => {}); }, 900);
  setTimeout(() => { attachSwitcherListener(); initBanner().catch(() => {}); initBanner2().catch(() => {}); }, 2500);
  setTimeout(() => { attachSwitcherListener(); initBanner().catch(() => {}); initBanner2().catch(() => {}); }, 4000);

})();
