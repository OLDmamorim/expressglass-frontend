console.log('📦 script-tail.js v2026-05-14b carregado');
function extractPhoneFromText(txt){
  if(!txt) return '';
  const m = String(txt).match(/(\+?\d[\d\s()-]{6,})/); // 9+ dígitos
  return m ? m[1].trim() : '';
}

// ---------- Render MOBILE (lista do dia) ----------
function buildMobileCard(a){
  // Ícones oficiais (fallback para emoji se falhar)
  const mapsBtn = a.address ? `
    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer" class="icon-btn" title="Abrir no Google Maps">
      <img src="https://cdn.simpleicons.org/googlemaps/ffffff" alt="Google Maps" width="18" height="18"
           onerror="this.src=''; this.parentElement.textContent='🌍';"/>
    </a>` : '';

  // Botão telefone (se houver número) — único e com classe para forçar branco
  // Botão telefone (agora com SVG inline branco)
const phone = a.phone || extractPhoneFromText(a.extra) || extractPhoneFromText(a.notes);
const telBtn = phone ? `
  <a href="tel:${phone.replace(/\s+/g,'')}" class="icon-btn" title="Telefonar" aria-label="Telefonar">
    <svg viewBox="0 0 24 24" width="18" height="18" role="img" aria-hidden="true">
      <path fill="#fff"
        d="M2.003 5.884l3.065-.611a1 1 0 011.023.51l1.5 2.598a1 1 0 01-.091 1.09l-1.2 1.6a12.044 12.044 0 005.516 5.516l1.6-1.2a1 1 0 011.09-.091l2.598 1.5a1 1 0 01.51 1.023l-.611 3.065A1 1 0 0114 21C7.94 21 3 16.06 3 10a1 1 0 01.815-.985z"/>
    </svg>
  </a>
` : '';

  const wazeBtn = a.address ? `
    <a href="https://waze.com/ul?q=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer" class="icon-btn" title="Abrir no Waze">
      <img src="https://cdn.simpleicons.org/waze/ffffff" alt="Waze" width="18" height="18"
           onerror="this.src=''; this.parentElement.textContent='🗺️';"/>
    </a>` : '';

  const base = getCardBaseColor(a);
  const g = gradFromBase(base);
  const textColor = textColorForBg(base);

  // Hierarquia visual: matrícula em destaque, carro secundário
  const hasIcons = !!(wazeBtn || mapsBtn || telBtn);
  const iconPadding = hasIcons ? 'padding-right: 52px;' : '';

  const plate = (a.plate || '').toUpperCase();
  const car = (a.car || '').toUpperCase();
  // Construir lista de serviços: primário + extra_services (sem duplicados)
  const _allSvcs = (function() {
    const primary = a.service ? [a.service] : [];
    let extra = a.extra_services || [];
    if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch(e) { extra = []; } }
    if (!Array.isArray(extra)) extra = [];
    const extraNames = extra.map(function(s) { return s && s.service ? s.service : ''; }).filter(Boolean);
    return [...primary, ...extraNames];
  })();
  const chips = [
    a.period ? `<span class="m-chip">${a.period}</span>` : '',
    ..._allSvcs.map(function(s) { return `<span class="m-chip">${s}</span>`; }),
    !isLoja() && a.locality ? `<span class="m-chip">${a.locality}</span>` : '',
    a.calibration ? `<span class="m-chip m-chip-calib">⊕ CALIB</span>` : '',
    a.first_of_day ? `<span class="m-chip" style="background:#f59e0b;color:#fff;font-weight:700;">⭐ 1.º</span>` : ''
  ].filter(Boolean).join('');
  const notes = [a.client_name, a.extra, a.notes].filter(Boolean).map(t => `<div class="m-info">${t}</div>`).join('');
  const damageRow = a.damage_details ? `<div class="m-info" style="font-style:italic;opacity:0.85;">🔍 ${a.damage_details}</div>` : '';
  // Footer PHC: só mostrar se auto_imported E status ainda é NE
  const isAutoImported = a.auto_imported && a.date && (!a.status || a.status === 'NE');
  const phcFooter = isAutoImported ? `
      <div class="phc-import-footer">
        <div>Importado direto PHC, mantém?</div>
        <div>Confirma status vidro</div>
      </div>` : '';

  const isRealizado = a.executed === true;
  const isNaoRealizado = a.executed === false && !!a.not_done_reason;
  const preAgendadoM = a.confirmed === false;
  const todayISO = localISO(new Date());
  const isPastOrToday = a.date && a.date <= todayISO;

  const motivoBadge = isNaoRealizado && a.not_done_reason ? `
    <div style="margin:6px 8px 0;padding:7px 12px;background:rgba(220,38,38,0.15);border-left:3px solid #dc2626;border-radius:6px;font-size:12px;font-weight:700;color:#dc2626;display:flex;align-items:center;gap:6px;">
      ❌ <span style="color:inherit;">${a.not_done_reason}</span>
    </div>` : '';

  const statusToggle = a.date ? `
    <div class="m-status-row">
      <button class="m-status-btn ${isNaoRealizado ? 'm-status-active-ne' : ''}" data-exec="false" data-id="${a.id}">
        <span class="m-status-dot m-dot-ne"></span>
        N. Realizado
      </button>
      <button class="m-status-btn ${isRealizado ? 'm-status-active-st' : ''}" data-exec="true" data-id="${a.id}">
        <span class="m-status-dot m-dot-st"></span>
        Realizado
      </button>
    </div>${motivoBadge}` : '';

  // Dias aberto mobile
  const _mDiasAberto = a.createdAt ? (() => {
    const d = new Date(a.createdAt); d.setHours(0,0,0,0);
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    return Math.floor((hoje - d) / 86400000);
  })() : 0;
  const _mDiasBg = _mDiasAberto >= 8 ? '#dc2626' : _mDiasAberto >= 5 ? '#ea580c' : _mDiasAberto >= 3 ? '#d97706' : null;
  const mDiasAbertoBadge = _mDiasAberto > 0 && _mDiasBg ? `
    <div style="margin:6px 0 4px;display:flex;justify-content:center;">
      <span style="display:inline-flex;align-items:center;gap:6px;background:${_mDiasBg};color:#ffffff;padding:5px 16px;border-radius:20px;font-size:13px;font-weight:800;-webkit-text-fill-color:#ffffff;">
        ⏱ ${_mDiasAberto} ${_mDiasAberto === 1 ? 'dia aberto' : 'dias aberto'}
      </span>
    </div>` : '';

  const userRole = window.authClient?.getUser?.()?.role || '';
  const canEdit = userRole === 'admin' || userRole === 'coordenador';
  const editBtn = canEdit ? `
    <button onclick="editAppointment('${a.id}')" class="icon-btn" title="Editar"
      style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.25);border:none;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:10;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>` : '';

  return `
    <div class="appointment m-card${preAgendadoM ? ' pre-agendado' : ''}" data-id="${a.id}"
         style="--c1:${g.c1}; --c2:${g.c2}; --tc:${textColor}; position:relative;">
      ${editBtn}
      <div class="map-icons">
        ${wazeBtn}${mapsBtn}${telBtn}
      </div>
      <div style="${iconPadding}">
        <div class="m-title"><span class="m-title-text">${plate}</span></div>
        ${car ? `<div class="m-car">${car}</div>` : ''}
        ${chips ? `<div class="m-chips" data-ms-patched="1">${chips}</div>` : ''}
        ${a.commercial_user_id ? `<div style="display:inline-block;background:#7c3aed !important;color:#fff !important;font-size:11px;font-weight:800;padding:3px 10px;border-radius:12px;margin-bottom:4px;animation:blink 1.5s infinite;">🤝 COMERCIAL</div>` : ''}
        ${notes}
        ${damageRow}
        ${preAgendadoM ? `<span class="pre-agendado-badge">⏳ Aguarda confirmação</span>` : ''}
        ${preAgendadoM
          ? `<div class="m-pending-confirm">⏳ Aguarda confirmação do coordenador</div>`
          : ''
        }
        ${isLoja() ? '' : buildKmRow(a)}
      </div>
      ${statusToggle}
      ${mDiasAbertoBadge}
      ${phcFooter}
    </div>
  `;
}

// ===== [PATCH FINAL] — bootstrap + mobile render =====

// Lista (mobile) do dia — com ordenação por distância
async function renderMobileDay(){
  const list  = document.getElementById('mobileDayList');
  const label = document.getElementById('mobileDayLabel');
  if(!list || !label) return;

  const iso = localISO(currentMobileDay);
  const weekday = currentMobileDay.toLocaleDateString('pt-PT',{ weekday:'long' });
  const dm = currentMobileDay.toLocaleDateString('pt-PT',{ day:'2-digit', month:'2-digit' });
  label.textContent = `${cap(weekday)} • ${dm}`;

  // Itens do dia (base)
  const itemsRaw = filterAppointments(
    appointments
      .filter(a => a.date === iso)
      .sort((a,b) => {
        // Loja: ordenar por período (Manhã/Tarde) e depois sortIndex
        // SM: ordenar apenas por sortIndex (rota optimizada)
        if (isLoja()) {
          return (a.period||'').localeCompare(b.period||'') || (a.sortIndex||0)-(b.sortIndex||0);
        }
        // first_of_day sempre no topo
        if (a.first_of_day && !b.first_of_day) return -1;
        if (!a.first_of_day && b.first_of_day) return 1;
        return (a.sortIndex||0) - (b.sortIndex||0);
      })
  );

  // Verificar se já existe ordem otimizada (sortIndex > 1 em algum item)
  const hasOptimizedOrder = itemsRaw.some(item => (item.sortIndex || 0) > 1);
  
  let items;
  if (hasOptimizedOrder) {
    // Se já tem ordem otimizada, usar essa ordem (respeitar sortIndex)
    console.log('✅ MOBILE - Usando ordem otimizada (sortIndex)');
    items = itemsRaw; // Já está ordenado por sortIndex na query acima
  } else {
    // Se não tem ordem otimizada, aplicar ordenação automática
    console.log('🔄 MOBILE - Aplicando ordenação automática');
    items = await ordenarSeNecessario(itemsRaw);
  }
  // Garantir sempre: first_of_day no topo, independente do caminho
  items = [
    ...items.filter(a => a.first_of_day),
    ...items.filter(a => !a.first_of_day)
  ];

  var _bmBlocked = isDayBlocked(iso);
  var _bmRole = window.authClient?.getUser?.()?.role;
  var _bmCanToggle = _bmRole === 'admin' || _bmRole === 'coordenador';
  var _bmBanner = '';
  if (_bmBlocked) {
    var _desbtn = _bmCanToggle ? '<button onclick="toggleBlockedDay(&quot;' + iso + '&quot;)" style="margin-left:auto;background:#ef4444;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;">Desbloquear</button>' : '';
    _bmBanner = '<div style="background:#fee2e2;border:1.5px solid #ef4444;border-radius:10px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#dc2626;">🔒 ' + (_bmBlocked.reason || 'Dia bloqueado') + ' ' + _desbtn + '</div>';
  } else if (_bmCanToggle) {
    _bmBanner = '<div style="text-align:right;margin-bottom:6px;"><button onclick="toggleBlockedDay(&quot;' + iso + '&quot;)" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;">🔓 Bloquear este dia</button></div>';
  }

  if(items.length === 0){
    list.innerHTML = _bmBanner + '<div class="m-card" style="--c1:#9ca3af;--c2:#6b7280;">Sem serviços para este dia.</div>';
    return;
  }

  // Mobile SM: mostrar serviços com localidade OU pré-agendamentos importados (sem localidade mas com data)
  // Esconder apenas os que não têm nem data nem localidade (pendentes normais sem atribuição)
  if (!isLoja()) {
    items = items.filter(a => !!a.locality || (!!a.date && a.confirmed === false));
  }

  if(items.length === 0){
    list.innerHTML = `<div class="m-card" style="--c1:#9ca3af;--c2:#6b7280;">Sem serviços confirmados para este dia.</div>`;
    return;
  }

  // Resumo do dia (só SM)
  const summary = buildDaySummary(currentMobileDay, true);
  const allServices = items.map(buildMobileCard).join('');

  // Botão Rota — só se houver serviços com morada
  const temMoradas = items.some(a => !!a.address);
  const rotaBtn = (!isLoja() && temMoradas) ? `
    <button onclick="openRotaDoDia()"
      style="width:100%;margin:0 0 12px;padding:13px;border:none;border-radius:14px;
             background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;
             font-size:15px;font-weight:800;letter-spacing:0.3px;cursor:pointer;
             display:flex;align-items:center;justify-content:center;gap:8px;
             box-shadow:0 4px 12px rgba(22,163,74,0.35);">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"></path></svg>
      🗺️ Ver Rota do Dia
    </button>` : '';

  list.innerHTML = _bmBanner + (summary ? `<div class="mobile-day-summary">${summary}</div>` : '') + rotaBtn + allServices || '<p style="text-align:center;color:#6b7280;margin:20px;">Nenhum serviço agendado</p>';
  highlightSearchResults();
}

