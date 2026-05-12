// ===== VIDRO RETIRADO PATCH =====
// Adiciona botão "Vidro Retirado" entre N.Realizado e Realizado

(function() {

  // ── Injectar modal HTML ──────────────────────────────────────────
  const modalHTML = `
<div id="glassRemovedModal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;">
  <div style="background:#fff;border-radius:16px;padding:28px 24px;max-width:360px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 6px;font-size:17px;font-weight:800;color:#1e293b;">🪟 Vidro Retirado</h3>
    <p style="margin:0 0 18px;font-size:13px;color:#6b7280;">Indica a data prevista para colar o vidro</p>
    <div style="margin-bottom:14px;">
      <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Data sugerida pelo cliente</label>
      <input type="date" id="grDateInput" style="width:100%;padding:10px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" />
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button id="grBtnDate" onclick="window._grConfirmDate()" style="background:#2563eb;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;">📅 Confirmar data sugerida</button>
      <button id="grBtnNoDate" onclick="window._grConfirmNoDate()" style="background:#f1f5f9;color:#374151;border:1.5px solid #d1d5db;padding:12px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;">Sem previsão</button>
      <button onclick="window._grCancel()" style="background:transparent;color:#9ca3af;border:none;padding:8px;font-size:13px;cursor:pointer;">Cancelar</button>
    </div>
  </div>
</div>`;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  let _grTargetId = null;

  window._openGlassRemovedModal = function(id) {
    _grTargetId = id;
    const today = new Date().toISOString().slice(0,10);
    document.getElementById('grDateInput').value = '';
    document.getElementById('grDateInput').min = today;
    document.getElementById('glassRemovedModal').style.display = 'flex';
  };

  window._grCancel = function() {
    document.getElementById('glassRemovedModal').style.display = 'none';
    _grTargetId = null;
  };

  window._grConfirmNoDate = async function() {
    if (!_grTargetId) return;
    document.getElementById('glassRemovedModal').style.display = 'none';
    const id = _grTargetId; _grTargetId = null;
    const i = window.appointments.findIndex(a => String(a.id) === String(id));
    if (i < 0) return;
    window.appointments[i].glass_removed = true;
    try {
      await window.apiClient.updateAppointment(id, { ...window.appointments[i], glass_removed: true });
      if (typeof renderAll === 'function') renderAll();
      if (typeof window.showToast === 'function') window.showToast('Vidro retirado registado', 'success');
    } catch(e) {
      window.appointments[i].glass_removed = false;
      if (typeof window.showToast === 'function') window.showToast('Erro ao guardar', 'error');
    }
  };

  window._grConfirmDate = async function() {
    if (!_grTargetId) return;
    const dateVal = document.getElementById('grDateInput').value;
    if (!dateVal) { alert('Por favor seleciona uma data'); return; }
    document.getElementById('glassRemovedModal').style.display = 'none';
    const id = _grTargetId; _grTargetId = null;
    const i = window.appointments.findIndex(a => String(a.id) === String(id));
    if (i < 0) return;
    const prev = { date: window.appointments[i].date, confirmed: window.appointments[i].confirmed, glass_removed: window.appointments[i].glass_removed };
    window.appointments[i].glass_removed = true;
    window.appointments[i].date = dateVal;
    window.appointments[i].confirmed = false; // aguarda confirmação coordenador
    try {
      await window.apiClient.updateAppointment(id, { ...window.appointments[i], glass_removed: true, date: dateVal, confirmed: false });
      if (typeof renderAll === 'function') renderAll();
      if (typeof window.showToast === 'function') window.showToast('Vidro retirado — data sugerida enviada para confirmação', 'success');
    } catch(e) {
      Object.assign(window.appointments[i], prev);
      if (typeof window.showToast === 'function') window.showToast('Erro ao guardar', 'error');
    }
  };

  // ── Patch aos botões — interceta cliques no dc-exec-row e m-status-row ──
  document.addEventListener('click', function(e) {
    // Botão vidro retirado (desktop e mobile)
    const grBtn = e.target.closest('[data-gr]');
    if (grBtn) {
      e.stopPropagation();
      const id = grBtn.dataset.gr;
      window._openGlassRemovedModal(id);
      return;
    }
  });

  // ── Patch ao renderCard desktop ────────────────────────────────────
  const _origRenderSchedule = window.renderSchedule;
  if (_origRenderSchedule) {
    // Patch aplicado via MutationObserver após render
  }

  // Injectar botão "Vidro Retirado" após cada render
  function injectGlassRemovedButtons() {
    // Desktop: inserir linha própria APÓS dc-exec-row
    document.querySelectorAll('.dc-exec-row').forEach(row => {
      if (row.nextElementSibling && row.nextElementSibling.classList.contains('gr-btn-row')) return;
      const id = row.dataset.id;
      const appt = (window.appointments || []).find(a => String(a.id) === String(id));
      if (!appt) return;
      const isActive = appt.glass_removed;
      const btnRow = document.createElement('div');
      btnRow.className = 'gr-btn-row';
      btnRow.style.cssText = 'margin:4px 0 0;';
      const btn = document.createElement('button');
      btn.className = 'dc-exec-btn';
      btn.setAttribute('data-gr', id);
      btn.style.cssText = isActive
        ? 'background:#2563eb;color:#fff;border-color:#2563eb;width:100%;'
        : 'width:100%;';
      btn.innerHTML = isActive ? '🪟 Vidro Retirado' : '🪟 Retirar Vidro';
      btnRow.appendChild(btn);
      row.insertAdjacentElement('afterend', btnRow);
    });

    // Mobile: linha própria APÓS m-status-row
    document.querySelectorAll('.m-status-row').forEach(row => {
      if (row.nextElementSibling && row.nextElementSibling.classList.contains('gr-btn-row-m')) return;
      const id = row.querySelector('[data-exec]')?.dataset?.id;
      if (!id) return;
      const appt = (window.appointments || []).find(a => String(a.id) === String(id));
      if (!appt) return;
      const isActive = appt.glass_removed;
      const btnRow = document.createElement('div');
      btnRow.className = 'gr-btn-row-m';
      btnRow.style.cssText = 'margin:6px 8px 0;';
      const btn = document.createElement('button');
      btn.className = 'm-status-btn' + (isActive ? ' m-status-active-gr' : '');
      btn.setAttribute('data-gr', id);
      btn.style.cssText = 'width:100%;justify-content:center;';
      btn.innerHTML = `<span class="m-status-dot" style="background:${isActive?'#fff':'#2563eb'};"></span>${isActive ? 'Vidro Retirado' : 'Retirar Vidro'}`;
      btnRow.appendChild(btn);
      row.insertAdjacentElement('afterend', btnRow);
    });

    // Badge no card desktop para glass_removed com data sugerida
    document.querySelectorAll('.day-card').forEach(card => {
      const id = card.dataset.id;
      if (!id) return;
      const appt = (window.appointments || []).find(a => String(a.id) === String(id));
      if (!appt?.glass_removed) return;
      if (card.querySelector('.gr-badge')) return;
      const badge = document.createElement('div');
      badge.className = 'gr-badge';
      badge.style.cssText = 'margin:4px 0 0;padding:4px 10px;background:#dbeafe;border-left:3px solid #2563eb;border-radius:5px;font-size:11px;font-weight:700;color:#1d4ed8;';
      badge.textContent = appt.confirmed === false && appt.date ? `🪟 Vidro retirado — cliente sugere ${new Date(appt.date+'T12:00:00').toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})}` : '🪟 Vidro retirado — sem previsão';
      const execRow = card.querySelector('.dc-exec-row');
      if (execRow) execRow.insertAdjacentElement('afterend', badge);
    });
  }

  // Observar mudanças no DOM para re-injectar botões
  const obs = new MutationObserver(() => { clearTimeout(obs._t); obs._t = setTimeout(injectGlassRemovedButtons, 80); });
  obs.observe(document.body, { childList: true, subtree: true });

  // CSS extra para botão azul activo no mobile
  const style = document.createElement('style');
  style.textContent = `.m-status-active-gr { background:#2563eb !important; color:#fff !important; border-color:#2563eb !important; } .m-status-active-gr .m-status-dot { background:#fff !important; }`;
  document.head.appendChild(style);

  console.log('🪟 Glass Removed Patch carregado');
})();
