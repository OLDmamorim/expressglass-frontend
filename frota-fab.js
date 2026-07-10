// frota-fab.js - v1
// Botão flutuante (por cima do "+", canto inferior esquerdo) que abre o
// portal da loja diretamente no menu Frota/Viatura da loja do serviço.
// A loja é resolvida pelo proxy powering-kpis (action=portal-link) a partir
// do portal ativo (powering_loja_id).

(function () {
  var BTN_ID = 'frotaFab';
  var _cache = {};          // { portalId: url|false }
  var _resolving = {};      // { portalId: true } enquanto resolve

  function getActivePortalId() {
    var sel = document.getElementById('portalSwitcherSelect');
    if (sel && sel.value) return sel.value;
    return window.currentPortalId
      || (window.authClient && window.authClient.getUser && window.authClient.getUser() && window.authClient.getUser().portal_id)
      || null;
  }

  function ensureButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'Frota da loja';
    btn.setAttribute('aria-label', 'Frota da loja');
    btn.style.cssText = [
      'position:fixed', 'bottom:92px', 'left:20px', 'z-index:500',
      'width:58px', 'height:58px', 'border-radius:50%', 'border:none', 'cursor:pointer',
      'background:linear-gradient(135deg,#14b8a6,#0d9488)',
      'color:#fff', 'display:none', 'align-items:center', 'justify-content:center',
      'box-shadow:0 6px 24px rgba(13,148,136,0.45),0 2px 8px rgba(0,0,0,0.2)',
      'transition:transform .15s', '-webkit-tap-highlight-color:transparent'
    ].join(';');
    // ícone de viatura
    btn.innerHTML = '<svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>';
    btn.addEventListener('click', function () {
      var pid = getActivePortalId();
      var url = pid && _cache[pid];
      if (url) window.open(url, '_blank');
    });
    btn.addEventListener('touchstart', function () { btn.style.transform = 'scale(0.93)'; }, { passive: true });
    btn.addEventListener('touchend', function () { btn.style.transform = ''; }, { passive: true });
    document.body.appendChild(btn);
    return btn;
  }

  // Atualiza apenas a visibilidade (sem chamadas à API) — barato, corre em intervalo.
  function updateVisibility() {
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;
    var pid = getActivePortalId();
    var addBtn = document.getElementById('addServiceMobile');
    var addVisible = addBtn && addBtn.offsetParent !== null; // acompanha o "+" (mobile)
    var url = pid && _cache[pid];
    btn.style.display = (addVisible && url) ? 'flex' : 'none';
  }

  // Resolve (uma vez por portal) o link do portal da loja.
  async function resolve(portalId) {
    if (!portalId || _cache.hasOwnProperty(portalId) || _resolving[portalId]) return;
    if (!(window.authClient && window.authClient.getUser && window.authClient.getUser())) return;
    _resolving[portalId] = true;
    try {
      var r = await window.authClient.authenticatedFetch(
        '/.netlify/functions/powering-kpis?action=portal-link&portal_id=' + encodeURIComponent(portalId)
      );
      var d = await r.json();
      _cache[portalId] = (d && d.success && d.url) ? d.url : false;
    } catch (e) {
      _cache[portalId] = false;
    } finally {
      delete _resolving[portalId];
      updateVisibility();
    }
  }

  function tick() {
    var pid = getActivePortalId();
    if (pid) resolve(pid);
    updateVisibility();
  }

  function start() {
    ensureButton();
    var sel = document.getElementById('portalSwitcherSelect');
    if (sel && !sel._frotaHooked) {
      sel.addEventListener('change', function () { setTimeout(tick, 200); });
      sel._frotaHooked = true;
    }
    tick();
    setInterval(tick, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1200); });
  } else {
    setTimeout(start, 1200);
  }
})();