// Render global
function renderAll(){
  window.appointments = appointments;
  try { renderSchedule(); } catch(e){ console.error('Erro renderSchedule:', e); }
  try { renderUnscheduled(); } catch(e){ console.error('Erro renderUnscheduled:', e); }
  try { if (typeof renderServicesTable === 'function') renderServicesTable(); } catch(e){ console.error('Erro renderServicesTable:', e); }
  try { renderMobileDay(); } catch(e){ console.error('Erro renderMobileDay:', e); }
  try { applyBlockedDayOverlays(); } catch(e){ console.warn('applyBlockedDayOverlays:', e); }
}

// Função global para recarregar appointments (usada pelo switcher do coordenador)
window.reloadAppointments = async function() {
  try {
    const raw = await window.apiClient.getAppointments();
    appointments = raw.map(a => ({
      ...a,
      date: a.date ? String(a.date).slice(0,10) : null,
      address: a.address || a.morada || a.addr || null,
      sortIndex: a.sortIndex || a.sortindex || 1,
      id: a.id ?? (Date.now() + Math.random()),
      createdAt: a.createdAt || a.created_at || null
    }));
    renderAll();
  } catch(e) { console.error('Erro ao recarregar:', e); }
};

// Auto-refresh a cada 30s — mantém vistas sincronizadas entre utilizadores
// Só corre se a página está visível (não gasta bateria em background)
(function startPolling() {
  const INTERVAL = 60000; // 60 segundos
  let timer = null;

  function poll() {
    if (window._pausePolling) return; // aguardar gravação pendente
    if (document.visibilityState === 'visible' && window.reloadAppointments) {
      window.reloadAppointments().catch(() => {});
    }
  }

  function start() { if (!timer) timer = setInterval(poll, INTERVAL); }
  function stop()  { if (timer) { clearInterval(timer); timer = null; } }

  // Pausa quando a aba está em background, retoma quando volta ao primeiro plano
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { poll(); start(); }
    else stop();
  });

  // Inicia após o portalReady (dados já carregados)
  window.addEventListener('portalReady', () => setTimeout(start, 5000), { once: true });

  // Fallback: arrancar mesmo que portalReady não dispare
  setTimeout(() => { if (!timer) setTimeout(start, 2000); }, 8000);
})();

// ===== RELATÓRIO SEMANAL =====

// ===== ROTA DO DIA — abre Google Maps com toda a rota =====
function openRotaDoDia() {
  const iso = localISO(currentMobileDay);
  const items = appointments
    .filter(a => a.date === iso && !!a.address)
    .sort((a,b) => (a.sortIndex||0) - (b.sortIndex||0));

  if (items.length === 0) {
    showToast('Sem serviços com morada para este dia', 'error');
    return;
  }

  const base = getBasePartida();
  const maxWp = Math.min(items.length, 9);
  const wps = items.slice(0, maxWp).map(a => encodeURIComponent(a.address));
  const url = `https://www.google.com/maps/dir/${encodeURIComponent(base)}/${wps.join('/')}/${encodeURIComponent(base)}`;
  window.open(url, '_blank');
}



// ===== POWERING EG KPIs =====
let _poweringKpis = null;
let _poweringKpisLoaded = false;

async function loadPoweringKpis() {
  if (!isLoja()) return;
  const lojaId = window.portalConfig?.poweringLojaId;
  if (!lojaId) return; // portal sem lojaId configurado

  try {
    const now = new Date();
    const url = `/.netlify/functions/powering-kpis?loja_id=${lojaId}&mes=${now.getMonth()+1}&ano=${now.getFullYear()}`;
    const resp = await window.authClient.authenticatedFetch(url);
    const data = await resp.json();
    if (data.success && data.kpis) {
      _poweringKpis = data.kpis;
      _poweringKpisLoaded = true;
      renderPoweringBanner();
    }
  } catch(e) {
    console.warn('PoweringEG KPIs não disponíveis:', e.message);
  }
}

