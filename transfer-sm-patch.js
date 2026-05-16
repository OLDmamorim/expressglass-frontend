// transfer-sm-patch.js — v1
// Transferência de agendamento para outro SM directamente do modal
(function () {

  // ── Injectar painel de transferência no modal ────────────────────────────
  function injectTransferPanel() {
    if (document.getElementById('smTransferPanel')) return;

    // Botão na barra de acções
    var actions = document.querySelector('.form-actions');
    if (!actions) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnTransferirSM';
    btn.title = 'Transferir para outro SM';
    btn.style.cssText =
      'display:none;background:#7c3aed;color:#fff;border:none;border-radius:8px;' +
      'padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer;order:-1;';
    btn.innerHTML = '🔄 Transferir SM';
    // Inserir antes do Cancelar (primeiro filho)
    actions.insertBefore(btn, actions.firstChild);

    // Painel inline (aparece por cima das acções quando activo)
    var panel = document.createElement('div');
    panel.id = 'smTransferPanel';
    panel.style.cssText =
      'display:none;background:#f5f3ff;border:2px solid #7c3aed;border-radius:12px;' +
      'padding:18px 20px;margin-bottom:12px;';
    panel.innerHTML =
      '<div style="font-size:14px;font-weight:800;color:#5b21b6;margin-bottom:14px;">🔄 Transferir para outro SM</div>' +
      '<div id="smTransferList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        '<button type="button" id="smTransferCancel" style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:8px 18px;font-weight:700;font-size:13px;cursor:pointer;">Cancelar</button>' +
        '<button type="button" id="smTransferConfirm" style="background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-weight:700;font-size:13px;cursor:pointer;" disabled>Confirmar transferência</button>' +
      '</div>';

    // Inserir antes de form-actions
    actions.parentNode.insertBefore(panel, actions);

    btn.addEventListener('click', openTransferPanel);
    document.getElementById('smTransferCancel').addEventListener('click', closeTransferPanel);
    document.getElementById('smTransferConfirm').addEventListener('click', doTransfer);
  }

  // ── Abrir painel ─────────────────────────────────────────────────────────
  var _selectedPortalId = null;
  var _selectedPortalName = null;

  function openTransferPanel() {
    var consultable = window.consultablePortals || [];
    if (!consultable.length) {
      showToast && showToast('Sem SMs disponíveis para transferência', 'warning');
      return;
    }

    _selectedPortalId = null;
    _selectedPortalName = null;

    var list = document.getElementById('smTransferList');
    list.innerHTML = consultable.map(function (p) {
      var typeLabel = p.portalType === 'pesados' ? ' (Pesados)' : ' (SM)';
      return '<label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;' +
        'border:2px solid #ddd8fe;background:#fff;cursor:pointer;font-size:14px;font-weight:600;color:#4c1d95;' +
        'transition:border-color .15s;">' +
        '<input type="radio" name="smTransferTarget" value="' + p.id + '" data-name="' + p.name + '" ' +
        'style="accent-color:#7c3aed;width:16px;height:16px;"> ' + p.name + typeLabel +
        '</label>';
    }).join('');

    // Confirmar botão actualiza ao seleccionar
    list.querySelectorAll('input[type=radio]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        _selectedPortalId = parseInt(this.value);
        _selectedPortalName = this.dataset.name;
        document.getElementById('smTransferConfirm').disabled = false;
        document.getElementById('smTransferConfirm').textContent = 'Confirmar → ' + _selectedPortalName;
        // Highlight selecionado
        list.querySelectorAll('label').forEach(function (lbl) {
          lbl.style.borderColor = '#ddd8fe';
          lbl.style.background = '#fff';
        });
        this.closest('label').style.borderColor = '#7c3aed';
        this.closest('label').style.background = '#f5f3ff';
      });
    });

    document.getElementById('smTransferPanel').style.display = 'block';
    document.getElementById('btnTransferirSM').style.display = 'none';
  }

  function closeTransferPanel() {
    document.getElementById('smTransferPanel').style.display = 'none';
    document.getElementById('btnTransferirSM').style.display = '';
    _selectedPortalId = null;
    _selectedPortalName = null;
    document.getElementById('smTransferConfirm').disabled = true;
    document.getElementById('smTransferConfirm').textContent = 'Confirmar transferência';
  }

  // ── Executar transferência ────────────────────────────────────────────────
  async function doTransfer() {
    if (!_selectedPortalId) return;

    // Descobrir ID do agendamento actual (editingId é let em script.js → usar hidden field ou dataset)
    var apptId = window._currentEditingId;
    if (!apptId) {
      // fallback: tentar ler do título do modal ou de dataset do form
      var form = document.getElementById('appointmentForm');
      apptId = form && form.dataset.editId;
    }
    if (!apptId) {
      showToast && showToast('Não foi possível identificar o agendamento', 'error');
      return;
    }

    var appt = (window.appointments || []).find(function (a) { return String(a.id) === String(apptId); });
    if (!appt) {
      showToast && showToast('Agendamento não encontrado', 'error');
      return;
    }

    var confirmBtn = document.getElementById('smTransferConfirm');
    var cancelBtn  = document.getElementById('smTransferCancel');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'A transferir…';
    cancelBtn.disabled = true;

    try {
      var token = window.authClient && window.authClient.getToken();
      var currentPortalId = window.activePortalId;

      // 1. Apagar do portal actual
      await window.authClient.authenticatedFetch(
        '/.netlify/functions/appointments/' + apptId + '?portal_id=' + currentPortalId,
        { method: 'DELETE' }
      );

      // 2. Criar no portal destino
      var payload = Object.assign({}, appt, {
        _targetPortalId: _selectedPortalId,
        pending_confirmation: true,
        referred_from_portal_id: currentPortalId,
        notes: (appt.notes ? appt.notes + ' | ' : '') +
          'Transferido de ' + ((window.portalConfig && window.portalConfig.name) || 'SM')
      });
      // Limpar campos que não devem ser copiados
      ['id', 'created_at', 'updated_at'].forEach(function (k) { delete payload[k]; });

      await window.authClient.authenticatedFetch('/.netlify/functions/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Remover da lista local
      if (Array.isArray(window.appointments)) {
        window.appointments = window.appointments.filter(function (a) {
          return String(a.id) !== String(apptId);
        });
      }

      // Fechar modal
      if (typeof cancelEdit === 'function') cancelEdit();
      else {
        var modal = document.getElementById('appointmentModal');
        if (modal) modal.classList.remove('show');
      }

      if (typeof showToast === 'function') showToast('✅ Transferido para ' + _selectedPortalName, 'success');
      if (typeof renderAll === 'function') renderAll();
      if (typeof window.reloadAppointments === 'function') window.reloadAppointments();

    } catch (e) {
      console.error('transfer-sm-patch: doTransfer error', e);
      if (typeof showToast === 'function') showToast('Erro na transferência: ' + (e.message || e), 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirmar → ' + _selectedPortalName;
      cancelBtn.disabled = false;
    }
  }

  // ── Mostrar/esconder botão conforme modo (edit vs novo) ──────────────────
  function syncTransferBtn(isEdit) {
    var btn = document.getElementById('btnTransferirSM');
    if (!btn) return;
    var consultable = window.consultablePortals || [];
    var readOnly = window._readOnlyMode;
    btn.style.display = (isEdit && consultable.length > 0 && !readOnly) ? '' : 'none';
    // Sempre fechar o painel ao mudar de modo
    closeTransferPanel();
  }

  // ── Hook em editAppointment para detectar edit mode ──────────────────────
  function hookEditAppointment() {
    var origEdit = window.editAppointment;
    if (!origEdit || origEdit._tsmHooked) return;
    window.editAppointment = function (id) {
      window._currentEditingId = id;
      origEdit.call(this, id);
      // Após o modal abrir, mostrar botão
      setTimeout(function () { syncTransferBtn(true); }, 80);
    };
    window.editAppointment._tsmHooked = true;
  }

  // Quando o modal fecha/abre para novo registo → esconder botão
  function hookCancelEdit() {
    var origCancel = window.cancelEdit;
    if (!origCancel || origCancel._tsmHooked) return;
    window.cancelEdit = function () {
      window._currentEditingId = null;
      syncTransferBtn(false);
      return origCancel.apply(this, arguments);
    };
    window.cancelEdit._tsmHooked = true;
  }

  // Hookar botões "Novo Serviço" para limpar o ID ao abrir em modo novo
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    var isNew = t.id === 'addServiceBtn' || t.id === 'addServiceMobile' ||
      (t.closest && (t.closest('#addServiceBtn') || t.closest('#addServiceMobile')));
    if (isNew) {
      window._currentEditingId = null;
      setTimeout(function () { syncTransferBtn(false); }, 100);
    }
  }, true);

  // ── Inicializar ──────────────────────────────────────────────────────────
  function init() {
    injectTransferPanel();
    hookEditAppointment();
    hookCancelEdit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });
  } else {
    setTimeout(init, 400);
  }

  // Re-tentar após portalReady (script.js pode ainda não ter carregado)
  window.addEventListener('portalReady', function () {
    setTimeout(function () {
      hookEditAppointment();
      hookCancelEdit();
    }, 600);
  }, { once: true });

  console.log('🔄 Transfer SM Patch v1 carregado');
})();
