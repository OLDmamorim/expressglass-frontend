// portal-consult-patch.js - v2
// Parte 2: SM Relacionados / Portais de Consulta
// Incluir no index.html DEPOIS de portal-init.js e script.js

(function() {

  // ============================================================
  // 1. DRAG & DROP — bloquear em modo so-leitura
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
      '<button onclick="event.stopPropagation();window.rejectPendingConsult(\'' + a.id + '\')" style="margin-left:10px;' +
      'background:#dc2626;color:#fff;border:none;border-radius:4px;padding:2px 7px;' +
      'font-size:11px;cursor:pointer;font-weight:700;">Rejeitar</button>' +
      '</div>';
    return html.replace(/(<div class="card-actions">)/, badge + '$1');
  }

  window.rejectPendingConsult = function(id) {
    // Encontrar o agendamento nos dados locais
    var appt = (window.appointments || []).find(function(a) { return String(a.id) === String(id); });

    // Modal de rejeição
    var existing = document.getElementById('rejectConsultOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'rejectConsultOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';

    var fromPortal = appt && appt.referred_from_portal_id
      ? (window.coordPortals || []).find(function(p) { return p.id === appt.referred_from_portal_id; })
      : null;
    var fromName = fromPortal ? fromPortal.name : 'SM de origem';

    overlay.innerHTML =
      '<div style="background:#fff;border-radius:14px;padding:24px;max-width:420px;width:90%;">' +
        '<h3 style="margin:0 0 10px;font-size:16px;color:#dc2626;">❌ Rejeitar encaminhamento</h3>' +
        '<p style="margin:0 0 12px;font-size:14px;color:#374151;">O serviço volta para <strong>' + fromName + '</strong>.<br>Indica o motivo da rejeição:</p>' +
        '<textarea id="rejectMotivo" rows="3" style="width:100%;border:1.5px solid #e5e7eb;border-radius:8px;' +
          'padding:8px;font-size:14px;resize:vertical;box-sizing:border-box;" ' +
          'placeholder="Ex: Sem disponibilidade nesse dia, viatura precisa de equipamento especial..."></textarea>' +
        '<div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end;">' +
          '<button id="rejectCancelBtn" style="background:#f3f4f6;color:#374151;border:none;border-radius:6px;' +
            'padding:8px 18px;font-weight:600;cursor:pointer;">Cancelar</button>' +
          '<button id="rejectConfirmBtn" style="background:#dc2626;color:#fff;border:none;border-radius:6px;' +
            'padding:8px 18px;font-weight:700;cursor:pointer;">Rejeitar e devolver</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('rejectCancelBtn').addEventListener('click', function() { overlay.remove(); });

    document.getElementById('rejectConfirmBtn').addEventListener('click', async function() {
      var motivo = document.getElementById('rejectMotivo').value.trim();
      if (!motivo) {
        document.getElementById('rejectMotivo').style.border = '1.5px solid #dc2626';
        return;
      }
      var btn = document.getElementById('rejectConfirmBtn');
      btn.disabled = true; btn.textContent = 'A processar...';

      try {
        // 1. Obter dados atuais do agendamento
        var apptData = appt || {};

        // 2. Eliminar deste portal
        await window.authClient.authenticatedFetch(
          '/.netlify/functions/appointments/' + id + '?portal_id=' + window.activePortalId,
          { method: 'DELETE' }
        );

        // 3. Recriar no portal de origem com motivo
        if (fromPortal) {
          var newNotes = (apptData.notes ? apptData.notes + ' | ' : '') +
            'Rejeitado por ' + (window.portalConfig && window.portalConfig.name ? window.portalConfig.name : 'SM') +
            ': ' + motivo;
          var payload = Object.assign({}, apptData, {
            _targetPortalId: fromPortal.id,
            pending_confirmation: false,
            referred_from_portal_id: null,
            notes: newNotes
          });
          delete payload.id;
          delete payload.created_at;
          delete payload.updated_at;
          await window.authClient.authenticatedFetch('/.netlify/functions/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }

        overlay.remove();
        if (typeof window.showToast === 'function') window.showToast('Serviço devolvido a ' + fromName, 'success');
        if (typeof window.reloadAppointments === 'function') await window.reloadAppointments();
      } catch(e) {
        console.error('rejectPendingConsult:', e);
        if (typeof window.showToast === 'function') window.showToast('Erro ao rejeitar', 'error');
        btn.disabled = false; btn.textContent = 'Rejeitar e devolver';
      }
    });
  };

  // ============================================================
  // 3. POLLING — verifica localidade enquanto modal esta aberto
  // ============================================================
  var _pollTimer = null;
  var _lastChecked = '';

  function startPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    removeConsultInfo();
    // Aguardar 1s para o form resetar antes de começar a verificar
    _lastChecked = '__init__';
    setTimeout(function() {
      _lastChecked = '';
      _pollTimer = setInterval(function() {
        var loc = (document.getElementById('appointmentLocality') || {}).value || '';
        if (loc === _lastChecked) return;
        _lastChecked = loc;
        if (loc) injectConsultInfo(loc);
        else removeConsultInfo();
      }, 500);
    }, 1000);
  }

  function stopPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    removeConsultInfo();
    _lastChecked = '';
  }

  function watchModal() {
    // Ligar ao clique nos botoes que abrem o modal
    var btnIds = ['addServiceBtn','addServiceMobile','addServiceBtnDesktop'];
    function onOpen() { setTimeout(startPoll, 200); }
    btnIds.forEach(function(id) {
      var btn = document.getElementById(id);
      if (btn && !btn._consultBound) { btn.addEventListener('click', onOpen); btn._consultBound = true; }
    });
    // Delegacao global para apanhar botoes dinamicos
    if (!document._consultOpenBound) {
      document.addEventListener('click', function(e) {
        var t = e.target;
        if (!t) return;
        var id = t.id || (t.closest && t.closest('[id]') && t.closest('[id]').id) || '';
        if (/addService/i.test(id)) onOpen();
      });
      document._consultOpenBound = true;
    }
    // Fechar modal para o poll
    document.addEventListener('click', function(e) {
      var closeBtn = e.target && (
        e.target.classList.contains('modal-close') ||
        e.target.closest && e.target.closest('.modal-close')
      );
      var backdrop = e.target && e.target.id === 'appointmentModal';
      if (closeBtn || backdrop) stopPoll();
    });
    // MutationObserver como fallback
    var modal = document.getElementById('appointmentModal');
    if (modal) {
      new MutationObserver(function() {
        if (modal.classList.contains('show')) startPoll();
        else stopPoll();
      }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function patchSelectLocality() { watchModal(); }

  async function injectConsultInfo(locality) {
    var consultable = window.consultablePortals || [];
    if (!consultable.length || window._readOnlyMode) return;

    var todayISO = new Date().toISOString().slice(0, 10);
    var limit = new Date(); limit.setDate(limit.getDate() + 5);
    var limitISO = limit.toISOString().slice(0, 10);

    var matches = [];
    for (var i = 0; i < consultable.length; i++) {
      var portal = consultable[i];
      try {
        var resp = await window.authClient.authenticatedFetch(
          '/.netlify/functions/appointments?portal_id=' + portal.id
        );
        var data = await resp.json();
        if (!data.success) continue;
        var inWindow = (data.data || []).filter(function(a) {
          var d = a.date ? String(a.date).slice(0,10) : '';
          return a.locality === locality && d >= todayISO && d <= limitISO;
        });
        inWindow.forEach(function(a) {
          var existing = matches.find(function(m) { return m.portalId === portal.id && m.date === String(a.date).slice(0,10); });
          if (existing) existing.count++;
          else matches.push({ portalId: portal.id, portalName: portal.name, date: String(a.date).slice(0,10), count: 1 });
        });
      } catch(e) {}
    }

    removeConsultInfo();
    if (!matches.length) return;

    var byPortal = {};
    matches.forEach(function(m) {
      if (!byPortal[m.portalId]) byPortal[m.portalId] = { name: m.portalName, id: m.portalId, days: [] };
      var raw = m.date ? String(m.date).slice(0,10) : '';
      var dt = raw && raw.length === 10 ? new Date(raw + 'T00:00:00') : null;
      var label = dt ? dt.toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' }) : m.date;
      if (dt) byPortal[m.portalId].days.push(label + ' (' + m.count + ')');
    });

    var div = document.createElement('div');
    div.id = 'crConsultInfo';
    div.style.cssText = 'background:#f0fdf4;border:1.5px solid #16a34a;border-radius:10px;' +
      'padding:10px 14px;margin:6px 0;font-size:13px;';

    var rows = Object.values(byPortal).map(function(p) {
      return '<div style="margin:4px 0;">' +
        '<span style="font-weight:700;color:#15803d;">' + p.name + '</span>' +
        ' \u2014 ' + p.days.join(', ') +
        '<button class="cr-send-btn" data-portal="' + p.id + '" data-name="' + p.name + '"' +
        ' style="margin-left:10px;background:#16a34a;color:#fff;border:none;border-radius:6px;' +
        'padding:3px 10px;font-size:12px;font-weight:700;cursor:pointer;">' +
        'Encaminhar \u2192</button></div>';
    }).join('');

    div.innerHTML = '<div style="font-weight:700;color:#15803d;margin-bottom:4px;">' +
      '\uD83D\uDCCC ' + locality + ' \u2014 SM com servi\u00E7os nos pr\u00F3ximos 5 dias:</div>' + rows;

    // Inserir a seguir ao #crDateSuggestion se existir, senao no topo do form
    var anchor = document.getElementById('crDateSuggestion');
    var form = document.getElementById('appointmentForm');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(div, anchor.nextSibling);
    } else if (form) {
      form.insertBefore(div, form.firstChild);
    }

    div.querySelectorAll('.cr-send-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var portalId = parseInt(btn.dataset.portal);
        var portalName = btn.dataset.name;
        window._pendingConsultTransfer = { portalId: portalId, portalName: portalName };
        if (typeof window.showToast === 'function') {
          window.showToast('Ao guardar, o servico sera encaminhado para ' + portalName, 'info');
        }
        btn.textContent = '\u2713 Selecionado';
        btn.style.background = '#15803d';
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
      // Capturar ANTES de orig() — o modal fecha durante a chamada e limpa _pendingConsultTransfer
      var transfer = window._pendingConsultTransfer || null;
      window._pendingConsultTransfer = null;
      var result = await orig(data);
      if (result && result.id && transfer) {
        try { await doTransfer(data, result, transfer.portalId, transfer.portalName); } catch(e) { console.error('transfer:', e); }
      }
      return result;
    };
    window.apiClient.createAppointment._consultPatched = true;
  }

  async function doTransfer(payload, createdAppt, targetPortalId, targetName) {
    await window.authClient.authenticatedFetch('/.netlify/functions/appointments/' + createdAppt.id + '?portal_id=' + window.activePortalId, { method: 'DELETE' });
    if (Array.isArray(window.appointments)) {
      window.appointments = window.appointments.filter(function(a) { return String(a.id) !== String(createdAppt.id); });
    }
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
    if (typeof window.showToast === 'function') window.showToast('Servico encaminhado para ' + targetName, 'success');
    if (typeof window.reloadAppointments === 'function') await window.reloadAppointments();
  }

  // ============================================================
  // 5. INIT
  // ============================================================
  function init() {
    hookCreateAppointment();
    patchCardRenderers();
    patchSelectLocality();
    var modal = document.getElementById('appointmentModal');
    if (modal) {
      new MutationObserver(function() {
        var isOpen = modal.classList.contains('show') || modal.style.display === 'flex' || modal.style.display === 'block';
        if (!isOpen) removeConsultInfo();
      }).observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    // Expor globalmente para debug e watcher permanente de modal
  window._consultStartPoll = startPoll;
  window._consultStopPoll = stopPoll;

  // Watcher permanente: verifica estado do modal a cada 1s
  setInterval(function() {
    var modal = document.getElementById('appointmentModal');
    if (!modal) return;
    if (modal.classList.contains('show')) {
      startPoll();
    } else {
      stopPoll();
    }
  }, 1000);

  console.log('portal-consult-patch v2 OK');
  }

  hookCreateAppointment();
  patchCardRenderers();
  watchModal();

  // Modal observer
  (function() {
    var modal = document.getElementById('appointmentModal');
    if (modal) {
      new MutationObserver(function() {
        var isOpen = modal.classList.contains('show') || modal.style.display === 'flex' || modal.style.display === 'block';
        if (!isOpen) removeConsultInfo();
      }).observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
    }
  })();

  console.log('portal-consult-patch v2 OK');

})();
