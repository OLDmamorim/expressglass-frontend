// ═══════════════════════════════════════════════════════════════════════════
// rota-do-dia-map.js — v2 — Mapa multi-portal (SM + Pesados)
// Checkboxes no topo do mapa para combinar rotas de vários portais.
// Cada portal: cor própria, base própria, rota própria.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Paleta de cores por portal (até 8 cores)
  const PORTAL_COLORS = [
    '#3b82f6', // azul
    '#16a34a', // verde
    '#dc2626', // vermelho
    '#d97706', // âmbar
    '#7c3aed', // roxo
    '#0891b2', // ciano
    '#db2777', // rosa
    '#ea580c', // laranja
  ];

  function colorForIndex(i) { return PORTAL_COLORS[i % PORTAL_COLORS.length]; }

  // ── SVG do marcador com matrícula ─────────────────────────────────────
  function makeMarkerSVG(plate, color) {
    const w = 96, h = 46, r = 8;
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

  // ── Helpers ────────────────────────────────────────────────────────────
  function getSelectedDate() {
    if (window.currentMobileDate) return window.currentMobileDate;
    if (window.currentMobileDay) return window.currentMobileDay.toISOString().split('T')[0];
    const lbl = document.getElementById('mobileDayLabel');
    if (lbl && lbl.dataset.date) return lbl.dataset.date;
    return new Date().toISOString().split('T')[0];
  }

  function apptAddress(appt) {
    if (appt.address && appt.address.trim().length > 5) return appt.address.trim() + ', Portugal';
    if (appt.locality) return appt.locality + ', Portugal';
    return null;
  }

  function fmtKm(m) {
    if (!m) return '0 km';
    return m >= 1000 ? (m/1000).toFixed(1) + ' km' : m + ' m';
  }

  function fmtDur(s) {
    if (!s) return '0 min';
    const m = Math.round(s / 60);
    return m >= 60 ? Math.floor(m/60) + 'h ' + (m%60) + 'min' : m + ' min';
  }

  // ── Lista dos portais a que o utilizador tem acesso (SM + Pesados) ────
  function getAvailablePortals() {
    const user = window.authClient?.getUser?.();
    if (!user) return [];
    let portals = [];
    if (Array.isArray(user.portals) && user.portals.length) {
      portals = user.portals;
    } else if (user.portal) {
      portals = [user.portal];
    }
    // Aceitar SM e Pesados (lojas têm rota fixa, sem sentido aqui)
    return portals.filter(p => {
      const t = p.portalType || p.portal_type;
      return t === 'sm' || t === 'pesados';
    });
  }

  // ── Buscar agendamentos de um portal (com cache em memória) ───────────
  const apptCache = new Map(); // key = portal_id+'_'+date
  async function fetchAppointments(portalId, date) {
    const key = portalId + '_' + date;
    if (apptCache.has(key)) return apptCache.get(key);

    const token = window.authClient?.getToken?.() || localStorage.getItem('authToken');
    const resp = await fetch('/.netlify/functions/appointments?portal_id=' + portalId, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await resp.json();
    if (!data.success) {
      console.warn('[RotaMapa] Erro a buscar appointments do portal', portalId, data.error);
      return [];
    }
    const onDay = (data.data || [])
      .filter(a => a.date === date)
      .sort((a, b) => (a.sortIndex ?? 999) - (b.sortIndex ?? 999));
    apptCache.set(key, onDay);
    return onDay;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MODAL
  // ═══════════════════════════════════════════════════════════════════════

  function buildModal(portals, currentPortalId) {
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
          flex-shrink: 0; flex-wrap: wrap;
        }
        #rotaMapModal .rm-title {
          font-size: 16px; font-weight: 800;
          color: #f1f5f9; letter-spacing: 0.3px;
          flex: 1; min-width: 100px;
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
          font-family: inherit; cursor: pointer; width: 130px;
        }
        #rotaMapModal .rm-close {
          width: 34px; height: 34px; border-radius: 50%;
          background: rgba(255,255,255,0.07); border: none;
          color: #94a3b8; font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background .15s;
        }
        #rotaMapModal .rm-close:hover { background: rgba(255,255,255,0.15); color: #f1f5f9; }

        /* ── Filtros de portais ── */
        #rotaMapModal .rm-portals {
          display: flex; gap: 6px; padding: 8px 16px; overflow-x: auto;
          background: #0b1422;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0; -webkit-overflow-scrolling: touch;
        }
        #rotaMapModal .rm-portals::-webkit-scrollbar { height: 4px; }
        #rotaMapModal .rm-portals::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
        #rotaMapModal .rm-portal-chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 20px;
          background: rgba(255,255,255,0.04);
          border: 1.5px solid rgba(255,255,255,0.1);
          color: #94a3b8; font-size: 12px; font-weight: 700;
          cursor: pointer; white-space: nowrap;
          transition: all .15s; user-select: none;
        }
        #rotaMapModal .rm-portal-chip:hover {
          background: rgba(255,255,255,0.08); color: #e2e8f0;
        }
        #rotaMapModal .rm-portal-chip.active {
          color: #fff; background: rgba(59,130,246,0.15);
        }
        #rotaMapModal .rm-portal-chip .dot {
          width: 10px; height: 10px; border-radius: 50%;
          flex-shrink: 0;
        }
        #rotaMapModal .rm-portal-chip .check {
          width: 14px; height: 14px; border-radius: 4px;
          border: 1.5px solid currentColor;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; line-height: 1;
        }
        #rotaMapModal .rm-portal-chip.active .check::after {
          content: '✓'; color: currentColor;
        }

        #rotaMapModal .rm-body {
          display: flex; flex: 1; overflow: hidden; min-height: 0;
        }

        /* ── Painel ── */
        #rotaMapModal .rm-panel {
          width: 320px; flex-shrink: 0;
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
        #rotaMapModal .rm-stops::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        #rotaMapModal .rm-portal-group {
          margin-bottom: 14px;
        }
        #rotaMapModal .rm-portal-header {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 8px; margin-bottom: 4px;
          font-size: 11px; font-weight: 800; letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        #rotaMapModal .rm-portal-header .dot {
          width: 8px; height: 8px; border-radius: 50%;
        }
        #rotaMapModal .rm-stop {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 8px; border-radius: 8px; margin-bottom: 3px;
          cursor: pointer; transition: background .12s;
        }
        #rotaMapModal .rm-stop:hover { background: rgba(255,255,255,0.05); }
        #rotaMapModal .rm-stop-idx {
          width: 22px; height: 22px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800; flex-shrink: 0;
          color: white;
        }
        #rotaMapModal .rm-stop-plate {
          font-size: 13px; font-weight: 800; color: #f1f5f9;
          font-family: 'Rajdhani','Roboto Mono',monospace;
          letter-spacing: 0.5px; line-height: 1.2;
        }
        #rotaMapModal .rm-stop-car {
          font-size: 11px; color: #64748b; font-weight: 500;
        }
        #rotaMapModal .rm-stop-loc {
          font-size: 11px; color: #475569; margin-top: 2px;
        }
        #rotaMapModal .rm-no-stops {
          text-align: center; padding: 20px 12px;
          color: #475569; font-size: 12px; font-style: italic;
        }

        /* ── Mapa ── */
        #rotaMapModal .rm-map-wrap { flex: 1; position: relative; min-height: 0; }
        #rotaMapModal #rotaGoogleMap { width: 100%; height: 100%; }
        #rotaMapModal .rm-loading {
          position: absolute; inset: 0;
          display: none; flex-direction: column;
          align-items: center; justify-content: center;
          background: rgba(15,23,42,0.85); color: #cbd5e1;
          font-size: 14px; gap: 12px; z-index: 5;
        }
        #rotaMapModal .rm-spinner {
          width: 36px; height: 36px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: rmSpin .8s linear infinite;
        }
        @keyframes rmSpin { to { transform: rotate(360deg); } }

        @media (max-width: 700px) {
          #rotaMapModal .rm-body { flex-direction: column-reverse; }
          #rotaMapModal .rm-panel {
            width: 100%; height: 240px;
            border-right: none; border-top: 1px solid rgba(255,255,255,0.07);
          }
        }
      </style>

      <div class="rm-topbar">
        <div class="rm-title">📍 Rota do Dia</div>
        <div class="rm-date-pill">
          📅 <input type="date" id="rotaDateInput" class="rm-date-input" />
        </div>
        <button class="rm-close" id="rotaMapClose">✕</button>
      </div>

      <div class="rm-portals" id="rmPortalChips"></div>

      <div class="rm-body">
        <div class="rm-panel">
          <div class="rm-stats">
            <div class="rm-stat"><div class="rm-stat-lbl">Paragens</div><div class="rm-stat-val" id="rmStatStops">—</div></div>
            <div class="rm-stat"><div class="rm-stat-lbl">Distância total</div><div class="rm-stat-val" id="rmStatDist">—</div></div>
            <div class="rm-stat"><div class="rm-stat-lbl">Tempo viagem</div><div class="rm-stat-val" id="rmStatTime">—</div></div>
            <div class="rm-stat"><div class="rm-stat-lbl">Portais</div><div class="rm-stat-val" id="rmStatPortals">—</div></div>
          </div>
          <div class="rm-stops" id="rmStopList"></div>
        </div>
        <div class="rm-map-wrap">
          <div id="rotaGoogleMap"></div>
          <div class="rm-loading" id="rmLoading">
            <div class="rm-spinner"></div>
            <span id="rmLoadingText">A calcular rotas...</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Renderizar chips de portais
    const chipsContainer = document.getElementById('rmPortalChips');
    portals.forEach((p, i) => {
      const color = colorForIndex(i);
      const chip = document.createElement('div');
      chip.className = 'rm-portal-chip';
      chip.dataset.portalId = p.id;
      chip.dataset.color = color;
      chip.innerHTML = `
        <span class="check"></span>
        <span class="dot" style="background:${color}"></span>
        <span>${p.name}</span>
      `;
      if (p.id === currentPortalId) chip.classList.add('active');
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        scheduleRender();
      });
      chipsContainer.appendChild(chip);
    });

    return modal;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER (com debounce para evitar redraws ao clicar rapidamente)
  // ═══════════════════════════════════════════════════════════════════════

  let mapInstance = null;
  let activeOverlays = []; // markers + renderers

  function clearMap() {
    activeOverlays.forEach(o => {
      if (o.setMap) o.setMap(null);
      if (o.setDirections) o.setDirections({ routes: [] });
    });
    activeOverlays = [];
  }

  function darkMapStyle() {
    return [
      { elementType: 'geometry', stylers: [{ color: '#1a2332' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#1a2332' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#748498' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#253345' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1c2d3e' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c4a6e' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1f2f' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2d4a6e' }] },
    ];
  }

  function ensureMap() {
    if (mapInstance) return mapInstance;
    mapInstance = new google.maps.Map(document.getElementById('rotaGoogleMap'), {
      zoom: 9,
      center: { lat: 41.55, lng: -8.43 },
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      styles: darkMapStyle(),
    });
    return mapInstance;
  }

  let _renderTimer = null;
  function scheduleRender() {
    if (_renderTimer) clearTimeout(_renderTimer);
    _renderTimer = setTimeout(renderAll, 150);
  }

  async function renderAll() {
    const date = document.getElementById('rotaDateInput').value;
    const chips = [...document.querySelectorAll('.rm-portal-chip.active')];
    const portalsActivos = chips.map(c => ({
      id: parseInt(c.dataset.portalId),
      color: c.dataset.color,
      name: c.querySelector('span:last-child').textContent
    }));

    document.getElementById('rmStatPortals').textContent = portalsActivos.length || '—';

    const map = ensureMap();
    clearMap();

    const stopList = document.getElementById('rmStopList');
    stopList.innerHTML = '';

    const loading = document.getElementById('rmLoading');
    if (loading) loading.style.display = 'flex';

    if (portalsActivos.length === 0) {
      document.getElementById('rmStatStops').textContent = '—';
      document.getElementById('rmStatDist').textContent = '—';
      document.getElementById('rmStatTime').textContent = '—';
      stopList.innerHTML = '<div class="rm-no-stops">Selecione pelo menos 1 portal acima</div>';
      if (loading) loading.style.display = 'none';
      return;
    }

    let totalStops = 0, totalDist = 0, totalDur = 0;
    const allBounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    // Buscar appointments de cada portal e desenhar
    for (const portal of portalsActivos) {
      const allPortals = window._rmAllPortals || [];
      const portalFull = allPortals.find(p => p.id === portal.id);
      const baseAddr = portalFull?.departureAddress || portalFull?.departure_address || null;

      const appts = await fetchAppointments(portal.id, date);
      totalStops += appts.length;

      // Lista no painel
      const group = document.createElement('div');
      group.className = 'rm-portal-group';
      group.innerHTML = `
        <div class="rm-portal-header" style="color:${portal.color}">
          <span class="dot" style="background:${portal.color}"></span>
          <span>${portal.name}</span>
          <span style="margin-left:auto;color:#475569;font-weight:600;">${appts.length} ${appts.length === 1 ? 'paragem' : 'paragens'}</span>
        </div>
      `;
      if (appts.length === 0) {
        group.innerHTML += '<div class="rm-no-stops">Sem agendamentos neste dia</div>';
      } else {
        appts.forEach((a, i) => {
          const addr = apptAddress(a);
          const stop = document.createElement('div');
          stop.className = 'rm-stop';
          stop.innerHTML = `
            <div class="rm-stop-idx" style="background:${portal.color}">${i + 1}</div>
            <div style="flex:1;min-width:0;">
              <div class="rm-stop-plate">${a.plate || '—'}</div>
              <div class="rm-stop-car">${a.car || ''}</div>
              ${addr ? `<div class="rm-stop-loc">📍 ${addr.replace(', Portugal','')}</div>` : '<div class="rm-stop-loc" style="color:#dc2626">⚠ Sem morada</div>'}
            </div>
          `;
          group.appendChild(stop);
        });
      }
      stopList.appendChild(group);

      // Desenhar no mapa (só agendamentos com morada)
      const withAddr = appts.filter(a => apptAddress(a));
      if (withAddr.length === 0) continue;

      const result = await calcRoute(baseAddr, withAddr);
      if (!result) continue;

      // Polyline da rota
      const renderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: portal.color,
          strokeOpacity: 0.85,
          strokeWeight: 4,
        },
        map: map,
      });
      renderer.setDirections(result);
      activeOverlays.push(renderer);

      // Markers nas paragens
      const legOffset = baseAddr ? 1 : 0;
      result.routes[0].legs.forEach((leg, i) => {
        let appt, pos;
        if (baseAddr) {
          if (i < withAddr.length) {
            appt = withAddr[i];
            pos = leg.end_location;
          } else return;
        } else {
          appt = withAddr[i];
          pos = leg.start_location;
          if (i === result.routes[0].legs.length - 1) {
            const last = withAddr[i + 1] || withAddr[i];
            const lm = new google.maps.Marker({
              position: leg.end_location, map: map,
              icon: markerIcon(last.plate, portal.color), zIndex: 200,
            });
            activeOverlays.push(lm);
            allBounds.extend(leg.end_location); hasBounds = true;
          }
        }
        if (!appt) return;
        const m = new google.maps.Marker({
          position: pos, map: map,
          icon: markerIcon(appt.plate, portal.color),
          zIndex: 100 + i,
          title: appt.plate + (appt.car ? ' — ' + appt.car : ''),
        });
        const iw = new google.maps.InfoWindow({
          content: `<div style="font-family:system-ui;font-size:13px;min-width:180px;">
            <div style="font-weight:800;font-size:15px;margin-bottom:4px;color:${portal.color};">${appt.plate}</div>
            <div style="color:#475569;margin-bottom:2px;">${appt.car || ''}</div>
            <div style="color:#64748b;font-size:12px;">${apptAddress(appt) || ''}</div>
            <div style="color:#94a3b8;font-size:11px;margin-top:6px;font-style:italic;">${portal.name}</div>
          </div>`,
        });
        m.addListener('click', () => iw.open(map, m));
        activeOverlays.push(m);
        allBounds.extend(pos); hasBounds = true;
      });

      // Marker base
      if (baseAddr) {
        try {
          const baseGeo = await new Promise((res, rej) =>
            new google.maps.Geocoder().geocode({ address: baseAddr },
              (r, s) => s === 'OK' && r[0] ? res(r[0].geometry.location) : rej(s)
            )
          );
          const bm = new google.maps.Marker({
            position: baseGeo, map: map, zIndex: 300,
            title: 'Base ' + portal.name,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 11, fillColor: portal.color, fillOpacity: 1,
              strokeColor: '#fff', strokeWeight: 2.5,
            },
          });
          const biw = new google.maps.InfoWindow({
            content: `<div style="font-size:13px;font-weight:700;color:${portal.color};">🏠 Base ${portal.name}</div>
              <div style="font-size:11px;color:#64748b;margin-top:4px;">${baseAddr}</div>`,
          });
          bm.addListener('click', () => biw.open(map, bm));
          activeOverlays.push(bm);
          allBounds.extend(baseGeo); hasBounds = true;
        } catch(e) {
          console.warn('[RotaMapa] Base não geocodificada:', portal.name);
        }
      }

      // Somar totais
      result.routes[0].legs.forEach(leg => {
        totalDist += leg.distance.value;
        totalDur += leg.duration.value;
      });
    }

    document.getElementById('rmStatStops').textContent = totalStops;
    document.getElementById('rmStatDist').textContent = fmtKm(totalDist);
    document.getElementById('rmStatTime').textContent = fmtDur(totalDur);

    if (hasBounds) {
      map.fitBounds(allBounds, { top: 60, right: 40, bottom: 40, left: 40 });
    }

    if (loading) loading.style.display = 'none';
  }

  async function calcRoute(baseAddr, withAddr) {
    const dirSvc = new google.maps.DirectionsService();
    const addresses = withAddr.map(a => apptAddress(a));
    const origin = baseAddr || addresses[0];
    const destination = baseAddr || addresses[addresses.length - 1];
    const waypoints = baseAddr
      ? addresses.map(addr => ({ location: addr, stopover: true }))
      : addresses.slice(1, -1).map(addr => ({ location: addr, stopover: true }));

    try {
      return await new Promise((resolve, reject) => {
        dirSvc.route({
          origin, destination, waypoints,
          travelMode: google.maps.TravelMode.DRIVING,
          optimizeWaypoints: false,
        }, (res, status) => {
          if (status === 'OK') resolve(res);
          else reject(new Error('Directions: ' + status));
        });
      });
    } catch(e) {
      console.warn('[RotaMapa] Directions falhou:', e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ABRIR / FECHAR
  // ═══════════════════════════════════════════════════════════════════════

  function openRotaMap(date) {
    if (!window.google?.maps) {
      alert('Google Maps ainda não carregou. Aguarda um momento.');
      return;
    }

    const portals = getAvailablePortals();
    if (portals.length === 0) {
      alert('Não há SMs ou Pesados disponíveis para mostrar.');
      return;
    }

    // Guardar lista completa (com morada) para uso interno
    window._rmAllPortals = portals;

    const currentPortalId = window.portalConfig?.id || portals[0].id;
    apptCache.clear();

    buildModal(portals, currentPortalId);

    const dateInput = document.getElementById('rotaDateInput');
    dateInput.value = date || getSelectedDate();

    document.getElementById('rotaMapClose').addEventListener('click', () => {
      document.getElementById('rotaMapModal')?.remove();
      mapInstance = null;
      activeOverlays = [];
    });

    dateInput.addEventListener('change', () => {
      apptCache.clear();
      scheduleRender();
    });

    const onKey = e => {
      if (e.key === 'Escape') {
        document.getElementById('rotaMapModal')?.remove();
        document.removeEventListener('keydown', onKey);
        mapInstance = null;
        activeOverlays = [];
      }
    };
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => renderAll());
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INTERCEPTAR BOTÕES
  // ═══════════════════════════════════════════════════════════════════════

  function init() {
    window.openRotaDoDia = function() {
      const date = window.currentMobileDay
        ? window.currentMobileDay.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      openRotaMap(date);
    };

    const desk = document.getElementById('btnRotaDoDiaDesk');
    if (desk) desk.onclick = () => window.openRotaDoDia();

    window.openRotaDoMapa = openRotaMap;
  }

  function patchRenderMobileDay() {
    if (window._rmPatched) return;
    if (typeof window.renderMobileDay !== 'function') return;
    window._rmPatched = true;
    const _orig = window.renderMobileDay;
    window.renderMobileDay = async function() {
      await _orig.apply(this, arguments);
      injectRotaBtnIfNeeded();
    };
  }

  function injectRotaBtnIfNeeded() {
    const list = document.getElementById('mobileDayList');
    if (!list) return;
    if (list.querySelector('[onclick*="openRotaDoDia"]')) return;
    if (list.querySelector('.rm-rota-btn')) return;

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

    const firstCard = list.querySelector('.m-card');
    if (firstCard) list.insertBefore(btn, firstCard);
    else list.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(() => { init(); patchRenderMobileDay(); }, 400);
  setTimeout(() => { init(); patchRenderMobileDay(); }, 1500);
  window.addEventListener('portalReady', () => { init(); patchRenderMobileDay(); });

})();