function renderPoweringBanner() {
  const k = _poweringKpis;
  if (!k) return;

  // Desktop — inserir antes da tabela
  const existing = document.getElementById('poweringKpiBanner');
  if (existing) existing.remove();

  const desvioCor = parseFloat(k.desvioPct) >= 0 ? '#16a34a' : '#dc2626';
  const desvioBg = parseFloat(k.desvioPct) >= 0 ? '#f0fdf4' : '#fef2f2';
  const desvioIcon = parseFloat(k.desvioPct) >= 0 ? '↑' : '↓';

  const mesNome = new Date(k.ano, k.mes-1, 1).toLocaleDateString('pt-PT', {month:'long', year:'numeric'});

  const banner = document.createElement('div');
  banner.id = 'poweringKpiBanner';
  banner.style.cssText = 'margin:0 0 0 0;background:#fff;border-bottom:1px solid #e5e7eb;padding:8px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;';
  banner.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;">
      📊 ${mesNome}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <div style="background:#eff6ff;border-radius:8px;padding:5px 12px;text-align:center;">
        <div style="font-size:18px;font-weight:800;color:#2563eb;line-height:1;">${k.servicos}</div>
        <div style="font-size:10px;color:#6b7280;margin-top:1px;">Serviços</div>
      </div>
      <div style="background:#f5f3ff;border-radius:8px;padding:5px 12px;text-align:center;">
        <div style="font-size:18px;font-weight:800;color:#7c3aed;line-height:1;">${k.objetivo}</div>
        <div style="font-size:10px;color:#6b7280;margin-top:1px;">Objetivo</div>
      </div>
      <div style="background:${desvioBg};border-radius:8px;padding:5px 12px;text-align:center;">
        <div style="font-size:18px;font-weight:800;color:${desvioCor};line-height:1;">${desvioIcon}${Math.abs(k.desvioPct)}%</div>
        <div style="font-size:10px;color:#6b7280;margin-top:1px;">Desvio diário</div>
      </div>
      <div style="background:#f0fdf4;border-radius:8px;padding:5px 12px;text-align:center;">
        <div style="font-size:18px;font-weight:800;color:#16a34a;line-height:1;">${k.taxaRep}%</div>
        <div style="font-size:10px;color:#6b7280;margin-top:1px;">Taxa rep.</div>
      </div>
    </div>
    <div style="flex:1;min-width:120px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;margin-bottom:3px;">
        <span>Progresso mensal</span>
        <span>${k.progressoPct}%</span>
      </div>
      <div style="height:6px;background:#e5e7eb;border-radius:3px;">
        <div style="height:6px;background:linear-gradient(90deg,#3b82f6,#7c3aed);border-radius:3px;width:${Math.min(k.progressoPct,100)}%;transition:width 0.6s ease;"></div>
      </div>
      <div style="font-size:10px;color:#9ca3af;margin-top:3px;">Dia ${k.diasPassados} de ${k.diasUteisTotais} úteis</div>
    </div>`;

  // Inserir antes do schedule ou da toolbar mobile
  const schedule = document.getElementById('schedule');
  if (schedule) {
    schedule.parentElement.insertBefore(banner, schedule);
  } else {
    const mobileHeader = document.getElementById('mobileHeader') || document.querySelector('.mobile-day-header');
    if (mobileHeader) mobileHeader.after(banner);
    else document.querySelector('main, #app, body').prepend(banner);
  }
}

function buildRelatorio() {
  const el = document.getElementById('relatorioContent');
  if (!el) return;

  // Semana actual (seg–sáb)
  const week = [...Array(6)].map((_, i) => addDays(currentMonday, i));
  const weekStart = week[0].toLocaleDateString('pt-PT', {day:'2-digit', month:'2-digit'});
  const weekEnd   = week[5].toLocaleDateString('pt-PT', {day:'2-digit', month:'2-digit', year:'numeric'});

  const loja = isLoja();

  // Filtrar agendamentos da semana
  const isoWeek = week.map(d => localISO(d));
  const weekAppts = appointments.filter(a => a.date && isoWeek.includes(a.date));

  const total        = weekAppts.length;
  const realized     = weekAppts.filter(a => !!a.executed).length;
  const notDone      = total - realized;
  const glassRemoved = weekAppts.filter(a => !!a.glass_removed).length;

  let html = `<div style="font-family:'Figtree',sans-serif;">
    <div style="font-size:13px;color:#6b7280;margin-bottom:16px;">${weekStart} — ${weekEnd}</div>`;

  // Resumo de serviços
  html += `
    <div style="display:grid;grid-template-columns:repeat(${glassRemoved > 0 ? 4 : 3},1fr);gap:10px;margin-bottom:20px;">
      <div class="rel-stat">
        <div class="rel-n">${total}</div>
        <div class="rel-l">Agendados</div>
      </div>
      <div class="rel-stat rel-stat-green">
        <div class="rel-n">${realized}</div>
        <div class="rel-l">Realizados</div>
      </div>
      <div class="rel-stat rel-stat-red">
        <div class="rel-n">${notDone}</div>
        <div class="rel-l">Não realizados</div>
      </div>
      ${glassRemoved > 0 ? `
      <div class="rel-stat" style="border-left:3px solid #2563eb;">
        <div class="rel-n" style="color:#2563eb;">🪟 ${glassRemoved}</div>
        <div class="rel-l">Vidro Retirado</div>
      </div>` : ''}
    </div>`;

  // SM: totais de km, horas e combustível — mesma lógica do buildDaySummary por dia
  if (!loja) {
    let totalKm = 0, totalTravelMin = 0, totalServiceMin = 0;

    week.forEach(d => {
      const iso = localISO(d);
      const items = appointments.filter(a => a.date === iso)
        .sort((a,b) => (a.sortIndex||0) - (b.sortIndex||0))
        .filter(a => !!a.locality); // só confirmados

      if (!items.length) return;

      // KM com regresso
      const dayHasOptimized = items.some(a => (a.sortIndex || 0) > 1);
      let dayKm = 0, hasKm = false, lastKm = 0;
      items.forEach((a, i) => {
        const km = getKmValue(a);
        if (km != null && km > 0) { dayKm += km; hasKm = true; if (i === items.length-1) lastKm = km; }
      });
      if (!dayHasOptimized && hasKm && items.length > 1) dayKm = Math.round(dayKm * 1.45);
      const returnKm = hasKm ? (dayHasOptimized ? Math.round(lastKm * 0.8) : Math.round(dayKm * 0.12)) : 0;
      totalKm += dayKm + returnKm;

      // Tempo de viagem (Google Maps ou estimativa)
      let dayTravel = 0, hasGoogle = false;
      items.forEach(a => { const tt = a.travelTime || a.travel_time || 0; if (tt > 0) { dayTravel += tt; hasGoogle = true; } });
      if (!hasGoogle && hasKm) dayTravel = Math.round((dayKm / ROUTE_CONFIG.avgSpeedKmh) * 60);
      // Tempo de regresso com base no km e velocidade média (mais preciso que % do total)
      const returnMin = Math.round((returnKm / ROUTE_CONFIG.avgSpeedKmh) * 60);
      totalTravelMin += dayTravel + returnMin;

      // Tempo de execução
      items.forEach(a => { totalServiceMin += (typeof getTotalServiceTime === 'function' ? getTotalServiceTime(a) : getServiceTime(a.service, a.vehicleType || a.vehicle_type, a.calibration, a.custom_service_time)); });
    });

    const totalMin = totalTravelMin + totalServiceMin;
    const totalHours = Math.floor(totalMin / 60);
    const totalMins  = totalMin % 60;
    const fuelL = (totalKm * ROUTE_CONFIG.fuelPer100km / 100).toFixed(1);
    const fuelEur = (fuelL * ROUTE_CONFIG.fuelPricePerLiter).toFixed(2);

    html += `
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:4px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-bottom:12px;">Serviço Móvel</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
          <div class="rel-stat">
            <div class="rel-n" style="font-size:22px;">🛣️ ${totalKm} km</div>
            <div class="rel-l">Total km</div>
          </div>
          <div class="rel-stat">
            <div class="rel-n" style="font-size:22px;">⏱️ ${totalHours}h${String(totalMins).padStart(2,'0')}</div>
            <div class="rel-l">Horas trabalho</div>
          </div>
          <div class="rel-stat">
            <div class="rel-n" style="font-size:22px;">⛽ ${fuelL}L</div>
            <div class="rel-l">Combustível</div>
          </div>
          <div class="rel-stat rel-stat-orange">
            <div class="rel-n" style="font-size:22px;">💰 ${fuelEur}€</div>
            <div class="rel-l">Custo combustível</div>
          </div>
        </div>
      </div>`;
  }

  // Lista dia a dia
  html += `<div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-bottom:10px;">Por dia</div>`;

  week.forEach(d => {
    const iso = localISO(d);
    const dayAppts = weekAppts.filter(a => a.date === iso);
    if (!dayAppts.length) return;
    const dR = dayAppts.filter(a => !!a.executed).length;
    const dN = dayAppts.length - dR;
    const dayLabel = d.toLocaleDateString('pt-PT', {weekday:'short', day:'2-digit', month:'2-digit'});
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;">
      <span style="font-weight:600;color:#374151;">${dayLabel}</span>
      <span>
        <span style="color:#16a34a;font-weight:700;">${dR} ✓</span>
        <span style="color:#6b7280;margin:0 4px;">/</span>
        <span style="color:#dc2626;font-weight:700;">${dN} ✗</span>
        <span style="color:#9ca3af;font-size:12px;margin-left:4px;">(${dayAppts.length} total)</span>
      </span>
    </div>`;
  });


  // ===== SECÇÃO COMERCIAL =====
  const comercialAppts = weekAppts.filter(a => !!a.commercial_user_id);

  if (!loja && comercialAppts.length > 0) {
    // Agrupar por comercial
    const byComercial = {};
    comercialAppts.forEach(a => {
      const key = a.commercial_user_id;
      if (!byComercial[key]) byComercial[key] = { name: a.commercial_name || `Comercial #${key}`, items: [] };
      byComercial[key].items.push(a);
    });

    // Agrupar por localidade
    const byLocality = {};
    comercialAppts.forEach(a => {
      const loc = a.locality || 'Sem localidade';
      if (!byLocality[loc]) byLocality[loc] = { total: 0, realized: 0 };
      byLocality[loc].total++;
      if (a.executed) byLocality[loc].realized++;
    });

    const totalCom   = comercialAppts.length;
    const realCom    = comercialAppts.filter(a => a.executed === true).length;
    const notDoneCom = comercialAppts.filter(a => a.executed === false && !!a.not_done_reason).length;
    const pendCom    = totalCom - realCom - notDoneCom;
    const taxaCom    = totalCom > 0 ? Math.round((realCom / totalCom) * 100) : 0;

    // Tempo médio criação → execução
    const tempos = comercialAppts
      .filter(a => a.date && a.createdAt)
      .map(a => {
        const criado = new Date(a.createdAt); criado.setHours(0,0,0,0);
        const exec   = new Date(a.date);      exec.setHours(0,0,0,0);
        return Math.max(0, Math.round((exec - criado) / 86400000));
      });
    const tempoMedio = tempos.length > 0
      ? Math.round(tempos.reduce((s, v) => s + v, 0) / tempos.length)
      : null;

    html += `
      <div style="border-top:2px solid #7c3aed;padding-top:16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7c3aed;margin-bottom:12px;">🤝 Serviços Comerciais</div>

        <!-- KPIs principais -->
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px;">
          <div class="rel-stat" style="border-left:3px solid #7c3aed;">
            <div class="rel-n" style="color:#7c3aed;">${totalCom}</div>
            <div class="rel-l">Total encaminhados</div>
          </div>
          <div class="rel-stat rel-stat-green">
            <div class="rel-n">${realCom}</div>
            <div class="rel-l">Realizados</div>
          </div>
          <div class="rel-stat rel-stat-red">
            <div class="rel-n">${notDoneCom}</div>
            <div class="rel-l">Não realizados</div>
          </div>
          <div class="rel-stat" style="border-left:3px solid #f59e0b;">
            <div class="rel-n" style="color:#d97706;">${pendCom}</div>
            <div class="rel-l">Pendentes</div>
          </div>
        </div>

        <!-- Taxa de conversão + tempo médio -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
          <div style="background:#f5f3ff;border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:#7c3aed;">${taxaCom}%</div>
            <div style="font-size:11px;color:#6b7280;font-weight:600;margin-top:2px;">Taxa de realização</div>
            <div style="height:4px;background:#e5e7eb;border-radius:2px;margin-top:8px;">
              <div style="height:4px;background:#7c3aed;border-radius:2px;width:${taxaCom}%;"></div>
            </div>
          </div>
          <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:24px;font-weight:800;color:#16a34a;">${tempoMedio !== null ? tempoMedio + 'd' : '—'}</div>
            <div style="font-size:11px;color:#6b7280;font-weight:600;margin-top:2px;">Tempo médio criação→exec.</div>
          </div>
        </div>

        <!-- Por comercial -->
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Por comercial</div>
        ${Object.values(byComercial).sort((a,b) => b.items.length - a.items.length).map(c => {
          const r = c.items.filter(a => a.executed === true).length;
          const n = c.items.filter(a => a.executed === false && !!a.not_done_reason).length;
          const p = c.items.length - r - n;
          const tx = Math.round((r / c.items.length) * 100);
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
            <span style="font-weight:700;color:#374151;">${c.name}</span>
            <span style="display:flex;gap:8px;align-items:center;">
              <span style="color:#7c3aed;font-weight:700;">${c.items.length}</span>
              <span style="color:#16a34a;font-weight:700;">${r}✓</span>
              <span style="color:#dc2626;font-weight:700;">${n}✗</span>
              ${p > 0 ? `<span style="color:#d97706;font-weight:700;">${p}⏳</span>` : ''}
              <span style="background:#f5f3ff;color:#7c3aed;padding:2px 6px;border-radius:8px;font-size:11px;font-weight:800;">${tx}%</span>
            </span>
          </div>`;
        }).join('')}

        <!-- Por localidade -->
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7280;margin:12px 0 8px;">Por localidade</div>
        ${Object.entries(byLocality).sort((a,b) => b[1].total - a[1].total).map(([loc, d]) => {
          const pct = Math.round((d.realized / d.total) * 100);
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
            <span style="color:#374151;">${loc}</span>
            <span style="display:flex;gap:8px;align-items:center;">
              <span style="color:#7c3aed;font-weight:700;">${d.total}</span>
              <span style="color:#16a34a;">${d.realized}✓</span>
              <span style="background:#f5f3ff;color:#7c3aed;padding:2px 6px;border-radius:8px;font-size:11px;font-weight:700;">${pct}%</span>
            </span>
          </div>`;
        }).join('')}
      </div>`;
  }

  // ===== SECÇÃO TEMPO DE EXECUÇÃO POR TIPO DE SERVIÇO =====
  const apptsConcluidos = weekAppts.filter(a => a.executed === true);

  if (apptsConcluidos.length > 0) {
    const serviceLabels = { PB: 'Para-brisas', LT: 'Lateral', OC: 'Óculo', REP: 'Reparação', POL: 'Polimento' };
    const byService = {};

    apptsConcluidos.forEach(a => {
      const svc = a.service || 'PB';
      if (!byService[svc]) byService[svc] = { count: 0, totalMin: 0 };
      byService[svc].count++;
      byService[svc].totalMin += getServiceTime(svc, a.vehicle_type || a.vehicleType, a.calibration);
    });

    html += `
      <div style="border-top:2px solid #0ea5e9;padding-top:16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#0ea5e9;margin-bottom:12px;">⏱️ Tempo de Execução por Tipo</div>
        ${Object.entries(byService).sort((a,b) => b[1].count - a[1].count).map(([svc, d]) => {
          const avgMin = Math.round(d.totalMin / d.count);
          const h = Math.floor(avgMin / 60);
          const m = avgMin % 60;
          const timeStr = h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`;
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
            <span style="font-weight:700;color:#374151;">${serviceLabels[svc] || svc}</span>
            <span style="display:flex;gap:12px;align-items:center;">
              <span style="color:#6b7280;font-size:12px;">${d.count} serviço${d.count !== 1 ? 's' : ''}</span>
              <span style="background:#e0f2fe;color:#0ea5e9;padding:3px 10px;border-radius:8px;font-size:12px;font-weight:800;">${timeStr}/serviço</span>
            </span>
          </div>`;
        }).join('')}
      </div>`;
  }

  // ===== MOTIVOS DE NÃO REALIZAÇÃO =====
  const naoRealizados = weekAppts.filter(a => a.executed === false && !!a.not_done_reason);
  if (naoRealizados.length > 0) {
    const byMotivo = {};
    naoRealizados.forEach(a => {
      const m = a.not_done_reason;
      byMotivo[m] = (byMotivo[m] || 0) + 1;
    });
    html += `
      <div style="border-top:2px solid #dc2626;padding-top:16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#dc2626;margin-bottom:12px;">❌ Motivos de Não Realização</div>
        ${Object.entries(byMotivo).sort((a,b) => b[1]-a[1]).map(([motivo, count]) =>
          `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
            <span style="color:#374151;">${motivo}</span>
            <span style="background:#fef2f2;color:#dc2626;padding:2px 10px;border-radius:8px;font-size:12px;font-weight:800;">${count}×</span>
          </div>`
        ).join('')}
      </div>`;
  }

  // ── Vidros Retirados ──────────────────────────────────────────────────
  const glassRemovedAppts = weekAppts.filter(a => !!a.glass_removed);
  if (glassRemovedAppts.length > 0) {
    html += `
      <div style="border-top:2px solid #2563eb;padding-top:16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#2563eb;margin-bottom:12px;">🪟 Vidros Retirados (${glassRemovedAppts.length})</div>
        ${glassRemovedAppts.map(a => {
          const dateStr = a.date ? new Date(a.date + 'T00:00:00').toLocaleDateString('pt-PT', { weekday:'short', day:'2-digit', month:'2-digit' }) : '—';
          const sugestao = a.date && a.glass_removed && a.confirmed === false
            ? `<span style="color:#f59e0b;font-size:11px;font-weight:700;">⚠️ Aguarda data</span>`
            : a.date ? `<span style="color:#16a34a;font-size:11px;font-weight:700;">📅 ${dateStr}</span>` : '';
          let diasBadge = '';
          if (a.glass_removed_date) {
            const removedMs = new Date(a.glass_removed_date + 'T00:00:00').getTime();
            if (!isNaN(removedMs)) {
              const diasEspera = Math.floor((Date.now() - removedMs) / 86400000);
              const cor = diasEspera >= 14 ? '#dc2626' : diasEspera >= 7 ? '#f59e0b' : '#2563eb';
              diasBadge = `<span style="background:${cor};color:#fff;font-size:11px;font-weight:800;padding:2px 8px;border-radius:8px;margin-left:6px;">${diasEspera}d</span>`;
            }
          }
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9;gap:8px;">
            <div style="flex:1;min-width:0;">
              <span style="font-size:13px;font-weight:800;color:#1e293b;">${(a.plate||'').toUpperCase()}</span>
              <span style="font-size:12px;color:#64748b;margin-left:6px;">${a.car||''}</span>
              ${diasBadge}
              ${a.locality ? `<span style="font-size:11px;color:#94a3b8;margin-left:4px;">· ${a.locality}</span>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0;">${sugestao}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  html += `</div></div>`;
  el.innerHTML = html;
}

// Selector Pré-agendamento / Confirmado
function setConfirmed(value) {
  document.getElementById('appointmentConfirmed').value = value ? 'true' : 'false';
  const btnPre  = document.getElementById('btnPreAgendado');
  const btnConf = document.getElementById('btnConfirmado');
  if (!btnPre || !btnConf) return;
  if (value) {
    btnConf.style.cssText = 'padding:14px 10px;border-radius:10px;border:2px solid #16a34a;background:#dcfce7;color:#14532d;font-weight:800;font-size:14px;cursor:pointer;';
    btnPre.style.cssText  = 'padding:14px 10px;border-radius:10px;border:2px solid #d1d5db;background:#f9fafb;color:#6b7280;font-weight:800;font-size:14px;cursor:pointer;';
  } else {
    btnPre.style.cssText  = 'padding:14px 10px;border-radius:10px;border:2px solid #f59e0b;background:#fef3c7;color:#92400e;font-weight:800;font-size:14px;cursor:pointer;';
    btnConf.style.cssText = 'padding:14px 10px;border-radius:10px;border:2px solid #d1d5db;background:#f9fafb;color:#6b7280;font-weight:800;font-size:14px;cursor:pointer;';
  }
}


function _injectLocalityFirstOverlay() {
  var existing = document.getElementById('localityFirstOverlay');
  if (existing) existing.remove();
  if (isLoja() || editingId) return;
  var localityVal = document.getElementById('appointmentLocality')?.value;
  if (localityVal) return;
  var form = document.getElementById('appointmentForm');
  if (!form) return;
  if (getComputedStyle(form).position === 'static') form.style.position = 'relative';
  var overlay = document.createElement('div');
  overlay.id = 'localityFirstOverlay';
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,0.75);z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:16px;border-radius:inherit;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);pointer-events:none;';
  overlay.innerHTML = '<div style="background:#1d4ed8;color:#fff;border-radius:12px;padding:10px 18px;font-size:14px;font-weight:700;box-shadow:0 4px 16px rgba(29,78,216,0.3);text-align:center;max-width:260px;">📍 Começa por escolher a localidade<div style="font-size:11px;font-weight:400;margin-top:4px;opacity:0.85;">A sugestão de data é automática</div></div>';
  form.appendChild(overlay);
  setTimeout(function() {
    var localityBtn = document.querySelector('.locality-select');
    if (localityBtn) localityBtn.click();
    else {
      var dd = document.getElementById('localityDropdown');
      if (dd) { dd.classList.add('open'); dd.classList.add('show'); }
      var search = document.getElementById('localitySearch');
      if (search) { search.value = ''; renderLocalityOptions(''); search.focus(); }
    }
  }, 100);
}

