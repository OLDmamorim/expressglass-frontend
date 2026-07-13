// frota-fab.js - v3
// Botão flutuante (por cima do "+", canto inferior esquerdo) que abre o
// portal da loja diretamente no menu Frota/Viatura da loja do serviço.
// A loja é resolvida pelo proxy powering-kpis (action=portal-link) a partir
// do portal ativo (powering_loja_id). Funciona para qualquer utilizador
// (incluindo admin) — depende apenas da agenda/portal selecionado.

(function () {
  var BTN_ID = 'frotaFab';
  var _cache = {};          // { portalId: url|false }  (resultado definitivo)
  var _resolving = {};      // { portalId: true } enquanto resolve
  var _attempts = {};       // { portalId: n } tentativas com erro transitório

  function getActivePortalId() {
    var sel = document.getElementById('portalSwitcherSelect');
    if (sel && sel.value) return sel.value;
    if (window.portalConfig && window.portalConfig.id) return window.portalConfig.id;
    return window.currentPortalId
      || (window.authClient && window.authClient.getUser && window.authClient.getUser() && window.authClient.getUser().portal_id)
      || null;
  }

  function isVisible(el) {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
    var r = el.getBoundingClientRect(); // funciona para position:fixed (offsetParent não)
    return r.width > 1 && r.height > 1;
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
    var url = pid && _cache[pid];
    // Mostrar em mobile sempre que haja link, INDEPENDENTEMENTE do "+".
    // (O técnico não tem o botão "+", mas deve continuar a ver o atalho da Viatura.)
    var isMobile = window.matchMedia('(max-width: 820px)').matches;
    var addBtn = document.getElementById('addServiceMobile');
    var addVisible = isVisible(addBtn); // "+" presente (coordenador)
    btn.style.display = (isMobile && url) ? 'flex' : 'none';
    // Se o "+" existe, o atalho fica por cima dele; senão ocupa o lugar do "+".
    btn.style.bottom = addVisible ? '92px' : '24px';
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
      if (d && d.success && d.url) {
        _cache[portalId] = d.url;                 // sucesso
      } else if (d && d.reason === 'sem_portal') {
        _cache[portalId] = false;                 // definitivo: loja sem portal
      } else {
        // erro transitório (ex.: deploy a decorrer / API key) — tentar de novo, com limite
        _attempts[portalId] = (_attempts[portalId] || 0) + 1;
        if (_attempts[portalId] >= 5) _cache[portalId] = false;
      }
    } catch (e) {
      _attempts[portalId] = (_attempts[portalId] || 0) + 1;
      if (_attempts[portalId] >= 5) _cache[portalId] = false;
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
    setInterval(function () {
      // (re)ligar o listener caso o switcher seja criado mais tarde
      var s = document.getElementById('portalSwitcherSelect');
      if (s && !s._frotaHooked) {
        s.addEventListener('change', function () { setTimeout(tick, 200); });
        s._frotaHooked = true;
      }
      tick();
    }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1200); });
  } else {
    setTimeout(start, 1200);
  }
})();
