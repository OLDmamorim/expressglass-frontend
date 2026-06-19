// reports-widget.js — standalone reports panel for index.html
// Uses window.authClient (already available on index.html)

let _rwCharts = {};
let _rwCurrentParams = null;
let _rwCompareMode = false;

function openReportsPanel() {
  const panel = document.getElementById('reportsPanel');
  if (!panel) return;
  panel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _rwLoadPortals();
}

function closeReportsPanel() {
  const panel = document.getElementById('reportsPanel');
  if (panel) panel.style.display = 'none';
  document.body.style.overflow = '';
}

async function _rwLoadPortals() {
  const sel = document.getElementById('reportPortal');
  if (!sel || sel.options.length > 1) return; // already loaded
  try {
    const user = window.authClient?.getUser();
    let list = [];

    if (user?.role === 'admin') {
      // Admin: fetch all portals from API
      const resp = await window.authClient.authenticatedFetch('/.netlify/functions/portals');
      const data = await resp.json();
      if (!data.success) return;
      list = data.data || [];
    } else {
      // Coordinator/other: use portals stored in session at login time
      list = user?.portals || [];
      // Include primary portal if missing from list
      if (user?.portal?.id && !list.find(p => p.id === user.portal.id)) {
        list = [user.portal, ...list];
      }
    }

    const opts = '<option value="">Selecionar portal</option>' +
      list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    sel.innerHTML = opts;
    // Pre-select if only one
    if (list.length === 1) sel.value = String(list[0].id);
    // Populate second portal selector for compare mode
    const sel2 = document.getElementById('reportPortal2');
    if (sel2) sel2.innerHTML = opts;
  } catch(e) { console.error('reports-widget: loadPortals', e); }
}

function toggleCompareMode() {
  _rwCompareMode = !_rwCompareMode;
  const wrap = document.getElementById('reportPortal2Wrap');
  const btn  = document.getElementById('btnCompareToggle');
  if (_rwCompareMode) {
    wrap.style.display = 'block';
    btn.style.background = '#7c3aed';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    // Sync options if portal2 is empty
    const sel2 = document.getElementById('reportPortal2');
    if (sel2 && sel2.options.length <= 1) {
      const sel = document.getElementById('reportPortal');
      if (sel) sel2.innerHTML = sel.innerHTML;
    }
  } else {
    wrap.style.display = 'none';
    btn.style.background = '#f5f3ff';
    btn.style.color = '#7c3aed';
    btn.style.border = '1px solid #ddd6fe';
    // Reset compare view
    document.getElementById('reportCompareContent').style.display = 'none';
    document.getElementById('btnDownloadPDF').style.display = 'none';
  }
}

