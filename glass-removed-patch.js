// ===== VIDRO RETIRADO PATCH =====
(function() {

  // ── Modal ───────────────────────────────────────────────────────
  document.body.insertAdjacentHTML('beforeend', `
<div id="glassRemovedModal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;">
  <div style="background:#fff;border-radius:16px;padding:28px 24px;max-width:360px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 6px;font-size:17px;font-weight:800;color:#1e293b;">🪟 Vidro Retirado</h3>
    <p style="margin:0 0 18px;font-size:13px;color:#6b7280;">Indica a data prevista para colar o vidro</p>
    <div style="margin-bottom:14px;">
      <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Data sugerida pelo cliente</label>
      <input type="date" id="grDateInput" style="width:100%;padding:10px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" />
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button onclick="window._grConfirmDate()" style="background:#2563eb;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;">📅 Confirmar data sugerida</button>
      <button onclick="window._grConfirmNoDate()" style="background:#f1f5f9;color:#374151;border:1.5px solid #d1d5db;padding:12px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;">Sem previsão</button>
      <button onclick="window._grCancel()" style="background:transparent;color:#9ca3af;border:none;padding:8px;font-size:13px;cursor:pointer;">Cancelar</button>
    </div>
  </div>
</div>`);

  let _grTargetId = null;

  window._openGlassRemovedModal = function(id) {
    _grTargetId = id;
    document.getElementById('grDateInput').value = '';
    document.getElementById('grDateInput').min = new Date().toISOString().slice(0,10);
    document.getElementById('glassRemovedModal').style.display = 'flex';
  };
  window._grCancel = function() {
    document.getElementById('glassRemovedModal').style.display = 'none';
    _grTargetId = null;
  };

  async function _grSave(id, dateVal) {
    const appts = window.appointments || [];
    const i = appts.findIndex(a => String(a.id) === String(id));
    if (i < 0) return;
    const prev = { glass_removed: appts[i].glass_removed, date: appts[i].date, confirmed: appts[i].confirmed };
    appts[i].glass_removed = true;
    if (dateVal) { appts[i].date = dateVal; appts[i].confirmed = false; }
    try {
      await window.apiClient.updateAppointment(id, { ...appts[i] });
      if (typeof renderAll === 'function') renderAll(); else window.reloadAppointments?.();
      if (typeof window.showToast === 'function') window.showToast('Vidro retirado registado', 'success');
    } catch(e) {
      Object.assign(appts[i], prev);
      if (typeof window.showToast === 'function') window.showToast('Erro ao guardar', 'error');
    }
  }

  window._grConfirmNoDate = async function() {
    document.getElementById('glassRemovedModal').style.display = 'none';
    const id = _grTargetId; _grTargetId = null;
    await _grSave(id, null);
  };
  window._grConfirmDate = async function() {
    const dateVal = document.getElementById('grDateInput').value;
    if (!dateVal) { alert('Por favor seleciona uma data'); return; }
    document.getElementById('glassRemovedModal').style.display = 'none';
    const id = _grTargetId; _grTargetId = null;
    await _grSave(id, dateVal);
  };

  // ── Hook no renderAll para injectar botões ────────────────────
  const _origRenderAll = window.renderAll;
  if (typeof _origRenderAll === 'function') {
    window.renderAll = function() {
      _origRenderAll.apply(this, arguments);
      setTimeout(injectGlassButtons, 50);
    };
  } else {
    // renderAll ainda não definido — tentar após portalReady
    window.addEventListener('portalReady', function() {
      setTimeout(function() {
        const orig = window.renderAll;
        if (typeof orig === 'function') {
          window.renderAll = function() {
            orig.apply(this, arguments);
            setTimeout(injectGlassButtons, 50);
          };
        }
      }, 500);
    }, { once: true });
  }

  function injectGlassButtons() {
    const appts = window.appointments || [];

    // Desktop: linha após dc-exec-row
    document.querySelectorAll('.dc-exec-row').forEach(row => {
      if (row.dataset.grInjected) return;
      row.dataset.grInjected = '1';
      const id = row.dataset.id;
      const appt = appts.find(a => String(a.id) === String(id));
      if (!appt) return;
      const isActive = !!appt.glass_removed;
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'margin:4px 0 0;';
      const btn = document.createElement('button');
      btn.className = 'dc-exec-btn' + (isActive ? ' dc-exec-gr-active' : '');
      btn.setAttribute('data-gr-id', id);
      btn.style.cssText = 'width:100%;' + (isActive ? 'background:#2563eb!important;color:#fff!important;border-color:#2563eb!important;' : '');
      btn.innerHTML = isActive ? '🪟 Vidro Retirado' : '🪟 Retirar Vidro';
      btn.onclick = function(e) { e.stopPropagation(); window._openGlassRemovedModal(id); };
      btnRow.appendChild(btn);
      row.insertAdjacentElement('afterend', btnRow);
    });

    // Mobile: linha após m-status-row
    document.querySelectorAll('.m-status-row').forEach(row => {
      if (row.dataset.grInjected) return;
      row.dataset.grInjected = '1';
      const id = row.querySelector('[data-exec]')?.dataset?.id;
      if (!id) return;
      const appt = appts.find(a => String(a.id) === String(id));
      if (!appt) return;
      const isActive = !!appt.glass_removed;
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'margin:6px 8px 0;';
      const btn = document.createElement('button');
      btn.className = 'm-status-btn' + (isActive ? ' m-status-active-gr' : '');
      btn.setAttribute('data-gr-id', id);
      btn.style.cssText = 'width:100%;justify-content:center;';
      btn.innerHTML = `<span class="m-status-dot" style="background:${isActive?'#fff':'#2563eb'};"></span>${isActive?'Vidro Retirado':'Retirar Vidro'}`;
      btn.onclick = function(e) { e.stopPropagation(); window._openGlassRemovedModal(id); };
      btnRow.appendChild(btn);
      row.insertAdjacentElement('afterend', btnRow);
    });
  }

  // CSS
  const style = document.createElement('style');
  style.textContent = `.m-status-active-gr{background:#2563eb!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-color:#2563eb!important;} .m-status-active-gr .m-status-dot{background:#fff!important;}`;
  document.head.appendChild(style);

  console.log('🪟 Glass Removed Patch carregado');
})();
