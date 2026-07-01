// recalibra-week.js
// Vista de semana (grelha dias × horas) para o portal Recalibra, no mobile.
// Botão "📅 Ver semana" abre uma janela com a ocupação da semana para se ver
// rapidamente onde há espaço para encaixar um serviço. Fecha a qualquer momento.
(function () {
  'use strict';

  const HMIN = 8, HMAX = 19;
  const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  let weekCursor = null; // Segunda-feira da semana mostrada

  // Cor por loja (cada loja com a sua cor)
  const LOJA_COLORS = {
    'BARCELOS': '#2563eb',
    'BRAGA MINHO CENTER': '#dc2626',
    'BRAGA SM': '#ea580c',
    'FAMALICÃO': '#7c3aed',
    'FAMALICÃO SM': '#db2777',
    'GUIMARÃES': '#16a34a',
    'MYCARCENTER': '#0891b2',
    'PAÇOS DE FERREIRA': '#a16207',
    'PAREDES': '#4f46e5',
    'PAREDES SM': '#9333ea',
    'PÓVOA DE VARZIM': '#0d9488',
    'RECALIBRA MINHO': '#b91c1c',
    'VIANA DO CASTELO': '#1d4ed8',
    'VIANA DO CASTELO SM': '#c2410c',
    'VILA VERDE': '#15803d'
  };
  function lojaColor(loja) { return LOJA_COLORS[(loja || '').toUpperCase()] || '#475569'; }

  function isRecalibra() { return window.portalConfig?.portalType === 'recalibra'; }

  function mondayOf(d) {
    if (typeof getMonday === 'function') return getMonday(d);
    const r = new Date(d); const day = r.getDay();
    const diff = r.getDate() - day + (day === 0 ? -6 : 1);
    r.setDate(diff); r.setHours(0, 0, 0, 0); return r;
  }
  function addD(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); r.setHours(0, 0, 0, 0); return r; }
  function iso(d) { return (typeof localISO === 'function') ? localISO(d) : d.toISOString().slice(0, 10); }
  const fmt = h => String(h).padStart(2, '0') + ':00';

  // Mapa: para uma data, que horas estão ocupadas e por quem
  function liveAppointments() {
    return (typeof window.getLiveAppointments === 'function') ? (window.getLiveAppointments() || []) : (window.appointments || []);
  }

  function occupancyFor(dateIso) {
    const map = {}; // hour -> {plate, locality}
    liveAppointments().forEach(a => {
      if (a.date !== dateIso) return;
      if (!a.period || !/^[0-9]/.test(a.period)) return;
      const p = String(a.period).split('-').map(s => parseInt(s, 10));
      let lo, hi;
      if (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) { lo = p[0]; hi = p[1]; }
      else if (p.length === 1 && !isNaN(p[0])) { lo = hi = p[0]; }
      else return;
      const entry = { plate: (a.plate || '').toUpperCase(), locality: (a.locality || '').toUpperCase() };
      for (let h = lo; h <= hi; h++) {
        // Em caso de sobreposição, preferir o que tem loja definida
        if (!map[h] || (!map[h].locality && entry.locality)) map[h] = entry;
      }
    });
    return map;
  }

  // Serviços do dia SEM hora definida (não são calibragens com bloco horário).
  // Não cabem na grelha por hora, mas têm de aparecer na semana.
  function noHourFor(dateIso) {
    const list = [];
    liveAppointments().forEach(a => {
      if (a.date !== dateIso) return;
      if (a.period && /^[0-9]/.test(a.period)) return; // tem hora → já aparece na grelha
      list.push({ plate: (a.plate || '').toUpperCase(), locality: (a.locality || '').toUpperCase() });
    });
    return list;
  }

  function close() { document.getElementById('recWeekOverlay')?.remove(); }

  function render() {
    let overlay = document.getElementById('recWeekOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'recWeekOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding:10px;overflow:auto;';
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      document.body.appendChild(overlay);
    }

    const days = DAYS.map((_, i) => addD(weekCursor, i));
    const occ = days.map(d => occupancyFor(iso(d)));
    const noHour = days.map(d => noHourFor(iso(d)));
    const fimSemana = addD(weekCursor, 5);
    const titulo = weekCursor.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' }) + ' – ' + fimSemana.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });

    // Cabeçalho de dias
    let head = `<div style="font-size:10px;font-weight:800;color:#64748b;"></div>`;
    days.forEach((d, i) => {
      const isToday = iso(d) === iso(new Date());
      head += `<div style="text-align:center;font-size:10px;font-weight:800;color:${isToday ? '#0f766e' : '#475569'};line-height:1.1;">${DAYS[i]}<br><span style="font-size:9px;font-weight:600;color:#94a3b8;">${d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })}</span></div>`;
    });

    // Linha "S/ hora" — serviços do dia sem bloco horário definido
    let rows = '';
    rows += `<div style="font-size:9px;font-weight:800;color:#b45309;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;text-align:right;line-height:1;">S/ hora</div>`;
    noHour.forEach(list => {
      if (list.length) {
        const chips = list.map(c => {
          const loja = c.locality || '';
          const lbl = loja || c.plate || '•';
          const bg = loja ? lojaColor(loja) : '#475569';
          return `<div title="${loja || c.plate}${loja && c.plate ? ' · ' + c.plate : ''}" style="background:${bg};color:#fff;border-radius:4px;font-size:7px;font-weight:800;padding:2px 3px;overflow:hidden;text-align:center;line-height:1.05;white-space:nowrap;text-overflow:ellipsis;">${lbl}</div>`;
        }).join('');
        rows += `<div style="display:flex;flex-direction:column;gap:2px;min-height:26px;background:#fff7ed;border:1px solid #fed7aa;border-radius:5px;padding:2px;">${chips}</div>`;
      } else {
        rows += `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:5px;min-height:26px;"></div>`;
      }
    });

    // Linhas de horas
    for (let h = HMIN; h <= HMAX; h++) {
      rows += `<div style="font-size:10px;font-weight:700;color:#475569;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;">${fmt(h)}</div>`;
      occ.forEach(m => {
        const c = m[h];
        if (c) {
          const loja = c.locality || '';
          const lbl = loja || c.plate || '•';
          const bg = loja ? lojaColor(loja) : '#475569';
          rows += `<div title="${loja || c.plate}${loja && c.plate ? ' · ' + c.plate : ''}" style="background:${bg};color:#fff;border-radius:5px;min-height:26px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;padding:2px;overflow:hidden;text-align:center;line-height:1.05;">${lbl}</div>`;
        } else {
          rows += `<div style="background:#dcfce7;border:1px solid #bbf7d0;border-radius:5px;min-height:26px;"></div>`;
        }
      });
    }

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;margin:auto;box-shadow:0 20px 60px rgba(0,0,0,.4);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:16px;font-weight:900;color:#0f172a;">📅 Semana</div>
          <button id="recWeekClose" style="background:none;border:none;font-size:26px;color:#94a3b8;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;padding:10px;">
          <button id="recWeekPrev" style="background:#f1f5f9;border:none;border-radius:8px;padding:7px 14px;font-size:16px;font-weight:800;cursor:pointer;">‹</button>
          <div style="font-size:14px;font-weight:800;color:#0f766e;min-width:120px;text-align:center;">${titulo}</div>
          <button id="recWeekNext" style="background:#f1f5f9;border:none;border-radius:8px;padding:7px 14px;font-size:16px;font-weight:800;cursor:pointer;">›</button>
        </div>
        <div style="padding:0 10px 6px;">
          <div style="display:grid;grid-template-columns:40px repeat(6,1fr);gap:3px;margin-bottom:3px;">${head}</div>
          <div style="display:grid;grid-template-columns:40px repeat(6,1fr);gap:3px;">${rows}</div>
        </div>
        <div style="display:flex;gap:14px;justify-content:center;align-items:center;padding:8px 10px 14px;font-size:11px;color:#64748b;font-weight:600;">
          <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:#dcfce7;border:1px solid #bbf7d0;border-radius:3px;display:inline-block;"></span> Livre</span>
          <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:3px;display:inline-block;"></span> S/ hora</span>
          <span>Ocupado = cor da loja</span>
        </div>
        <div style="padding:0 14px 16px;">
          <button id="recWeekCloseBtn" style="width:100%;background:#0f766e;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer;">Fechar</button>
        </div>
      </div>`;

    document.getElementById('recWeekClose').onclick = close;
    document.getElementById('recWeekCloseBtn').onclick = close;
    document.getElementById('recWeekPrev').onclick = () => { weekCursor = addD(weekCursor, -7); render(); };
    document.getElementById('recWeekNext').onclick = () => { weekCursor = addD(weekCursor, 7); render(); };
  }

  function open() {
    const base = (typeof currentMobileDay !== 'undefined' && currentMobileDay) ? currentMobileDay : new Date();
    weekCursor = mondayOf(base);
    render();
  }
  window.openRecalibraWeek = open;

  function updateButton() {
    const rec = isRecalibra();
    const btn = document.getElementById('btnRecalibraWeek');
    if (btn) {
      btn.style.display = rec ? '' : 'none';
      if (rec && !btn._bound) { btn._bound = true; btn.onclick = open; }
    }
    // No Recalibra, esconder os 3 botões (Vendas / Calcular Rotas / Timeline)
    // Nos outros portais repor a grelha de 3 colunas (não 'block')
    const row = document.getElementById('mobileActionRow');
    if (row) row.style.display = rec ? 'none' : 'grid';
  }

  function init() {
    updateButton();
    document.addEventListener('portalReady', () => setTimeout(updateButton, 300));
    setInterval(updateButton, 3000); // apanha mudanças de portal
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