function bootApp() {
  if (window._bootAppRan) return;
  window._bootAppRan = true;
  console.log('🚀 bootApp iniciado');
  (async () => {
    try { await loadRouteSettings(); } catch(e){ console.warn('loadRouteSettings falhou', e); }
    try { await load(); } catch(e){ console.error('load() falhou', e); }
    try { await loadBlockedDays(); } catch(e){ console.warn('loadBlockedDays falhou', e); }
    try { await loadPoweringKpis(); } catch(e){ console.warn('PoweringEG falhou', e); }
    // Arrancar polling de pedidos comerciais após tudo carregado
    try { if (typeof window.crStartPolling === 'function') window.crStartPolling(); } catch(e){}
    try { buildLocalityOptions?.(); } catch(e){}
    renderAll();
  document.querySelector('.locality-select')?.addEventListener('click', toggleLocalityDropdown);


  // Navegação mínima (se existirem botões)
  document.getElementById('todayWeek')?.addEventListener('click', ()=>{ currentMonday = getMonday(new Date()); renderAll(); });
  document.getElementById('prevWeek')?.addEventListener('click', ()=>{ currentMonday = addDays(currentMonday, -7); renderAll(); });
  document.getElementById('nextWeek')?.addEventListener('click', ()=>{ currentMonday = addDays(currentMonday,  7); renderAll(); });

  document.getElementById('prevDay')?.addEventListener('click', ()=>{ currentMobileDay = addDays(currentMobileDay, -1); renderMobileDay(); });
  document.getElementById('todayDay')?.addEventListener('click', ()=>{ currentMobileDay = new Date(); currentMobileDay.setHours(0,0,0,0); renderMobileDay(); });
  document.getElementById('nextDay')?.addEventListener('click', ()=>{ currentMobileDay = addDays(currentMobileDay, 1); renderMobileDay(); });

  // Status toggle nos cards mobile (delegado) — usa campo executed
  document.getElementById('mobileDayList')?.addEventListener('click', async (e) => {
    // Confirmar agendamento
    const confirmBtn = e.target.closest('[data-confirm]');
    if (confirmBtn) {
      await persistConfirmed(confirmBtn.dataset.confirm, true);
      return;
    }
    // Realizado/N.Realizado
    const btn = e.target.closest('[data-exec]');
    if (!btn) return;
    const id = btn.dataset.id;
    const executed = btn.dataset.exec === 'true';
    if (!id) return;
    await persistExecuted(id, executed);
  });

  // Botão Calcular Rotas - Abrir modal de seleção de dia
  document.getElementById('calculateRoutes')?.addEventListener('click', calculateAllRoutesFromToday);
  document.getElementById('calculateRoutesMobile')?.addEventListener('click', calculateAllRoutesFromToday);
  document.getElementById('btnRotaDoDiaDesk')?.addEventListener('click', () => {
    // Desktop: usar hoje, ou pedir ao utilizador que selecione o dia
    const today = new Date(); today.setHours(0,0,0,0);
    // Temporariamente definir currentMobileDay para hoje e chamar openRotaDoDia
    const prev = currentMobileDay;
    currentMobileDay = today;
    openRotaDoDia();
    currentMobileDay = prev;
  });
  document.getElementById('calculateRoutesMobile')?.addEventListener('click', calculateAllRoutesFromToday);

  // ── Relatório semanal (mobile + desktop) ──
  const openRelatorio = () => {
    buildRelatorio();
    document.getElementById('relatorioModal')?.classList.add('show');
  };
  document.getElementById('btnRelatorio')?.addEventListener('click', openRelatorio);
  document.getElementById('btnRelatorioDesk')?.addEventListener('click', openRelatorio);
  document.getElementById('closeRelatorio')?.addEventListener('click', () => {
    document.getElementById('relatorioModal')?.classList.remove('show');
  });

  // Event listeners para edição
  document.getElementById('cancelForm')?.addEventListener('click', cancelEdit);
  document.getElementById('closeModal')?.addEventListener('click', cancelEdit);

  // Injetar secção "Encaminhado por comercial" no modal

  document.getElementById('deleteAppointment')?.addEventListener('click', function() {
    if (editingId) deleteAppointment(editingId);
  });

  // === Guardar Agendamento (criar/editar) ===
(function hookFormSubmit() {
  const form = document.getElementById('appointmentForm');
  const saveBtn = document.getElementById('saveAppointment'); // se existir
  if (!form) return;

  async function collectFormData() {
    const get = id => document.getElementById(id)?.value?.trim() || '';

    // normaliza data p/ YYYY-MM-DD
    const rawDate = get('appointmentDate');   // dd/mm/aaaa ou yyyy-mm-dd
    let date = '';
    if (rawDate) {
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
        const [d,m,y] = rawDate.split('/');
        date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        date = rawDate;
      }
    }

    // ===== CÁLCULO AUTOMÁTICO DE QUILÓMETROS =====
    let calculatedKm = null;
    const address = get('appointmentAddress');
    
    if (address) {
      try {
        showToast('Calculando distância...', 'info');
        const distanceInMeters = await getDistance(getBasePartida(), address);
        if (distanceInMeters !== Infinity && distanceInMeters > 0) {
          calculatedKm = Math.round(distanceInMeters / 1000); // converter metros para km
          // Atualizar o campo visual dos quilómetros
          const kmField = document.getElementById('appointmentKm');
          if (kmField) {
            kmField.value = calculatedKm;
          }
          showToast(`Distância calculada: ${calculatedKm} km`, 'success');
        } else {
          showToast('Não foi possível calcular a distância', 'error');
        }
      } catch (error) {
        console.error('Erro ao calcular distância:', error);
        showToast('Erro ao calcular distância', 'error');
      }
    }

    return {
      // campos base
      date,
      plate:  get('appointmentPlate').toUpperCase(),
      car:    get('appointmentCar').toUpperCase(),
      service:get('appointmentService'),
      locality:get('appointmentLocality'),
      period: (document.getElementById('appointmentPeriod')?.value || null),
      notes:  get('appointmentNotes'),
      address:get('appointmentAddress'),
      phone:  get('appointmentPhone'),
      extra:  get('appointmentExtra'),
      status: (document.getElementById('appointmentStatus')?.value || 'NE'),
      vehicleType: (document.getElementById('appointmentVehicleType')?.value || localStorage.getItem('eg_last_vehicleType') || 'L'),
      calibration: document.getElementById('appointmentCalibration')?.checked || false,
      first_of_day: document.getElementById('appointmentFirstOfDay')?.checked || false,
      // ===== ADICIONAR OS QUILÓMETROS CALCULADOS =====
      km: calculatedKm,
      confirmed: document.getElementById('appointmentConfirmed')?.value !== 'false',
      commercial_user_id: document.getElementById('appointmentCommercial')?.value
        ? parseInt(document.getElementById('appointmentCommercial').value)
        : null,
      client_name: (document.getElementById('appointmentClientName')?.value || '').trim() || null,
      damage_details: (document.getElementById('appointmentDamageDetails')?.value || '').trim() || null,
      custom_service_time: document.getElementById('appointmentService')?.value === 'OUT'
        ? (parseInt(document.getElementById('appointmentCustomTime')?.value) || null)
        : null,
      foreign_plate: document.getElementById('foreignPlate')?.checked || false,
      extra_services: typeof _readExtraServices === 'function' ? _readExtraServices() : []
    };
  }

  async function onSubmit(e) {
    e?.preventDefault?.();

    const payload = await collectFormData();

    // Guardar último tipo de veículo selecionado
    if (payload.vehicleType) localStorage.setItem('eg_last_vehicleType', payload.vehicleType);

    if (payload.date && payload.confirmed !== false) {
      var _bd = isDayBlocked(payload.date);
      if (_bd && !confirm('⚠️ ' + (_bd.reason || 'Dia bloqueado') + '\nAgendar mesmo assim?')) return;
    }
    // defaults mínimos
    if (!payload.plate) { showToast('Matrícula é obrigatória', 'error'); return; }
    if (!payload.service) { showToast('Tipo de serviço é obrigatório', 'error'); return; }
    if (!payload.locality && !isLoja()) { showToast('Localidade é obrigatória', 'error'); return; }

    try {
      if (editingId) {
        // UPDATE
        const updated = await window.apiClient.updateAppointment(editingId, payload);
        // aplica no array local
        const idx = appointments.findIndex(a => String(a.id) === String(editingId));
        // Guardar estado anterior ANTES de atualizar
        const prevAppt = idx >= 0 ? { ...appointments[idx] } : null;
        if (idx >= 0) appointments[idx] = { ...appointments[idx], ...updated, ...payload };
        showToast('Agendamento atualizado', 'success');
        if (payload.first_of_day && payload.date) await enforceSingleFirstOfDay(editingId, payload.date);
        // Notificar comercial apenas se mudou data OU confirmação
        if (payload.commercial_user_id && prevAppt) {
          const dateChanged = payload.date && prevAppt.date !== payload.date;
          const confirmedChanged = prevAppt.confirmed !== payload.confirmed && payload.confirmed === true;
          if (dateChanged || confirmedChanged) {
            const apptId = updated?.id || editingId;
            const nType = payload.confirmed ? 'scheduled' : 'pre-agendado';
            try { await authClient.authenticatedFetch('/.netlify/functions/notify-commercial', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ appointment_id: apptId, type: nType }) }); } catch(ne) {}
          }
        }
      } else {
        // CREATE
        const created = await window.apiClient.createAppointment(payload);
        
        // ✨ ELIMINAR SERVIÇO ORIGINAL: Se foi preenchido de um serviço por agendar
        if (window.originalUnscheduledServiceId && payload.date) {
          try {
            console.log('🗑️ Eliminando serviço original por agendar:', window.originalUnscheduledServiceId);
            await window.apiClient.deleteAppointment(window.originalUnscheduledServiceId);
            
            // Remover do array local
            const index = appointments.findIndex(a => String(a.id) === String(window.originalUnscheduledServiceId));
            if (index > -1) {
              appointments.splice(index, 1);
            }
            
            console.log('✅ Serviço original eliminado com sucesso');
          } catch (error) {
            console.error('⚠️ Erro ao eliminar serviço original:', error);
          } finally {
            // Limpar ID guardado
            window.originalUnscheduledServiceId = null;
          }
        }
       
       // Refaça o array e redesenha já
appointments = await window.apiClient.getAppointments();

// 🔧 NORMALIZAÇÃO (igual ao load)
appointments = appointments.map(a => ({
  ...a,
  date: a.date ? String(a.date).slice(0, 10) : null,
  address: a.address || a.morada || a.addr || null,
  sortIndex: a.sortIndex || 1,
  id: a.id ?? (Date.now() + Math.random())
}));

renderAll();

// (opcional) fechar modal
cancelEdit?.();

// ⛔️ APAGAR/COMENTAR tudo o que estava aqui:
// // 👉 Mete já no array em memória e força re-render
// const id = created?.id ?? (Date.now() + Math.random());
// const newItem = { ...payload, id, ...normalização... };
// appointments = [newItem]; // ou qualquer atribuição que substitua a lista
// renderAll();

        const item = { id: created?.id || (Date.now()+Math.random()), sortIndex: 1, ...payload, ...created };
        appointments.push(item);
        showToast('Agendamento criado', 'success');
        if (payload.first_of_day && payload.date) await enforceSingleFirstOfDay(item.id, payload.date);
        // Notificar comercial ao criar (sempre que tem comercial e data)
        if (payload.commercial_user_id && payload.date) {
          const apptId = created?.id || item.id;
          const nType = payload.confirmed ? 'scheduled' : 'pre-agendado';
          try { await authClient.authenticatedFetch('/.netlify/functions/notify-commercial', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ appointment_id: apptId, type: nType }) }); } catch(ne) {}
        }
      }

      // re-render e fechar modal
      renderAll();
      document.getElementById('appointmentModal')?.classList?.remove('show');
      form.reset();
      editingId = null;

    } catch (err) {
      // fallback offline (caso a API falhe)
      try {
        if (editingId) {
          const local = window.apiClient.updateAppointmentOffline(editingId, payload);
          const idx = appointments.findIndex(a => String(a.id) === String(editingId));
          if (idx >= 0) appointments[idx] = { ...appointments[idx], ...local };
        } else {
          const local = window.apiClient.createAppointmentOffline(payload);
          appointments.push(local);
        }
        renderAll();
        showToast('Guardado localmente (offline).', 'info');
        document.getElementById('appointmentModal')?.classList?.remove('show');
        form.reset();
        editingId = null;
      } catch (e2) {
        showToast('Falha ao guardar: ' + e2.message, 'error');
      }
    }
  }

  // garante que o botão "Guardar" submete o form
  form.addEventListener('submit', onSubmit);
  // Não registar click no saveBtn — é type="submit" e já dispara o submit event
})();

  
  // --- Novo Serviço (desktop) ---
  document.getElementById('addServiceBtn')?.addEventListener('click', () => {
    editingId = null;
    document.getElementById('appointmentForm').reset();
    document.getElementById('modalTitle').textContent = 'Novo Agendamento';
    document.getElementById('deleteAppointment').classList.add('hidden');
    setConfirmed(false);
    const lastVT = localStorage.getItem('eg_last_vehicleType') || 'L';
    const vtSelect = document.getElementById('appointmentVehicleType');
    if (vtSelect) vtSelect.value = lastVT;
    const selectedText = document.getElementById('selectedLocalityText');
    const selectedDot = document.getElementById('selectedLocalityDot');
    if (selectedText && selectedDot) {
      selectedText.textContent = 'Selecione a localidade';
      selectedDot.style.backgroundColor = '';
    }
    document.getElementById('appointmentModal').classList.add('show');
    if (!isLoja()) {
      setTimeout(() => _injectLocalityFirstOverlay(), 50);
    } else {
      setTimeout(() => { const p = document.getElementById('appointmentPlate'); if (p) p.focus(); }, 100);
    }
  });

  // --- Novo Serviço (mobile) ---
  document.getElementById('addServiceMobile')?.addEventListener('click', () => {
    editingId = null;
    document.getElementById('appointmentForm').reset();
    document.getElementById('modalTitle').textContent = 'Novo Agendamento';
    document.getElementById('deleteAppointment').classList.add('hidden');
    setConfirmed(false);
    const lastVT = localStorage.getItem('eg_last_vehicleType') || 'L';
    const vtSelect = document.getElementById('appointmentVehicleType');
    if (vtSelect) vtSelect.value = lastVT;
    const selectedText = document.getElementById('selectedLocalityText');
    const selectedDot = document.getElementById('selectedLocalityDot');
    if (selectedText && selectedDot) {
      selectedText.textContent = 'Selecione a localidade';
      selectedDot.style.backgroundColor = '';
    }
    document.getElementById('appointmentModal').classList.add('show');
    if (!isLoja()) {
      setTimeout(() => _injectLocalityFirstOverlay(), 50);
    } else {
      setTimeout(() => { const p = document.getElementById('appointmentPlate'); if (p) p.focus(); }, 100);
    }
  });

  // --- Importar Excel ---
  document.getElementById('importExcelBtn')?.addEventListener('click', () => {
    openExcelImportModal();
  });
  
  // --- Limpar Todos os Serviços por Agendar ---
  document.getElementById('clearAllUnscheduledBtn')?.addEventListener('click', async () => {
    const unscheduled = appointments.filter(a => !a.date);
    
    if (unscheduled.length === 0) {
      showToast('ℹ️ Não há serviços por agendar para limpar.', 'info');
      return;
    }
    
    const confirmMessage = `Tem a certeza que pretende eliminar TODOS os ${unscheduled.length} serviços por agendar?\n\nEsta ação não pode ser revertida!`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    try {
      showToast('🗑️ A eliminar serviços...', 'info');
      
      let successCount = 0;
      let errorCount = 0;
      
      // Eliminar cada serviço individualmente
      for (const service of unscheduled) {
        try {
          await window.apiClient.deleteAppointment(service.id);
          const index = appointments.findIndex(a => String(a.id) === String(service.id));
          if (index > -1) {
            appointments.splice(index, 1);
          }
          successCount++;
        } catch (error) {
          console.error(`Erro ao eliminar serviço ${service.id}:`, error);
          errorCount++;
        }
      }
      
      renderAll();
      
      if (errorCount === 0) {
        showToast(`✅ ${successCount} serviços eliminados com sucesso!`, 'success');
      } else {
        showToast(`⚠️ ${successCount} serviços eliminados, ${errorCount} falharam.`, 'warning');
      }
      
    } catch (error) {
      showToast('❌ Erro ao eliminar serviços: ' + error.message, 'error');
    }
  });
  })(); // fecho do async IIFE dentro de bootApp
} // fecho de bootApp

