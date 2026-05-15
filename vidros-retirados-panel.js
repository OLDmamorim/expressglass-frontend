// ===== VIDROS RETIRADOS PANEL =====
(function() {
  // Inject modal HTML
  document.body.insertAdjacentHTML('beforeend', `
<div id="vidrosRetiradosModal" style="display:none;position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.6);align-items:flex-start;justify-content:center;padding-top:60px;overflow-y:auto;">
  <div id="vidrosRetiradosPanel" style="background:#1e293b;border-radius:16px;padding:24px;max-width:700px;width:95%;box-shadow:0 24px 80px rgba(0,0,0,0.5);margin-bottom:40px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <h2 style="margin:0;font-size:20px;font-weight:800;color:#fff;">🪟 Vidros Retirados</h2>
      <button id="btnFecharVidros" style="background:rgba(255,255,255,0.1);border:none;color:#fff;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:600;">Fechar</button>
    </div>
    <div id="vidrosRetiradosList" style="min-height:60px;"></div>
  </div>
</div>`);

  // Normaliza qualquer formato de data para YYYY-MM-DD
  function normDate(d) {
    if (!d) return null;
    return String(d).slice(0, 10); // apanha só YYYY-MM-DD mesmo que venha como ISO completo
  }

  function calcDaysOut(dateStr) {
    const s = normDate(dateStr);
    if (!s) return null;
    const ms = new Date(s + 'T00:00:00').getTime();
    if (isNaN(ms)) return null;
    return Math.floor((Date.now() - ms) / 86400000);
  }

  function fmtDate(d) {
    const s = normDate(d);
    if (!s) return '—';
    const [y, m, day] = s.split('-');
    return `${day}/${m}/${y}`;
  }

  function renderVidrosPanel() {
    const appts = (window.appointments || []).filter(a => a.glass_removed);
    appts.sort((a, b) => calcDaysOut(b.glass_removed_date) - calcDaysOut(a.glass_removed_date));

    const list = document.getElementById('vidrosRetiradosList');
    if (!list) return;

    if (appts.length === 0) {
      list.innerHTML = '<div style="color:rgba(255,255,255,0.5);text-align:center;padding:32px 0;font-size:14px;">Nenhum vidro retirado de momento.</div>';
      return;
    }

    // Header row
    let html = `<div style="display:grid;grid-template-columns:1fr 1.2fr 0.7fr auto auto;gap:8px;padding:6px 12px;margin-bottom:4px;">
      <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;">Matrícula</span>
      <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;">Carro / Serviço</span>
      <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;">Retirado</span>
      <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;">Dias</span>
      <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;">Reagendado</span>
    </div>`;

    appts.forEach(function(a) {
      const days = calcDaysOut(a.glass_removed_date);
      let daysBg = '#2563eb';
      if (days === null) daysBg = '#64748b';
      else if (days >= 14) daysBg = '#dc2626';
      else if (days >= 7) daysBg = '#f59e0b';
      const daysLabel = days === null ? '?' : days + 'd';

      const scheduledDate = a.date ? fmtDate(a.date) : '<span style="color:rgba(255,255,255,0.35);">—</span>';

      html += `<div class="vr-row" style="display:grid;grid-template-columns:1fr 1.2fr 0.7fr auto auto;gap:8px;align-items:center;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.05);margin-bottom:6px;cursor:pointer;" onclick="editAppointment('${a.id}');window._closeVidrosPanel();">
        <span style="font-size:15px;font-weight:800;color:#fff;">${(a.plate||'').toUpperCase()}</span>
        <span style="font-size:12px;color:rgba(255,255,255,0.7);">${(a.car||'').toUpperCase()}<br><span style="font-size:11px;opacity:0.6;">${a.service||''}</span></span>
        <span style="font-size:12px;color:rgba(255,255,255,0.6);">${fmtDate(a.glass_removed_date)}</span>
        <span style="font-size:12px;font-weight:700;padding:4px 10px;border-radius:12px;color:#fff;background:${daysBg};white-space:nowrap;">${daysLabel}</span>
        <span style="font-size:12px;color:rgba(255,255,255,0.6);white-space:nowrap;">${scheduledDate}</span>
      </div>`;
    });

    list.innerHTML = html;
  }

  window._openVidrosPanel = function() {
    renderVidrosPanel();
    document.getElementById('vidrosRetiradosModal').style.display = 'flex';
  };
  window._closeVidrosPanel = function() {
    document.getElementById('vidrosRetiradosModal').style.display = 'none';
  };

  document.getElementById('btnFecharVidros')?.addEventListener('click', window._closeVidrosPanel);
  document.getElementById('vidrosRetiradosModal')?.addEventListener('click', function(e) {
    if (e.target === this) window._closeVidrosPanel();
  });

  // Hook nav button
  document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'btnVidrosRetirados') window._openVidrosPanel();
  });

  console.log('🪟 Vidros Retirados Panel carregado');
})();
