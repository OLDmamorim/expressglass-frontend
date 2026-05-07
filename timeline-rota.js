// ═══════════════════════════════════════════════════════════════════════════
// timeline-rota.js — Timeline vertical do dia
// Mostra hora de partida (09:00), tempos de viagem, serviços, almoço e regresso.
// Linha "agora" só aparece se for hoje.
// ═══════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const HORA_PARTIDA_H = 9;
  const HORA_PARTIDA_M = 0;
  const ALMOCO_DURACAO_MIN = 60;
  const ALMOCO_INICIO_MIN_H = 12; // mais cedo que o almoço pode começar
  const ALMOCO_INICIO_MAX_H = 14; // mais tarde que o almoço pode começar

  // ── Helpers ───────────────────────────────────────────────────────────
  function getSelectedDate() {
    if (window.currentMobileDate) return window.currentMobileDate;
    if (window.currentMobileDay) return window.currentMobileDay.toISOString().split('T')[0];
    const lbl = document.getElementById('mobileDayLabel');
    if (lbl && lbl.dataset.date) return lbl.dataset.date;
    return new Date().toISOString().split('T')[0];
  }

  function getDateISO() {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }

  function fmtHM(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function fmtDur(min) {
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? h + 'h ' + m + 'min' : h + 'h';
  }

  function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  // ── Calcular timeline ─────────────────────────────────────────────────
  // Retorna array de eventos: { type, label, time (em min desde meia-noite), duration }
  // type: 'partida' | 'viagem' | 'servico' | 'almoco' | 'regresso'
  function calcularTimeline(items) {
    const events = [];
    let cursor = HORA_PARTIDA_H * 60 + HORA_PARTIDA_M;

    // 1. Partida
    events.push({
      type: 'partida',
      label: 'Saída da loja',
      time: cursor,
      duration: 0,
    });

    // Calcular onde encaixar o almoço — após o serviço cuja conclusão fica entre 12h e 14h
    // Para isso, simular passo a passo
    const STEPS = [];
    let simCursor = cursor;
    items.forEach((a, i) => {
      // Tempo de viagem até este serviço
      const travel = a.travelTime || a.travel_time || 15; // fallback 15 min
      simCursor += travel;
      STEPS.push({ idx: i, type: 'viagem', start: simCursor - travel, end: simCursor, travel });
      // Tempo de execução
      const exec = (typeof window.getServiceTime === 'function')
        ? window.getServiceTime(a.service, a.vehicleType || a.vehicle_type, a.calibration)
        : 90;
      STEPS.push({ idx: i, type: 'servico', start: simCursor, end: simCursor + exec, duration: exec, appt: a });
      simCursor += exec;
    });

    // Decidir após qual serviço inserir o almoço
    let lunchAfterIdx = -1;
    for (let i = 0; i < items.length; i++) {
      const svcStep = STEPS.find(s => s.type === 'servico' && s.idx === i);
      if (!svcStep) continue;
      const endHour = svcStep.end / 60;
      if (endHour >= ALMOCO_INICIO_MIN_H && endHour <= ALMOCO_INICIO_MAX_H) {
        lunchAfterIdx = i;
        break;
      }
    }
    // Se nenhum serviço terminou no intervalo, mete almoço quando o cursor passar 12h
    if (lunchAfterIdx === -1) {
      for (let i = 0; i < items.length; i++) {
        const svcStep = STEPS.find(s => s.type === 'servico' && s.idx === i);
        if (svcStep && svcStep.end >= ALMOCO_INICIO_MIN_H * 60) {
          lunchAfterIdx = i;
          break;
        }
      }
    }

    // Construir eventos reais com almoço na posição certa
    cursor = HORA_PARTIDA_H * 60 + HORA_PARTIDA_M;
    items.forEach((a, i) => {
      const travel = a.travelTime || a.travel_time || 15;
      events.push({
        type: 'viagem',
        label: 'Viagem para ' + (a.locality || a.plate),
        time: cursor,
        duration: travel,
      });
      cursor += travel;

      const exec = (typeof window.getServiceTime === 'function')
        ? window.getServiceTime(a.service, a.vehicleType || a.vehicle_type, a.calibration)
        : 90;
      events.push({
        type: 'servico',
        label: a.plate + ' — ' + (a.car || ''),
        sublabel: (a.locality || '') + (a.address ? ' · ' + a.address : ''),
        time: cursor,
        duration: exec,
        appt: a,
      });
      cursor += exec;

      if (i === lunchAfterIdx) {
        events.push({
          type: 'almoco',
          label: 'Almoço',
          time: cursor,
          duration: ALMOCO_DURACAO_MIN,
        });
        cursor += ALMOCO_DURACAO_MIN;
      }
    });

    // Regresso
    const lastItem = items[items.length - 1];
    const returnTime = lastItem?.return_time || 20;
    events.push({
      type: 'regresso',
      label: 'Regresso à loja',
      time: cursor,
      duration: returnTime,
    });
    cursor += returnTime;

    events.push({
      type: 'fim',
      label: 'Chegada à loja',
      time: cursor,
      duration: 0,
    });

    return events;
  }

  // ── Renderizar timeline ───────────────────────────────────────────────
  function renderTimeline() {
    // Ler data do input se modal existir, senão da agenda
    const inp = document.getElementById('tlDateInput');
    const date = inp?.value || getSelectedDate();
    const isToday = date === getDateISO();

    const items = (window.appointments || [])
      .filter(a => {
        if (!a.date) return false;
        return String(a.date).slice(0, 10) === date;
      })
      .filter(a => !!a.locality)
      .sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0));

    const list = document.getElementById('tlContent');

    if (items.length === 0) {
      list.innerHTML = '<div class="tl-empty">Sem serviços agendados para este dia</div>';
      return;
    }

    const events = calcularTimeline(items);
    const now = nowMinutes();
    const tlStart = events[0].time;
    const tlEnd = events[events.length - 1].time;
    const tlSpan = Math.max(tlEnd - tlStart, 1);

    // Construir HTML
    const colorByType = {
      partida: '#16a34a',
      fim: '#16a34a',
      viagem: '#94a3b8',
      servico: '#3b82f6',
      almoco: '#f59e0b',
      regresso: '#94a3b8',
    };
    const iconByType = {
      partida: '🏠',
      fim: '🏠',
      viagem: '🚗',
      servico: '🔧',
      almoco: '🍽️',
      regresso: '🚗',
    };

    let html = '<div class="tl-list">';
    events.forEach((ev, idx) => {
      const isPast = isToday && now > ev.time + (ev.duration || 0);
      const isCurrent = isToday && now >= ev.time && now <= ev.time + (ev.duration || 0);
      let cls = 'tl-event tl-' + ev.type;
      if (isPast) cls += ' tl-past';
      if (isCurrent) cls += ' tl-current';

      html += `
        <div class="${cls}" style="--col:${colorByType[ev.type]}">
          <div class="tl-time">${fmtHM(ev.time)}</div>
          <div class="tl-line"></div>
          <div class="tl-dot">${iconByType[ev.type]}</div>
          <div class="tl-body">
            <div class="tl-label">${ev.label}</div>
            ${ev.sublabel ? `<div class="tl-sub">${ev.sublabel}</div>` : ''}
            ${ev.duration ? `<div class="tl-dur">${fmtDur(ev.duration)}</div>` : ''}
          </div>
        </div>
      `;
    });
    html += '</div>';

    // Linha "agora" — só se for hoje E entre tlStart e tlEnd
    if (isToday && now >= tlStart && now <= tlEnd) {
      const pct = ((now - tlStart) / tlSpan) * 100;
      html += `
        <div class="tl-now-marker" style="top:${pct}%">
          <div class="tl-now-line"></div>
          <div class="tl-now-label">${fmtHM(now)} agora</div>
        </div>
      `;
    }

    list.innerHTML = html;

    // Scroll para evento atual
    if (isToday) {
      setTimeout(() => {
        const cur = list.querySelector('.tl-current');
        if (cur) cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
    }
  }

  // ── Modal ─────────────────────────────────────────────────────────────
  function buildTimelineModal(date) {
    document.getElementById('timelineModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'timelineModal';
    modal.innerHTML = `
      <style>
        #timelineModal {
          position: fixed; inset: 0; z-index: 9998;
          background: #0f172a;
          display: flex; flex-direction: column;
          font-family: 'Figtree', system-ui, sans-serif;
        }
        #timelineModal .tl-topbar {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 16px;
          background: #0f172a;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          flex-shrink: 0;
        }
        #timelineModal .tl-title {
          font-size: 17px; font-weight: 800;
          color: #f1f5f9;
          flex: 1;
        }
        #timelineModal .tl-date {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 20px;
          padding: 4px 12px;
          color: #94a3b8;
          font-size: 13px; font-weight: 600;
          display: flex; align-items: center; gap: 6px;
        }
        #timelineModal .tl-date input {
          background: none; border: none; outline: none;
          color: #e2e8f0; font-size: 13px; font-weight: 700;
          font-family: inherit; cursor: pointer; width: 130px;
        }
        #timelineModal .tl-close {
          width: 36px; height: 36px; border-radius: 50%;
          background: rgba(255,255,255,0.07); border: none;
          color: #94a3b8; font-size: 20px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        #timelineModal .tl-content {
          flex: 1; overflow-y: auto;
          padding: 16px 12px 32px;
          position: relative;
        }
        #timelineModal .tl-empty {
          text-align: center;
          color: #64748b;
          padding: 80px 20px;
          font-size: 14px;
        }
        #timelineModal .tl-list {
          position: relative;
          margin-left: 70px;
        }
        #timelineModal .tl-event {
          position: relative;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 14px;
          padding: 6px 0 12px;
          min-height: 50px;
        }
        #timelineModal .tl-time {
          position: absolute;
          left: -70px;
          top: 6px;
          width: 50px;
          font-size: 13px;
          font-weight: 800;
          color: #cbd5e1;
          font-variant-numeric: tabular-nums;
          font-family: 'Roboto Mono', monospace;
          text-align: right;
        }
        #timelineModal .tl-line {
          position: absolute;
          left: 17px;
          top: 36px;
          bottom: -8px;
          width: 2px;
          background: rgba(255,255,255,0.1);
        }
        #timelineModal .tl-event:last-child .tl-line { display: none; }
        #timelineModal .tl-dot {
          width: 36px; height: 36px;
          border-radius: 50%;
          background: var(--col);
          color: white;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
          z-index: 2;
          box-shadow: 0 0 0 4px #0f172a;
        }
        #timelineModal .tl-body {
          padding-top: 6px;
          min-width: 0;
        }
        #timelineModal .tl-label {
          font-size: 14px;
          font-weight: 700;
          color: #f1f5f9;
          line-height: 1.3;
        }
        #timelineModal .tl-sub {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 2px;
        }
        #timelineModal .tl-dur {
          font-size: 11px;
          color: #64748b;
          margin-top: 4px;
          font-weight: 600;
        }
        #timelineModal .tl-past { opacity: 0.5; }
        #timelineModal .tl-current .tl-label { color: #fbbf24; }
        #timelineModal .tl-current .tl-dot {
          box-shadow: 0 0 0 4px #0f172a, 0 0 0 7px rgba(251,191,36,0.4);
          animation: tlPulse 1.5s infinite;
        }
        @keyframes tlPulse {
          0%, 100% { box-shadow: 0 0 0 4px #0f172a, 0 0 0 7px rgba(251,191,36,0.4); }
          50% { box-shadow: 0 0 0 4px #0f172a, 0 0 0 11px rgba(251,191,36,0.15); }
        }
        #timelineModal .tl-now-marker {
          position: absolute;
          left: 12px;
          right: 12px;
          height: 0;
          z-index: 3;
          pointer-events: none;
        }
        #timelineModal .tl-now-line {
          height: 2px;
          background: #ef4444;
          box-shadow: 0 0 8px rgba(239,68,68,0.6);
        }
        #timelineModal .tl-now-label {
          position: absolute;
          right: 0; top: -10px;
          background: #ef4444;
          color: white;
          font-size: 11px;
          font-weight: 800;
          padding: 3px 10px;
          border-radius: 12px;
          font-family: 'Roboto Mono', monospace;
        }
        #timelineModal .tl-legend {
          background: rgba(255,255,255,0.04);
          border-radius: 10px;
          padding: 8px 12px;
          margin-bottom: 12px;
          font-size: 11px;
          color: #94a3b8;
          display: flex; gap: 12px; flex-wrap: wrap;
        }
        #timelineModal .tl-legend span {
          display: inline-flex; align-items: center; gap: 4px;
        }
      </style>

      <div class="tl-topbar">
        <div class="tl-title">⏱️ Timeline</div>
        <div class="tl-date">📅 <input type="date" id="tlDateInput" value="${date}"></div>
        <button class="tl-close" id="tlClose">✕</button>
      </div>
      <div class="tl-content" id="tlContent"></div>
    `;

    document.body.appendChild(modal);

    document.getElementById('tlClose').onclick = () => modal.remove();
    document.getElementById('tlDateInput').onchange = renderTimeline;

    const onKey = e => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', onKey);
        if (refreshTimer) clearInterval(refreshTimer);
      }
    };
    document.addEventListener('keydown', onKey);

    return modal;
  }

  // Auto-refresh do "agora" a cada minuto se for hoje
  let refreshTimer = null;
  function startRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      const date = getSelectedDate();
      if (date === getDateISO()) renderTimeline();
    }, 60000);
  }

  function getSelectedDateFromInput() {
    const inp = document.getElementById('tlDateInput');
    return inp?.value || getSelectedDate();
  }

  // override para usar o input do modal
  const origGetSelectedDate = getSelectedDate;
  function getSelectedDate2() {
    const inp = document.getElementById('tlDateInput');
    return inp?.value || origGetSelectedDate();
  }

  function openTimeline() {
    const date = getSelectedDate();
    buildTimelineModal(date);
    // Substituir getSelectedDate global para usar input
    window._tlGetDate = () => {
      const inp = document.getElementById('tlDateInput');
      return inp?.value || date;
    };
    renderTimeline();
    startRefresh();
  }

  // sobrescrever getSelectedDate localmente para considerar o input se existir
  const _origGet = getSelectedDate;
  // (não vou expor — uso a função global)

  // Hook do botão
  function init() {
    const btn = document.getElementById('btnTimeline');
    if (btn && !btn._tlHooked) {
      btn._tlHooked = true;
      btn.onclick = openTimeline;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(init, 500);
  setTimeout(init, 2000);
  window.addEventListener('portalReady', init);

  window.openTimeline = openTimeline;
})();