// Aguardar que o portal-init.js termine (dispara 'portalReady')
// antes de carregar os dados — resolve race condition no arranque
if (window._portalReadyFired) {
  // portalReady já disparou antes de este script carregar — chamar bootApp agora
  console.log('⚡ portalReady já disparou, a arrancar bootApp imediatamente');
  setTimeout(bootApp, 0);
} else {
  window.addEventListener('portalReady', bootApp, { once: true });
}

// === PRINT: Preenche secções de impressão (Hoje, Amanhã, Por Agendar) ===
(function(){
  if (window.fillPrintFromAppointments) return; // evitar duplicar
  function toISO(d){
    if (!(d instanceof Date)) d = new Date(d);
    d.setHours(0,0,0,0);
    const z = new Date(d.getTime() - d.getTimezoneOffset()*60000);
    return z.toISOString().slice(0,10);
  }
  function cap(s){ return (s||'').toString().charAt(0).toUpperCase()+ (s||'').toString().slice(1); }
    function normPeriod(p){
      return ''; // Sem períodos
    }
  // Função para serviços agendados (Hoje/Amanhã) - 7 colunas
  function rowScheduled(a){
    const dataFormatada = a.date ? new Date(a.date).toLocaleDateString('pt-PT') : '—';
    
    return `<tr>
      <td>${dataFormatada}</td>
      <td>${a.plate||'—'}</td>
      <td>${(a.car||'').toUpperCase()}</td>
      <td>${a.service||'—'}</td>
      <td>${a.locality||'—'}</td>
      <td>${a.notes || a.observations || '—'}</td>
      <td>${a.status||'—'}</td>
    </tr>`;
  }
  
  // Função para serviços por agendar - 8 colunas (com Data Criação)
  function rowUnscheduled(a){
    const dataFormatada = a.date ? new Date(a.date).toLocaleDateString('pt-PT') : '—';
    const dataCriacao = a.createdAt ? formatDateShort(a.createdAt) : '—';
    
    // Calcular antiguidade e aplicar cor
    let rowClass = '';
    if (!a.date && a.createdAt) {
      const dias = calcularDiasDesde(a.createdAt);
      if (dias >= 8) {
        rowClass = 'antiguidade-vermelho';
      } else if (dias >= 5) {
        rowClass = 'antiguidade-laranja';
      } else if (dias >= 3) {
        rowClass = 'antiguidade-amarelo';
      }
    }
    
    return `<tr class="${rowClass}">
      <td>${dataFormatada}</td>
      <td>${dataCriacao}</td>
      <td>${a.plate||'—'}</td>
      <td>${(a.car||'').toUpperCase()}</td>
      <td>${a.service||'—'}</td>
      <td>${a.locality||'—'}</td>
      <td>${a.notes || a.observations || '—'}</td>
      <td>${a.status||'—'}</td>
    </tr>`;
  }
  
  // Formatar data no formato DD.MM.YY
  function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}.${month}.${year}`;
  }
  
  // Calcular dias desde uma data
  function calcularDiasDesde(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    const diffMs = hoje - d;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
  function buildTable(title, dateLabel, list){
    const headDate = dateLabel ? `<div class="print-date">${dateLabel}</div>` : '';
    const empty = list.length===0 ? `<div class="print-empty">Sem registos</div>` : '';
    
    // Cabeçalho diferente para "Serviços por Agendar" (com coluna Data Criação)
    const isUnscheduled = title.includes('POR AGENDAR');
    const tableHeader = isUnscheduled 
      ? '<thead><tr><th>Data</th><th>Data Criação</th><th>Matrícula</th><th>Carro</th><th>Serviço</th><th>Localidade</th><th>Observações</th><th>Estado</th></tr></thead>'
      : '<thead><tr><th>Data</th><th>Matrícula</th><th>Carro</th><th>Serviço</th><th>Localidade</th><th>Observações</th><th>Estado</th></tr></thead>';
    
    // Usar função de linha apropriada conforme tipo de tabela
    const rowFunction = isUnscheduled ? rowUnscheduled : rowScheduled;
    
    return `<section class="print-section">
      <h2 class="print-title">${title}</h2>
      ${headDate}
      <table class="print-table">
        ${tableHeader}
        <tbody>${list.map(rowFunction).join('')}</tbody>
      </table>
      ${empty}
    </section>`;
  }
  window.fillPrintFromAppointments = function(){
    try{
      const contOld = document.getElementById('print-container-temp');
      if (contOld) contOld.remove();
      const cont = document.createElement('div');
      cont.id = 'print-container-temp';
      document.body.appendChild(cont);

      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);

      const isoToday = toISO(today);
      const isoTomorrow = toISO(tomorrow);

      const list = (Array.isArray(window.appointments)? window.appointments : []).slice();

        const unscheduled = list.filter(a => !a.date)
                            .sort((a,b)=> {
                              // Ordenar por data de criação (mais antigos primeiro)
                              const dateA = a.createdAt ? new Date(a.createdAt) : new Date();
                              const dateB = b.createdAt ? new Date(b.createdAt) : new Date();
                              return dateA - dateB;
                            });
      const todayServices = list.filter(a => a.date === isoToday)
                            .sort((a,b)=> (a.sortIndex||0)-(b.sortIndex||0));
      const tomorrowServices = list.filter(a => a.date === isoTomorrow)
                               .sort((a,b)=> (a.sortIndex||0)-(b.sortIndex||0));

      const dm = d => new Date(d).toLocaleDateString('pt-PT', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' });
      const titleToday = `SERVIÇOS DE HOJE`;
      const titleTomorrow = `SERVIÇOS DE AMANHÃ`;
      const titleUnscheduled = `SERVIÇOS POR AGENDAR`;

      cont.innerHTML = [
        buildTable(titleToday, cap(dm(today)), todayServices),
        buildTable(titleTomorrow, cap(dm(tomorrow)), tomorrowServices),
        buildTable(titleUnscheduled, '', unscheduled),
      ].join('');

      }catch(e){
    console.error('fillPrintFromAppointments falhou:', e);
  }
  };         
})();         

// === Máscara da matrícula ===
(function initPlateMask(){
  const el = document.getElementById('appointmentPlate');
  if (!el) return;

  el.addEventListener('input', (e) => {
    if (e.target._foreignMode) return; // sem máscara para estrangeiras
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const parts = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)].filter(Boolean);
    e.target.value = parts.join('-');
  });

  el.addEventListener('blur', (e) => {
    if (e.target._foreignMode) { e.target.setCustomValidity(''); return; }
    const ok = /^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/.test(e.target.value);
    e.target.setCustomValidity(ok ? '' : 'Use o formato XX-XX-XX');
    tryAutoFill(e.target.value);
  });

  // Também tentar no input (útil quando matrícula é colada ou preenchida pelo browser)
  let autoFillTimer = null;
  el.addEventListener('input', (e) => {
    clearTimeout(autoFillTimer);
    autoFillTimer = setTimeout(() => tryAutoFill(e.target.value), 400);
  });

  function tryAutoFill(rawPlate) {
    if (editingId) return; // só para novos agendamentos
    const norm = rawPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (norm.length < 6) return;

    // Procurar matrícula em TODOS os registos (pendentes e agendados)
    const existingService = appointments.find(a =>
      a.plate && a.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase() === norm
    );

    if (existingService) {
      // Usar editingId para actualizar o registo existente
      editingId = existingService.id;
      window.originalUnscheduledServiceId = null;

      // Preencher campos
      if (existingService.car) document.getElementById('appointmentCar').value = existingService.car;
      if (existingService.service) document.getElementById('appointmentService').value = existingService.service;
      if (existingService.locality) document.getElementById('appointmentLocality').value = existingService.locality;
      if (existingService.notes) document.getElementById('appointmentNotes').value = existingService.notes;
      if (existingService.address) document.getElementById('appointmentAddress').value = existingService.address;
      if (existingService.phone) document.getElementById('appointmentPhone').value = existingService.phone;
      if (existingService.extra) document.getElementById('appointmentExtra').value = existingService.extra;
      if (existingService.status) {
        const statusEl = document.getElementById('appointmentStatus');
        if (statusEl) statusEl.value = existingService.status;
      }
      // NÃO alterar o estado confirmed — manter o que o coordenador seleccionou

      showToast('✨ Dados preenchidos automaticamente', 'info');
    }
  }
})();


// === Maiúsculas automáticas no campo Modelo do Carro ===
(function() {
  function applyCarUppercase() {
    const carInput = document.getElementById('appointmentCar');
    if (!carInput || carInput._upperCaseListenerAdded) return;
    carInput.addEventListener('input', function() {
      const pos = this.selectionStart;
      this.value = this.value.toUpperCase();
      this.setSelectionRange(pos, pos);
    });
    carInput._upperCaseListenerAdded = true;
  }
  if (document.readyState === 'complete') applyCarUppercase();
  else window.addEventListener('load', applyCarUppercase);
})();

// === Autocomplete de Morada (Google Places) ===
(function initAddressAutocomplete(){
  const input = document.getElementById('appointmentAddress');
  if (!input) return;

  function run() {
    if (!(window.google && google.maps && google.maps.places)) {
      console.warn('Google Places API ainda não disponível.');
      return;
    }

    // ⚠️ Sem 'types' e sem 'fields' — assim apanha moradas *e* empresas/POIs
    const ac = new google.maps.places.Autocomplete(input, {
      fields: ['place_id', 'name', 'formatted_address', 'address_components']
    });

    if (ac.setComponentRestrictions) {
      ac.setComponentRestrictions({ country: ['pt'] });
    }

    ac.addListener('place_changed', async () => {
      const place = ac.getPlace();
      const txt = [place?.name, place?.formatted_address]
        .filter(Boolean)
        .join(' - ');
      if (txt) {
        input.value = txt;

        // Extrair localidade dos address_components
        if (place.address_components) {
          // Tentar: concelho (level_2) → postal_town → locality (evitar freguesias)
          const types = ['administrative_area_level_2', 'postal_town', 'locality'];
          let detectedLocality = null;
          for (const type of types) {
            const comp = place.address_components.find(c => c.types.includes(type));
            if (comp) { detectedLocality = comp.long_name; break; }
          }

          if (detectedLocality) {
            // Verificar se corresponde a alguma localidade conhecida
            const localityField = document.getElementById('appointmentLocality');
            const currentLocality = localityField?.value || '';
            const known = window._localityList || [];
            const match = known.find(l => 
              l.toLowerCase() === detectedLocality.toLowerCase() ||
              detectedLocality.toLowerCase().includes(l.toLowerCase()) ||
              l.toLowerCase().includes(detectedLocality.toLowerCase())
            );
            const toSet = match || detectedLocality;

            if (currentLocality && currentLocality !== toSet) {
              showToast(`📍 Localidade actualizada: ${toSet}`, 'info');
            } else if (!currentLocality) {
              showToast(`📍 Localidade detectada: ${toSet}`, 'success');
            }

            if (toSet && typeof window.selectLocality === 'function') {
              window.selectLocality(toSet);
            } else if (localityField) {
              localityField.value = toSet;
            }
          } else {
            showToast('📍 Não foi possível detectar a localidade — preenche manualmente', 'warning');
          }
        }

        // Calcular distância automaticamente
        try {
          showToast('Calculando distância...', 'info');
          const distanceInMeters = await getDistance(getBasePartida(), txt);
          if (distanceInMeters !== Infinity && distanceInMeters > 0) {
            const calculatedKm = Math.round(distanceInMeters / 1000);
            const kmField = document.getElementById('appointmentKm');
            if (kmField) kmField.value = calculatedKm;
            showToast(`Distância calculada: ${calculatedKm} km`, 'success');
          } else {
            showToast('Não foi possível calcular a distância', 'error');
          }
        } catch (error) {
          console.error('Erro ao calcular distância:', error);
          showToast('Erro ao calcular distância', 'error');
        }
      }
    });
  }

  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();


// === Localidade: handlers mínimos (fix undefined) ===
window.toggleLocalityDropdown = function () {
  const dd = document.getElementById('localityDropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open') || dd.classList.contains('show');
  dd.classList.toggle('open');
  dd.classList.toggle('show');
  if (!isOpen) {
    // Ao abrir: limpar pesquisa, mostrar favoritas, focar input
    const search = document.getElementById('localitySearch');
    if (search) {
      search.value = '';
      renderLocalityOptions('');
      setTimeout(() => search.focus(), 50);
    }
  }
};

const PROX = {
  "Abrantes": ['Santarém', 'Tomar', 'Torres Novas', 'Entroncamento'],
  "Albufeira": ['Loulé', 'Silves', 'Lagoa', 'Portimão'],
  "Alcobaça": ['Leiria', 'Batalha', 'Nazaré', 'Caldas da Rainha', 'Porto de Mós'],
  "Alcochete": ['Montijo', 'Benavente', 'Palmela'],
  "Alcácer do Sal": ['Setúbal', 'Grândola', 'Santiago do Cacém', 'Évora'],
  "Almada": ['Lisboa', 'Seixal', 'Sesimbra', 'Palmela'],
  "Almeirim": ['Santarém', 'Cartaxo', 'Alpiarça'],
  "Amadora": ['Lisboa', 'Odivelas', 'Sintra', 'Cascais', 'Oeiras'],
  "Amarante": ['Felgueiras', 'Lousada', 'Penafiel', 'Celorico de Basto', 'Marco de Canaveses'],
  "Amares": ['Braga', 'Barcelos', 'Póvoa de Lanhoso', 'Terras de Bouro', 'Vila Verde'],
  "Anadia": ['Aveiro', 'Oliveira do Bairro', 'Mealhada', 'Cantanhede', 'Coimbra'],
  "Arcos de Valdevez": ['Ponte de Lima', 'Viana do Castelo', 'Ponte da Barca', 'Monção', 'Terras de Bouro'],
  "Arouca": ['Vale de Cambra', 'Sever do Vouga', 'Santa Maria da Feira'],
  "Aveiro": ['Ílhavo', 'Estarreja', 'Vagos', 'Murtosa', 'Oliveira do Bairro', 'Águeda'],
  "Azambuja": ['Vila Franca de Xira', 'Cartaxo', 'Rio Maior'],
  "Barcelos": ['Braga', 'Famalicão', 'Póvoa de Varzim', 'Esposende', 'Amares', 'Vila Verde'],
  "Barreiro": ['Seixal', 'Moita', 'Montijo', 'Palmela'],
  "Batalha": ['Leiria', 'Porto de Mós', 'Alcobaça'],
  "Beja": ['Cuba', 'Serpa', 'Vidigueira', 'Ferreira do Alentejo', 'Alvito'],
  "Benavente": ['Montijo', 'Alcochete', 'Vila Franca de Xira', 'Santarém'],
  "Borba": ['Estremoz', 'Vila Viçosa', 'Reguengos de Monsaraz'],
  "Braga": ['Barcelos', 'Famalicão', 'Guimarães', 'Póvoa de Lanhoso', 'Amares', 'Vila Verde', 'Esposende', 'Póvoa de Varzim'],
  "Bragança": ['Vinhais', 'Macedo de Cavaleiros', 'Miranda do Douro', 'Vimioso'],
  "Cabeceiras de Basto": ['Fafe', 'Celorico de Basto', 'Amarante', 'Mondim de Basto'],
  "Caldas da Rainha": ['Leiria', 'Alcobaça', 'Nazaré', 'Óbidos', 'Torres Vedras'],
  "Caminha": ['Viana do Castelo', 'Vila Nova de Cerveira', 'Ponte de Lima'],
  "Campo Maior": ['Elvas', 'Portalegre'],
  "Cantanhede": ['Coimbra', 'Vagos', 'Mira', 'Montemor-o-Velho', 'Figueira da Foz', 'Anadia'],
  "Cartaxo": ['Santarém', 'Almeirim', 'Vila Franca de Xira', 'Azambuja'],
  "Cascais": ['Sintra', 'Oeiras', 'Lisboa'],
  "Castelo Branco": ['Covilhã', 'Fundão', 'Proença-a-Nova', 'Idanha-a-Nova', 'Oleiros'],
  "Celorico de Basto": ['Cabeceiras de Basto', 'Amarante', 'Felgueiras'],
  "Chaves": ['Valpaços', 'Montalegre', 'Boticas', 'Vinhais'],
  "Coimbra": ['Condeixa-a-Nova', 'Montemor-o-Velho', 'Mealhada', 'Anadia', 'Cantanhede', 'Miranda do Corvo', 'Penacova', 'Soure'],
  "Covilhã": ['Castelo Branco', 'Fundão', 'Belmonte', 'Guarda', 'Seia'],
  "Elvas": ['Portalegre', 'Campo Maior', 'Estremoz'],
  "Entroncamento": ['Torres Novas', 'Abrantes', 'Tomar'],
  "Espinho": ['Gaia', 'Santa Maria da Feira', 'Ovar'],
  "Esposende": ['Barcelos', 'Braga', 'Viana do Castelo', 'Póvoa de Varzim'],
  "Estarreja": ['Aveiro', 'Murtosa', 'Ovar', 'Oliveira de Azeméis', 'Albergaria-a-Velha'],
  "Estremoz": ['Évora', 'Arraiolos', 'Borba', 'Vila Viçosa', 'Elvas'],
  "Fafe": ['Guimarães', 'Braga', 'Póvoa de Lanhoso', 'Cabeceiras de Basto', 'Vieira do Minho'],
  "Famalicão": ['Braga', 'Barcelos', 'Trofa', 'Santo Tirso', 'Póvoa de Varzim', 'Vila do Conde', 'Guimarães'],
  "Faro": ['Loulé', 'Olhão', 'São Brás de Alportel', 'Tavira'],
  "Felgueiras": ['Guimarães', 'Paços de Ferreira', 'Lousada', 'Amarante', 'Celorico de Basto'],
  "Figueira da Foz": ['Cantanhede', 'Mira', 'Montemor-o-Velho', 'Soure'],
  "Fundão": ['Castelo Branco', 'Covilhã', 'Belmonte'],
  "Gaia": ['Porto', 'Gondomar', 'Santa Maria da Feira', 'Espinho', 'Matosinhos'],
  "Gondomar": ['Porto', 'Gaia', 'Valongo', 'Penafiel', 'Santa Maria da Feira'],
  "Gouveia": ['Seia', 'Guarda', 'Mangualde', 'Celorico da Beira'],
  "Grândola": ['Setúbal', 'Alcácer do Sal', 'Santiago do Cacém', 'Sines'],
  "Guarda": ['Covilhã', 'Manteigas', 'Seia', 'Sabugal', 'Pinhel', 'Trancoso', 'Celorico da Beira'],
  "Guimarães": ['Braga', 'Famalicão', 'Felgueiras', 'Fafe', 'Vizela', 'Santo Tirso', 'Paços de Ferreira'],
  "Lagoa": ['Portimão', 'Silves', 'Albufeira'],
  "Lagos": ['Portimão', 'Aljezur', 'Vila do Bispo'],
  "Lamego": ['Peso da Régua', 'Resende', 'Castro Daire', 'Tarouca'],
  "Leiria": ['Batalha', 'Marinha Grande', 'Porto de Mós', 'Alcobaça', 'Pombal', 'Ourém'],
  "Lisboa": ['Loures', 'Odivelas', 'Amadora', 'Sintra', 'Oeiras', 'Cascais', 'Almada'],
  "Loulé": ['Faro', 'Albufeira', 'São Brás de Alportel', 'Silves', 'Tavira'],
  "Loures": ['Lisboa', 'Odivelas', 'Vila Franca de Xira', 'Mafra', 'Sintra'],
  "Lousada": ['Felgueiras', 'Paços de Ferreira', 'Penafiel', 'Amarante'],
  "Lousã": ['Miranda do Corvo', 'Coimbra', 'Góis', 'Oliveira do Hospital'],
  "Macedo de Cavaleiros": ['Bragança', 'Mirandela', 'Vinhais', 'Alfândega da Fé'],
  "Mafra": ['Sintra', 'Loures', 'Torres Vedras'],
  "Maia": ['Porto', 'Matosinhos', 'Trofa', 'Vila do Conde', 'Valongo', 'Gondomar'],
  "Mangualde": ['Viseu', 'Nelas', 'Penalva do Castelo', 'Gouveia'],
  "Marco de Canaveses": ['Amarante', 'Penafiel', 'Baião', 'Resende'],
  "Marinha Grande": ['Leiria', 'Pombal', 'Alcobaça'],
  "Matosinhos": ['Porto', 'Maia', 'Póvoa de Varzim', 'Vila do Conde', 'Gondomar'],
  "Mealhada": ['Aveiro', 'Águeda', 'Anadia', 'Coimbra'],
  "Melgaço": ['Monção', 'Arcos de Valdevez'],
  "Miranda do Corvo": ['Coimbra', 'Condeixa-a-Nova', 'Lousã', 'Góis'],
  "Mirandela": ['Macedo de Cavaleiros', 'Chaves', 'Valpaços', 'Murça'],
  "Moita": ['Barreiro', 'Montijo', 'Palmela'],
  "Montalegre": ['Chaves', 'Boticas', 'Vieira do Minho', 'Terras de Bouro'],
  "Montijo": ['Barreiro', 'Moita', 'Alcochete', 'Benavente'],
  "Monção": ['Valença', 'Melgaço', 'Arcos de Valdevez', 'Paredes de Coura'],
  "Moura": ['Serpa', 'Beja', 'Barrancos', 'Mourão'],
  "Murtosa": ['Aveiro', 'Estarreja', 'Ovar'],
  "Mértola": ['Serpa', 'Beja', 'Castro Verde'],
  "Nazaré": ['Alcobaça', 'Caldas da Rainha'],
  "Nelas": ['Viseu', 'Mangualde', 'Anadia', 'Santa Comba Dão'],
  "Odivelas": ['Lisboa', 'Loures', 'Amadora', 'Sintra'],
  "Oeiras": ['Lisboa', 'Amadora', 'Cascais', 'Sintra'],
  "Olhão": ['Faro', 'Tavira', 'São Brás de Alportel'],
  "Oliveira de Azeméis": ['Santa Maria da Feira', 'Estarreja', 'São João da Madeira', 'Vale de Cambra', 'Albergaria-a-Velha'],
  "Oliveira do Bairro": ['Aveiro', 'Águeda', 'Mealhada', 'Anadia'],
  "Oliveira do Hospital": ['Lousã', 'Góis', 'Arganil', 'Seia', 'Nelas'],
  "Ourém": ['Tomar', 'Leiria', 'Batalha'],
  "Ovar": ['Espinho', 'Estarreja', 'Santa Maria da Feira', 'Murtosa'],
  "Palmela": ['Setúbal', 'Seixal', 'Barreiro', 'Almada', 'Alcochete'],
  "Paredes": ['Valongo', 'Gondomar', 'Penafiel', 'Santo Tirso', 'Paços de Ferreira'],
  "Paredes de Coura": ['Vila Nova de Cerveira', 'Valença', 'Monção', 'Ponte de Lima'],
  "Paços de Ferreira": ['Guimarães', 'Felgueiras', 'Lousada', 'Santo Tirso', 'Paredes'],
  "Penafiel": ['Gondomar', 'Valongo', 'Paredes', 'Lousada', 'Amarante'],
  "Peniche": ['Óbidos', 'Caldas da Rainha'],
  "Peso da Régua": ['Vila Real', 'Lamego', 'Mesão Frio'],
  "Pombal": ['Leiria', 'Marinha Grande', 'Coimbra', 'Soure'],
  "Ponte da Barca": ['Arcos de Valdevez', 'Ponte de Lima', 'Terras de Bouro'],
  "Ponte de Lima": ['Viana do Castelo', 'Braga', 'Arcos de Valdevez', 'Barcelos', 'Ponte da Barca'],
  "Portalegre": ['Elvas', 'Campo Maior', 'Alter do Chão', 'Arronches', 'Marvão', 'Crato'],
  "Portimão": ['Lagoa', 'Silves', 'Lagos', 'Monchique'],
  "Porto": ['Gaia', 'Matosinhos', 'Maia', 'Gondomar', 'Valongo'],
  "Porto de Mós": ['Leiria', 'Batalha', 'Alcobaça', 'Torres Novas'],
  "Póvoa de Lanhoso": ['Braga', 'Amares', 'Fafe', 'Vieira do Minho', 'Guimarães'],
  "Póvoa de Varzim": ['Vila do Conde', 'Barcelos', 'Famalicão', 'Esposende', 'Maia', 'Matosinhos'],
  "Rio Maior": ['Santarém', 'Caldas da Rainha', 'Alcobaça', 'Azambuja'],
  "Santa Maria da Feira": ['Gaia', 'Gondomar', 'Espinho', 'Ovar', 'Oliveira de Azeméis', 'São João da Madeira'],
  "Santarém": ['Torres Novas', 'Almeirim', 'Cartaxo', 'Rio Maior', 'Benavente', 'Abrantes'],
  "Santiago do Cacém": ['Grândola', 'Sines', 'Alcácer do Sal', 'Odemira'],
  "Santo Tirso": ['Guimarães', 'Famalicão', 'Trofa', 'Maia', 'Paredes', 'Paços de Ferreira'],
  "Seia": ['Guarda', 'Gouveia', 'Oliveira do Hospital', 'Covilhã'],
  "Seixal": ['Almada', 'Barreiro', 'Palmela', 'Setúbal'],
  "Serpa": ['Beja', 'Moura', 'Mértola', 'Vidigueira'],
  "Sesimbra": ['Almada', 'Setúbal', 'Palmela'],
  "Setúbal": ['Palmela', 'Seixal', 'Almada', 'Alcácer do Sal', 'Grândola'],
  "Sever do Vouga": ['Albergaria-a-Velha', 'Águeda', 'Vale de Cambra', 'Arouca'],
  "Silves": ['Loulé', 'Albufeira', 'Portimão', 'Lagoa'],
  "Sines": ['Santiago do Cacém', 'Grândola', 'Odemira'],
  "Sintra": ['Lisboa', 'Amadora', 'Cascais', 'Mafra', 'Loures', 'Oeiras'],
  "São João da Madeira": ['Santa Maria da Feira', 'Oliveira de Azeméis', 'Vale de Cambra'],
  "Tavira": ['Faro', 'Loulé', 'Olhão', 'Castro Marim', 'Vila Real de Santo António'],
  "Terras de Bouro": ['Amares', 'Braga', 'Ponte da Barca', 'Arcos de Valdevez'],
  "Tomar": ['Entroncamento', 'Ourém', 'Torres Novas', 'Ferreira do Zêzere'],
  "Tondela": ['Viseu', 'Águeda', 'Santa Comba Dão', 'Sátão'],
  "Torres Novas": ['Santarém', 'Porto de Mós', 'Entroncamento', 'Tomar'],
  "Torres Vedras": ['Mafra', 'Caldas da Rainha', 'Óbidos', 'Lisboa'],
  "Trofa": ['Famalicão', 'Santo Tirso', 'Vila do Conde', 'Maia'],
  "Vagos": ['Aveiro', 'Ílhavo', 'Cantanhede', 'Mira'],
  "Vale de Cambra": ['São João da Madeira', 'Oliveira de Azeméis', 'Sever do Vouga', 'Arouca'],
  "Valença": ['Vila Nova de Cerveira', 'Monção', 'Paredes de Coura'],
  "Valongo": ['Porto', 'Maia', 'Gondomar', 'Penafiel', 'Paredes'],
  "Viana do Castelo": ['Esposende', 'Barcelos', 'Ponte de Lima', 'Caminha', 'Arcos de Valdevez', 'Vila Nova de Cerveira'],
  "Vieira do Minho": ['Braga', 'Póvoa de Lanhoso', 'Fafe', 'Cabeceiras de Basto', 'Montalegre'],
  "Vila Franca de Xira": ['Loures', 'Cartaxo', 'Benavente', 'Azambuja'],
  "Vila Nova de Cerveira": ['Caminha', 'Viana do Castelo', 'Valença', 'Paredes de Coura'],
  "Vila Real": ['Peso da Régua', 'Alijó', 'Murça', 'Mondim de Basto', 'Sabrosa'],
  "Vila Real de Santo António": ['Tavira', 'Castro Marim'],
  "Vila Verde": ['Braga', 'Barcelos', 'Amares', 'Ponte de Lima'],
  "Vila Viçosa": ['Borba', 'Estremoz', 'Elvas'],
  "Vila do Conde": ['Póvoa de Varzim', 'Barcelos', 'Famalicão', 'Trofa', 'Maia', 'Matosinhos'],
  "Viseu": ['Mangualde', 'Tondela', 'Nelas', 'Santa Comba Dão', 'Penalva do Castelo', 'Sátão'],
  "Vizela": ['Guimarães', 'Felgueiras', 'Santo Tirso', 'Paços de Ferreira'],
};

function getProximas(loc) {
  if (!loc) return [];
  const key = Object.keys(PROX).find(k => k.toLowerCase() === loc.toLowerCase());
  return key ? [key, ...PROX[key]] : [loc];
}

function sugerirDataParaLocalidade(locality) {
  if (!locality || !window.appointments) return null;
  var proximas = getProximas(locality);
  var hoje = new Date();
  hoje.setHours(0,0,0,0);
  var MAX_DIAS = 21;
  var MAX_SERVICOS = 5;
  var porDia = {};
  window.appointments.forEach(function(a) {
    if (!a.date) return;
    var d = a.date.slice(0,10);
    if (!porDia[d]) porDia[d] = { count: 0, localidades: [] };
    porDia[d].count++;
    if (a.locality) porDia[d].localidades.push(a.locality);
  });
  var candidatos = [];
  for (var i = 1; i <= MAX_DIAS; i++) {
    var d = new Date();
    d.setHours(12,0,0,0);
    d.setDate(d.getDate() + i);
    var dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    var iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    var dia = porDia[iso] || { count: 0, localidades: [] };
    if (dia.count >= MAX_SERVICOS) continue;
    var temMesma = dia.localidades.some(function(l) { return l && l.toLowerCase() === locality.toLowerCase(); });
    var temProxima = !temMesma && dia.localidades.some(function(l) {
      return l && proximas.some(function(p) { return p.toLowerCase() === l.toLowerCase(); });
    });
    candidatos.push({ date: iso, count: dia.count, localidades: dia.localidades, score: temMesma ? 100 : temProxima ? 50 : 0, temMesma: temMesma, temProxima: temProxima });
  }
  if (!candidatos.length) return null;
  candidatos.sort(function(a, b) { return b.score !== a.score ? b.score - a.score : a.count - b.count; });
  return candidatos[0];
}

window.sugerirDataParaLocalidade = sugerirDataParaLocalidade;

// Mostrar campo de tempo personalizado quando OUT selecionado
document.addEventListener('change', function(e) {
  if (e.target.id === 'appointmentService') {
    var grp = document.getElementById('customServiceTimeGroup');
    if (grp) grp.style.display = e.target.value === 'OUT' ? 'block' : 'none';
  }
});

// Toggle matrícula estrangeira
window.toggleForeignPlate = function(isForign) {
  var plate = document.getElementById('appointmentPlate');
  if (!plate) return;
  if (isForign) {
    plate.removeAttribute('pattern');
    plate.removeAttribute('maxlength');
    plate.setCustomValidity('');
    plate.placeholder = 'Ex: AB12 CDE ou 1234-XY-56';
    plate.style.fontStyle = 'italic';
    plate._foreignMode = true;
  } else {
    plate.setAttribute('pattern', '^[A-Za-z0-9]{2}-[A-Za-z0-9]{2}-[A-Za-z0-9]{2}$');
    plate.setAttribute('maxlength', '8');
    plate.placeholder = 'XX-XX-XX';
    plate.style.fontStyle = '';
    plate._foreignMode = false;
  }
};

window.selectLocality = function (value) {
  const field = document.getElementById('appointmentLocality');
  const txt   = document.getElementById('selectedLocalityText');
  const dot   = document.getElementById('selectedLocalityDot');
  if (field) field.value = value || '';
  if (txt)   txt.textContent = value || 'Selecione a localidade';
  if (dot)   dot.style.backgroundColor = value ? getLocColor(value) : '';
  const dd = document.getElementById('localityDropdown');
  dd?.classList.remove('open'); dd?.classList.remove('show');
  const search = document.getElementById('localitySearch');
  if (search) search.value = '';
  // Remover overlay de localidade obrigatória
  if (value) { var ov = document.getElementById('localityFirstOverlay'); if (ov) ov.remove(); }

  // Sugestão de data — em timeout para não interferir com o dropdown
  setTimeout(function() {
    try {
      var existing = document.getElementById('crDateSuggestion');
      if (existing) existing.remove();
      if (!value || typeof window.sugerirDataParaLocalidade !== 'function') return;
      var sug = window.sugerirDataParaLocalidade(value);
      if (!sug) return;
      var d = new Date(sug.date + 'T12:00:00');
      var dateStr = d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
      var motivo = sug.temMesma ? '📍 Já tem serviços em ' + value + ' nesse dia'
        : sug.temProxima ? '🗺️ Localidades próximas nesse dia'
        : '📅 Dia com menos serviços (' + sug.count + '/5)';
      var badge = document.createElement('div');
      badge.id = 'crDateSuggestion';
      badge.style.cssText = 'background:#eff6ff;border:1.5px solid #3b82f6;border-radius:10px;padding:10px 14px;margin:8px 0;font-size:13px;';
      badge.innerHTML = '<div style="font-weight:700;color:#1d4ed8;margin-bottom:2px;">💡 Sugestão de data</div>'
        + '<div style="color:#1e40af;font-size:14px;font-weight:600;">' + dateStr + ' (' + sug.count + ' serviços)</div>'
        + '<div style="color:#64748b;font-size:11px;margin-top:2px;">' + motivo + '</div>'
        + '<button id="crApplyDateBtn" style="margin-top:8px;background:#3b82f6;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">✓ Usar esta data</button>';
      var form = document.getElementById('appointmentForm');
      if (form) {
        form.insertBefore(badge, form.firstChild);
        document.getElementById('crApplyDateBtn').onclick = function() {
          window.crAplicarData(sug.date);
        };
      }
    } catch(e) { console.warn('[sugestão]', e.message); }
  }, 50);
};

window.crAplicarData = function(date) {
  const el = document.getElementById('appointmentDate');
  if (el) { el.value = date; el.dispatchEvent(new Event('change')); }
  const badge = document.getElementById('crDateSuggestion');
  if (badge) badge.style.border = '1.5px solid #16a34a';
};

// fecha o dropdown ao clicar fora
document.addEventListener('click', (e) => {
  const ac = document.getElementById('localityAutocomplete');
  if (!ac) return;
  if (!ac.contains(e.target)) {
    const dd = document.getElementById('localityDropdown');
    dd?.classList.remove('open'); dd?.classList.remove('show');
  }
});


// ========== FUNCIONALIDADES DE PROCURA E VISTA TABELA ==========

// Formatação automática da matrícula na caixa de procura
function formatPlateInput(input) {
  let value = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (value.length > 6) value = value.substring(0, 6);
  
  if (value.length >= 2) {
    value = value.substring(0, 2) + '-' + value.substring(2);
  }
  if (value.length >= 6) {
    value = value.substring(0, 5) + '-' + value.substring(5);
  }
  
  input.value = value;
}

// Filtrar serviços por matrícula
function filterServicesByPlate(searchTerm) {
  const normalizedSearch = searchTerm.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  // Filtrar linhas da tabela "por agendar"
  const rows = document.querySelectorAll('#unscheduledTableBody tr');
  rows.forEach(row => {
    const plate = row.getAttribute('data-plate') || '';
    const normalizedPlate = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (normalizedSearch === '' || normalizedPlate.includes(normalizedSearch)) {
      row.classList.remove('filtered-out');
    } else {
      row.classList.add('filtered-out');
    }
  });

  // Se há termo de pesquisa, mostrar também resultados de toda a agenda
  const resultBox = document.getElementById('plateSearchResults');
  if (normalizedSearch.length < 2) {
    if (resultBox) resultBox.remove();
    return;
  }

  // Procurar em todos os agendamentos
  const matches = (window.appointments || []).filter(a => {
    const p = (a.plate || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return p.includes(normalizedSearch);
  }).slice(0, 10);

  // Mostrar resultados numa caixa abaixo da pesquisa
  let box = document.getElementById('plateSearchResults');
  if (!box) {
    box = document.createElement('div');
    box.id = 'plateSearchResults';
    document.body.appendChild(box);
  }
  // Posicionar relativo ao campo de pesquisa
  const searchEl = document.getElementById('searchPlate');
  if (searchEl) {
    const rect = searchEl.getBoundingClientRect();
    box.style.cssText = `position:fixed;z-index:9999;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.18);max-height:380px;overflow-y:auto;width:${Math.max(rect.width, 360)}px;top:${rect.bottom + 4}px;left:${rect.left}px;`;
  }

  if (!matches.length) {
    box.innerHTML = '<div style="padding:12px 16px;color:#9ca3af;font-size:13px;">Nenhum resultado encontrado</div>';
    return;
  }

  box.innerHTML = matches.map(a => {
    const dateStr = a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('pt-PT', {day:'2-digit', month:'2-digit', year:'numeric'}) : '— sem data —';
    const statusColor = {'NE':'#6b7280','VE':'#f59e0b','ST':'#10b981'}[a.status] || '#6b7280';
    return `<div onclick="window._jumpToAppointment('${a.id}')" style="padding:10px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;align-items:center;gap:12px;" 
      onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <div style="font-weight:800;font-size:14px;min-width:80px;">${a.plate || '—'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#374151;">${(a.car||'').toUpperCase()}</div>
        <div style="font-size:11px;color:#9ca3af;">${dateStr} · ${a.locality || '—'}</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:${statusColor};background:${statusColor}20;padding:2px 8px;border-radius:6px;">${a.status||'—'}</div>
    </div>`;
  }).join('') + (matches.length >= 10 ? '<div style="padding:8px 16px;font-size:12px;color:#9ca3af;text-align:center;">Mostrando primeiros 10 resultados</div>' : '');

  // Fechar ao clicar fora
  setTimeout(() => {
    document.addEventListener('click', function closeBox(e) {
      if (!box.contains(e.target) && e.target.id !== 'searchPlate') {
        box.remove();
        document.removeEventListener('click', closeBox);
      }
    });
  }, 100);
}

window._jumpToAppointment = function(id) {
  // Fechar caixa de resultados
  document.getElementById('plateSearchResults')?.remove();
  document.getElementById('searchPlate').value = '';

  const a = (window.appointments || []).find(ap => String(ap.id) === String(id));
  if (!a) return;

  if (a.date) {
    // Serviço agendado — navegar para a semana/dia certo
    const d = new Date(a.date + 'T12:00:00');
    // Desktop: ir para a semana
    currentMonday = getMonday(d);
    currentMobileDay = d;
    renderAll();
    // Destacar o card após render
    setTimeout(() => {
      const card = document.querySelector(`[data-id="${id}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.outline = '3px solid #f59e0b';
        card.style.outlineOffset = '2px';
        setTimeout(() => { card.style.outline = ''; card.style.outlineOffset = ''; }, 2500);
      }
    }, 300);
  } else {
    // Serviço por agendar — já está na lista
    setTimeout(() => {
      const row = document.querySelector(`#unscheduledTableBody tr[data-id="${id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.style.background = '#fef3c7';
        setTimeout(() => { row.style.background = ''; }, 2500);
      }
    }, 100);
  }
};

// Vista em tabela é agora a única vista disponível

// Inicializar funcionalidades quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {

  // ── Backup / Restaurar (independente do portalReady) ──
  function openBackupModal() {
    document.getElementById('backupModal')?.classList.add('show');
  }
  function closeBackupModalFn() {
    document.getElementById('backupModal')?.classList.remove('show');
    const s = document.getElementById('restoreStatus');
    if (s) { s.style.display = 'none'; s.textContent = ''; }
    const fi = document.getElementById('restoreFile');
    if (fi) fi.value = '';
  }

  document.getElementById('btnBackupRapido')?.addEventListener('click', openBackupModal);
  document.getElementById('backupBtn')?.addEventListener('click', openBackupModal);
  document.getElementById('closeBackupModal')?.addEventListener('click', closeBackupModalFn);
  document.getElementById('backupModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'backupModal') closeBackupModalFn();
  });

  document.getElementById('btnExportBackup')?.addEventListener('click', async () => {
    try {
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      const role = window.authClient?.getUser()?.role;
      const isAdmin = role === 'admin';

      let appts, filename, exportData;

      if (isAdmin) {
        // Admin: backup geral de todos os portais
        const token = window.authClient?.getToken();
        const resp = await fetch('/.netlify/functions/backup-all', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Erro no backup');
        appts = data.appointments;
        filename = `backup_GERAL_${stamp}.json`;
        exportData = { exportedAt: data.exportedAt, portals: data.portals, total: data.total, appointments: appts };
      } else {
        // Outros: só portal activo
        appts = window.appointments || [];
        if (!appts.length) { alert('Sem agendamentos para exportar.'); return; }
        const portalName = (window.portalConfig?.name || 'portal').replace(/\s+/g, '-');
        filename = `backup_${portalName}_${stamp}.json`;
        exportData = { portal: portalName, exportedAt: now.toISOString(), total: appts.length, appointments: appts };
      }

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      alert(`✅ Backup guardado: ${filename}\n${appts.length} agendamentos exportados.`);
    } catch(e) { alert('Erro ao criar backup: ' + e.message); }
  });

  document.getElementById('btnChooseRestore')?.addEventListener('click', () => {
    document.getElementById('restoreFile')?.click();
  });

  document.getElementById('restoreFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const statusEl = document.getElementById('restoreStatus');
    statusEl.style.display = 'block';
    statusEl.style.color = '#6b7280';
    statusEl.textContent = '⏳ A ler ficheiro...';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const toRestore = data.appointments || (Array.isArray(data) ? data : []);
      if (!toRestore.length) {
        statusEl.style.color = '#dc2626';
        statusEl.textContent = '❌ Ficheiro vazio ou inválido.';
        return;
      }
      statusEl.textContent = `⏳ A restaurar ${toRestore.length} agendamentos...`;
      const existing = new Set((window.appointments||[]).map(a => (a.plate||'').replace(/[^A-Z0-9]/gi,'').toUpperCase()));
      let created = 0, skipped = 0, errors = 0;
      for (const appt of toRestore) {
        const n = (appt.plate||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
        if (existing.has(n)) { skipped++; continue; }
        try {
          const { id, ...payload } = appt;
          await window.apiClient.createAppointment(payload);
          existing.add(n); created++;
        } catch(err) {
          if (err.message?.includes('já existe')) skipped++;
          else errors++;
        }
      }
      statusEl.style.color = '#16a34a';
      statusEl.textContent = `✅ ${created} restaurados, ${skipped} ignorados${errors ? `, ${errors} erros` : ''}.`;
      if (created > 0 && typeof renderAll === 'function') {
        if (typeof load === 'function') await load();
        renderAll();
      }
    } catch(err) {
      statusEl.style.color = '#dc2626';
      statusEl.textContent = '❌ Erro: ' + err.message;
    }
    e.target.value = '';
  });

  // Event listener para caixa de procura
  const searchInput = document.getElementById('searchPlate');
  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      formatPlateInput(e.target);
      filterServicesByPlate(e.target.value);
    });
    
    searchInput.addEventListener('keydown', function(e) {
      // Permitir apenas letras, números e teclas de controle
      const allowedKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!allowedKeys.includes(e.key) && !/^[A-Za-z0-9]$/.test(e.key)) {
        e.preventDefault();
      }
    });
  }
  
  // Vista em tabela é agora a única vista disponível
});
