// portal-consult-patch.js - v1
// Parte 2: SM Relacionados / Portais de Consulta
// Incluir no index.html DEPOIS de portal-init.js e script.js

(function() {

  // ============================================================
  // 1. DRAG & DROP — bloquear em modo só-leitura
  // ============================================================
  document.addEventListener('dragstart', function(e) {
    if (window._readOnlyMode) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // ============================================================
  // 2. PATCH buildDesktopCard — badge a piscar para pending_confirmation
  // ============================================================
  function patchCardRenderers() {
    var _origDesktop = window.buildDesktopCard;
    if (_origDesktop && !_origDesktop._patched) {
      window.buildDesktopCard = function(a) {
        var html = _origDesktop(a);
        if (a.pending_confirmation) {
          html = injectPendingBadge(html, a, 'desktop');
        }
        return html;
      };
      window.buildDesktopCard._patched = true;
    }

    var _origMobile = window.buildMobileCard;
    if (_origMobile && !_origMobile._patched) {
      window.buildMobileCard = function(a) {
        var html = _origMobile(a);
        if (a.pending_confirmation) {
          html = injectPendingBadge(html, a, 'mobile');
        }
        return html;
      };
      window.buildMobileCard._patched = true;
    }
  }

  function injectPendingBadge(html, a, type) {
    // Encontrar nome do portal de origem
    var fromPortalName = '';
    if (a.referred_from_portal_id) {
      var fromPortal = (window.coordPortals || []).find(function(p) {
        return p.id === a.referred_from_portal_id;
      });
      fromPortalName = fromPortal ? fromPortal.name : 'outro SM';
    }

    var badge = '<div style="margin:6px 0;padding:5px 10px;background:rgba(234,179,8,0.15);' +
      'border-left:3px solid #eab308;border-radius:5px;font-size:12px;font-weight:700;' +
      'color:#854d0e;animation:blink 1.2s infinite;">' +
      '\uD83D\uDD04 Serviço passa pelo SM' + (fromPortalName ? ' ' + fromPortalName : '') +
      ' \u2014 a confirmar' +
      '<button onclick="rejectPendingConsult(\'' + a.id + '\')" style="margin-left:10px;' +
      'background:#dc2626;color:#fff;border:none;border-radius:4px;padding:2px 7px;' +
      'font-size:11px;cursor:pointer;font-weight:700;">Rejeitar</button>' +
      '</div>';

    // Inserir antes do fecho do card (antes de </div> final)
    return html.replace(/(<div class="card-actions">)/, badge + '$1');
  }

  // Rejeitar sugestão: limpar pending_confirmation e referred_from_portal_id
  window.rejectPendingConsult = async function(id) {
    try {
      await window.authClient.authenticatedFetch(
        '/.netlify/functions/appointments/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pending_confirmation: false,
            referred_from_portal_id: null
          })
        }
      );
      if (typeof window.reloadAppointments === 'function') await window.reloadAppointments();
    } catch(e) {
      console.error('Erro ao rejeitar sugestão:', e);
    }
  };

  // ============================================================
  // 3. HOOK em apiClient.createAppointment — verificar sugestões
  // ============================================================
  function hookCreateAppointment() {
    var orig = window.apiClient.createAppointment.bind(window.apiClient);
    if (orig._patched) return;

    window.apiClient.createAppointment = async function(data) {
      var result = await orig(data);
      // Só verificar sugestões em modo não-readonly, com localidade preenchida
      if (!window._readOnlyMode && data.locality && result && result.id) {
        try {
          await checkCrossSmSuggestions(data, result);
        } catch(e) {
          console.warn('Sugestão cruzada: erro ao verificar', e);
        }
      }
      return result;
    };
    window.apiClient.createAppointment._patched = true;
  }

  // ============================================================
  // 4. LÓGICA DE SUGESTÕES CRUZADAS
  // ============================================================
  async function checkCrossSmSuggestions(payload, createdAppt) {
    var consultable = window.consultablePortals || [];
    if (!consultable.length) return;

    var locality = payload.locality;
    var today = new Date();
    var todayISO = today.toISOString().slice(0, 10);
    var limit = new Date(today); limit.setDate(limit.getDate() + 5);
    var limitISO = limit.toISOString().slice(0, 10);

    var matches = []; // [{portalName, portalId, date, count}]

    for (var i = 0; i < consultable.length; i++) {
      var portal = consultable[i];
      try {
        var resp = await window.authClient.authenticatedFetch(
          '/.netlify/functions/appointments?portal_id=' + portal.id
        );
        var data = await resp.json();
        if (!data.success) continue;
        var appts = data.data || [];
        // Filtrar por localidade + janela de 5 dias (incluindo hoje)
        var inWindow = appts.filter(function(a) {
          return a.locality === locality &&
                 a.date && a.date >= todayISO && a.date <= limitISO;
        });
        if (inWindow.length > 0) {
          // Agrupar por dia
          var byDay = {};
          inWindow.forEach(function(a) {
            byDay[a.date] = (byDay[a.date] || 0) + 1;
          });
          Object.keys(byDay).forEach(function(date) {
            matches.push({
              portalId: portal.id,
              portalName: portal.name,
              date: date,
              count: byDay[date]
            });
          });
        }
      } catch(e) {
        console.warn('Sugestão: erro ao consultar portal ' + portal.name, e);
      }
    }

    if (matches.length > 0) {
      showSuggestionModal(payload, createdAppt, matches);
    }
  }

  // ============================================================
  // 5. MODAL DE SUGESTÃO
  // ============================================================
  function showSuggestionModal(payload, createdAppt, matches) {
    var existing = document.getElementById('consultSuggestionOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'consultSuggestionOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';

    // Agrupar por portal
    var byPortal = {};
    matches.forEach(function(m) {
      if (!byPortal[m.portalId]) byPortal[m.portalId] = { name: m.portalName, days: [] };
      byPortal[m.portalId].days.push({ date: m.date, count: m.count });
    });

    var rows = Object.keys(byPortal).map(function(pid) {
      var p = byPortal[pid];
      var dayList = p.days.map(function(d) {
        var dt = new Date(d.date + 'T00:00:00');
        var label = dt.toLocaleDateString('pt-PT', { weekday:'short', day:'2-digit', month:'2-digit' });
        return label + ' (' + d.count + ' serv.)';
      }).join(', ');
      return '<div style="margin:8px 0;padding:10px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">' +
        '<strong>' + p.name + '</strong><br>' +
        '<span style="font-size:13px;color:#6b7280;">' + dayList + '</span><br>' +
        '<button class="suggest-accept-btn" data-portal="' + pid + '" data-name="' + p.name + '"' +
        ' style="margin-top:8px;background:#2563eb;color:#fff;border:none;border-radius:6px;' +
        'padding:6px 14px;font-weight:700;cursor:pointer;font-size:13px;">' +
        'Aceitar \u2014 passa pelo ' + p.name + '</button>' +
        '</div>';
    }).join('');

    overlay.innerHTML =
      '<div style="background:#fff;border-radius:14px;padding:24px;max-width:460px;width:90%;max-height:80vh;overflow-y:auto;">' +
        '<h3 style="margin:0 0 6px;font-size:17px;">&#x1F4CB; Sugest\u00E3o de encaminhamento</h3>' +
        '<p style="margin:0 0 14px;font-size:14px;color:#374151;">' +
          'O SM abaixo j\u00E1 tem servi\u00E7os em <strong>' + payload.locality + '</strong> nos pr\u00F3ximos 5 dias.' +
          ' Quer que este servi\u00E7o passe pelo SM correspondente?' +
        '</p>' +
        rows +
        '<div style="margin-top:14px;text-align:right;">' +
          '<button id="consultSuggestionClose" style="background:#f3f4f6;color:#374151;border:none;' +
          'border-radius:6px;padding:8px 20px;font-weight:600;cursor:pointer;">Ignorar</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('consultSuggestionClose').addEventListener('click', function() {
      overlay.remove();
    });

    overlay.querySelectorAll('.suggest-accept-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var targetPortalId = parseInt(btn.dataset.portal);
        var targetName = btn.dataset.name;
        btn.disabled = true;
        btn.textContent = 'A enviar...';
        await acceptSuggestion(payload, createdAppt, targetPortalId, targetName);
        overlay.remove();
      });
    });
  }

  // Aceitar sugestão: apagar do portal atual + criar no portal de consulta com pending_confirmation
  async function acceptSuggestion(payload, createdAppt, targetPortalId, targetName) {
    try {
      // 1. Eliminar do portal atual
      await window.authClient.authenticatedFetch(
        '/.netlify/functions/appointments/' + createdAppt.id, { method: 'DELETE' }
      );
      // Remover do array local
      if (Array.isArray(window.appointments)) {
        window.appointments = window.appointments.filter(function(a) {
          return String(a.id) !== String(createdAppt.id);
        });
      }

      // 2. Criar no portal de consulta (backend valida que targetPortalId em consultablePortalIds)
      var newPayload = Object.assign({}, payload, {
        _targetPortalId: targetPortalId,
        pending_confirmation: true,
        referred_from_portal_id: window.activePortalId,
        notes: (payload.notes ? payload.notes + ' | ' : '') +
               'Serv. passa pelo ' + (window.portalConfig && window.portalConfig.name ? window.portalConfig.name : 'SM')
      });
      delete newPayload.id;

      await window.authClient.authenticatedFetch('/.netlify/functions/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPayload)
      });

      if (typeof window.showToast === 'function') {
        window.showToast('Servi\u00E7o enviado para ' + targetName + ' (a confirmar)', 'success');
      }
      if (typeof window.reloadAppointments === 'function') await window.reloadAppointments();
    } catch(e) {
      console.error('Erro ao aceitar sugest\u00E3o:', e);
      if (typeof window.showToast === 'function') {
        window.showToast('Erro ao enviar para ' + targetName, 'error');
      }
    }
  }

  // ============================================================
  // 6. INIT
  // ============================================================
  function init() {
    // Hook imediato — apiClient já existe quando este script carrega
    hookCreateAppointment();
    // Card renderers: buildDesktopCard pode ainda não estar definido
    if (typeof window.buildDesktopCard === 'function') {
      patchCardRenderers();
    } else {
      window.addEventListener('portalReady', patchCardRenderers, { once: true });
      setTimeout(patchCardRenderers, 1500);
    }
    console.log('portal-consult-patch v1 OK');
  }

  // Correr sempre — portalReady pode já ter disparado antes deste script carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
