// encomenda-btn.js - v1
// Botão "📦 Encomenda" no topo da agenda: abre o Portal da Loja do PoweringEG
// em Frisos e consumíveis → Consumíveis, para encomendar consumíveis.
//
// O portal aberto é o da loja PRINCIPAL do serviço: a agenda da SM Braga abre
// o portal de Braga, a da SM Famalicão o de Famalicão (Relações de lojas no
// PoweringEG), já com a SM escolhida como a loja que encomenda. A resolução é
// feita pelo proxy powering-kpis (action=portal-link&menu=encomenda) a partir
// do portal ativo (powering_loja_id), como o botão da Frota (frota-fab.js).

(function () {
  var BTN_ID = 'encomendaBtn';

  // ---- puro (testado em tests/encomenda-btn.test.js) ----
  function urlDoPedido(portalId) {
    return '/.netlify/functions/powering-kpis?action=portal-link&menu=encomenda&portal_id=' + encodeURIComponent(portalId);
  }

  // O que fazer com a resposta: guardar o link, desistir de vez, ou tentar outra vez.
  function interpretar(resposta, tentativas) {
    if (resposta && resposta.success && resposta.url) return { estado: 'ok', url: resposta.url, lojaNome: resposta.lojaNome || '' };
    if (resposta && resposta.reason === 'sem_portal') return { estado: 'sem_portal' };
    return tentativas + 1 >= 5 ? { estado: 'sem_portal' } : { estado: 'repetir' };
  }

  var api = { urlDoPedido: urlDoPedido, interpretar: interpretar };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ---- browser ----
  var _cache = {};      // { portalId: {url, lojaNome} | false }
  var _resolving = {};
  var _attempts = {};

  function getActivePortalId() {
    var sel = document.getElementById('portalSwitcherSelect');
    if (sel && sel.value) return sel.value;
    if (window.portalConfig && window.portalConfig.id) return window.portalConfig.id;
    return window.currentPortalId
      || (window.authClient && window.authClient.getUser && window.authClient.getUser() && window.authClient.getUser().portal_id)
      || null;
  }

  function ensureStyle() {
    if (document.getElementById('encomendaBtnStyle')) return;
    var st = document.createElement('style');
    st.id = 'encomendaBtnStyle';
    st.textContent =
      '#' + BTN_ID + '{background:linear-gradient(135deg,#e11d48,#be123c)!important;color:#fff!important;font-weight:700;' +
      'padding:6px 12px;border:0;border-radius:8px;font-size:.82rem;box-shadow:0 5px 14px rgba(225,29,72,.25);cursor:pointer;white-space:nowrap}' +
      '@media (max-width:600px){#' + BTN_ID + ' .enc-label{display:none}#' + BTN_ID + '{padding:7px 9px;font-size:15px}}';
    document.head.appendChild(st);
  }

  function ensureButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    var actions = document.querySelector('.page-header .header-actions');
    if (!actions) return null;
    ensureStyle();
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'header-btn';
    btn.style.display = 'none';
    btn.title = 'Encomendar consumíveis (Portal da Loja)';
    btn.setAttribute('aria-label', 'Encomenda de consumíveis');
    btn.innerHTML = '📦 <span class="enc-label">Encomenda</span>';
    btn.addEventListener('click', function () {
      var pid = getActivePortalId();
      var link = pid && _cache[pid];
      if (link && link.url) window.open(link.url, '_blank');
    });
    var antes = document.getElementById('glassAlertBtn');
    if (antes && antes.parentNode === actions) actions.insertBefore(btn, antes);
    else actions.appendChild(btn);
    return btn;
  }

  function updateVisibility() {
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;
    var pid = getActivePortalId();
    var link = pid && _cache[pid];
    btn.style.display = link && link.url ? '' : 'none';
    if (link && link.lojaNome) btn.title = 'Encomendar consumíveis — Portal da Loja ' + link.lojaNome;
  }

  async function resolve(portalId) {
    if (!portalId || _cache.hasOwnProperty(portalId) || _resolving[portalId]) return;
    if (!(window.authClient && window.authClient.getUser && window.authClient.getUser())) return;
    _resolving[portalId] = true;
    try {
      var r = await window.authClient.authenticatedFetch(urlDoPedido(portalId));
      var d = await r.json();
      var res = interpretar(d, _attempts[portalId] || 0);
      if (res.estado === 'ok') _cache[portalId] = { url: res.url, lojaNome: res.lojaNome };
      else if (res.estado === 'sem_portal') _cache[portalId] = false;
      else _attempts[portalId] = (_attempts[portalId] || 0) + 1;
    } catch (e) {
      var res2 = interpretar(null, _attempts[portalId] || 0);
      if (res2.estado === 'sem_portal') _cache[portalId] = false;
      else _attempts[portalId] = (_attempts[portalId] || 0) + 1;
    } finally {
      delete _resolving[portalId];
      updateVisibility();
    }
  }

  function tick() {
    ensureButton();
    var pid = getActivePortalId();
    if (pid) resolve(pid);
    updateVisibility();
  }

  function start() {
    tick();
    setInterval(function () {
      var s = document.getElementById('portalSwitcherSelect');
      if (s && !s._encomendaHooked) {
        s.addEventListener('change', function () { setTimeout(tick, 200); });
        s._encomendaHooked = true;
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
