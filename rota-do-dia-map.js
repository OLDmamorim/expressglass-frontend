// ═══════════════════════════════════════════════════════════════════════════
// rota-do-dia-map.js — Mapa full-screen da Rota do Dia
// Marcadores personalizados com matrícula + cor do card
// Interceta #btnRotaDoDiaDesk e #btnRotaDoDiaMobile
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Cor do marcador conforme estado do agendamento ─────────────────────
  function cardColor(appt) {
    if (appt.executed)          return '#16a34a'; // verde  — realizado
    if (appt.not_done_reason)   return '#dc2626'; // vermelho — não realizado
    if (appt.confirmed === true || appt.confirmed === 'true') return '#1d4ed8'; // azul — confirmado
    return '#d97706';                              // âmbar — pré-agendamento
  }

  // ── SVG do marcador com matrícula ─────────────────────────────────────
  function makeMarkerSVG(plate, color) {
    const w = 96, h = 46, r = 8;
    // Formatar matrícula: garantir maiúsculas
    const label = (plate || '—').toUpperCase();
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="${w-2}" height="${h-14}" rx="${r}" fill="${color}" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
      <polygon points="${w/2-8},${h-14} ${w/2+8},${h-14} ${w/2},${h-1}" fill="${color}"/>
      <text x="${w/2}" y="${(h-14)/2+5}"
        font-family="'Rajdhani','Roboto Mono',monospace"
        font-size="13" font-weight="700"
        fill="white" text-anchor="middle"
        letter-spacing="1">${label}</text>
    </svg>`;
  }

  function markerIcon(plate, color) {
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(makeMarkerSVG(plate, color)),
      scaledSize: new google.maps.Size(96, 46),
      anchor: new google.maps.Point(48, 46),
    };
  }

  // ── Obter dia seleccionado ─────────────────────────────────────────────
  function getSelectedDate() {
    // Tentar ler do estado global do script.js
    if (window.currentMobileDate) return window.currentMobileDate;
    // Tentar ler do elemento de data mobile
    const lbl = document.getElementById('mobileDayLabel');
    if (lbl && lbl.dataset.date) return lbl.dataset.date;
    // Fallback: hoje
    return new Date().toISOString().split('T')[0];
  }

  // ── Obter agendamentos do dia ordenados ───────────────────────────────
  function getDayAppointments(date) {
    return (window.appointments || [])
      .filter(a => a.date === date)
      .sort((a, b) => (a.sortIndex ?? 999) - (b.sortIndex ?? 999));
  }

  // ── Endereço para geocoding ────────────────────────────────────────────
  function apptAddress(appt) {
    if (appt.address && appt.address.trim().length > 5) return appt.address.trim() + ', Portugal';
    if (appt.locality) return appt.locality + ', Portugal';
    return null;
  }

  // ── Período legível ────────────────────────────────────────────────────
  function periodLabel(appt) {
    if (appt.period === 'Manhã') return '🌅 Manhã';
    if (appt.period === 'Tarde') return '🌇 Tarde';
    return '';
  }

  // ── Formatação km ──────────────────────────────────────────────────────
  function fmtKm(m) {
    if (!m) return '';
    return m >= 1000 ? (m/1000).toFixed(1) + ' km' : m + ' m';
  }
  function fmtDur(s) {
    if (!s) return '';
    const m = Math.round(s / 60);
    return m >= 60 ? Math.floor(m/60) + 'h ' + (m%60) + 'min' : m + ' min';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MODAL PRINCIPAL
  // ═══════════════════════════════════════════════════════════════════════

  function buildModal() {
    const existing = document.getElementById('rotaMapModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'rotaMapModal';
    modal.innerHTML = `
      <style>
        #rotaMapModal {
          position: fixed; inset: 0; z-index: 9998;
          background: #0f172a;
          display: flex; flex-direction: column;
          font-family: 'Figtree', system-ui, sans-serif;
        }
        #rotaMapModal .rm-topbar {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 16px;
          background: #0f172a;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          flex-shrink: 0;
        }
        #rotaMapModal .rm-title {
          font-size: 16px; font-weight: 800;
          color: #f1f5f9; letter-spacing: 0.3px;
          flex: 1;
        }
        #rotaMapModal .rm-date-pill {
          display: flex; align-items: center; gap: 6px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 20px; padding: 4px 12px;
          color: #94a3b8; font-size: 13px; font-weight: 600;
        }
        #rotaMapModal .rm-date-input {
          background: none; border: none; outline: none;
          color: #e2e8f0; font-size: 13px; font-weight: 700;
          font-family: inherit; cursor: pointer;
          width: 130px;
        }
        #rotaMapModal .rm-close {
          width: 34px; height: 34px; border-radius: 50%;
          background: rgba(255,255,255,0.07); border: none;
          color: #94a3b8; font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background .15s;
        }
        #rotaMapModal .rm-close:hover { background: rgba(255,255,255,0.15); color: #f1f5f9; }
        #rotaMapModal .rm-body {
          display: flex; flex: 1; overflow: hidden;
        }

        /* ── Painel lateral ── */
        #rotaMapModal .rm-panel {
          width: 300px; flex-shrink: 0;
          background: #0f172a;
          border-right: 1px solid rgba(255,255,255,0.07);
          display: flex; flex-direction: column;
          overflow: hidden;
        }
        #rotaMapModal .rm-stats {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 1px; background: rgba(255,255,255,0.06);
          border-bottom: 1px solid rgba(255,255,255,0.07);
          flex-shrink: 0;
        }
        #rotaMapModal .rm-stat {
          background: #0f172a;
          padding: 10px 14px;
        }
        #rotaMapModal .rm-stat-lbl {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.6px; color: #475569; margin-bottom: 2px;
        }
        #rotaMapModal .rm-stat-val {
          font-size: 18px; font-weight: 900; color: #f1f5f9;
          font-variant-numeric: tabular-nums;
        }
        #rotaMapModal .rm-stops {
          flex: 1; overflow-y: auto;
          padding: 10px 8px;
        }
        #rotaMapModal .rm-stops::-webkit-scrollbar { width: 4px; }
        #rotaMapModal .rm-stops::-webkit-scrollbar-track { background: transparent; }
        #rotaMapModal .rm-stops::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }

        #rotaMapModal .rm-stop {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 10px 8px; border-radius: 10px; margin-bottom: 4px;
          cursor: pointer; transition: background .12s;
        }
        #rotaMapModal .rm-stop:hover { background: rgba(255,255,255,0.05); }
        #rotaMapModal .rm-stop.active { background: rgba(255,255,255,0.08); }

        #rotaMapModal .rm-stop-idx {
          width: 22px; height: 22px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800; flex-shrink: 0; margin-top: 1px;
          color: white;
        }
        #rotaMapModal .rm-stop-plate {
          font-size: 13px; font-weight: 800; color: #f1f5f9;
          font-family: 'Rajdhani', 'Roboto Mono', monospace;
          letter-spacing: 0.5px; line-height: 1.2;
        }
        #rotaMapModal .rm-stop-car {
          font-size: 11px; color: #64748b; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 180px;
        }
        #rotaMapModal .rm-stop-loc {
          font-size: 11px; color: #475569; margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 180px;
        }
        #rotaMapModal .rm-stop-leg {
          font-size: 10px; color: #334155; margin-top: 3px;
          display: flex; gap: 6px;
        }
        #rotaMapModal .rm-connector {
          width: 1px; background: rgba(255,255,255,0.08);
          margin: 0 10px 0 18px; height: 14px; flex-shrink: 0;
        }
        #rotaMapModal .rm-no-stops {
          text-align: center; padding: 40px 16px;
          color: #475569; font-size: 13px;
        }

        /* ── Mapa ── */
        #rotaMapModal .rm-map-wrap {
          flex: 1; position: relative;
        }
        #rotaMapModal #rotaGoogleMap {
          width: 100%; height: 100%;
        }
        #rotaMapModal .rm-loading {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: #0f172a; color: #64748b;
          font-size: 14px; gap: 12px;
        }
        #rotaMapModal .rm-spinner {
          width: 36px; height: 36px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: rmSpin .8s linear infinite;
        }
        @keyframes rmSpin { to { transform: rotate(360deg); } }
        #rotaMapModal .rm-err {
          position: absolute; inset: 0;
          display: none; flex-direction: column;
          align-items: center; justify-content: center;
          background: #0f172a; color: #ef4444;
          font-size: 14px; gap: 8px; padding: 32px;
          text-align: center;
        }

        /* ── Mobile: painel escorrega de baixo ── */
        @media (max-width: 700px) {
          #rotaMapModal .rm-body { flex-direction: column-reverse; }
          #rotaMapModal .rm-panel {
            width: 100%; height: 220px;
            border-right: none; border-top: 1px solid rgba(255,255,255,0.07);
          }
          #rotaMapModal .rm-stops { padding: 6px; }
          #rotaMapModal .rm-stop { padding: 8px 6px; }
        }
      </style>

      <div class="rm-topbar">
        <div class="rm-title">📍 Rota do Dia</div>
        <div class="rm-date-pill">
          📅 <input type="date" id="rotaDateInput" class="rm-date-input" />
        </div>
        <button class="rm-close" id="rotaMapClose">✕</button>
      </div>

      <div class="rm-body">
        <div class="rm-panel">
          <div class="rm-stats">
            <div class="rm-stat">
              <div class="rm-stat-lbl">Paragens</div>
              <div class="rm-stat-val" id="rmStatStops">—</div>
            </div>
            <div class="rm-stat">
              <div class="rm-stat-lbl">Distância</div>
              <div class="rm-stat-val" id="rmStatDist">—</div>
            </div>
            <div class="rm-stat">
              <div class="rm-stat-lbl">Tempo viagem</div>
              <div class="rm-stat-val" id="rmStatTime">—</div>
            </div>
            <div class="rm-stat">
              <div class="rm-stat-lbl">Com morada</div>
              <div class="rm-stat-val" id="rmStatAddr">—</div>
            </div>
          </div>
          <div class="rm-stops" id="rmStopList"></div>
        </div>

        <div class="rm-map-wrap">
          <div id="rotaGoogleMap"></div>
          <div class="rm-loading" id="rmLoading">
            <div class="rm-spinner"></div>
            A calcular rota...
          </div>
          <div class="rm-err" id="rmError"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    return modal;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LÓGICA DO MAPA
  // ═══════════════════════════════════════════════════════════════════════

  let mapInstance = null;
  let directionsRenderer = null;
  let activeMarkers = [];

  function clearMap() {
    activeMarkers.forEach(m => m.setMap(null));
    activeMarkers = [];
    if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
  }

  async function renderRoute(date) {
    const loading = document.getElementById('rmLoading');
    const errDiv  = document.getElementById('rmError');
    const stopList = document.getElementById('rmStopList');

    if (loading) loading.style.display = 'flex';
    if (errDiv)  errDiv.style.display  = 'none';

    const appts = getDayAppointments(date);
    const withAddr = appts.filter(a => apptAddress(a));

    // Estatísticas
    document.getElementById('rmStatStops').textContent = appts.length;
    document.getElementById('rmStatAddr').textContent  = withAddr.length + '/' + appts.length;

    // Lista de paragens (todos, com ou sem morada)
    renderStopList(appts);

    if (!mapInstance) {
      mapInstance = new google.maps.Map(document.getElementById('rotaGoogleMap'), {
        zoom: 10,
        center: { lat: 41.55, lng: -8.43 }, // Braga por defeito
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: darkMapStyle(),
      });
      directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true, // vamos usar os nossos marcadores
        polylineOptions: {
          strokeColor: '#3b82f6',
          strokeOpacity: 0.85,
          strokeWeight: 4,
        },
      });
      directionsRenderer.setMap(mapInstance);
      // Forçar resize para garantir que o mapa ocupa o espaço correto
      google.maps.event.trigger(mapInstance, 'resize');
    }

    clearMap();

    if (withAddr.length === 0) {
      if (loading) loading.style.display = 'none';
      document.getElementById('rmStatDist').textContent = '—';
      document.getElementById('rmStatTime').textContent = '—';
      // Mostrar apenas pins sem rota
      appts.forEach((a, i) => {
        // Sem endereço não conseguimos posicionar
      });
      return;
    }

    // Calcular rota via Directions API
    const dirSvc = new google.maps.DirectionsService();
    const addresses = withAddr.map(a => apptAddress(a));

    // Base da loja como ponto de partida e chegada
    const baseAddr = window.basePartidaDoDia
      || window.portalConfig?.departureAddress
      || (typeof getBasePartida === 'function' ? getBasePartida() : null)
      || null;

    // Com base: origin=base, destination=base, waypoints=todos os agendamentos
    // Sem base: origin=1º agendamento, destination=último, waypoints=intermédios
    const origin      = baseAddr || addresses[0];
    const destination = baseAddr || addresses[addresses.length - 1];
    const waypoints   = baseAddr
      ? addresses.map(addr => ({ location: addr, stopover: true }))
      : addresses.slice(1, -1).map(addr => ({ location: addr, stopover: true }));

    try {
      const result = await new Promise((resolve, reject) => {
        dirSvc.route({
          origin,
          destination,
          waypoints,
          travelMode: google.maps.TravelMode.DRIVING,
          optimizeWaypoints: false, // respeitar a ordem dos cards
        }, (res, status) => {
          if (status === 'OK') resolve(res);
          else reject(new Error('Directions API: ' + status));
        });
      });

      directionsRenderer.setDirections(result);

      // Somar distância e duração total
      let totalDist = 0, totalDur = 0;
      result.routes[0].legs.forEach(leg => {
        totalDist += leg.distance.value;
        totalDur  += leg.duration.value;
      });
      document.getElementById('rmStatDist').textContent = fmtKm(totalDist);
      document.getElementById('rmStatTime').textContent = fmtDur(totalDur);

      // Colocar marcadores personalizados nos pontos da rota
      result.routes[0].legs.forEach((leg, i) => {
        const appt  = withAddr[i];
        const color = cardColor(appt);
        const pos   = leg.start_location;

        const marker = new google.maps.Marker({
          position: pos,
          map: mapInstance,
          icon: markerIcon(appt.plate, color),
          zIndex: 100 + i,
          title: appt.plate + (appt.car ? ' — ' + appt.car : ''),
        });

        // InfoWindow ao clicar
        const iw = new google.maps.InfoWindow({
          content: `
            <div style="font-family:system-ui;font-size:13px;min-width:160px;">
              <div style="font-weight:800;font-size:15px;margin-bottom:4px;">${appt.plate}</div>
              <div style="color:#475569;margin-bottom:2px;">${appt.car || ''}</div>
              <div style="color:#64748b;font-size:12px;">${apptAddress(appt) || ''}</div>
              ${appt.notes ? `<div style="color:#64748b;font-size:11px;margin-top:4px;">${appt.notes}</div>` : ''}
            </div>
          `,
        });
        marker.addListener('click', () => iw.open(mapInstance, marker));
        activeMarkers.push(marker);

        // Marcador do ponto final — é o appt seguinte (i+1), não o atual
        if (i === result.routes[0].legs.length - 1) {
          const lastAppt = withAddr[i + 1] || withAddr[i];
          const lastMarker = new google.maps.Marker({
            position: leg.end_location,
            map: mapInstance,
            icon: markerIcon(lastAppt.plate, cardColor(lastAppt)),
            zIndex: 200,
            title: lastAppt.plate,
          });
          activeMarkers.push(lastMarker);
        }
      });

      // Highlight parada ao clicar na lista
      withAddr.forEach((appt, i) => {
        const stopEl = document.getElementById('rmStop-' + appt.id);
        if (stopEl) {
          stopEl.addEventListener('click', () => {
            document.querySelectorAll('.rm-stop').forEach(s => s.classList.remove('active'));
            stopEl.classList.add('active');
            if (activeMarkers[i]) {
              mapInstance.panTo(activeMarkers[i].getPosition());
              mapInstance.setZoom(14);
              google.maps.event.trigger(activeMarkers[i], 'click');
            }
          });
        }
      });

      if (loading) loading.style.display = 'none';

      // Pin da base (partida/chegada) — geocodificado separadamente
      if (baseAddr) {
        new google.maps.Geocoder().geocode({ address: baseAddr }, (r, s) => {
          if (s !== 'OK' || !r || !r[0]) return;
          const basePt = r[0].geometry.location;
          const baseMarker = new google.maps.Marker({
            position: basePt,
            map: mapInstance,
            zIndex: 300,
            title: 'Base SM',
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#f59e0b',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2.5,
            },
          });
          const iw = new google.maps.InfoWindow({
            content: '<div style="font-size:13px;font-weight:700;">🏠 Base SM</div><div style="font-size:11px;color:#64748b;">' + baseAddr + '</div>'
          });
          baseMarker.addListener('click', () => iw.open(mapInstance, baseMarker));
          activeMarkers.push(baseMarker);
        });
      }

    } catch (e) {
      console.error('[RotaMapa]', e);
      if (loading) loading.style.display = 'none';

      // Fallback: mostrar marcadores sem rota (geocoding individual)
      document.getElementById('rmStatDist').textContent = '—';
      document.getElementById('rmStatTime').textContent = '—';

      const geocoder = new google.maps.Geocoder();
      const bounds = new google.maps.LatLngBounds();

      for (let i = 0; i < withAddr.length; i++) {
        const appt = withAddr[i];
        try {
          const geoRes = await new Promise((res, rej) =>
            geocoder.geocode({ address: apptAddress(appt) }, (r, s) =>
              s === 'OK' ? res(r) : rej(s)
            )
          );
          const pos   = geoRes[0].geometry.location;
          const color = cardColor(appt);
          const marker = new google.maps.Marker({
            position: pos,
            map: mapInstance,
            icon: markerIcon(appt.plate, color),
            zIndex: 100 + i,
            title: appt.plate,
          });
          activeMarkers.push(marker);
          bounds.extend(pos);
        } catch (_) {}
      }
      if (!bounds.isEmpty()) mapInstance.fitBounds(bounds);
    }
  }

  // ── Lista de paragens no painel ────────────────────────────────────────
  function renderStopList(appts) {
    const list = document.getElementById('rmStopList');
    if (!list) return;

    if (appts.length === 0) {
      list.innerHTML = `<div class="rm-no-stops">Sem agendamentos para este dia</div>`;
      return;
    }

    let html = '';
    appts.forEach((a, i) => {
      const color = cardColor(a);
      const addr  = apptAddress(a);
      const period = periodLabel(a);
      html += `
        <div class="rm-stop" id="rmStop-${a.id}" data-idx="${i}">
          <div class="rm-stop-idx" style="background:${color}">${i + 1}</div>
          <div style="flex:1;min-width:0;">
            <div class="rm-stop-plate">${a.plate || '—'}</div>
            <div class="rm-stop-car">${a.car || ''} ${period}</div>
            ${addr ? `<div class="rm-stop-loc">📍 ${addr.replace(', Portugal','')}</div>` : '<div class="rm-stop-loc" style="color:#dc2626">⚠ Sem morada</div>'}
          </div>
        </div>
        ${i < appts.length - 1 ? '<div class="rm-connector"></div>' : ''}
      `;
    });
    list.innerHTML = html;
  }

  // ── Estilo dark do mapa ────────────────────────────────────────────────
  function darkMapStyle() {
    return [
      { elementType: 'geometry', stylers: [{ color: '#1a2332' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#1a2332' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#748498' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#253345' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1c2d3e' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c4a6e' }] },
      { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f3a56' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1f2f' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2d4a6e' }] },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ABRIR / FECHAR
  // ═══════════════════════════════════════════════════════════════════════

  function openRotaMap(date) {
    if (!window.google?.maps) {
      alert('Google Maps ainda não carregou. Aguarda um momento e tenta novamente.');
      return;
    }

    const modal = buildModal();

    // Data inicial
    const dateInput = document.getElementById('rotaDateInput');
    dateInput.value = date || getSelectedDate();

    // Fechar
    document.getElementById('rotaMapClose').addEventListener('click', () => {
      modal.remove();
      mapInstance = null;
      directionsRenderer = null;
      activeMarkers = [];
    });

    // Mudar data
    dateInput.addEventListener('change', () => {
      if (dateInput.value) renderRoute(dateInput.value);
    });

    // Fechar com Escape
    const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    // Renderizar — requestAnimationFrame garante que o flex layout já tem dimensões
    requestAnimationFrame(() => renderRoute(dateInput.value));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INTERCEPTAR BOTÕES EXISTENTES
  // ═══════════════════════════════════════════════════════════════════════

  function hookButtons() {
    // Desktop: #btnRotaDoDiaDesk
    const desk = document.getElementById('btnRotaDoDiaDesk');
    if (desk) {
      desk.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        openRotaMap(getSelectedDate());
      }, true); // capture para correr antes do handler original
    }

    // Mobile: #btnRotaDoDia (pode ter outro id)
    ['btnRotaDoDia', 'btnRotaDoDiaMobile', 'rotaDoDiaBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          openRotaMap(getSelectedDate());
        }, true);
      }
    });

    // Botão verde "Ver Rota do Dia" no totalizador mobile
    document.querySelectorAll('[id*="RotaDia"], [id*="rotaDia"], [id*="rota-dia"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        openRotaMap(getSelectedDate());
      }, true);
    });

    // Botão "📍 Ver Rota" verde (classe específica do screenshot)
    document.querySelectorAll('.rota-dia-btn, .ver-rota-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        openRotaMap(getSelectedDate());
      }, true);
    });
  }

  // ── Arrancar ──────────────────────────────────────────────────────────
  function init() {
    // Sobrescrever openRotaDoDia do script.js — assim todos os botões usam o mapa
    window.openRotaDoDia = function() {
      const date = window.currentMobileDay
        ? window.currentMobileDay.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      openRotaMap(date);
    };

    // Sobrescrever onclick do botão desktop (por precaução)
    const desk = document.getElementById('btnRotaDoDiaDesk');
    if (desk) desk.onclick = () => window.openRotaDoDia();

    // Expor para chamada directa
    window.openRotaDoMapa = openRotaMap;
  }

  // ── Wrap de renderMobileDay para injectar botão em lojas ────────────
  // O script.js usa list.innerHTML = ... por isso o MutationObserver não chega
  // Fazemos wrap à função global após ela estar definida
  function patchRenderMobileDay() {
    if (window._rmPatched) return;
    if (typeof window.renderMobileDay !== 'function') return;
    window._rmPatched = true;

    const _orig = window.renderMobileDay;
    window.renderMobileDay = async function() {
      await _orig.apply(this, arguments);
      injectRotaBtnIfNeeded();
    };
    console.log('[RotaMapa] renderMobileDay patchado');
  }

  function injectRotaBtnIfNeeded() {
    const list = document.getElementById('mobileDayList');
    if (!list) return;
    // Se o script.js já injectou o botão (SMs), não duplicar
    if (list.querySelector('[onclick*="openRotaDoDia"]')) return;
    if (list.querySelector('.rm-rota-btn')) return;

    // Verificar se há moradas no dia
    const dateStr = window.currentMobileDay
      ? window.currentMobileDay.toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];
    const temMoradas = (window.appointments || []).some(a => a.date === dateStr && !!a.address);
    if (!temMoradas) return;

    const btn = document.createElement('button');
    btn.className = 'rm-rota-btn';
    btn.style.cssText = 'width:100%;margin:0 0 12px;padding:13px;border:none;border-radius:14px;' +
      'background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;' +
      'font-size:15px;font-weight:800;letter-spacing:0.3px;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;gap:8px;' +
      'box-shadow:0 4px 12px rgba(22,163,74,0.35);font-family:inherit;';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"></path></svg> 🗺️ Ver Rota do Dia';
    btn.onclick = () => window.openRotaDoDia();

    // Inserir antes do primeiro card (após summary se existir)
    const firstCard = list.querySelector('.m-card');
    if (firstCard) list.insertBefore(btn, firstCard);
    else list.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Garantir override após script.js definir renderMobileDay
  setTimeout(() => { init(); patchRenderMobileDay(); }, 400);
  setTimeout(() => { init(); patchRenderMobileDay(); }, 1500);
  window.addEventListener('portalReady', () => { init(); patchRenderMobileDay(); });

})();