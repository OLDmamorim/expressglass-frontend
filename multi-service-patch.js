// ===== MULTI-SERVIÇO PATCH =====
(function() {

// ── Helpers ──────────────────────────────────────────────────────
function getAllServices(a) {
  const primary = a.service ? [{ service: a.service, custom_service_time: a.custom_service_time || null }] : [];
  let extra = a.extra_services || [];
  if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch(e) { extra = []; } }
  if (!Array.isArray(extra)) extra = [];
  return [...primary, ...extra];
}

function getTotalServiceTime(a) {
  const vt = a.vehicleType || a.vehicle_type || 'L';
  const svcTimes = (typeof SERVICE_TIMES !== 'undefined' && SERVICE_TIMES) ? SERVICE_TIMES : { PB_L:90,LT_L:45,OC_L:60,REP_L:30,POL_L:45,RV_L:30,OUT_L:60, PB_P:120,LT_P:60,OC_P:90,REP_P:45,POL_P:60,RV_P:45,OUT_P:90, PB_A:150,LT_A:75,OC_A:105,REP_A:45,POL_A:60,RV_A:60,OUT_A:90, CALIB_EXTRA_L:30,CALIB_EXTRA_P:45,CALIB_EXTRA_A:45 };
  const vtKey = (vt||'L').toUpperCase().charAt(0);
  return getAllServices(a).reduce((sum, s) => {
    const code = (s.service||'PB').toUpperCase().split('-')[0].split(' ')[0];
    if (code === 'OUT' && s.custom_service_time && parseInt(s.custom_service_time) > 0) {
      return sum + parseInt(s.custom_service_time) + (a.calibration ? (svcTimes['CALIB_EXTRA_'+vtKey]||30) : 0);
    }
    const base = svcTimes[code+'_'+vtKey] || svcTimes[code+'_L'] || svcTimes['PB_L'] || 90;
    const extra = a.calibration ? (svcTimes['CALIB_EXTRA_'+vtKey]||30) : 0;
    return sum + base + extra;
  }, 0);
}

window._msGetAllServices = getAllServices;
window._msTotalTime = getTotalServiceTime;

// ── Normalizar extra_services ao carregar ─────────────────────────
const _origReload = window.reloadAppointments;
if (typeof _origReload === 'function') {
  window.reloadAppointments = async function() {
    await _origReload.apply(this, arguments);
    normalizeExtraServices();
  };
}

function normalizeExtraServices() {
  if (!window.appointments) return;
  window.appointments.forEach(a => {
    if (typeof a.extra_services === 'string') {
      try { a.extra_services = JSON.parse(a.extra_services); } catch(e) { a.extra_services = []; }
    }
    if (!Array.isArray(a.extra_services)) a.extra_services = [];
  });
}

// ── Hook renderAll para injectar badges e botão do modal ──────────
const _origRenderAll = window.renderAll;
if (typeof _origRenderAll === 'function') {
  window.renderAll = function() {
    _origRenderAll.apply(this, arguments);
    normalizeExtraServices();
    setTimeout(injectMultiServiceUI, 60);
  };
}

function injectMultiServiceUI() {
  if (!window.appointments) return;
  // Nota: badges desktop são agora gerados via getAllServices() em script.js (linha ~2343)
  // Não é necessário injectar aqui — evita duplicados.

  // Nota: chips mobile são agora gerados diretamente em buildMobileCard (inclui extra_services)
  // Não é necessário injectar aqui — evita duplicados.
}

// ── _addExtraServiceRow ────────────────────────────────────────────
window._addExtraServiceRow = function(serviceVal, customTime) {
  const container = document.getElementById('extraServicesContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'extra-svc-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px;';

  const sel = document.createElement('select');
  sel.className = 'extra-svc-select';
  sel.style.cssText = 'flex:1;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;';
  [['','Selecionar...'],['PB','PB - Para-brisas'],['LT','LT - Lateral'],['OC','OC - Óculo'],['REP','REP - Reparação'],['POL','POL - Polimento'],['OUT','OUT - Outros']].forEach(([v,t]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = t;
    sel.appendChild(opt);
  });
  if (serviceVal) sel.value = serviceVal;

  const timeWrap = document.createElement('div');
  timeWrap.className = 'extra-svc-time-wrap';
  timeWrap.style.display = serviceVal === 'OUT' ? 'block' : 'none';
  const timeInput = document.createElement('input');
  timeInput.type = 'number'; timeInput.className = 'extra-svc-time';
  timeInput.min = '1'; timeInput.max = '999'; timeInput.placeholder = 'min';
  timeInput.style.cssText = 'width:70px;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;';
  if (customTime) timeInput.value = customTime;
  timeWrap.appendChild(timeInput);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.style.cssText = 'background:#fee2e2;color:#dc2626;border:none;border-radius:8px;padding:10px 12px;font-size:16px;cursor:pointer;flex-shrink:0;';
  removeBtn.textContent = '✕';
  removeBtn.onclick = function() { row.remove(); };

  sel.addEventListener('change', function() {
    timeWrap.style.display = this.value === 'OUT' ? 'block' : 'none';
  });

  row.appendChild(sel);
  row.appendChild(timeWrap);
  row.appendChild(removeBtn);
  container.appendChild(row);
};

// ── Hook no guardar agendamento — interceptar updateAppointment/createAppointment ──
function getExtraServices() {
  return Array.from(document.querySelectorAll('.extra-svc-row')).map(row => ({
    service: row.querySelector('.extra-svc-select')?.value || '',
    custom_service_time: row.querySelector('.extra-svc-select')?.value === 'OUT'
      ? (parseInt(row.querySelector('.extra-svc-time')?.value) || null) : null
  })).filter(s => !!s.service);
}

const _origUpdateAppt = window.apiClient?.updateAppointment?.bind(window.apiClient);
const _origCreateAppt = window.apiClient?.createAppointment?.bind(window.apiClient);

function patchApiClient() {
  if (!window.apiClient) return;
  if (!window.apiClient._msPatched) {
    const origUpdate = window.apiClient.updateAppointment.bind(window.apiClient);
    const origCreate = window.apiClient.createAppointment.bind(window.apiClient);
    window.apiClient.updateAppointment = function(id, data) {
      // Se o modal está aberto, injectar extra_services
      const modal = document.getElementById('appointmentModal');
      if (modal && modal.classList.contains('show')) {
        data.extra_services = getExtraServices();
      }
      return origUpdate(id, data);
    };
    window.apiClient.createAppointment = function(data) {
      const modal = document.getElementById('appointmentModal');
      if (modal && modal.classList.contains('show')) {
        data.extra_services = getExtraServices();
      }
      return origCreate(data);
    };
    window.apiClient._msPatched = true;
  }
}

// Tentar patch imediato e após portalReady
patchApiClient();
window.addEventListener('portalReady', function() { setTimeout(patchApiClient, 500); }, { once: true });

// ── Limpar extra_services ao fechar modal ─────────────────────────
const origCancelEdit = window.cancelEdit;
if (typeof origCancelEdit === 'function') {
  window.cancelEdit = function() {
    const container = document.getElementById('extraServicesContainer');
    if (container) container.innerHTML = '';
    origCancelEdit.apply(this, arguments);
  };
}

// Preencher extra_services ao editar
const origEditAppt = window.editAppointment;
if (typeof origEditAppt === 'function') {
  window.editAppointment = function(id) {
    origEditAppt.apply(this, arguments);
    setTimeout(function() {
      const a = (window.appointments||[]).find(x => String(x.id) === String(id));
      if (!a) return;
      const container = document.getElementById('extraServicesContainer');
      if (!container) return;
      container.innerHTML = '';
      const extras = Array.isArray(a.extra_services) ? a.extra_services : [];
      extras.forEach(function(s) { window._addExtraServiceRow(s.service, s.custom_service_time); });
    }, 100);
  };
}

console.log('🔧 Multi-service patch carregado');
})();
