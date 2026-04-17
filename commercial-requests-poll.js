// ═══════════════════════════════════════════════════════════════════════════
// commercial-requests-poll.js
// Polling de pedidos de serviço de comerciais — popup na agenda do coordenador
// Carregado no index.html; só activa para coordenador/admin
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const POLL_INTERVAL = 30000; // 30 segundos
  const SEEN_KEY      = 'eg_seen_commercial_requests';
  let pollTimer       = null;
  let isRunning       = false;

  // ── Roles que devem ver os popups ─────────────────────────────────────
  function shouldRun() {
    const role = window.authClient?.getUser?.()?.role;
    return ['coordenador', 'admin'].includes(role);
  }

  // ── IDs já vistos (para não repetir popup) ────────────────────────────
  function getSeenIds() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
    catch (_) { return new Set(); }
  }

  function markSeen(id) {
    const seen = getSeenIds();
    seen.add(id);
    // Guardar só os últimos 200 para não crescer indefinidamente
    const arr = [...seen].slice(-200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  }

  // ── Fetch dos pedidos pendentes ───────────────────────────────────────
  async function fetchPendingRequests() {
    const portalId = window.currentPortalId ||
                     window.authClient?.getUser?.()?.portal_id ||
                     document.getElementById('portalSwitcherSelect')?.value;
    if (!portalId) return [];

    const r = await window.authClient.authenticatedFetch(
      `/.netlify/functions/commercial-request?portal_id=${portalId}`
    );
    const d = await r.json();
    return d.success ? (d.requests || []) : [];
  }

  // ── Mostrar popup ─────────────────────────────────────────────────────
  function showRequestPopup(req) {
    const existing = document.getElementById('crPopup-' + req.id);
    if (existing) return;

    const popup = document.createElement('div');
    popup.id = 'crPopup-' + req.id;
    popup.style.cssText = [
      'position:fixed', 'bottom:80px', 'right:20px', 'z-index:9990',
      'background:#0f172a', 'color:#f1f5f9',
      'border-left:4px solid #2563eb',
      'border-radius:14px',
      'padding:16px 18px',
      'box-shadow:0 8px 32px rgba(0,0,0,.45)',
      'font-family:Figtree,system-ui,sans-serif',
      'max-width:320px', 'width:calc(100vw - 40px)',
      'animation:crSlideIn .3s ease',
    ].join(';');

    const time = new Date(req.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const commercial = req.commercial_name || 'Comercial';

    popup.innerHTML = `
      <style>
        @keyframes crSlideIn {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
        #crPopup-${req.id} .cr-close {
          position:absolute; top:10px; right:12px;
          background:none; border:none; color:#64748b;
          font-size:16px; cursor:pointer; line-height:1;
        }
        #crPopup-${req.id} .cr-close:hover { color:#f1f5f9; }
      </style>
      <button class="cr-close" onclick="this.closest('[id^=crPopup]').remove()">✕</button>
      <div style="font-size:11px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">
        📋 Pedido de Serviço · ${time}
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="font-family:'Rajdhani','Roboto Mono',monospace;font-size:18px;font-weight:900;
                    background:#1e293b;padding:4px 12px;border-radius:6px;letter-spacing:1px;">
          ${req.plate}
        </div>
        <div style="font-size:13px;color:#94a3b8;">
          ${req.locality}
        </div>
      </div>
      ${req.service_file ? `<div style="font-size:12px;color:#64748b;margin-bottom:6px;">Ficha: ${req.service_file}</div>` : ''}
      <div style="font-size:12px;color:#475569;">
        Enviado por <strong style="color:#e2e8f0">${commercial}</strong>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button onclick="dismissCR(${req.id})"
          style="flex:1;padding:8px;background:#1e293b;color:#94a3b8;border:none;
                 border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
                 font-family:inherit;">
          Dispensar
        </button>
        <button onclick="viewCRInAgenda('${req.plate}', ${req.id})"
          style="flex:1;padding:8px;background:#2563eb;color:#fff;border:none;
                 border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;
                 font-family:inherit;">
          Ver na Agenda →
        </button>
      </div>
    `;

    document.body.appendChild(popup);

    // Auto-dismiss após 60 segundos
    setTimeout(() => popup.remove(), 60000);
  }

  // ── Dispensar pedido (marcar como visto) ──────────────────────────────
  window.dismissCR = function (id) {
    markSeen(id);
    document.getElementById('crPopup-' + id)?.remove();
  };

  // ── Ver na agenda ─────────────────────────────────────────────────────
  window.viewCRInAgenda = function (plate, id) {
    markSeen(id);
    document.getElementById('crPopup-' + id)?.remove();

    // Tentar abrir a pesquisa no sistema
    const searchInput = document.getElementById('searchInput');
    const searchBtn   = document.getElementById('searchBtn');
    const searchBar   = document.getElementById('searchBar');
    if (searchInput) {
      if (searchBar) searchBar.classList.remove('hidden');
      searchInput.value = plate;
      searchInput.dispatchEvent(new Event('input'));
      searchInput.focus();
    }
  };

  // ── Ciclo de polling ──────────────────────────────────────────────────
  async function poll() {
    if (!shouldRun()) return;
    try {
      const requests = await fetchPendingRequests();
      const seen = getSeenIds();

      requests.forEach(req => {
        if (!seen.has(req.id)) {
          showRequestPopup(req);
          markSeen(req.id);
        }
      });
    } catch (e) {
      console.warn('[CR Poll]', e.message);
    }
  }

  function startPolling() {
    if (isRunning) return;
    if (!shouldRun()) return;
    isRunning = true;
    poll(); // primeira vez imediata
    pollTimer = setInterval(poll, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    isRunning = false;
  }

  // ── Iniciar após auth ─────────────────────────────────────────────────
  window.addEventListener('portalReady', startPolling);
  setTimeout(startPolling, 2000);

  // Parar se fizer logout
  window.addEventListener('beforeunload', stopPolling);

})();
