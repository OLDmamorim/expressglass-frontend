// ═══════════════════════════════════════════════════════════════════════════
// rota-do-dia-map.js — v3.0 — Mapa multi-portal (Leaflet + OpenStreetMap)
// Tiles: CartoDB Dark (gratuito, sem chave API)
// Rotas: Google Directions API (só para dados km/tempo/polyline)
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const PORTAL_COLORS = [
    '#3b82f6', '#16a34a', '#dc2626', '#d97706',
    '#7c3aed', '#0891b2', '#db2777', '#ea580c',
  ];

  function colorForIndex(i, total) {
    if (!total || total <= PORTAL_COLORS.length) return PORTAL_COLORS[i % PORTAL_COLORS.length];
    const hue = Math.round((i * 360) / total);
    return `hsl(${hue}, 65%, 45%)`;
  }

  function makeMarkerSVG(label, color) {
    const w = 80, h = 38, r = 7;
    const txt = (label || '—').toUpperCase().slice(0, 10);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="${w-2}" height="${h-12}" rx="${r}" fill="${color}" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
      <polygon points="${w/2-7},${h-12} ${w/2+7},${h-12} ${w/2},${h-1}" fill="${color}"/>
      <text x="${w/2}" y="${(h-12)/2+5}"
        font-family="'Rajdhani','Roboto Mono',monospace"
        font-size="11" font-weight="700"
        fill="white" text-anchor="middle" letter-spacing="1">${txt}</text>
    </svg>`;
  }

  function getSelectedDate() {
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
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m';
  }

  function fmtDur(s) {
    if (!s) return '0 min';
    const m = Math.round(s / 60);
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'min' : m + ' min';
  }

  // ── Carregar Leaflet dinamicamente ────────────────────────────────────────
  async function loadLeaflet() {
    if (window.L && window.L.map) return;
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!document.getElementById('leaflet-js')) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.id = 'leaflet-js';
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
  }

  // ── Lista de portais acessíveis ───────────────────────────────────────────
  async function getAvailablePortals() {
    const user = window.authClient?.getUser?.();
    if (!user) return [];
    if (user.role === 'admin' || user.role === 'pesados_coord') {
      try {
        const token = window.authClient?.getToken?.() || localStorage.getItem('authToken');
        const resp = await fetch('/.netlify/functions/portals', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await resp.json();
        if (data.success && Array.isArray(data.data)) {
          return data.data
            .filter(p => p.portal_type === 'sm' || p.portal_type === 'pesados')
            .map(p => ({
              id: p.id, name: p.name,
              departureAddress: p.departure_address,
              portalType: p.portal_type,
            }));
        }
      } catch (e) { console.warn('[RotaMapa] Erro portais:', e); }
      return [];
    }
    let portals = [];
    if (Array.isArray(user.portals) && user.portals.length) portals = user.portals;
    else if (user.portal) portals = [user.portal];
    return portals.filter(p => {
      const t = p.portalType || p.portal_type;
      return t === 'sm' || t === 'pesados';
    });
  }

  const apptCache = new Map();
  async function fetchAppointments(portalId, date) {
    const key = portalId + '_' + date;
    if (apptCache.has(key)) return apptCache.get(key);
    const token = window.authClient?.getToken?.() || localStorage.getItem('authToken');
    const resp = await fetch('/.netlify/functions/appointments?portal_id=' + portalId, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await resp.json();
    if (!data.success) return [];
    const onDay = (data.data || [])
      .filter(a => a.date && String(a.date).slice(0, 10) === date)
      .sort((a, b) => (a.sortIndex ?? 999) - (b.sortIndex ?? 999));
    apptCache.set(key, onDay);
    return onDay;
  }

  // ── Modal HTML ────────────────────────────────────────────────────────────
  function buildModal(portals, currentPortalId) {
    document.getElementById('rotaMapModal')?.remove();

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
          flex-shrink: 0; flex-wrap: wrap; z-index: 2;
        }
        #rotaMapModal .rm-title {
          font-size: 16px; font-weight: 800; color: #f1f5f9;
          letter-spacing: 0.3px; flex: 1; min-width: 100px;
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
          transition: background .15s; flex-shrink: 0;
        }
        #rotaMapModal .rm-close:hover { background: rgba(255,255,255,0.15); color: #f1f5f9; }
        #rotaMapModal .rm-portals {
          display: flex; gap: 6px; padding: 8px 16px; overflow-x: auto;
          background: #0b1422;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0; -webkit-overflow-scrolling: touch; z-index: 2;
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
        #rotaMapModal .rm-portal-chip:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }
        #rotaMapModal .rm-portal-chip.active { color: #fff; background: rgba(59,130,246,0.15); }
        #rotaMapModal .rm-portal-chip .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        #rotaMapModal .rm-portal-chip .check {
          width: 14px; height: 14px; border-radius: 4px;
          border: 1.5px solid currentColor;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; line-height: 1;
        }
        #rotaMapModal .rm-portal-chip.active .check::after { content: '✓'; color: currentColor; }
        #rotaMapModal .rm-body { position: relative; flex: 1; overflow: hidden; min-height: 0; }
        #rotaMapModal .rm-panel {
          position: absolute; left: 0; top: 0; bottom: 0; width: 300px; z-index: 2;
          background: #0f172a;
          border-right: 1px solid rgba(255,255,255,0.07);
          display: flex; flex-direction: column; overflow: hidden;
        }
        #rotaMapModal .rm-stats {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 1px; background: rgba(255,255,255,0.06);
          border-bottom: 1px solid rgba(255,255,255,0.07);
          flex-shrink: 0;
        }
        #rotaMapModal .rm-stat { background: #0f172a; padding: 10px 14px; }
        #rotaMapModal .rm-stat-lbl {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.6px; color: #475569; margin-bottom: 2px;
        }
        #rotaMapModal .rm-stat-val {
          font-size: 18px; font-weight: 900; color: #f1f5f9;
          font-variant-numeric: tabular-nums;
        }
        #rotaMapModal .rm-stops { flex: 1; overflow-y: auto; padding: 10px 8px; }
        #rotaMapModal .rm-stops::-webkit-scrollbar { width: 4px; }
        #rotaMapModal .rm-stops::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        #rotaMapModal .rm-portal-group { margin-bottom: 14px; }
        #rotaMapModal .rm-portal-header {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 8px; margin-bottom: 4px;
          font-size: 11px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;
        }
        #rotaMapModal .rm-portal-header .dot { width: 8px; height: 8px; border-radius: 50%; }
        #rotaMapModal .rm-stop {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 8px; border-radius: 8px; margin-bottom: 3px;
          cursor: pointer; transition: background .12s;
        }
        #rotaMapModal .rm-stop:hover { background: rgba(255,255,255,0.05); }
        #rotaMapModal .rm-stop.rm-selected { background: rgba(255,255,255,0.09); border-left: 3px solid currentColor; padding-left: 5px; }
        @keyframes rmPulse { 0% { transform:scale(.8); opacity:.4; } 100% { transform:scale(1.5); opacity:0; } }
        #rotaMapModal .rm-stop-idx {
          width: 22px; height: 22px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800; flex-shrink: 0; color: white;
        }
        #rotaMapModal .rm-stop-plate {
          font-size: 13px; font-weight: 800; color: #f1f5f9;
          font-family: 'Rajdhani','Roboto Mono',monospace;
          letter-spacing: 0.5px; line-height: 1.2;
        }
        #rotaMapModal .rm-stop-car { font-size: 11px; color: #64748b; font-weight: 500; }
        #rotaMapModal .rm-stop-loc { font-size: 11px; color: #475569; margin-top: 2px; }
        #rotaMapModal .rm-no-stops {
          text-align: center; padding: 20px 12px;
          color: #475569; font-size: 12px; font-style: italic;
        }
        #rotaMapModal .rm-map-wrap {
          position: absolute; left: 300px; right: 0; top: 0; bottom: 0;
        }
        #rotaMapModal #rotaGoogleMap { width: 100%; height: 100%; }
        /* Leaflet overrides */
        #rotaMapModal .leaflet-container { background: #e8e8e8; }
        #rotaMapModal .leaflet-control-attribution { font-size: 9px; }
        #rotaMapModal .rm-loading {
          position: absolute; inset: 0;
          display: none; flex-direction: column;
          align-items: center; justify-content: center;
          background: rgba(15,23,42,0.85); color: #cbd5e1;
          font-size: 14px; gap: 12px; z-index: 1001;
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
          #rotaMapModal .rm-panel {
            width: 100%; height: 220px; top: auto; bottom: 0; left: 0; right: 0;
            border-right: none; border-top: 1px solid rgba(255,255,255,0.07);
          }
          #rotaMapModal .rm-map-wrap { left: 0; bottom: 220px; }
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

    const chipsContainer = document.getElementById('rmPortalChips');
    portals.forEach((p, i) => {
      const color = colorForIndex(i, portals.length);
      const chip = document.createElement('div');
      chip.className = 'rm-portal-chip';
      chip.dataset.portalId = p.id;
      chip.dataset.color = color;
      chip.innerHTML = `<span class="check"></span><span class="dot" style="background:${color}"></span><span>${p.name}</span>`;
      if (p.id === currentPortalId) chip.classList.add('active');
      chip.addEventListener('click', () => { chip.classList.toggle('active'); scheduleRender(); });
      chipsContainer.appendChild(chip);
    });

    return modal;
  }

  // ── Leaflet map instance ──────────────────────────────────────────────────
  let leafletMap = null;
  let activeOverlays = [];
  let markerByApptId = {};     // apptId → { marker, color, plate }
  let selectedMarker = null;   // { marker, origColor, origPlate }

  function clearMap() {
    if (leafletMap) {
      activeOverlays.forEach(o => { try { leafletMap.removeLayer(o); } catch (e) {} });
    }
    activeOverlays = [];
    markerByApptId = {};
    selectedMarker = null;
  }

  function makeMarkerSVGSelected(label, color) {
    const w = 84, h = 40, r = 7;
    const txt = (label || '—').toUpperCase().slice(0, 10);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="${w-2}" height="${h-12}" rx="${r}" fill="#fff" stroke="${color}" stroke-width="2.5"/>
      <polygon points="${w/2-7},${h-12} ${w/2+7},${h-12} ${w/2},${h-1}" fill="#fff" stroke="${color}" stroke-width="1.5"/>
      <text x="${w/2}" y="${(h-12)/2+5}"
        font-family="'Rajdhani','Roboto Mono',monospace"
        font-size="12" font-weight="800"
        fill="${color}" text-anchor="middle" letter-spacing="1">${txt}</text>
    </svg>`;
  }

  function selectStop(apptId) {
    // Deselect previous
    if (selectedMarker) {
      const { marker, origColor, origPlate } = selectedMarker;
      marker.setIcon(L.divIcon({
        html: makeMarkerSVG(origPlate, origColor),
        className: '', iconSize: [80, 38], iconAnchor: [40, 38],
      }));
      document.querySelectorAll('.rm-stop.rm-selected').forEach(el => el.classList.remove('rm-selected'));
      selectedMarker = null;
    }
    const info = markerByApptId[apptId];
    if (!info) return;
    // Highlight marker: white fill + color border + pulse ring
    info.marker.setIcon(L.divIcon({
      html: `<div style="position:relative;width:84px;height:40px;">
        <div style="position:absolute;top:6px;left:2px;right:2px;bottom:12px;border-radius:8px;background:${info.color};animation:rmPulse 1s ease-out infinite;opacity:.35;pointer-events:none;"></div>
        ${makeMarkerSVGSelected(info.plate, info.color)}
      </div>`,
      className: '', iconSize: [84, 40], iconAnchor: [42, 40],
    }));
    info.marker.openPopup();
    leafletMap?.panTo(info.marker.getLatLng());
    selectedMarker = { marker: info.marker, origColor: info.color, origPlate: info.plate };
    // Highlight sidebar item
    const stopEl = document.querySelector(`.rm-stop[data-appt-id="${apptId}"]`);
    if (stopEl) { stopEl.classList.add('rm-selected'); stopEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }

  function ensureMap() {
    if (leafletMap) return leafletMap;
    const el = document.getElementById('rotaGoogleMap');
    if (!el || !window.L) { console.error('[RotaMapa] Leaflet ou #rotaGoogleMap não disponível'); return null; }

    leafletMap = L.map(el, { center: [39.5, -8.0], zoom: 7, zoomControl: true });

    // CartoDB Voyager — cores naturais, mar azul, terra clara
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(leafletMap);

    console.log('[RotaMapa] Leaflet map criado OK');
    return leafletMap;
  }

  let _renderTimer = null;
  function scheduleRender() {
    if (_renderTimer) clearTimeout(_renderTimer);
    _renderTimer = setTimeout(renderAll, 150);
  }

  async function renderAll() {
    const dateInput = document.getElementById('rotaDateInput');
    if (!dateInput) return;
    const date = dateInput.value;
    const chips = [...document.querySelectorAll('.rm-portal-chip.active')];
    const portaisActivos = chips.map(c => ({
      id: parseInt(c.dataset.portalId),
      color: c.dataset.color,
      name: c.querySelector('span:last-child').textContent
    }));

    document.getElementById('rmStatPortals').textContent = portaisActivos.length || '—';

    const map = ensureMap();
    clearMap();

    const stopList = document.getElementById('rmStopList');
    stopList.innerHTML = '';

    const loading = document.getElementById('rmLoading');
    if (loading) loading.style.display = 'flex';

    if (portaisActivos.length === 0 || !map) {
      document.getElementById('rmStatStops').textContent = '—';
      document.getElementById('rmStatDist').textContent = '—';
      document.getElementById('rmStatTime').textContent = '—';
      stopList.innerHTML = '<div class="rm-no-stops">Selecione pelo menos 1 portal acima</div>';
      if (loading) loading.style.display = 'none';
      return;
    }

    let totalStops = 0, totalDist = 0, totalDur = 0;
    const allLatLngs = [];

    for (const portal of portaisActivos) {
      const allPortals = window._rmAllPortals || [];
      const portalFull = allPortals.find(p => p.id === portal.id);
      const baseAddr = portalFull?.departureAddress || portalFull?.departure_address || null;

      const appts = await fetchAppointments(portal.id, date);
      totalStops += appts.length;

      const group = document.createElement('div');
      group.className = 'rm-portal-group';
      group.innerHTML = `
        <div class="rm-portal-header" style="color:${portal.color}">
          <span class="dot" style="background:${portal.color}"></span>
          <span>${portal.name}</span>
          <span style="margin-left:auto;color:#475569;font-weight:600;">${appts.length} ${appts.length === 1 ? 'paragem' : 'paragens'}</span>
        </div>`;

      if (appts.length === 0) {
        group.innerHTML += '<div class="rm-no-stops">Sem agendamentos neste dia</div>';
      } else {
        appts.forEach((a, i) => {
          const addr = apptAddress(a);
          const stop = document.createElement('div');
          stop.className = 'rm-stop';
          stop.dataset.apptId = a.id;
          stop.style.color = portal.color;
          stop.innerHTML = `
            <div class="rm-stop-idx" style="background:${portal.color}">${i + 1}</div>
            <div style="flex:1;min-width:0;">
              <div class="rm-stop-plate">${a.plate || '—'}</div>
              <div class="rm-stop-car">${a.car || ''}</div>
              ${addr ? `<div class="rm-stop-loc">📍 ${addr.replace(', Portugal', '')}</div>`
                     : '<div class="rm-stop-loc" style="color:#dc2626">⚠ Sem morada</div>'}
            </div>`;
          stop.addEventListener('click', () => selectStop(a.id));
          group.appendChild(stop);
        });
      }
      stopList.appendChild(group);

      const withAddr = appts.filter(a => apptAddress(a));
      if (withAddr.length === 0) continue;

      // Calcular rota via Google Directions (só para dados km/tempo/polyline)
      const routeResult = await calcRoute(baseAddr, withAddr);
      if (!routeResult) continue;

      // Desenhar polyline da rota no Leaflet
      const route = routeResult.routes[0];
      const path = route.overview_path.map(p => [p.lat(), p.lng()]);
      const polyline = L.polyline(path, {
        color: portal.color, weight: 4, opacity: 0.85,
      }).addTo(map);
      activeOverlays.push(polyline);
      allLatLngs.push(...path);

      // Marcadores das paragens
      route.legs.forEach((leg, i) => {
        let appt, pos;
        if (baseAddr) {
          if (i < withAddr.length) { appt = withAddr[i]; pos = [leg.end_location.lat(), leg.end_location.lng()]; }
          else return;
        } else {
          appt = withAddr[i];
          pos = [leg.start_location.lat(), leg.start_location.lng()];
          if (i === route.legs.length - 1) {
            const lastAppt = withAddr[i + 1] || withAddr[i];
            const lastPos = [leg.end_location.lat(), leg.end_location.lng()];
            addLeafletMarker(map, lastPos, lastAppt, portal.color);
            allLatLngs.push(lastPos);
          }
        }
        if (!appt || !pos) return;
        addLeafletMarker(map, pos, appt, portal.color);
        allLatLngs.push(pos);
      });

      // Marcador base (geocodificar com Google se disponível)
      if (baseAddr && window.google?.maps?.Geocoder) {
        try {
          const basePos = await new Promise((res, rej) =>
            new google.maps.Geocoder().geocode({ address: baseAddr },
              (r, s) => s === 'OK' && r[0] ? res(r[0].geometry.location) : rej(s)
            )
          );
          const bpos = [basePos.lat(), basePos.lng()];
          const baseIcon = L.divIcon({
            html: `<div style="width:18px;height:18px;border-radius:50%;background:${portal.color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);"></div>`,
            className: '', iconSize: [18, 18], iconAnchor: [9, 9],
          });
          const bm = L.marker(bpos, { icon: baseIcon, zIndexOffset: 200 })
            .bindPopup(`<b style="color:${portal.color}">🏠 Base ${portal.name}</b><br><small>${baseAddr}</small>`)
            .addTo(map);
          activeOverlays.push(bm);
          allLatLngs.push(bpos);
        } catch (e) {
          console.warn('[RotaMapa] Base não geocodificada:', portal.name);
        }
      }

      route.legs.forEach(leg => { totalDist += leg.distance.value; totalDur += leg.duration.value; });
    }

    document.getElementById('rmStatStops').textContent = totalStops;
    document.getElementById('rmStatDist').textContent = fmtKm(totalDist);
    document.getElementById('rmStatTime').textContent = fmtDur(totalDur);

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
    }

    if (loading) loading.style.display = 'none';
  }

  function addLeafletMarker(map, pos, appt, color) {
    const icon = L.divIcon({
      html: makeMarkerSVG(appt.plate, color),
      className: '',
      iconSize: [80, 38],
      iconAnchor: [40, 38],
    });
    const m = L.marker(pos, { icon, zIndexOffset: 100 })
      .bindPopup(`<div style="font-size:13px;min-width:160px;">
        <div style="font-weight:800;font-size:15px;color:${color};margin-bottom:4px;">${appt.plate || '—'}</div>
        <div style="color:#475569;">${appt.car || ''}</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px;">${apptAddress(appt) || ''}</div>
      </div>`)
      .addTo(map);
    // Register for sidebar click → highlight
    if (appt.id) markerByApptId[appt.id] = { marker: m, color, plate: appt.plate };
    // Clicking the map marker also selects the sidebar item
    m.on('click', () => selectStop(appt.id));
    activeOverlays.push(m);
    return m;
  }

  async function calcRoute(baseAddr, withAddr) {
    if (!window.google?.maps) return null;
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
    } catch (e) {
      console.warn('[RotaMapa] Directions falhou:', e.message);
      return null;
    }
  }

  async function openRotaMap(date) {
    const portals = await getAvailablePortals();
    if (portals.length === 0) {
      alert('Não há SMs ou Pesados disponíveis para mostrar.');
      return;
    }

    window._rmAllPortals = portals;
    const currentPortalId = window.portalConfig?.id || portals[0].id;
    apptCache.clear();
    leafletMap = null;
    activeOverlays = [];

    buildModal(portals, currentPortalId);

    const dateInput = document.getElementById('rotaDateInput');
    dateInput.value = date || getSelectedDate();

    function closeModal() {
      document.getElementById('rotaMapModal')?.remove();
      if (leafletMap) { leafletMap.remove(); leafletMap = null; }
      activeOverlays = [];
    }

    document.getElementById('rotaMapClose').addEventListener('click', closeModal);
    const onKey = e => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    dateInput.addEventListener('change', () => { apptCache.clear(); scheduleRender(); });

    // Carregar Leaflet e iniciar mapa
    document.getElementById('rmLoading').style.display = 'flex';
    document.getElementById('rmLoadingText').textContent = 'A carregar mapa...';
    try {
      await loadLeaflet();
    } catch (e) {
      console.error('[RotaMapa] Falhou a carregar Leaflet:', e);
      document.getElementById('rmLoadingText').textContent = 'Erro a carregar mapa';
      return;
    }

    setTimeout(() => {
      ensureMap();
      setTimeout(renderAll, 200);
    }, 50);
  }

  function init() {
    window.openRotaDoDia = function () {
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
    window.renderMobileDay = async function () {
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(() => { init(); patchRenderMobileDay(); }, 400);
  setTimeout(() => { init(); patchRenderMobileDay(); }, 1500);
  window.addEventListener('portalReady', () => { init(); patchRenderMobileDay(); });

})();
