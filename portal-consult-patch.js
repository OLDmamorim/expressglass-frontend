// portal-consult-patch.js - v4

(function() {

  // ── 1. DRAG & DROP bloqueado em modo só-leitura ──────────────
  document.addEventListener('dragstart', function(e) {
    if (window._readOnlyMode) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ── 2. BADGE nos cards com pending_confirmation ──────────────
  function patchCardRenderers() {
    ['buildDesktopCard','buildMobileCard'].forEach(function(name) {
      var orig = window[name];
      if (!orig || orig._cp) return;
      window[name] = function(a) {
        var html = orig(a);
        if (a.pending_confirmation) html = injectBadge(html, a);
        return html;
      };
      window[name]._cp = true;
    });
  }

  function injectBadge(html, a) {
    var fromPortal = (window.coordPortals || []).find(function(p) { return p.id === a.referred_from_portal_id; });
    var fromName = fromPortal ? fromPortal.name : 'SM origem';
    var badge =
      '<div style="margin:6px 0;padding:5px 10px;background:rgba(234,179,8,0.15);' +
      'border-left:3px solid #eab308;border-radius:5px;font-size:12px;font-weight:700;color:#854d0e;">' +
      '\uD83D\uDD04 Passa pelo SM ' + fromName + ' \u2014 a confirmar ' +
      '<button onclick="event.stopPropagation();window.rejectPendingConsult(\'' + a.id + '\')" ' +
      'style="margin-left:8px;background:#dc2626;color:#fff;border:none;border-radius:4px;' +
      'padding:2px 8px;font-size:11px;cursor:pointer;font-weight:700;">Rejeitar</button>' +
      '</div>';
    // tentar inserir antes de card-actions, senao no fim
    var replaced = html.replace(/(<div[^>]*class="[^"]*card-actions[^"]*">)/, badge + '$1');
    return replaced !== html ? replaced : html + badge;
  }

  // ── 3. MODAL DE REJEIÇÃO ─────────────────────────────────────
  window.rejectPendingConsult = function(id) {
    var appt = (window.appointments || []).find(function(a) { return String(a.id) === String(id); });
    var fromPortal = appt && appt.referred_from_portal_id
      ? (window.coordPortals || []).find(function(p) { return p.id === appt.referred_from_portal_id; })
      : null;
    var fromName = fromPortal ? fromPortal.name : 'SM de origem';

    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
    ov.innerHTML =
      '<div style="background:#fff;border-radius:14px;padding:24px;max-width:420px;width:90%;">' +
      '<h3 style="margin:0 0 10px;font-size:16px;color:#dc2626;">\u274C Rejeitar encaminhamento</h3>' +
      '<p style="margin:0 0 12px;font-size:14px;color:#374151;">O servi\u00E7o volta para <strong>' + fromName + '</strong>.<br>Indica o motivo:</p>' +
      '<textarea id="_rejectMotivo" rows="3" style="width:100%;border:1.5px solid #e5e7eb;border-radius:8px;padding:8px;font-size:14px;resize:vertical;box-sizing:border-box;" placeholder="Ex: Sem disponibilidade nesse dia..."></textarea>' +
      '<div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end;">' +
      '<button id="_rejectCancel" style="background:#f3f4f6;color:#374151;border:none;border-radius:6px;padding:8px 18px;font-weight:600;cursor:pointer;">Cancelar</button>' +
      '<button id="_rejectConfirm" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:8px 18px;font-weight:700;cursor:pointer;">Rejeitar e devolver</button>' +
      '</div></div>';
    document.body.appendChild(ov);

    ov.querySelector('#_rejectCancel').onclick = function() { ov.remove(); };
    ov.querySelector('#_rejectConfirm').onclick = async function() {
      var motivo = ov.querySelector('#_rejectMotivo').value.trim();
      if (!motivo) { ov.querySelector('#_rejectMotivo').style.border = '1.5px solid #dc2626'; return; }
      var btn = ov.querySelector('#_rejectConfirm');
      btn.disabled = true; btn.textContent = 'A processar...';
      try {
        await window.authClient.authenticatedFetch(
          '/.netlify/functions/appointments/' + id + '?portal_id=' + window.activePortalId,
          { method: 'DELETE' }
        );
        if (fromPortal && appt) {
          var payload = Object.assign({}, appt, {
            _targetPortalId: fromPortal.id,
            pending_confirmation: false,
            referred_from_portal_id: null,
            notes: (appt.notes ? appt.notes + ' | ' : '') + 'Rejeitado por ' + ((window.portalConfig && window.portalConfig.name) || 'SM') + ': ' + motivo
          });
          ['id','created_at','updated_at'].forEach(function(k) { delete payload[k]; });
          await window.authClient.authenticatedFetch('/.netlify/functions/appointments', {
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
          });
        }
        ov.remove();
        if (typeof window.showToast === 'function') window.showToast('Servi\u00E7o devolvido a ' + fromName, 'success');
        if (typeof window.reloadAppointments === 'function') await window.reloadAppointments();
      } catch(e) {
        console.error('rejectPendingConsult:', e);
        btn.disabled = false; btn.textContent = 'Rejeitar e devolver';
      }
    };
  };

  // ── 4. POLL — bloco verde no modal ───────────────────────────
  var _pollTimer = null;
  var _lastChecked = '';
  var _modalWasOpen = false;
  var _userOpenedDropdown = false;

  function getActiveLocality() {
    // selectedLocalityText e sempre corretamente resetado pelo script.js
    // appointmentLocality (hidden) pode ter valor antigo — usar o display como fonte de verdade
    var displayEl = document.getElementById('selectedLocalityText');
    var placeholder = 'Selecione a localidade';
    if (!displayEl || !displayEl.textContent.trim() || displayEl.textContent.trim() === placeholder) {
      return ''; // nada selecionado
    }
    // Display tem valor real — confirmar com o hidden
    return (document.getElementById('appointmentLocality') || {}).value || displayEl.textContent.trim();
  }

  function startPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    removeConsultInfo();
    _lastChecked = getActiveLocality(); // '' se display mostra placeholder
    _userOpenedDropdown = false;

    _pollTimer = setInterval(function() {
      var loc = getActiveLocality();
      if (loc === _lastChecked) return;
      _lastChecked = loc;
      if (loc) injectConsultInfo(loc);
      else removeConsultInfo();
    }, 400);
  }

  function stopPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    removeConsultInfo();
    _lastChecked = '';
  }

  // Watcher de modal — verifica transições a cada 300ms
  setInterval(function() {
    var modal = document.getElementById('appointmentModal');
    var isOpen = !!(modal && modal.classList.contains('show'));
    if (isOpen && !_modalWasOpen) { _modalWasOpen = true; startPoll(); }
    else if (!isOpen && _modalWasOpen) { _modalWasOpen = false; stopPoll(); }
  }, 300);

  // ── Comparação fuzzy de localidade (ignora acentos, maiúsculas, palavras curtas em comum) ──
  function localityMatch(a, b) {
    if (!a || !b) return false;
    var norm = function(s) {
      return s.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
        .replace(/[^a-z0-9\s]/g, '').trim();
    };
    var na = norm(a), nb = norm(b);
    if (na === nb) return true;
    // match parcial: "famalicao" ∈ "vila nova de famalicao" ou vice-versa
    if (na.length >= 4 && nb.includes(na)) return true;
    if (nb.length >= 4 && na.includes(nb)) return true;
    return false;
  }

  // ── 5. BLOCO VERDE ───────────────────────────────────────────
  async function injectConsultInfo(locality) {
    var consultable = window.consultablePortals || [];
    console.log('[consult] locality:', locality, '| consultable portals:', consultable.map(function(p){return p.name;}));
    if (!consultable.length || window._readOnlyMode) return;

    var todayISO = new Date().toISOString().slice(0, 10);
    var limit = new Date(); limit.setDate(limit.getDate() + 5);
    var limitISO = limit.toISOString().slice(0, 10);

    var matches = [];
    for (var i = 0; i < consultable.length; i++) {
      var portal = consultable[i];
      try {
        var resp = await window.authClient.authenticatedFetch('/.netlify/functions/appointments?portal_id=' + portal.id);
        var data = await resp.json();
        if (!data.success) continue;
        (data.data || []).forEach(function(a) {
          var d = a.date ? String(a.date).slice(0, 10) : '';
          if (!localityMatch(a.locality, locality) || d < todayISO || d > limitISO) return;
          var ex = matches.find(function(m) { return m.portalId === portal.id && m.date === d; });
          if (ex) ex.count++;
          else matches.push({ portalId: portal.id, portalName: portal.name, date: d, count: 1 });
        });
      } catch(e) { console.warn('[consult] erro portal', portal.name, e); }
    }

    removeConsultInfo();
    if (!matches.length) return;

    var byPortal = {};
    matches.forEach(function(m) {
      if (!byPortal[m.portalId]) byPortal[m.portalId] = { name: m.portalName, id: m.portalId, days: [] };
      var dt = new Date(m.date + 'T00:00:00');
      var label = dt.toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' });
      byPortal[m.portalId].days.push(label + ' (' + m.count + ')');
    });

    var div = document.createElement('div');
    div.id = 'crConsultInfo';
    div.style.cssText = 'background:#f0fdf4;border:1.5px solid #16a34a;border-radius:10px;padding:10px 14px;margin:6px 0;font-size:13px;';
    var rows = Object.values(byPortal).map(function(p) {
      return '<div style="margin:4px 0;"><span style="font-weight:700;color:#15803d;">' + p.name + '</span> \u2014 ' + p.days.join(', ') +
        '<button class="cr-send-btn" data-portal="' + p.id + '" data-name="' + p.name + '" ' +
        'style="margin-left:10px;background:#16a34a;color:#fff;border:none;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:700;cursor:pointer;">' +
        'Encaminhar \u2192</button></div>';
    }).join('');
    div.innerHTML = '<div style="font-weight:700;color:#15803d;margin-bottom:4px;">\uD83D\uDCCC ' + locality + ' \u2014 SM com servi\u00E7os nos pr\u00F3ximos 5 dias:</div>' + rows;

    var anchor = document.getElementById('crDateSuggestion');
    var form = document.getElementById('appointmentForm') || document.querySelector('.modal-body');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(div, anchor.nextSibling);
    else if (form) form.insertBefore(div, form.firstChild);

    div.querySelectorAll('.cr-send-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        window._pendingConsultTransfer = { portalId: parseInt(btn.dataset.portal), portalName: btn.dataset.name };
        if (typeof window.showToast === 'function') window.showToast('Ao guardar, encaminhado para ' + btn.dataset.name, 'info');
        btn.textContent = '\u2713 Selecionado'; btn.style.background = '#15803d';
        div.querySelectorAll('.cr-send-btn').forEach(function(b) { if (b !== btn) b.style.display = 'none'; });
      });
    });
  }

  function removeConsultInfo() {
    var el = document.getElementById('crConsultInfo');
    if (el) el.remove();
    window._pendingConsultTransfer = null;
  }

  // ── 6. HOOK createAppointment ────────────────────────────────
  (function() {
    if (window.apiClient.createAppointment._cp) return;
    var orig = window.apiClient.createAppointment.bind(window.apiClient);
    window.apiClient.createAppointment = async function(data) {
      var transfer = window._pendingConsultTransfer || null;
      window._pendingConsultTransfer = null;
      var result = await orig(data);
      if (result && result.id && transfer) {
        try { await doTransfer(data, result, transfer.portalId, transfer.portalName); } catch(e) { console.error('transfer:', e); }
      }
      return result;
    };
    window.apiClient.createAppointment._cp = true;
  })();

  async function doTransfer(payload, created, targetPortalId, targetName) {
    await window.authClient.authenticatedFetch(
      '/.netlify/functions/appointments/' + created.id + '?portal_id=' + window.activePortalId,
      { method: 'DELETE' }
    );
    if (Array.isArray(window.appointments))
      window.appointments = window.appointments.filter(function(a) { return String(a.id) !== String(created.id); });
    var np = Object.assign({}, payload, {
      _targetPortalId: targetPortalId, pending_confirmation: true,
      referred_from_portal_id: window.activePortalId,
      notes: (payload.notes ? payload.notes + ' | ' : '') + 'Encaminhado de ' + ((window.portalConfig && window.portalConfig.name) || 'SM')
    });
    delete np.id;
    await window.authClient.authenticatedFetch('/.netlify/functions/appointments', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(np)
    });
    if (typeof window.showToast === 'function') window.showToast('Encaminhado para ' + targetName, 'success');
    if (typeof window.reloadAppointments === 'function') await window.reloadAppointments();
  }

  // ── 7. PATCH CARD RENDERERS ──────────────────────────────────
  patchCardRenderers();
  window.addEventListener('portalReady', patchCardRenderers, { once: true });
  setTimeout(patchCardRenderers, 2000);

  // Limpar locality stale ao abrir novo agendamento
  // _injectLocalityFirstOverlay corre a 50ms — limpar antes disso
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t) return;
    var isAddBtn = t.id === 'addServiceBtn' || t.id === 'addServiceMobile' ||
      (t.closest && (t.closest('#addServiceBtn') || t.closest('#addServiceMobile')));
    if (isAddBtn) {
      setTimeout(function() {
        var hidden = document.getElementById('appointmentLocality');
        if (hidden) hidden.value = '';
      }, 20);
    }
  }, true);

  // ── 8. POPUP — serviços importados a aguardar confirmação ──
  function checkImportedPending() {
    var user = window.authClient && window.authClient.getUser && window.authClient.getUser();
    if (!user) return;
    var role = user.role;
    if (role !== 'coordenador' && role !== 'admin') return;

    // Só uma vez por dia
    var todayKey = 'eg_import_popup_' + new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(todayKey)) return;

    // Esta semana: segunda a sábado da semana atual
    var now = new Date();
    var dow = now.getDay() || 7; // 1=seg, 7=dom
    var monday = new Date(now); monday.setDate(now.getDate() - (dow - 1)); monday.setHours(0,0,0,0);
    var saturday = new Date(monday); saturday.setDate(monday.getDate() + 5); saturday.setHours(23,59,59,999);
    var monISO = monday.toISOString().slice(0,10);
    var satISO = saturday.toISOString().slice(0,10);

    var todayISO = new Date().toISOString().slice(0,10);
    var pending = (window.appointments || []).filter(function(a) {
      var d = a.date ? String(a.date).slice(0,10) : '';
      // Sem data OU data de hoje em diante
      return a.auto_imported && !a.confirmed && (!d || d >= todayISO);
    });

    if (!pending.length) return;

    localStorage.setItem(todayKey, '1');

    // Mostrar popup
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:9998;display:flex;align-items:center;justify-content:center;';

    var grouped = {};
    pending.forEach(function(a) {
      var d = a.date ? String(a.date).slice(0,10) : 'sem data';
      grouped[d] = (grouped[d] || 0) + 1;
    });
    var rows = Object.keys(grouped).sort().map(function(d) {
      var dt = new Date(d + 'T00:00:00');
      var label = dt.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit' });
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;">' +
        '<span style="color:#374151;">' + label + '</span>' +
        '<span style="font-weight:700;color:#1d4ed8;">' + grouped[d] + ' serv.</span>' +
        '</div>';
    }).join('');

    ov.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.2);">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">' +
          '<div style="background:#fef3c7;border-radius:10px;padding:10px;font-size:24px;">📋</div>' +
          '<div>' +
            '<div style="font-weight:800;font-size:17px;color:#1f2937;">Serviços importados pendentes</div>' +
            '<div style="font-size:13px;color:#6b7280;">Esta semana — aguardam confirmação</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:#fafafa;border-radius:10px;padding:12px 16px;margin-bottom:20px;">' +
          rows +
          '<div style="display:flex;justify-content:space-between;padding:8px 0 0;font-weight:800;font-size:15px;">' +
            '<span>Total</span><span style="color:#1d4ed8;">' + pending.length + ' serviços</span>' +
          '</div>' +
        '</div>' +
        '<button id="_importPopupClose" style="width:100%;background:#1d4ed8;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:700;cursor:pointer;">Ver na agenda</button>' +
      '</div>';

    document.body.appendChild(ov);

    ov.querySelector('#_importPopupClose').onclick = function() { ov.remove(); };
    ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
  }

  window._checkImportedPending = checkImportedPending;

  // Hookar no reloadAppointments para correr depois dos dados estarem prontos
  var _origReload = window.reloadAppointments;
  if (typeof _origReload === 'function') {
    window.reloadAppointments = async function() {
      var result = await _origReload.apply(this, arguments);
      setTimeout(checkImportedPending, 500);
      return result;
    };
  }

  // Fallback: portalReady + timeout generoso
  window.addEventListener('portalReady', function() {
    setTimeout(checkImportedPending, 3000);
  }, { once: true });
  setTimeout(checkImportedPending, 6000);

  console.log('portal-consult-patch v4 OK');

})();
