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
                     window.activePortalId ||
                     window.authClient?.getUser?.()?.portal_id;

    try {
      // Se não há portal específico (admin), buscar todos os pedidos pendentes
      const url = portalId
        ? `/.netlify/functions/commercial-request?portal_id=${portalId}`
        : `/.netlify/functions/commercial-request?all=1`;
      const r = await window.authClient.authenticatedFetch(url);
      const d = await r.json();
      return d.success ? (d.requests || []) : [];
    } catch (_) { return []; }
  }

  function ensureBannerContainer() {
    let container = document.getElementById(BANNER_ID);
    if (container) return container;

    container = document.createElement('div');
    container.id = BANNER_ID;
    container.style.cssText = 'display:none;flex-direction:column;gap:6px;padding:8px 14px;background:#fef3c7;border-bottom:2px solid #f59e0b;position:relative;z-index:50;';

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
        .cr-banner-pulsing { animation: crPulse 1.5s ease-in-out 3 !important; }
        .cr-card-active { border-color:#2563eb !important; background:#eff6ff !important; }
        .cr-grid { display:flex;flex-wrap:wrap;gap:6px; }
        .cr-card { background:#fff;border:1.5px solid #f59e0b;border-radius:10px;padding:8px 10px;font-family:'Figtree',system-ui,sans-serif;box-shadow:0 2px 6px rgba(245,158,11,.15);width:calc(16.66% - 6px);min-width:140px;flex:1;max-width:200px;display:flex;flex-direction:column;gap:3px; }
        .cr-card-top { display:flex;justify-content:space-between;align-items:center; }
        .cr-card-plate { font-family:'Rajdhani','Roboto Mono',monospace;font-size:14px;font-weight:900;color:#92400e;letter-spacing:0.5px; }
        .cr-card-loc { font-size:11px;color:#78350f;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .cr-card-meta { font-size:10px;color:#a16207;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .cr-btn-agenda { background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;margin-top:2px; }
        .cr-btn-agenda:hover { background:#d97706; }
        .cr-x { background:none;border:none;color:#d97706;font-size:13px;cursor:pointer;padding:0;line-height:1;flex-shrink:0; }
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
    container.classList.remove('cr-banner-pulsing');
    void container.offsetWidth;
    container.classList.add('cr-banner-pulsing');

    container.innerHTML = `
      <div class="cr-header"><div class="cr-dot"></div>${newOnes.length === 1 ? '1 pedido pendente' : newOnes.length + ' pedidos pendentes'}</div>
      <div class="cr-grid">
        ${newOnes.map(req => {
          const time = new Date(req.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
          const comercial = (req.commercial_name || 'Comercial').split(/[\s.]/)[0]; // primeiro nome
          return `<div class="cr-card" id="crCard-${req.id}">
            <div class="cr-card-top">
              <div class="cr-card-plate">${req.plate}</div>
              <button class="cr-x" onclick="crDismiss(${req.id})">✕</button>
            </div>
            <div class="cr-card-loc">📍 ${req.locality}</div>
            <div class="cr-card-meta">👤 ${comercial}${req.service_file ? ' · ' + req.service_file : ''} · ${time}</div>
            <button class="cr-btn-agenda" onclick="crViewInAgenda('${req.plate}',${req.id})">📅 Agendar</button>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  window.crViewInAgenda = function(plate, id) {
    // NÃO marcar como visto ainda — só quando o coordenador fechar o modal
    document.getElementById('crCard-' + id)?.classList.add('cr-card-active');

    // Abrir modal de novo agendamento
    const addBtn = document.getElementById('addServiceBtn') || document.getElementById('addAppointmentBtn');
    if (addBtn) {
      addBtn.click();
      // Pré-preencher matrícula após o modal abrir
      setTimeout(() => {
        const plateInput = document.getElementById('appointmentPlate');
        if (plateInput) {
          plateInput.value = plate;
          plateInput.dispatchEvent(new Event('input'));
        }
      }, 200);
    }

    // Marcar como visto e remover card ao fechar o modal
    const closeBtn = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelForm');
    const onClose = () => {
      markSeen(id);
      document.getElementById('crCard-' + id)?.remove();
      const cards = document.getElementById(BANNER_ID)?.querySelectorAll('.cr-card');
      if (!cards?.length) document.getElementById(BANNER_ID).style.display = 'none';
      closeBtn?.removeEventListener('click', onClose);
      cancelBtn?.removeEventListener('click', onClose);
    };
    closeBtn?.addEventListener('click', onClose);
    cancelBtn?.addEventListener('click', onClose);

    // Também marcar ao submeter o form
    document.getElementById('appointmentForm')?.addEventListener('submit', onClose, { once: true });
  };

  window.crDismiss = function(id) {
    markSeen(id);
    document.getElementById('crCard-' + id)?.remove();
    const cards = document.getElementById(BANNER_ID)?.querySelectorAll('.cr-card');
    if (!cards?.length) document.getElementById(BANNER_ID).style.display = 'none';
  };

  async function poll() {
    const role = window.authClient?.getUser?.()?.role;
    const portalId = document.getElementById('portalSwitcherSelect')?.value || window.currentPortalId || window.activePortalId;
    
    // Debug visível — remover após confirmar
    const dbg = document.getElementById('crDebug') || (() => {
      const d = document.createElement('div');
      d.id = 'crDebug';
      d.style.cssText = 'position:fixed;bottom:60px;left:10px;background:#000;color:#0f0;font-size:10px;padding:6px;border-radius:6px;z-index:9999;max-width:300px;';
      document.body.appendChild(d);
      return d;
    })();
    dbg.textContent = `CR: role=${role} portal=${portalId} t=${new Date().toLocaleTimeString()}`;

    if (!shouldRun()) { dbg.textContent += ' SKIP(role)'; return; }
    const requests = await fetchPendingRequests();
    dbg.textContent += ` reqs=${requests.length}`;
    if (requests.length > 0) renderBanner(requests);
  }

  function start() {
    if (!shouldRun()) return;
    poll();
    setInterval(poll, POLL_INTERVAL);
  }

  window.addEventListener('portalReady',   start);
  window.addEventListener('portalChanged', poll);
  // Tentar em múltiplos momentos para garantir arranque
  setTimeout(start, 500);
  setTimeout(start, 2000);
  setTimeout(start, 5000);
  // Quando a página volta ao primeiro plano
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
  // Quando o DOM está pronto
  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start);
  }

})();