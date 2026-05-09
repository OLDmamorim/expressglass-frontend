// portal-consult-patch.js - v2
// Parte 2: SM Relacionados / Portais de Consulta
// Incluir no index.html DEPOIS de portal-init.js e script.js

(function() {

  // ============================================================
  // 1. DRAG & DROP — bloquear em modo só-leitura
  // ============================================================
  document.addEventListener('dragstart', function(e) {
    if (window._readOnlyMode) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ============================================================
  // 2. PATCH buildDesktopCard — badge a piscar para pending_confirmation
  // ============================================================
  function patchCardRenderers() {
    var _origDesktop = window.buildDesktopCard;
    if (_origDesktop && !_origDesktop._consultPatched) {
      window.buildDesktopCard = function(a) {
        var html = _origDesktop(a);
        if (a.pending_confirmation) html = injectPendingBadge(html, a);
        return html;
      };
      window.buildDesktopCard._consultPatched = true;
    }
    var _origMobile = window.buildMobileCard;
    if (_origMobile && !_origMobile._consultPatched) {
      window.buildMobileCard = function(a) {
        var html = _origMobile(a);
        if (a.pending_confirmation) html = injectPendingBadge(html, a);
        return html;
      };
      window.buildMobileCard._consultPatched = true;
    }
  }

  function injectPendingBadge(html, a) {
    var fromPortal = (window.coordPortals || []).find(function(p) { return p.id === a.referred_from_portal_id; });
    var fromName = fromPortal ? fromPortal.name : 'outro SM';
    var badge = '<div style="margin:6px 0;padding:5px 10px;background:rgba(234,179,8,0.15);' +
      'border-left:3px solid #eab308;border-radius:5px;font-size:12px;font-weight:700;' +
      'color:#854d0e;animation:blink 1.2s infinite;">' +
      '\uD83D\uDD04 Passa pelo SM ' + fromName + ' \u2014 a confirmar' +
      '<button onclick="window.rejectPendingConsult(\'' + a.id + '\')" style="margin-left:10px;' +
      'background:#dc2626;color:#fff;border:none;border-radius:4px;padding:2px 7px;' +
      'font-size:11px;cursor:pointer;font-weight:700;">Rejeitar</button>' +
      '</div>';
    return html.replace(/(<div class="card-actions">)/, badge + '$1');
  }

  window.rejectPendingConsult = async function(id) {
    try {
      await window.authClient.authenticatedFetch('/.netlify/functions/appointments/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_confirmation: false, referred_from_portal_id: null })
      });
      if (typeof window.reloadAppointments === 'function') await window.reloadAppointments();
    } catch(e) { console.error('rejectPendingConsult:', e); }
  };

  // ============================================================
  // 3. INTERCEPTAR selectLocality — injetar info SM de consulta
  //    no bloco #crDateSuggestion que o script.js já cria
  // ============================================================
  function patchSelectLocality() {
    if (!window.selectLocality || window.selectLocality._consultPatched) return;
    var orig = window.selectLocality;
    window.selectLocality = function(value) {
      orig(value);
      if (value) setTimeout(function() { injectConsultInfo(value); }, 150);
      else removeConsultInfo();
    };
    window.selectLocality._consultPatched = true;
  }

  async function injectConsultInfo(locality) {
    var consultable = window.consultablePortals || [];
    if (!consultable.length || window._readOnlyMode) return;

    var todayISO = new Date().toISOString().slice(0, 10);
    var limit = new Date(); limit.setDate(limit.getDate() + 5);
    var limitISO = limit.toISOString().slice(0, 10);

    var matches = []; // [{portalId, portalName, date, count}]

    for (var i = 0; i < consultable.length; i++) {
      var portal = consultable[i];
      try {
        var resp = await window.authClient.authenticatedFetch(
          '/.netlify/functions/appointments?portal_id=' + portal.id
        );
        var data = await resp.json();
        if (!data.success) continue;
        var inWindow = (data.data || []).filter(function(a) {
          return a.locality === locality && a.date >= todayISO && a.date <= limitISO;
        });
        inWindow.forEach(function(a) {
          var existing = matches.find(function(m) { return m.portalId === portal.id && m.date === a.date; });
          if (existing) existing.count++;
          else matches.push({ portalId: portal.id, portalName: portal.name, date: a.date, count: 1 });
        });
      } catch(e) {}
    }

    if (!matches.length) { removeConsultInfo(); return; }

    // Agrupar por portal
    var byPortal = {};
    matches.forEach(function(m) {
      if (!byPortal[m.portalId]) byPortal[m.portalId] = { name: m.portalName, id: m.portalId, days: [] };
      var dt = new Date(m.date + 'T00:00:00');
      var label = dt.toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' });
      byPortal[m.portalId].days.push(label + ' (' + m.count + ')');
    });

    removeConsultInfo();

    // Injetar dentro ou a seguir ao #crDateSuggestion
    var anchor = document.getElementById('crDateSuggestion');
    var form = document.getElementById('appointmentForm');
    var insertAfter = anchor || null;

    var div = document.createElement('div');
    div.id = 'crConsultInfo';
    div.style.cssText = 'background:#f0fdf4;border:1.5px solid #16a34a;border-radius:10px;' +
      'padding:10px 14px;margin:6px 0;font-size:13px;';

    var rows = Object.values(byPortal).map(function(p) {
      return '<div style="margin:4px 0;">' +
        '<span style="font-weight:700;color:#15803d;">' + p.name + '</span>' +
        ' &mdash; ' + p.days.join(', ') +
        '<button class="cr-send-btn" data-portal="' + p.id + '" data-name="' + p.name + '"' +
        ' style="margin-left:10px;background:#16a34a;color:#fff;border:none;border-radius:6px;' +
        'padding:3px 10px;font-size:12px;font-weight:700;cursor:pointer;">' +
        'Encaminhar \u2192</button>' +
        '</div>';
    }).join('');

    div.innerHTML = '<div style="font-weight:700;color:#15803d;margin-bottom:4px;">' +
      '\uD83D\uDCCC ' + locality + ' — SM com servi\u00E7os nos pr\u00F3ximos 5 dias:</div>' + rows;

    if (insertAfter && insertAfter.parentNode) {
      insertAfter.parentNode.insertBefore(div, insertAfter.nextSibling);
    } else if (form) {
      form.insertBefore(div, form.firstChild);
    }

    // Botões de encaminhar
    div.querySelectorAll('.cr-send-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var portalId = parseInt(btn.dataset.portal);
        var portalName = btn.dataset.name;
        window._pendingConsultTransfer = { portalId: portalId, portalName: portalName };
        if (typeof window.showToast === 'function') {
          window.showToast('Ao guardar, o servi\u00E7o ser\u00E1 encaminhado para ' + portalName, 'info');
        }
        btn.style.background = '#15803d';
        btn.textContent = '\u2713 Selecionado';
        div.querySelectorAll('.cr-send-btn').forEach(function(b) { if (b !== btn) b.style.display = 'none'; });
      });
    });
  }

  function removeConsultInfo() {
    var el = document.getElementById('crConsultInfo');
    if (el) el.remove();
    window._pendingConsultTransfer = null;
  }

  // ============================================================
  // 4. HOOK createAppointment — executar encaminhamento se selecionado
  // ============================================================
  function hookCreateAppointment() {
    if (window.apiClient.createAppointment._consultPatched) return;
    var orig = window.apiClient.createAppointment.bind(window.apiClient);
    window.apiClient.createAppointment = async function(data) {
      var result = await orig(data);
      if (result && result.id && window._pendingConsultTransfer) {
        var transfer = window._pendingConsultTransfer;
        window._pendingConsultTransfer = null;
        removeConsultInfo();
        try { await doTransfer(data, result, transfer.portalId, transfer.portalName); } catch(e) { console.error('transfer:', e); }
      }
      return result;
    };
    window.apiClient.createAppointment._consultPatched = true;
  }

  async function doTransfer(payload, createdAppt, targetPortalId, targetName) {
    // Eliminar do portal atual
    await window.authClient.authenticatedFetch('/.netlify/functions/appointments/' + createdAppt.id, { method: 'DELETE' });
    if (Array.isArray(window.appointments)) {
      window.appointments = window.appointments.filter(function(a) { return String(a.id) !== String(createdAppt.id); });
    }
    // Criar no portal de consulta com pending_confirmation
    var newPayload = Object.assign({}, payload, {
      _targetPortalId: targetPortalId,
      pending_confirmation: true,
      referred_from_portal_id: window.activePortalId,
      notes: (payload.notes ? payload.notes + ' | ' : '') + 'Encaminhado de ' + (window.portalConfig && window.portalConfig.name ? window.portalConfig.name : 'SM')
    });
    delete newPayload.id;
    await window.authClient.authenticatedFetch('/.netlify/functions/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPayload)
    });
    if (typeof window.showToast === 'function') window.showToast('Servi\u00E7o encaminhado para ' + targetName, 'success');
    if (typeof window.reloadAppointments === 'function') await window.reloadAppointments();
  }

  // ============================================================
  // 5. INIT
  // ============================================================
  function init() {
    hookCreateAppointment();
    patchCardRenderers();
    patchSelectLocality();
    // Limpar estado ao fechar modal
    var modal = document.getElementById('appointmentModal');
    if (modal) {
      new MutationObserver(function() {
        var isOpen = modal.classList.contains('show') || modal.style.display === 'flex' || modal.style.display === 'block';
        if (!isOpen) removeConsultInfo();
      }).observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    console.log('portal-consult-patch v2 OK');
  }

  // selectLocality é definido tarde no script.js — aguardar portalReady ou usar retry
  function tryInit() {
    if (window.selectLocality) { init(); }
    else { setTimeout(tryInit, 200); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }

})();
