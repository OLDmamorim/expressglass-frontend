// ===== VEHICLE CHECK-UP PATCH (Braga - beta) =====
(function () {

  function isBraga() {
    return (window.portalConfig?.name || '').toUpperCase().includes('BRAGA');
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  document.body.insertAdjacentHTML('beforeend', `
<div id="vcModal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;padding:12px;">
  <div style="background:#fff;border-radius:16px;padding:24px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <span style="font-size:22px;">🔍</span>
      <div>
        <div style="font-size:16px;font-weight:800;color:#0f172a;">Check-up Viatura</div>
        <div id="vcPlate" style="font-size:13px;color:#2563eb;font-family:monospace;font-weight:800;"></div>
      </div>
      <button onclick="window._vcClose()" style="margin-left:auto;background:#f1f5f9;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:15px;line-height:1;">✕</button>
    </div>
    <div id="vcBody"></div>
  </div>
</div>`);

  const ANGLES = ['Frente', 'Trás', 'Lado Esq.', 'Lado Dir.'];
  const ANGLES_FULL = ['Frente', 'Trás', 'Lado Esquerdo', 'Lado Direito'];

  let _photos = [null, null, null, null];
  let _mediaTypes = ['image/jpeg', 'image/jpeg', 'image/jpeg', 'image/jpeg'];
  let _apptId = null;
  let _plate = '';

  window._vcClose = function () {
    document.getElementById('vcModal').style.display = 'none';
  };

  window._openVehicleCheckup = function (id, plate) {
    _apptId = id;
    _plate = plate;
    _photos = [null, null, null, null];
    _mediaTypes = ['image/jpeg', 'image/jpeg', 'image/jpeg', 'image/jpeg'];
    document.getElementById('vcPlate').textContent = plate;
    _renderStep1();
    document.getElementById('vcModal').style.display = 'flex';
  };

  function _renderStep1() {
    document.getElementById('vcBody').innerHTML = `
      <p style="font-size:13px;color:#64748b;margin-bottom:14px;">Fotografa os ângulos que quiseres (mínimo 1). O sistema deteta danos em cada foto tirada.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;" id="vcZones"></div>
      <button id="vcAnalyzeBtn" onclick="window._vcAnalyze()" disabled
        style="width:100%;background:#2563eb;color:#fff;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:800;cursor:pointer;opacity:0.4;transition:opacity .2s;">
        🔍 Analisar danos
      </button>
      <button onclick="window._vcClose()"
        style="width:100%;background:transparent;border:none;padding:10px;font-size:13px;color:#9ca3af;cursor:pointer;margin-top:4px;">
        Cancelar
      </button>`;
    _refreshZones();
  }

  function _refreshZones() {
    const el = document.getElementById('vcZones');
    if (!el) return;
    el.innerHTML = ANGLES.map((label, i) => {
      const has = !!_photos[i];
      return `
      <div onclick="document.getElementById('vcFileInput${i}').click()"
           style="border:2px ${has ? 'solid #16a34a' : 'dashed #cbd5e1'};border-radius:10px;padding:12px;text-align:center;cursor:pointer;min-height:90px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:${has ? '#f0fdf4' : '#f8fafc'};">
        <div style="font-size:28px;">${has ? '✅' : '📷'}</div>
        <div style="font-size:12px;font-weight:700;color:${has ? '#16a34a' : '#64748b'};">${label}</div>
        <input type="file" id="vcFileInput${i}" accept="image/*" capture="environment" style="display:none;" onchange="window._vcOnPhoto(${i},this)">
      </div>`;
    }).join('');
    const btn = document.getElementById('vcAnalyzeBtn');
    const hasAny = _photos.some(p => p !== null);
    if (btn) { btn.disabled = !hasAny; btn.style.opacity = hasAny ? '1' : '0.4'; btn.style.cursor = hasAny ? 'pointer' : 'default'; }
  }

  window._vcOnPhoto = function (idx, input) {
    const file = input.files?.[0];
    if (!file) return;
    const origType = file.type || 'image/jpeg';
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        const MAX = 1280;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        _photos[idx] = dataUrl.split(',')[1];
        _mediaTypes[idx] = 'image/jpeg';
        _refreshZones();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  window._vcAnalyze = async function () {
    document.getElementById('vcBody').innerHTML = `
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:40px;margin-bottom:14px;animation:spin 1.5s linear infinite;display:inline-block;">🔍</div>
        <p style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:6px;">A analisar viatura…</p>
        <p style="font-size:13px;color:#64748b;">O sistema está a verificar danos nas imagens</p>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

    const images = _photos.map((b64, i) =>
      b64 ? { base64: b64, media_type: _mediaTypes[i], angle: ANGLES_FULL[i] } : null
    ).filter(Boolean);

    try {
      const tok = localStorage.getItem('eg_auth_token');
      const res = await fetch('/.netlify/functions/vehicle-checkup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
        body: JSON.stringify({ images })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro na análise');
      _renderResults(json.data);
    } catch (e) {
      document.getElementById('vcBody').innerHTML = `
        <p style="color:#dc2626;text-align:center;margin-bottom:14px;font-weight:600;">Erro: ${e.message}</p>
        <button onclick="window._vcRetryStep1()" style="width:100%;background:#e2e8f0;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;margin-bottom:8px;">← Tentar novamente</button>
        <button onclick="window._vcClose()" style="width:100%;background:transparent;border:none;padding:8px;font-size:13px;color:#9ca3af;cursor:pointer;">Cancelar</button>`;
      window._vcRetryStep1 = _renderStep1;
    }
  };

  const SEV_LABEL = { minor: 'Leve', moderate: 'Moderado', major: 'Grave' };
  const SEV_COLOR = { minor: '#6b7280', moderate: '#d97706', major: '#dc2626' };
  const SEV_BG    = { minor: '#f9fafb', moderate: '#fffbeb', major: '#fef2f2' };

  function _renderResults(data) {
    const damages = data.damages || [];

    if (!damages.length) {
      document.getElementById('vcBody').innerHTML = `
        <div style="text-align:center;padding:30px 16px;">
          <div style="font-size:48px;margin-bottom:12px;">✅</div>
          <p style="font-size:16px;font-weight:800;color:#16a34a;margin-bottom:6px;">Sem danos detetados</p>
          <p style="font-size:13px;color:#64748b;margin-bottom:20px;">Viatura sem danos visíveis nas imagens.</p>
          <button onclick="window._vcClose()" style="background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px 28px;font-weight:700;cursor:pointer;">Fechar</button>
        </div>`;
      return;
    }

    // Serialize damages into a data attribute to avoid JSON in onclick
    const encoded = encodeURIComponent(JSON.stringify(damages));

    document.getElementById('vcBody').innerHTML = `
      <p style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:12px;">
        🔍 ${damages.length} dano${damages.length !== 1 ? 's' : ''} detetado${damages.length !== 1 ? 's' : ''} — seleciona os que pretendes registar:
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        ${damages.map((d, i) => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;background:${SEV_BG[d.severity] || '#f9fafb'};border:1.5px solid ${SEV_COLOR[d.severity] || '#e5e7eb'};cursor:pointer;">
          <input type="checkbox" id="vcDmg${i}" ${d.severity !== 'minor' ? 'checked' : ''} style="margin-top:2px;width:16px;height:16px;flex-shrink:0;accent-color:#2563eb;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#0f172a;">${d.description}</div>
            <div style="font-size:11px;color:${SEV_COLOR[d.severity] || '#6b7280'};margin-top:2px;">${d.angle} · ${SEV_LABEL[d.severity] || d.severity}</div>
          </div>
        </label>`).join('')}
      </div>
      <button onclick="window._vcSave('${encoded}')"
        style="width:100%;background:#0f172a;color:#fff;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:8px;">
        💾 Guardar nas observações
      </button>
      <button onclick="window._vcClose()"
        style="width:100%;background:#e2e8f0;border:none;border-radius:10px;padding:11px;font-size:13px;font-weight:600;cursor:pointer;">
        Cancelar
      </button>`;
  }

  window._vcSave = async function (encoded) {
    const damages = JSON.parse(decodeURIComponent(encoded));
    const selected = damages.filter((d, i) => document.getElementById('vcDmg' + i)?.checked);

    if (!selected.length) { window._vcClose(); return; }

    const today = new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const lines = selected.map(d => `• ${d.description} (${d.angle})`).join('\n');
    const prefix = `[Check-up ${today}]\n${lines}`;

    const appts = window.appointments || [];
    const appt = appts.find(a => String(a.id) === String(_apptId));
    const existing = appt?.notes || '';
    const newNotes = existing ? prefix + '\n\n' + existing : prefix;
    const newDamageDetails = selected.map(d => d.description).join('; ');

    document.getElementById('vcBody').innerHTML = `<p style="text-align:center;padding:30px;color:#64748b;">A guardar…</p>`;

    try {
      const tok = localStorage.getItem('eg_auth_token');
      const portalId = window.portalConfig?.id || appt?.portal_id || null;
      const res = await fetch('/.netlify/functions/appointments/' + _apptId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
        body: JSON.stringify({ notes: newNotes, damage_details: newDamageDetails, _portalId: portalId })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao guardar');

      if (appt) { appt.notes = newNotes; appt.damage_details = newDamageDetails; }
      if (typeof renderAll === 'function') renderAll();

      document.getElementById('vcBody').innerHTML = `
        <div style="text-align:center;padding:30px 16px;">
          <div style="font-size:48px;margin-bottom:12px;">✅</div>
          <p style="font-size:16px;font-weight:800;color:#16a34a;margin-bottom:6px;">Observações guardadas!</p>
          <p style="font-size:13px;color:#64748b;margin-bottom:20px;">${selected.length} dano${selected.length !== 1 ? 's' : ''} registado${selected.length !== 1 ? 's' : ''} na ficha.</p>
          <button onclick="window._vcClose()" style="background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px 28px;font-weight:700;cursor:pointer;">Fechar</button>
        </div>`;
    } catch (e) {
      document.getElementById('vcBody').innerHTML = `
        <p style="color:#dc2626;text-align:center;margin-bottom:14px;font-weight:600;">Erro: ${e.message}</p>
        <button onclick="window._vcClose()" style="width:100%;background:#e2e8f0;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:600;">Fechar</button>`;
    }
  };

  // ── Inject "Check-up" button after dc-exec-row (desktop) and m-status-row (mobile) ───
  function injectCheckupButtons() {
    if (!isBraga()) return;
    const appts = window.appointments || [];

    // Mobile only
    document.querySelectorAll('.m-status-row').forEach(row => {
      if (row.dataset.vcInjected) return;
      row.dataset.vcInjected = '1';
      const id = row.querySelector('[data-exec]')?.dataset?.id;
      if (!id) return;
      const appt = appts.find(a => String(a.id) === String(id));
      if (!appt) return;
      const btn = document.createElement('button');
      btn.className = 'm-status-btn';
      btn.style.cssText = 'width:100%;justify-content:center;';
      btn.innerHTML = '<span class="m-status-dot" style="background:#2563eb;"></span>Check-up Viatura';
      btn.onclick = function (e) { e.stopPropagation(); window._openVehicleCheckup(id, appt.plate || ''); };
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin:6px 8px 0;';
      wrap.appendChild(btn);
      // Insert after any already-injected button rows (e.g. Retirar Vidro) so check-up stays last
      let insertAfter = row;
      let next = row.nextElementSibling;
      while (next && next.querySelector && next.querySelector('.m-status-btn')) {
        insertAfter = next;
        next = next.nextElementSibling;
      }
      insertAfter.insertAdjacentElement('afterend', wrap);
    });
  }

  // ── Hook renderAll ────────────────────────────────────────────────────────
  function hookRenderAll() {
    const orig = window.renderAll;
    if (typeof orig === 'function') {
      window.renderAll = function () {
        orig.apply(this, arguments);
        setTimeout(injectCheckupButtons, 70);
      };
    } else {
      window.addEventListener('portalReady', function () {
        setTimeout(function () {
          const o = window.renderAll;
          if (typeof o === 'function') {
            window.renderAll = function () {
              o.apply(this, arguments);
              setTimeout(injectCheckupButtons, 70);
            };
          }
        }, 500);
      }, { once: true });
    }
  }

  function init() {
    if (!isBraga()) return;
    hookRenderAll();
    console.log('🔍 Vehicle Check-up Patch carregado (Braga)');
  }

  if (window.portalConfig) {
    init();
  } else {
    window.addEventListener('portalReady', init, { once: true });
  }

})();