async function generateReport() {
  const portalId = document.getElementById('reportPortal').value;
  const fromMonth = document.getElementById('reportFrom').value;
  const toMonth   = document.getElementById('reportTo').value;
  if (!portalId || !fromMonth || !toMonth) {
    if (typeof showToast === 'function') showToast('Preenche todos os campos', 'error');
    return;
  }

  if (_rwCompareMode) {
    const portalId2 = document.getElementById('reportPortal2').value;
    if (!portalId2) {
      if (typeof showToast === 'function') showToast('Seleciona o segundo portal para comparar', 'error');
      return;
    }
    if (portalId === portalId2) {
      if (typeof showToast === 'function') showToast('Seleciona portais diferentes para comparar', 'error');
      return;
    }
    await _generateComparisonReport(portalId, portalId2, fromMonth, toMonth);
    return;
  }

  const dateFrom = fromMonth + '-01';
  const dateTo   = toMonth + '-' + new Date(toMonth.split('-')[0], toMonth.split('-')[1], 0).getDate();
  _rwCurrentParams = { portalId, dateFrom, dateTo };

  document.getElementById('reportLoading').style.display = 'block';
  document.getElementById('reportContent').style.display = 'none';
  document.getElementById('reportCompareContent').style.display = 'none';
  document.getElementById('btnDownloadPDF').style.display = 'none';

  try {
    const token = window.authClient.getToken();
    const resp = await fetch(`/.netlify/functions/reports?portal_id=${portalId}&date_from=${dateFrom}&date_to=${dateTo}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    _rwRenderReport(data);
  } catch(e) {
    if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
  } finally {
    document.getElementById('reportLoading').style.display = 'none';
  }
}

function _rwRenderReport(data) {
  const { portal, period, totals, byLocality, byWeekday, byWeek, byService, byComercial, byMotivo } = data;

  const portalDisplayName = portal.name || 'Portal';
  document.getElementById('reportTitle').textContent = portalDisplayName;

  const fmtDate = d => new Date(d+'T12:00:00').toLocaleDateString('pt-PT',{day:'2-digit',month:'long',year:'numeric'});
  const fromDate = new Date(period.from + 'T12:00:00');
  const toDate   = new Date(period.to   + 'T12:00:00');
  const sameMonth = fromDate.getMonth() === toDate.getMonth() && fromDate.getFullYear() === toDate.getFullYear();
  const periodLabel = sameMonth
    ? fromDate.toLocaleDateString('pt-PT', {month:'long', year:'numeric'})
    : `${fmtDate(period.from)} → ${fmtDate(period.to)}`;
  document.getElementById('reportPeriod').textContent = `${fmtDate(period.from)} → ${fmtDate(period.to)}`;

  const total   = parseInt(totals.total_agendados)||0;
  const realiz  = parseInt(totals.total_realizados)||0;
  const nRealiz = parseInt(totals.total_nao_realizados)||0;
  const taxa    = total > 0 ? Math.round((realiz/total)*100) : 0;
  const km      = parseInt(totals.total_km)||0;
  const diasComServicos = parseInt(totals.dias_com_servicos)||1;
  const mediaDiaria = diasComServicos > 0 ? (total/diasComServicos).toFixed(1) : '—';
  const travelMin  = parseInt(totals.total_travel_min)||0;
  const travelStr  = travelMin > 0 ? `${Math.floor(travelMin/60)}h${String(travelMin%60).padStart(2,'0')}` : '—';
  const fuelLitros = (km * 7.5 / 100);
  const custoGasoleo = (fuelLitros * 1.95).toFixed(2);

  document.getElementById('kpiTotal').textContent = total;
  document.getElementById('kpiRealizados').textContent = realiz;
  document.getElementById('kpiNaoRealizados').textContent = nRealiz;
  document.getElementById('kpiTaxa').textContent = taxa + '%';
  document.getElementById('kpiKm').textContent = km + ' km';
  document.getElementById('kpiPendentes').textContent = parseInt(totals.total_pendentes)||0;
  document.getElementById('kpiMediaDiaria').textContent = mediaDiaria;
  document.getElementById('kpiTempoEstrada').textContent = travelStr;
  document.getElementById('kpiCusto').textContent = custoGasoleo + '€';

  Object.values(_rwCharts).forEach(c => c?.destroy());
  _rwCharts = {};

  const COLORS = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#db2777','#0891b2','#65a30d','#ea580c','#6366f1'];

  const locLabels    = byLocality.map(r => r.locality);
  const locTotals    = byLocality.map(r => parseInt(r.total));
  const locRealizados = byLocality.map(r => parseInt(r.realizados));
  _rwCharts.locality = new Chart(document.getElementById('chartLocality'), {
    type: 'bar',
    data: { labels: locLabels, datasets: [
      { label: 'Total',     data: locTotals,     backgroundColor: '#bfdbfe', borderColor: '#2563eb', borderWidth: 1.5, borderRadius: 4 },
      { label: 'Realizados', data: locRealizados, backgroundColor: '#bbf7d0', borderColor: '#16a34a', borderWidth: 1.5, borderRadius: 4 }
    ]},
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { position: 'top' } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  _rwCharts.weekly = new Chart(document.getElementById('chartWeekly'), {
    type: 'bar',
    data: { labels: ['0-2 dias', '3-6 dias', '7-13 dias', '14-29 dias', '30+ dias'],
      datasets: [{ label: 'Serviços', data: [0,0,0,0,0], backgroundColor: ['#16a34a','#65a30d','#d97706','#ea580c','#dc2626'], borderRadius: 6 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  (async () => {
    try {
      const token = window.authClient.getToken();
      const portalId = document.getElementById('reportPortal').value;
      const resp2 = await fetch(`/.netlify/functions/appointments?portal_id=${portalId}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const apptData = await resp2.json();
      const normDate = s => s ? String(s).slice(0, 10) : null;
      const allAppts = apptData.data || [];
      const appts = allAppts.filter(a => {
        const d = normDate(a.date);
        return a.created_at && d && d >= normDate(period.from) && d <= normDate(period.to);
      });

      const diasList = appts.map(a => {
        const criacao = new Date(a.created_at); criacao.setHours(0,0,0,0);
        const servico = new Date(normDate(a.date) + 'T00:00:00');
        return Math.max(0, Math.floor((servico - criacao) / 86400000));
      }).filter(d => !isNaN(d) && d >= 0);

      const buckets = [0,0,0,0,0];
      diasList.forEach(d => {
        if (d <= 2)       buckets[0]++;
        else if (d <= 6)  buckets[1]++;
        else if (d <= 13) buckets[2]++;
        else if (d <= 29) buckets[3]++;
        else              buckets[4]++;
      });
      _rwCharts.weekly.data.datasets[0].data = buckets;
      _rwCharts.weekly.update();

      const media = diasList.length > 0 ? (diasList.reduce((s,d)=>s+d,0)/diasList.length).toFixed(1) : '—';
      document.getElementById('kpiMediaDiaria').textContent = media + (media !== '—' ? ' dias' : '');

      const vidrosSection = document.getElementById('reportVidrosSection');
      if (vidrosSection) {
        const vidrosAppts = allAppts.filter(a => !!a.glass_removed)
          .sort((a,b) => {
            const dA = a.glass_removed_date ? Date.now() - new Date(normDate(a.glass_removed_date)+'T00:00:00').getTime() : -1;
            const dB = b.glass_removed_date ? Date.now() - new Date(normDate(b.glass_removed_date)+'T00:00:00').getTime() : -1;
            return dB - dA;
          });
        if (vidrosAppts.length > 0) {
          const fmtD = d => { const s=normDate(d); if(!s) return '—'; const [y,m,day]=s.split('-'); return `${day}/${m}/${y}`; };
          vidrosSection.innerHTML = `
            <div style="border-top:2px solid #2563eb;padding-top:24px;margin-top:32px;">
              <h3 style="font-size:16px;font-weight:700;color:#2563eb;margin-bottom:16px;">🪟 Vidros Retirados (${vidrosAppts.length} pendente${vidrosAppts.length!==1?'s':''})</h3>
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead><tr style="background:#eff6ff;">
                  <th style="padding:10px 12px;text-align:left;font-weight:700;color:#2563eb;">Matrícula</th>
                  <th style="padding:10px 12px;text-align:left;font-weight:700;">Carro / Serviço</th>
                  <th style="padding:10px;text-align:center;font-weight:700;">Retirado em</th>
                  <th style="padding:10px;text-align:center;font-weight:700;">Dias aguarda</th>
                  <th style="padding:10px;text-align:center;font-weight:700;">Reagendado</th>
                </tr></thead>
                <tbody>${vidrosAppts.map((a,i)=>{
                  const grNorm = normDate(a.glass_removed_date);
                  const grMs = grNorm ? new Date(grNorm+'T00:00:00').getTime() : NaN;
                  const dias = !isNaN(grMs) ? Math.floor((Date.now()-grMs)/86400000) : null;
                  const diasCor = dias===null?'#64748b':dias>=14?'#dc2626':dias>=7?'#f59e0b':'#2563eb';
                  return `<tr style="border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafafa':''}">
                    <td style="padding:10px 12px;font-weight:800;">${(a.plate||'').toUpperCase()}</td>
                    <td style="padding:10px 12px;">${(a.car||'').toUpperCase()}<br><span style="font-size:12px;color:#6b7280;">${a.service||''}</span></td>
                    <td style="text-align:center;padding:10px;color:#6b7280;">${fmtD(a.glass_removed_date)}</td>
                    <td style="text-align:center;padding:10px;"><span style="background:${diasCor};color:#fff;font-weight:800;padding:3px 10px;border-radius:12px;font-size:13px;">${dias===null?'?':dias+'d'}</span></td>
                    <td style="text-align:center;padding:10px;">${a.date?fmtD(a.date):'<span style="color:#94a3b8;">—</span>'}</td>
                  </tr>`;
                }).join('')}</tbody>
              </table>
            </div>`;
          vidrosSection.style.display = 'block';
        } else {
          vidrosSection.style.display = 'none';
        }
      }
    } catch(e) { console.warn('reports-widget: async chart update', e); }
  })();

  const dowNames = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
  const dowData = Array(7).fill(0);
  byWeekday.forEach(r => { const i=parseInt(r.dow_num)-1; if(i>=0&&i<7) dowData[i]=parseInt(r.total); });
  _rwCharts.weekday = new Chart(document.getElementById('chartWeekday'), {
    type: 'bar',
    data: { labels: dowNames, datasets: [{ label: 'Serviços', data: dowData, backgroundColor: COLORS, borderRadius: 6 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  const svcMap = { PB:'Para-brisas', LT:'Lateral', OC:'Óculo', REP:'Reparação', POL:'Polimento', MO:'Montante' };
  _rwCharts.service = new Chart(document.getElementById('chartService'), {
    type: 'doughnut',
    data: { labels: byService.map(r=>svcMap[r.service]||r.service), datasets: [{ data: byService.map(r=>parseInt(r.total)), backgroundColor: COLORS, borderWidth: 2 }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, cutout: '55%' }
  });

  document.getElementById('reportLocalityTable').innerHTML = byLocality.map((r,i) => {
    const t=parseInt(r.total), rl=parseInt(r.realizados);
    const tx=t>0?Math.round((rl/t)*100):0;
    const taxaColor=tx>=80?'#16a34a':tx>=50?'#d97706':'#dc2626';
    return `<tr style="border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafafa':''}">
      <td style="padding:10px 12px;font-weight:600;">${r.locality}</td>
      <td style="text-align:center;padding:10px;">${t}</td>
      <td style="text-align:center;padding:10px;color:#16a34a;font-weight:700;">${rl}</td>
      <td style="text-align:center;padding:10px;"><span style="background:${taxaColor}15;color:${taxaColor};font-weight:700;padding:2px 8px;border-radius:20px;">${tx}%</span></td>
      <td style="text-align:center;padding:10px;color:#7c3aed;font-weight:600;">${parseInt(r.km)||0} km</td>
    </tr>`;
  }).join('');

  const comercialSection = document.getElementById('reportComercialSection');
  if (comercialSection) {
    if (byComercial && byComercial.length > 0) {
      const totalCom  = byComercial.reduce((s,r)=>s+parseInt(r.total),0);
      const realizCom = byComercial.reduce((s,r)=>s+parseInt(r.realizados),0);
      const taxaCom   = totalCom>0?Math.round((realizCom/totalCom)*100):0;
      comercialSection.innerHTML = `
        <div style="border-top:2px solid #7c3aed;padding-top:24px;margin-top:32px;">
          <h3 style="font-size:16px;font-weight:700;color:#7c3aed;margin-bottom:16px;">🤝 Serviços Encaminhados por Comercial</h3>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
            <div style="background:#f5f3ff;border-radius:12px;padding:16px;text-align:center;"><div style="font-size:28px;font-weight:800;color:#7c3aed;">${totalCom}</div><div style="font-size:12px;color:#6b7280;margin-top:4px;">Total encaminhados</div></div>
            <div style="background:#f0fdf4;border-radius:12px;padding:16px;text-align:center;"><div style="font-size:28px;font-weight:800;color:#16a34a;">${realizCom}</div><div style="font-size:12px;color:#6b7280;margin-top:4px;">Realizados</div></div>
            <div style="background:#fefce8;border-radius:12px;padding:16px;text-align:center;"><div style="font-size:28px;font-weight:800;color:#d97706;">${taxaCom}%</div><div style="font-size:12px;color:#6b7280;margin-top:4px;">Taxa realização</div></div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead><tr style="background:#f5f3ff;">
              <th style="padding:10px 12px;text-align:left;font-weight:700;color:#7c3aed;">Comercial</th>
              <th style="padding:10px;text-align:center;font-weight:700;">Total</th>
              <th style="padding:10px;text-align:center;font-weight:700;color:#16a34a;">Realizados</th>
              <th style="padding:10px;text-align:center;font-weight:700;color:#dc2626;">Não real.</th>
              <th style="padding:10px;text-align:center;font-weight:700;color:#d97706;">Pendentes</th>
              <th style="padding:10px;text-align:center;font-weight:700;">Taxa</th>
              <th style="padding:10px;text-align:center;font-weight:700;">Média dias</th>
            </tr></thead>
            <tbody>${byComercial.map((r,i)=>{
              const t=parseInt(r.total),rl=parseInt(r.realizados),nr=parseInt(r.nao_realizados),p=parseInt(r.pendentes);
              const tx=t>0?Math.round((rl/t)*100):0;
              const txColor=tx>=80?'#16a34a':tx>=50?'#d97706':'#dc2626';
              const md=r.media_dias?parseFloat(r.media_dias).toFixed(1)+' dias':'—';
              return `<tr style="border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafafa':''}">
                <td style="padding:10px 12px;font-weight:700;">${r.comercial_name}</td>
                <td style="text-align:center;padding:10px;font-weight:700;color:#7c3aed;">${t}</td>
                <td style="text-align:center;padding:10px;color:#16a34a;font-weight:700;">${rl}</td>
                <td style="text-align:center;padding:10px;color:#dc2626;font-weight:700;">${nr}</td>
                <td style="text-align:center;padding:10px;color:#d97706;font-weight:700;">${p}</td>
                <td style="text-align:center;padding:10px;"><span style="background:${txColor}15;color:${txColor};font-weight:700;padding:2px 10px;border-radius:20px;">${tx}%</span></td>
                <td style="text-align:center;padding:10px;color:#6b7280;">${md}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;
      comercialSection.style.display = 'block';
    } else {
      comercialSection.style.display = 'none';
    }
  }

  const motivosSection = document.getElementById('reportMotivosSection');
  if (motivosSection) {
    if (byMotivo && byMotivo.length > 0) {
      motivosSection.innerHTML = `
        <div style="border-top:2px solid #dc2626;padding-top:24px;margin-top:32px;">
          <h3 style="font-size:16px;font-weight:700;color:#dc2626;margin-bottom:16px;">❌ Motivos de Não Realização</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead><tr style="background:#fef2f2;">
              <th style="padding:10px 12px;text-align:left;font-weight:700;color:#dc2626;">Motivo</th>
              <th style="padding:10px;text-align:center;font-weight:700;">Ocorrências</th>
            </tr></thead>
            <tbody>${byMotivo.map((r,i)=>`
              <tr style="border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafafa':''}">
                <td style="padding:10px 12px;color:#374151;">${r.motivo}</td>
                <td style="text-align:center;padding:10px;"><span style="background:#fef2f2;color:#dc2626;font-weight:700;padding:2px 12px;border-radius:20px;">${r.total}×</span></td>
              </tr>`).join('')}</tbody>
          </table>
        </div>`;
      motivosSection.style.display = 'block';
    } else {
      motivosSection.style.display = 'none';
    }
  }

  // ===== EQUIPA =====
  const teamSec = document.getElementById('reportTeamSection');
  if (teamSec) {
    const teamStats = data.teamStats;
    if (teamStats && teamStats.length) {
      const fmtT = iso => iso ? new Date(iso).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}) : '—';
      const fmtD = d => d ? new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('pt-PT',{weekday:'short',day:'2-digit',month:'2-digit'}) : '—';
      const fmtH = h => (h==null||isNaN(h)) ? '—' : `${Math.floor(h)}h${String(Math.round((h-Math.floor(h))*60)).padStart(2,'0')}`;
      const daysWithBoth = teamStats.filter(r => r.checkin_at && r.checkout_at);
      const totalNetHrs = daysWithBoth.reduce((s,r) => s + Math.max(0, parseFloat(r.hours_raw||0) - 1), 0);
      const avgNetHrs = daysWithBoth.length ? totalNetHrs / daysWithBoth.length : 0;
      const totalServices = teamStats.reduce((s,r) => s + parseInt(r.services_done||0), 0);
      const avgServices = teamStats.length ? totalServices / teamStats.length : 0;
      const totalKm = teamStats.reduce((s,r) => s + parseFloat(r.km_day||0), 0);
      const servicesPerHour = totalNetHrs > 0 ? totalServices / totalNetHrs : 0;
      teamSec.innerHTML = `
        <div style="border-top:2px solid #7c3aed;padding-top:24px;margin-top:32px;">
          <h3 style="font-size:16px;font-weight:700;color:#7c3aed;margin-bottom:16px;">⏱️ Equipa — Tempos e Rentabilidade</h3>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
            <div style="background:#f5f3ff;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:4px;">DIAS REGISTADOS</div>
              <div style="font-size:26px;font-weight:900;color:#7c3aed;">${teamStats.length}</div>
            </div>
            <div style="background:#f0fdf4;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:11px;font-weight:700;color:#16a34a;margin-bottom:4px;">MÉDIA HORAS/DIA</div>
              <div style="font-size:26px;font-weight:900;color:#16a34a;">${fmtH(avgNetHrs)}</div>
            </div>
            <div style="background:#eff6ff;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:11px;font-weight:700;color:#1d4ed8;margin-bottom:4px;">MÉDIA SERV./DIA</div>
              <div style="font-size:26px;font-weight:900;color:#1d4ed8;">${avgServices.toFixed(1)}</div>
            </div>
            <div style="background:#fff7ed;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:11px;font-weight:700;color:#ea580c;margin-bottom:4px;">SERV./HORA</div>
              <div style="font-size:26px;font-weight:900;color:#ea580c;">${servicesPerHour.toFixed(2)}</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f5f3ff;">
              <th style="padding:9px 10px;text-align:left;font-weight:700;color:#7c3aed;border-bottom:2px solid #e2e8f0;">Data</th>
              <th style="padding:9px 10px;text-align:center;font-weight:700;color:#7c3aed;border-bottom:2px solid #e2e8f0;">Entrada</th>
              <th style="padding:9px 10px;text-align:center;font-weight:700;color:#7c3aed;border-bottom:2px solid #e2e8f0;">Saída</th>
              <th style="padding:9px 10px;text-align:center;font-weight:700;color:#7c3aed;border-bottom:2px solid #e2e8f0;">Horas líq.</th>
              <th style="padding:9px 10px;text-align:center;font-weight:700;color:#7c3aed;border-bottom:2px solid #e2e8f0;">Serviços</th>
              <th style="padding:9px 10px;text-align:center;font-weight:700;color:#7c3aed;border-bottom:2px solid #e2e8f0;">KM</th>
              <th style="padding:9px 10px;text-align:center;font-weight:700;color:#7c3aed;border-bottom:2px solid #e2e8f0;">Serv./hora</th>
            </tr></thead>
            <tbody>
              ${teamStats.map((r,i) => {
                const hrsRaw = r.checkin_at && r.checkout_at ? parseFloat(r.hours_raw||0) : null;
                const net = hrsRaw != null ? Math.max(0, hrsRaw - 1) : null;
                const svcs = parseInt(r.services_done||0);
                const sph = net > 0 ? (svcs / net).toFixed(2) : '—';
                return `<tr style="border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafafa':''}">
                  <td style="padding:8px 10px;font-weight:600;">${fmtD(r.date)}</td>
                  <td style="padding:8px 10px;text-align:center;color:${r.checkin_auto?'#94a3b8':'#16a34a'};font-weight:600;">${fmtT(r.checkin_at)}${r.checkin_auto?' *':''}</td>
                  <td style="padding:8px 10px;text-align:center;color:${r.checkout_auto?'#94a3b8':'#1d4ed8'};font-weight:600;">${fmtT(r.checkout_at)}${r.checkout_auto?' *':''}</td>
                  <td style="padding:8px 10px;text-align:center;font-weight:700;color:#7c3aed;">${fmtH(net)}</td>
                  <td style="padding:8px 10px;text-align:center;font-weight:700;">${svcs}</td>
                  <td style="padding:8px 10px;text-align:center;">${parseFloat(r.km_day||0).toFixed(0)} km</td>
                  <td style="padding:8px 10px;text-align:center;font-weight:700;color:#ea580c;">${sph}</td>
                </tr>`;
              }).join('')}
              <tr style="background:#f5f3ff;font-weight:700;border-top:2px solid #e2e8f0;">
                <td style="padding:8px 10px;">TOTAL</td>
                <td colspan="2" style="padding:8px 10px;text-align:center;color:#64748b;font-size:12px;">${daysWithBoth.length} dias completos</td>
                <td style="padding:8px 10px;text-align:center;color:#7c3aed;">${fmtH(totalNetHrs)}</td>
                <td style="padding:8px 10px;text-align:center;">${totalServices}</td>
                <td style="padding:8px 10px;text-align:center;">${totalKm.toFixed(0)} km</td>
                <td style="padding:8px 10px;text-align:center;color:#ea580c;">${servicesPerHour.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <p style="font-size:11px;color:#94a3b8;margin-top:8px;">* preenchido automaticamente · Horas líquidas = horas brutas − 1h almoço</p>
        </div>`;
      teamSec.style.display = 'block';
    } else {
      teamSec.innerHTML = `
        <div style="border-top:2px solid #7c3aed;padding-top:24px;margin-top:32px;">
          <h3 style="font-size:16px;font-weight:700;color:#7c3aed;margin-bottom:12px;">⏱️ Equipa — Tempos e Rentabilidade</h3>
          <p style="color:#94a3b8;font-size:13px;">Sem registos de check-in/check-out para o período selecionado.</p>
        </div>`;
      teamSec.style.display = 'block';
    }
  }

  document.getElementById('reportContent').style.display = 'block';
  document.getElementById('btnDownloadPDF').style.display = 'inline-block';
}

async function _generateComparisonReport(portalId1, portalId2, fromMonth, toMonth) {
  const dateFrom = fromMonth + '-01';
  const dateTo   = toMonth + '-' + new Date(toMonth.split('-')[0], toMonth.split('-')[1], 0).getDate();

  document.getElementById('reportLoading').style.display = 'block';
  document.getElementById('reportContent').style.display = 'none';
  document.getElementById('reportCompareContent').style.display = 'none';
  document.getElementById('btnDownloadPDF').style.display = 'none';

  try {
    const token = window.authClient.getToken();
    const hdrs = { 'Authorization': `Bearer ${token}` };
    const [r1, r2] = await Promise.all([
      fetch(`/.netlify/functions/reports?portal_id=${portalId1}&date_from=${dateFrom}&date_to=${dateTo}`, { headers: hdrs }),
      fetch(`/.netlify/functions/reports?portal_id=${portalId2}&date_from=${dateFrom}&date_to=${dateTo}`, { headers: hdrs })
    ]);
    const [dataA, dataB] = await Promise.all([r1.json(), r2.json()]);
    if (!dataA.success) throw new Error(dataA.error);
    if (!dataB.success) throw new Error(dataB.error);
    _rwRenderComparison(dataA, dataB);
  } catch(e) {
    if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
  } finally {
    document.getElementById('reportLoading').style.display = 'none';
  }
}

function _rwRenderComparison(dataA, dataB) {
  Object.values(_rwCharts).forEach(c => c?.destroy());
  _rwCharts = {};

  const nameA = dataA.portal.name || 'Portal A';
  const nameB = dataB.portal.name || 'Portal B';
  const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });

  function calcKpis(data) {
    const { totals } = data;
    const total  = parseInt(totals.total_agendados) || 0;
    const realiz = parseInt(totals.total_realizados) || 0;
    const nReal  = parseInt(totals.total_nao_realizados) || 0;
    const taxa   = total > 0 ? Math.round((realiz / total) * 100) : 0;
    const km     = parseInt(totals.total_km) || 0;
    const pend   = parseInt(totals.total_pendentes) || 0;
    const tMin   = parseInt(totals.total_travel_min) || 0;
    const travel = tMin > 0 ? `${Math.floor(tMin / 60)}h${String(tMin % 60).padStart(2, '0')}` : '—';
    const custo  = ((km * 7.5 / 100) * 1.95).toFixed(2);
    return { total, realiz, nReal, taxa, km, pend, travel, custo };
  }

  const kA = calcKpis(dataA);
  const kB = calcKpis(dataB);

  const kpiRows = [
    { label: 'Agendados',       vA: kA.total,  vB: kB.total,  fmt: v => v,        num: true,  better: true  },
    { label: 'Realizados',      vA: kA.realiz, vB: kB.realiz, fmt: v => v,        num: true,  better: true  },
    { label: 'Não realizados',  vA: kA.nReal,  vB: kB.nReal,  fmt: v => v,        num: true,  better: false },
    { label: 'Taxa realização', vA: kA.taxa,   vB: kB.taxa,   fmt: v => v + '%',  num: true,  better: true  },
    { label: 'Total km',        vA: kA.km,     vB: kB.km,     fmt: v => v + ' km',num: true,  better: null  },
    { label: 'Pendentes',       vA: kA.pend,   vB: kB.pend,   fmt: v => v,        num: true,  better: false },
    { label: 'Custo gasóleo',   vA: parseFloat(kA.custo), vB: parseFloat(kB.custo), fmt: v => v + '€', num: true, better: false },
  ];

  const svcMap = { PB: 'Para-brisas', LT: 'Lateral', OC: 'Óculo', REP: 'Reparação', POL: 'Polimento', MO: 'Montante' };

  function localityTable(rows) {
    if (!rows || !rows.length) return '<p style="color:#94a3b8;font-size:13px;padding:10px 0;">Sem dados</p>';
    return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
        <th style="text-align:left;padding:7px 10px;font-weight:700;color:#374151;">Localidade</th>
        <th style="text-align:center;padding:7px;font-weight:700;">Total</th>
        <th style="text-align:center;padding:7px;font-weight:700;color:#16a34a;">Real.</th>
        <th style="text-align:center;padding:7px;font-weight:700;">Taxa</th>
      </tr></thead>
      <tbody>${rows.map((r, i) => {
        const t = parseInt(r.total), rl = parseInt(r.realizados);
        const tx = t > 0 ? Math.round((rl / t) * 100) : 0;
        const txC = tx >= 80 ? '#16a34a' : tx >= 50 ? '#d97706' : '#dc2626';
        return `<tr style="border-bottom:1px solid #f1f5f9;${i % 2 === 0 ? 'background:#fafafa' : ''}">
          <td style="padding:7px 10px;font-weight:600;font-size:12px;">${r.locality}</td>
          <td style="text-align:center;padding:7px;font-weight:700;">${t}</td>
          <td style="text-align:center;padding:7px;color:#16a34a;font-weight:700;">${rl}</td>
          <td style="text-align:center;padding:7px;"><span style="background:${txC}15;color:${txC};font-weight:700;padding:1px 6px;border-radius:10px;font-size:11px;">${tx}%</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function serviceTable(rows) {
    if (!rows || !rows.length) return '<p style="color:#94a3b8;font-size:13px;padding:10px 0;">Sem dados</p>';
    const total = rows.reduce((s, r) => s + parseInt(r.total), 0);
    return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
        <th style="text-align:left;padding:7px 10px;font-weight:700;color:#374151;">Serviço</th>
        <th style="text-align:center;padding:7px;font-weight:700;">Total</th>
        <th style="text-align:center;padding:7px;font-weight:700;">%</th>
      </tr></thead>
      <tbody>${rows.map((r, i) => {
        const t = parseInt(r.total);
        const pct = total > 0 ? Math.round((t / total) * 100) : 0;
        return `<tr style="border-bottom:1px solid #f1f5f9;${i % 2 === 0 ? 'background:#fafafa' : ''}">
          <td style="padding:7px 10px;font-weight:600;font-size:12px;">${svcMap[r.service] || r.service}</td>
          <td style="text-align:center;padding:7px;font-weight:700;">${t}</td>
          <td style="text-align:center;padding:7px;"><span style="background:#eff6ff;color:#2563eb;font-weight:700;padding:1px 6px;border-radius:10px;font-size:11px;">${pct}%</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function motivoTable(rows) {
    if (!rows || !rows.length) return '<p style="color:#94a3b8;font-size:13px;padding:10px 0;">Sem dados</p>';
    return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#fef2f2;border-bottom:1px solid #fecdd3;">
        <th style="text-align:left;padding:7px 10px;font-weight:700;color:#dc2626;">Motivo</th>
        <th style="text-align:center;padding:7px;font-weight:700;">N.º</th>
      </tr></thead>
      <tbody>${rows.map((r, i) => `<tr style="border-bottom:1px solid #f1f5f9;${i % 2 === 0 ? 'background:#fafafa' : ''}">
        <td style="padding:7px 10px;color:#374151;font-size:12px;">${r.motivo}</td>
        <td style="text-align:center;padding:7px;"><span style="background:#fef2f2;color:#dc2626;font-weight:700;padding:1px 8px;border-radius:10px;font-size:11px;">${r.total}×</span></td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  const kpiHtml = kpiRows.map(row => {
    let bgA = '', bgB = '';
    if (row.better !== null && row.vA !== row.vB) {
      const aWins = row.better ? row.vA > row.vB : row.vA < row.vB;
      bgA = aWins ? 'background:#dcfce7;' : 'background:#fff1f2;';
      bgB = aWins ? 'background:#fff1f2;' : 'background:#dcfce7;';
    }
    return `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:12px 16px;font-size:22px;font-weight:800;color:#2563eb;${bgA}">${row.fmt(row.vA)}</td>
      <td style="padding:12px 8px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;background:#f8fafc;white-space:nowrap;">${row.label}</td>
      <td style="padding:12px 16px;font-size:22px;font-weight:800;color:#7c3aed;text-align:right;${bgB}">${row.fmt(row.vB)}</td>
    </tr>`;
  }).join('');

  const periodStr = `${fmtDate(dataA.period.from)} → ${fmtDate(dataA.period.to)}`;

  document.getElementById('reportCompareContent').innerHTML = `
    <div style="margin-bottom:24px;padding:22px 28px;background:linear-gradient(135deg,#1e3a5f 0%,#4c1d95 100%);border-radius:14px;color:#fff;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:11px;opacity:0.7;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">ExpressGlass — Comparação de Portais</div>
        <div style="font-size:20px;font-weight:800;"><span style="color:#93c5fd;">${nameA}</span> <span style="opacity:0.6;">vs</span> <span style="color:#c4b5fd;">${nameB}</span></div>
        <div style="font-size:13px;opacity:0.7;margin-top:4px;">${periodStr}</div>
      </div>
      <div style="font-size:52px;opacity:0.35;">⚖️</div>
    </div>

    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:20px;">
      <div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:14px;">📊 Indicadores Chave — rubrica a rubrica</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:2px solid #e2e8f0;">
          <th style="padding:10px 16px;text-align:left;font-weight:800;color:#2563eb;font-size:15px;">${nameA}</th>
          <th style="padding:10px 8px;text-align:center;font-weight:700;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em;background:#f8fafc;">Métrica</th>
          <th style="padding:10px 16px;text-align:right;font-weight:800;color:#7c3aed;font-size:15px;">${nameB}</th>
        </tr></thead>
        <tbody>${kpiHtml}</tbody>
      </table>
      <p style="margin-top:10px;font-size:11px;color:#94a3b8;text-align:center;">🟢 fundo verde = melhor resultado · 🔴 fundo vermelho = resultado inferior</p>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div style="background:#fff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;">
        <div style="font-weight:700;font-size:13px;color:#2563eb;margin-bottom:10px;">📍 ${nameA} — Por Localidade</div>
        ${localityTable(dataA.byLocality)}
      </div>
      <div style="background:#fff;border:1px solid #ddd6fe;border-radius:12px;padding:16px;">
        <div style="font-weight:700;font-size:13px;color:#7c3aed;margin-bottom:10px;">📍 ${nameB} — Por Localidade</div>
        ${localityTable(dataB.byLocality)}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div style="background:#fff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;">
        <div style="font-weight:700;font-size:13px;color:#2563eb;margin-bottom:10px;">🔧 ${nameA} — Tipo de Serviço</div>
        ${serviceTable(dataA.byService)}
      </div>
      <div style="background:#fff;border:1px solid #ddd6fe;border-radius:12px;padding:16px;">
        <div style="font-weight:700;font-size:13px;color:#7c3aed;margin-bottom:10px;">🔧 ${nameB} — Tipo de Serviço</div>
        ${serviceTable(dataB.byService)}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div style="background:#fff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;">
        <div style="font-weight:700;font-size:13px;color:#2563eb;margin-bottom:10px;">❌ ${nameA} — Motivos Não Realização</div>
        ${motivoTable(dataA.byMotivo)}
      </div>
      <div style="background:#fff;border:1px solid #ddd6fe;border-radius:12px;padding:16px;">
        <div style="font-weight:700;font-size:13px;color:#7c3aed;margin-bottom:10px;">❌ ${nameB} — Motivos Não Realização</div>
        ${motivoTable(dataB.byMotivo)}
      </div>
    </div>
  `;

  document.getElementById('reportCompareContent').style.display = 'block';
  document.getElementById('reportContent').style.display = 'none';
  document.getElementById('btnDownloadPDF').style.display = 'inline-block';
}

async function showKpiDetail(type) {
  if (!_rwCurrentParams) return;
  const { portalId, dateFrom, dateTo } = _rwCurrentParams;
  const titles = { agendados: 'Agendados', realizados: 'Realizados', nao_realizados: 'Não Realizados' };
  const modal = document.getElementById('kpiDetailModal');
  const body  = document.getElementById('kpiDetailBody');
  document.getElementById('kpiDetailTitle').textContent = titles[type] || 'Detalhe';
  body.innerHTML = '<p style="color:#6b7280;padding:20px 0;">A carregar…</p>';
  modal.classList.add('show');

  try {
    const token = window.authClient.getToken();
    const resp  = await fetch(
      `/.netlify/functions/reports?portal_id=${portalId}&date_from=${dateFrom}&date_to=${dateTo}&list=${type}`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Erro');
    const rows = data.data;
    if (!rows.length) {
      body.innerHTML = '<p style="text-align:center;color:#6b7280;padding:32px 0;">Nenhum registo encontrado.</p>';
      return;
    }
    const isNR  = type === 'nao_realizados';
    const fmtD  = iso => { if (!iso) return '—'; const s=String(iso).slice(0,10); const d=new Date(s+'T12:00:00'); return isNaN(d)?'—':d.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'2-digit'}); };
    const thSt  = 'padding:9px 12px;text-align:left;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e2e8f0;white-space:nowrap;';
    const tdSt  = 'padding:9px 12px;font-size:13px;border-bottom:1px solid #f1f5f9;vertical-align:middle;';
    const extraTh = isNR ? `<th style="${thSt}">Motivo</th><th style="${thSt}">Dias em aberto</th>` : '';
    body.innerHTML = `
      <div style="margin-bottom:10px;font-size:13px;color:#6b7280;">${rows.length} registo${rows.length>1?'s':''}</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="${thSt}">Data</th><th style="${thSt}">Matrícula</th>
            <th style="${thSt}">Viatura</th><th style="${thSt}">Serviço</th>
            <th style="${thSt}">Localidade</th>${extraTh}
          </tr></thead>
          <tbody>${rows.map(r => {
            let extra = '';
            if (isNR) {
              const motivo = r.not_done_reason || '—';
              const days   = r.days_to_close != null ? r.days_to_close : '—';
              const badge  = r.days_to_close != null
                ? `<span style="background:${r.days_to_close>3?'#fee2e2':'#f0fdf4'};color:${r.days_to_close>3?'#dc2626':'#16a34a'};font-weight:700;border-radius:6px;padding:2px 8px;font-size:12px;">${days===0?'mesmo dia':days+'d'}</span>`
                : '—';
              extra = `<td style="${tdSt}">${motivo}</td><td style="${tdSt}">${badge}</td>`;
            }
            return `<tr><td style="${tdSt}">${fmtD(r.date)}</td><td style="${tdSt}"><strong>${r.plate||'—'}</strong></td>
              <td style="${tdSt}">${r.car||'—'}</td><td style="${tdSt}">${r.service||'—'}</td>
              <td style="${tdSt}">${r.locality||'—'}</td>${extra}</tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  } catch(e) {
    body.innerHTML = `<p style="color:#dc2626;padding:20px 0;">Erro: ${e.message}</p>`;
  }
}

function downloadReportPDF() {
  window.print();
}

// Wire up close button and ESC key
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('closeReportsPanel')?.addEventListener('click', closeReportsPanel);
  document.getElementById('kpiDetailModal')?.querySelector('.modal-close')?.addEventListener('click', () => {
    document.getElementById('kpiDetailModal')?.classList.remove('show');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('kpiDetailModal')?.classList.remove('show');
      closeReportsPanel();
    }
  });
  // Set default months to current
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const from = document.getElementById('reportFrom');
  const to   = document.getElementById('reportTo');
  if (from && !from.value) from.value = ym;
  if (to   && !to.value)   to.value   = ym;
});
