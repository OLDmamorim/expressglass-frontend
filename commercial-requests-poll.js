// ═══════════════════════════════════════════════════════════════════════════
// commercial-requests-poll.js
// Banner piscante de pedidos de serviço de comerciais
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const POLL_INTERVAL = 30000;
  const SEEN_KEY      = 'eg_seen_cr';
  const BANNER_ID     = 'crBannerContainer';

  function shouldRun() {
    const role = window.authClient?.getUser?.()?.role;
    return ['coordenador', 'admin'].includes(role);
  }

  function getSeenIds() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
    catch (_) { return new Set(); }
  }

  function markSeen(id) {
    const seen = getSeenIds();
    seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  }

  async function fetchPendingRequests() {
    const portalId = document.getElementById('portalSwitcherSelect')?.value ||
                     window.currentPortalId ||
                     window.authClient?.getUser?.()?.portal_id;
    if (!portalId) return [];
    try {
      const r = await window.authClient.authenticatedFetch(
        `/.netlify/functions/commercial-request?portal_id=${portalId}`
      );
      const d = await r.json();
      return d.success ? (d.requests || []) : [];
    } catch (_) { return []; }
  }

  function ensureBannerContainer() {
    let container = document.getElementById(BANNER_ID);
    if (container) return container;

    container = document.createElement('div');
    container.id = BANNER_ID;
    container.style.cssText = 'display:none;flex-direction:column;gap:6px;padding:10px 16px;background:#fef3c7;border-bottom:2px solid #f59e0b;position:relative;z-index:50;';

    const switcher = document.getElementById('portalSwitcher');
    if (switcher?.parentNode) switcher.parentNode.insertBefore(container, switcher.nextSibling);
    else {
      const navBar = document.querySelector('.nav-bar');
      if (navBar?.parentNode) navBar.parentNode.insertBefore(container, navBar);
      else document.body.prepend(container);
    }

    if (!document.getElementById('crBannerStyle')) {
      const style = document.createElement('style');
      style.id = 'crBannerStyle';
      style.textContent = `
        @keyframes crPulse { 0%,100%{background:#fef3c7;border-color:#f59e0b} 50%{background:#fde68a;border-color:#d97706} }
        #${BANNER_ID}.pulsing { animation: crPulse 1.5s ease-in-out 3; }
        .cr-card { display:flex;align-items:center;gap:12px;background:#fff;border:1.5px solid #f59e0b;border-radius:10px;padding:10px 14px;font-family:'Figtree',system-ui,sans-serif;box-shadow:0 2px 8px rgba(245,158,11,.2); }
        .cr-card-plate { font-family:'Rajdhani','Roboto Mono',monospace;font-size:16px;font-weight:900;color:#92400e;letter-spacing:1px; }
        .cr-card-info { font-size:12px;color:#78350f;margin-top:1px; }
        .cr-card-actions { display:flex;gap:6px;flex-shrink:0; }
        .cr-btn { border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit; }
        .cr-btn-agenda { background:#f59e0b;color:#fff; }
        .cr-btn-agenda:hover { background:#d97706; }
        .cr-btn-dismiss { background:#f3f4f6;color:#6b7280; }
        .cr-header { display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px; }
        .cr-dot { width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:crDot 1s ease-in-out infinite; }
        @keyframes crDot { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `;
      document.head.appendChild(style);
    }
    return container;
  }

  function renderBanner(requests) {
    const container = ensureBannerContainer();
    const seen = getSeenIds();
    const newOnes = requests.filter(r => !seen.has(r.id));
    if (newOnes.length === 0) { container.style.display = 'none'; return; }

    container.style.display = 'flex';
    container.classList.remove('pulsing');
    void container.offsetWidth;
    container.classList.add('pulsing');

    container.innerHTML = `
      <div class="cr-header"><div class="cr-dot"></div>${newOnes.length === 1 ? '1 pedido de serviço pendente' : newOnes.length + ' pedidos pendentes'}</div>
      ${newOnes.map(req => {
        const time = new Date(req.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
        return `<div class="cr-card" id="crCard-${req.id}">
          <div style="font-size:20px;flex-shrink:0">📋</div>
          <div style="flex:1;min-width:0">
            <div class="cr-card-plate">${req.plate}</div>
            <div class="cr-card-info">📍 ${req.locality} · 🕐 ${time} · 👤 ${req.commercial_name || 'Comercial'}${req.service_file ? ' · Ficha: ' + req.service_file : ''}</div>
          </div>
          <div class="cr-card-actions">
            <button class="cr-btn cr-btn-agenda" onclick="crViewInAgenda('${req.plate}',${req.id})">📅 Agendar</button>
            <button class="cr-btn cr-btn-dismiss" onclick="crDismiss(${req.id})">✕</button>
          </div>
        </div>`;
      }).join('')}
    `;
  }

  window.crViewInAgenda = function(plate, id) {
    markSeen(id);
    document.getElementById('crCard-' + id)?.remove();
    const cards = document.getElementById(BANNER_ID)?.querySelectorAll('.cr-card');
    if (!cards?.length) document.getElementById(BANNER_ID).style.display = 'none';
    const searchInput = document.getElementById('searchInput');
    const searchBar = document.getElementById('searchBar');
    if (searchInput) {
      if (searchBar) searchBar.classList.remove('hidden');
      searchInput.value = plate;
      searchInput.dispatchEvent(new Event('input'));
    }
    document.querySelector('.unscheduled-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.crDismiss = function(id) {
    markSeen(id);
    document.getElementById('crCard-' + id)?.remove();
    const cards = document.getElementById(BANNER_ID)?.querySelectorAll('.cr-card');
    if (!cards?.length) document.getElementById(BANNER_ID).style.display = 'none';
  };

  async function poll() {
    if (!shouldRun()) return;
    const requests = await fetchPendingRequests();
    if (requests.length > 0) renderBanner(requests);
  }

  function start() {
    if (!shouldRun()) return;
    poll();
    setInterval(poll, POLL_INTERVAL);
  }

  window.addEventListener('portalReady',   start);
  window.addEventListener('portalChanged', poll);
  // Múltiplos triggers para garantir arranque independente do timing
  setTimeout(start, 1000);
  setTimeout(start, 3000);
  setTimeout(start, 6000);
  // Também tentar quando a página fica visível após background
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

})();
