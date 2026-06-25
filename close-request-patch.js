// close-request-patch.js — Fechar Ficha com devolução de eurocode
(function () {

  // ── Injectar painel no modal de agendamento ─────────────────────────────────
  function injectClosePanel() {
    if (document.getElementById('closeRequestPanel')) return;

    var actions = document.querySelector('.form-actions');
    if (!actions) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnFecharFicha';
    btn.style.cssText =
      'display:none;background:#dc2626;color:#fff;border:none;border-radius:8px;' +
      'padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer;order:-1;';
    btn.innerHTML = '🔒 Fechar Ficha';
    actions.insertBefore(btn, actions.firstChild);

    var panel = document.createElement('div');
    panel.id = 'closeRequestPanel';
    panel.style.cssText =
      'display:none;background:#fef2f2;border:2px solid #dc2626;border-radius:12px;' +
      'padding:18px 20px;margin-bottom:12px;';
    panel.innerHTML =
      '<div style="font-size:14px;font-weight:800;color:#991b1b;margin-bottom:14px;">🔒 Fechar Ficha</div>' +
      '<div style="margin-bottom:12px;">' +
        '<label style="font-size:12px;font-weight:700;color:#991b1b;display:block;margin-bottom:4px;">Eurocode a devolver</label>' +
        '<input id="closeReqEurocode" type="text" placeholder="Ex: 3556AGSVW" ' +
          'style="width:100%;border:1.5px solid #fca5a5;border-radius:8px;padding:8px 12px;font-size:13px;box-sizing:border-box;">' +
      '</div>' +
      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:12px;font-weight:700;color:#991b1b;display:block;margin-bottom:4px;">Notas (opcional)</label>' +
        '<textarea id="closeReqNotes" rows="2" placeholder="Motivo do fecho…" ' +
          'style="width:100%;border:1.5px solid #fca5a5;border-radius:8px;padding:8px 12px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>' +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        '<button type="button" id="closeReqCancel" ' +
          'style="background:#e5e7eb;color:#374151;border:none;border-radius:8px;padding:8px 18px;font-weight:700;font-size:13px;cursor:pointer;">Cancelar</button>' +
        '<button type="button" id="closeReqConfirm" ' +
          'style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-weight:700;font-size:13px;cursor:pointer;">🔒 Confirmar Fecho</button>' +
      '</div>';

    actions.parentNode.insertBefore(panel, actions);

    btn.addEventListener('click', openClosePanel);
    document.getElementById('closeReqCancel').addEventListener('click', closeClosePanel);
    document.getElementById('closeReqConfirm').addEventListener('click', doCloseRequest);
  }

  function openClosePanel() {
    var eurocode = (document.getElementById('appointmentExtra') || {}).value || '';
    document.getElementById('closeReqEurocode').value = eurocode.trim();
    document.getElementById('closeReqNotes').value = '';
    document.getElementById('closeRequestPanel').style.display = 'block';
    document.getElementById('btnFecharFicha').style.display = 'none';
  }

  function closeClosePanel() {
    var panel = document.getElementById('closeRequestPanel');
    var btn   = document.getElementById('btnFecharFicha');
    if (panel) panel.style.display = 'none';
    if (btn)   btn.style.display = '';
  }

  async function doCloseRequest() {
    var apptId = window._currentEditingId;
    if (!apptId) {
      var form = document.getElementById('appointmentForm');
      apptId = form && form.dataset.editId;
    }
    if (!apptId) {
      if (typeof showToast === 'function') showToast('Guarda o agendamento primeiro', 'warning');
      return;
    }

    var eurocode = document.getElementById('closeReqEurocode').value.trim();
    var notes    = document.getElementById('closeReqNotes').value.trim();
    var appt     = (window.appointments || []).find(function (a) { return String(a.id) === String(apptId); });
    var plate    = (appt && appt.plate)     || (document.getElementById('appointmentPlate')    || {}).value || '';
    var orderRef = (appt && appt.order_ref) || (document.getElementById('appointmentOrderRef') || {}).value || '';
    var nObra    = (appt && appt.n_obra)    || (document.getElementById('appointmentNObra')    || {}).value || '';

    var confirmBtn = document.getElementById('closeReqConfirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'A guardar…';

    try {
      if (!window.glassReception || !window.glassReception._requestClose) throw new Error('Módulo não disponível');
      await window.glassReception._requestClose(apptId, eurocode, plate, orderRef, nObra, notes);
      closeClosePanel();
      document.getElementById('btnFecharFicha').style.display = 'none';
      if (typeof showToast === 'function') showToast('✅ Ficha marcada para fecho pelo coordenador', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast('❌ ' + (e.message || 'Erro'), 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '🔒 Confirmar Fecho';
    }
  }

  // ── Mostrar/esconder botão conforme modo ──────────────────────────────────
  function syncCloseBtn(isEdit) {
    injectClosePanel();
    var btn = document.getElementById('btnFecharFicha');
    if (!btn) return;
    btn.style.display = isEdit ? '' : 'none';
    closeClosePanel();
  }

  // ── Hook em editAppointment ───────────────────────────────────────────────
  function hookEditAppointment() {
    var orig = window.editAppointment;
    if (!orig || orig._crpHooked) return;
    window.editAppointment = function (id) {
      orig.call(this, id);
      setTimeout(function () { syncCloseBtn(true); }, 120);
    };
    window.editAppointment._crpHooked = true;
    // preserve transfer-sm-patch hook flag
    if (orig._tsmHooked) window.editAppointment._tsmHooked = true;
  }

  function hookCancelEdit() {
    var orig = window.cancelEdit;
    if (!orig || orig._crpHooked) return;
    window.cancelEdit = function () {
      orig.apply(this, arguments);
      setTimeout(function () { syncCloseBtn(false); }, 50);
    };
    window.cancelEdit._crpHooked = true;
  }

  function init() {
    hookEditAppointment();
    hookCancelEdit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 200);
  }

})();
