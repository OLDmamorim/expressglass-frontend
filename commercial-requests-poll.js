// commercial-requests-poll.js — banner pedidos comerciais

(function () {
  'use strict';

  const POLL_INTERVAL = 30000;
  const SEEN_KEY = 'eg_seen_cr';
  const BANNER_ID = 'crBannerContainer';

  function shouldRun() {
    var role = window.authClient && window.authClient.getUser && window.authClient.getUser() && window.authClient.getUser().role;
    return role === 'coordenador' || role === 'admin';
  }

  function isSeen(id) { return false; } // sempre mostrar

  function markSeen(id) {
    // marcar no DOM apenas — não guardar em localStorage
    var card = document.getElementById('crCard-' + id);
    if (card) card.dataset.dismissed = '1';
  }

  function isDismissed(id) {
    var card = document.getElementById('crCard-' + id);
    return card && card.dataset.dismissed === '1';
  }

  function getPortalId() {
    var sel = document.getElementById('portalSwitcherSelect');
    if (sel && sel.value) return sel.value;
    if (window.currentPortalId) return window.currentPortalId;
    if (window.activePortalId) return window.activePortalId;
    if (window.portalConfig && window.portalConfig.id) return window.portalConfig.id;
    var u = window.authClient && window.authClient.getUser && window.authClient.getUser();
    if (u && u.portal_id) return u.portal_id;
    return null;
  }

  async function fetchPendingRequests() {
    var portalId = getPortalId();
    try {
      var url = portalId
        ? '/.netlify/functions/commercial-request?portal_id=' + portalId
        : '/.netlify/functions/commercial-request?all=1';
      var r = await window.authClient.authenticatedFetch(url);
      var d = await r.json();
      return d.success ? (d.requests || []) : [];
    } catch (_) { return []; }
  }

  function ensureStyles() {
    if (document.getElementById('crBannerStyle')) return;
    var s = document.createElement('style');
    s.id = 'crBannerStyle';
    s.textContent = [
      '@keyframes crPulse{0%,100%{background:#fef3c7}50%{background:#fde68a}}',
      '@keyframes crDot{0%,100%{opacity:1}50%{opacity:0.3}}',
      '#crBannerContainer{display:none;flex-direction:column;gap:6px;padding:8px 14px;background:#fef3c7;border-bottom:2px solid #f59e0b;z-index:50;}',
      '#crBannerContainer.cr-pulsing{animation:crPulse 1.5s ease-in-out 3;}',
      '.cr-header{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}',
      '.cr-dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:crDot 1s ease-in-out infinite;}',
      '.cr-grid{display:flex;flex-wrap:wrap;gap:6px;}',
      '@keyframes crPulseCard{0%,100%{border-color:currentColor;box-shadow:0 2px 6px rgba(245,158,11,.15)}50%{box-shadow:0 0 12px 3px rgba(245,158,11,.5)}}',
      '@keyframes crPulseOrange{0%,100%{border-color:#f97316;box-shadow:0 2px 6px rgba(249,115,22,.15)}50%{box-shadow:0 0 12px 3px rgba(249,115,22,.6)}}',
      '@keyframes crPulseRed{0%,100%{border-color:#ef4444;box-shadow:0 2px 6px rgba(239,68,68,.15)}50%{box-shadow:0 0 12px 3px rgba(239,68,68,.7)}}',
      '.cr-card{background:#fff;border:2px solid #f59e0b;border-radius:10px;padding:8px 10px;font-family:Figtree,system-ui,sans-serif;box-shadow:0 2px 6px rgba(245,158,11,.15);min-width:140px;flex:1;max-width:200px;display:flex;flex-direction:column;gap:3px;animation:crPulseCard 1.5s ease-in-out infinite;}',
      '.cr-card.cr-orange{border-color:#f97316;animation:crPulseOrange 1.2s ease-in-out infinite;}',
      '.cr-card.cr-red{border-color:#ef4444;animation:crPulseRed 1s ease-in-out infinite;}',
      '.cr-card-top{display:flex;justify-content:space-between;align-items:center;}',
      '.cr-card-plate{font-family:Rajdhani,monospace;font-size:14px;font-weight:900;color:#92400e;letter-spacing:0.5px;}',
      '.cr-card-loc{font-size:11px;color:#78350f;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.cr-card-meta{font-size:10px;color:#a16207;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.cr-btn-agenda{background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;margin-top:2px;}',
      '.cr-btn-agenda:hover{background:#d97706;}',
      '.cr-x{background:none;border:none;color:#d97706;font-size:13px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;}'
    ].join('');
    document.head.appendChild(s);
  }

  function ensureContainer() {
    var el = document.getElementById(BANNER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = BANNER_ID;
    var switcher = document.getElementById('portalSwitcher');
    if (switcher && switcher.parentNode) {
      switcher.parentNode.insertBefore(el, switcher.nextSibling);
    } else {
      var nav = document.querySelector('.nav-bar');
      if (nav && nav.parentNode) nav.parentNode.insertBefore(el, nav);
      else document.body.prepend(el);
    }
    return el;
  }

  function buildCard(req) {
    var time = new Date(req.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    var name = (req.commercial_name || 'Comercial').split(' ')[0];
    var meta = name + (req.service_file ? ' · ' + req.service_file : '') + ' · ' + time;

    // Calcular urgência
    var ageMin = (Date.now() - new Date(req.created_at).getTime()) / 60000;
    var urgClass = ageMin > 60 ? 'cr-red' : ageMin > 30 ? 'cr-orange' : '';

    var card = document.createElement('div');
    card.className = 'cr-card' + (urgClass ? ' ' + urgClass : '');
    card.id = 'crCard-' + req.id;

    var top = document.createElement('div');
    top.className = 'cr-card-top';

    var plate = document.createElement('div');
    plate.className = 'cr-card-plate';
    plate.style.color = ageMin > 60 ? '#991b1b' : ageMin > 30 ? '#9a3412' : '#92400e';
    plate.textContent = req.plate;

    var xBtn = document.createElement('button');
    xBtn.className = 'cr-x';
    xBtn.textContent = '✕';
    xBtn.onclick = function() { crDismiss(req.id); };

    top.appendChild(plate);
    top.appendChild(xBtn);

    var loc = document.createElement('div');
    loc.className = 'cr-card-loc';
    loc.textContent = '📍 ' + req.locality;

    var metaEl = document.createElement('div');
    metaEl.className = 'cr-card-meta';
    metaEl.textContent = '👤 ' + meta;

    var agBtn = document.createElement('button');
    agBtn.className = 'cr-btn-agenda';
    agBtn.style.background = ageMin > 60 ? '#ef4444' : ageMin > 30 ? '#f97316' : '#f59e0b';
    agBtn.textContent = '📅 Agendar';
    agBtn.dataset.req = JSON.stringify(req);
    agBtn.onclick = function() { crViewInAgenda(JSON.parse(this.dataset.req)); };

    card.appendChild(top);
    card.appendChild(loc);
    card.appendChild(metaEl);
    card.appendChild(agBtn);

    return card;
  }

  function renderBanner(requests) {
    ensureStyles();
    var container = ensureContainer();
    var newOnes = requests.filter(function(r) { return !isDismissed(r.id); });
    if (newOnes.length === 0) { container.style.display = 'none'; return; }

    container.style.display = 'flex';
    // sem animação no container

    // Limpar e reconstruir
    container.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'cr-header';
    var dot = document.createElement('div');
    dot.className = 'cr-dot';
    header.appendChild(dot);
    header.appendChild(document.createTextNode(
      newOnes.length === 1 ? '1 pedido pendente' : newOnes.length + ' pedidos pendentes'
    ));
    container.appendChild(header);

    var grid = document.createElement('div');
    grid.className = 'cr-grid';
    newOnes.forEach(function(req) {
      grid.appendChild(buildCard(req));
    });
    container.appendChild(grid);
  }

  window.crViewInAgenda = function(req) {
    var plate = req.plate; var id = req.id;
    document.getElementById('crCard-' + id) && document.getElementById('crCard-' + id).style.setProperty('border-color', '#2563eb');

    var addBtn = document.getElementById('addServiceBtn') || document.getElementById('addAppointmentNavBtn');
    if (addBtn) {
      addBtn.click();
      setTimeout(function() {
        // Pré-preencher todos os campos do modal
        var r = req;
        var f = function(id, val) {
          var el = document.getElementById(id);
          if (el && val) {
            el.value = val;
            el.dispatchEvent(new Event('input'));
            el.dispatchEvent(new Event('change'));
          }
        };
        f('appointmentPlate', plate);
        if (r.car)          f('appointmentCar', r.car);
        if (r.service_type) f('appointmentService', r.service_type);
        if (r.phone)        f('appointmentPhone', r.phone);
        if (r.entity)       f('appointmentClientName', r.entity);
        // Localidade via selectLocality do script.js
        if (r.locality && typeof window.selectLocality === 'function') {
          window.selectLocality(r.locality);
        }
        // Notas
        if (r.service_file || r.notes) {
          var notesEl = document.getElementById('appointmentNotes');
          if (notesEl) notesEl.value = [r.service_file ? 'Ficha: '+r.service_file : '', r.notes || ''].filter(Boolean).join(' | ');
        }
      }, 300);
    }

    // Só remover ao GUARDAR (submit) — cancelar/fechar mantém o card
    var container = document.getElementById(BANNER_ID);
    var onSave = function() {
      // Marcar como done na DB
      if (window.authClient && window.authClient.authenticatedFetch) {
        window.authClient.authenticatedFetch('/.netlify/functions/commercial-request', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, status: 'done' })
        }).catch(function(){});
      }
      var card2 = document.getElementById('crCard-' + id);
      if (card2) card2.remove();
      if (container && !container.querySelector('.cr-card')) container.style.display = 'none';
    };
    var form = document.getElementById('appointmentForm');
    if (form) form.addEventListener('submit', onSave, { once: true });
  };

  window.crDismiss = function(id) {
    markSeen(id);
    var card = document.getElementById('crCard-' + id);
    if (card) card.remove();
    var container = document.getElementById(BANNER_ID);
    if (container && !container.querySelector('.cr-card')) container.style.display = 'none';
  };

  async function poll() {
    if (!shouldRun()) return;
    var requests = await fetchPendingRequests();
    if (requests.length > 0) renderBanner(requests);
  }

  function start() {
    if (!shouldRun()) return;
    poll();
    setInterval(poll, POLL_INTERVAL);
  }

  // Expor para ser chamado pelo script.js após load()
  window.crStartPolling = start;
  window.addEventListener('portalReady', function() { setTimeout(start, 50); });
  window.addEventListener('portalChanged', poll);

  // Verificar a cada 200ms se portal está pronto (portalConfig existe)
  var _started = false;
  var _t = 0;
  var _iv = setInterval(function() {
    _t += 200;
    if (_started) { clearInterval(_iv); return; }
    var u = window.authClient && window.authClient.getUser && window.authClient.getUser();
    var ready = window.portalConfig || (u && u.role);
    if (u && ready && (u.role === 'coordenador' || u.role === 'admin')) {
      _started = true;
      clearInterval(_iv);
      start();
    }
    if (_t > 20000) clearInterval(_iv);
  }, 200);

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && _started) poll();
  });

})();
