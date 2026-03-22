// portal-init.js
// Script de inicialização do portal - verificar autenticação e carregar configurações

(async () => {
  // Verificar se está autenticado
  if (!authClient.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  // Verificar validade do token
  const result = await authClient.verifyAuth();
  
  if (!result.success) {
    alert('Sessão expirada. Por favor, faça login novamente.');
    authClient.logout();
    window.location.href = '/login.html';
    return;
  }

  const user = authClient.getUser();

  // Se for admin, redirecionar para painel administrativo
  if (user.role === 'admin') {
    window.location.href = '/admin.html';
    return;
  }

  // Verificar se tem portal atribuído
  if (!user.portal && (!user.portals || user.portals.length === 0)) {
    alert('Erro: Utilizador sem portal atribuído. Contacte o administrador.');
    authClient.logout();
    window.location.href = '/login.html';
    return;
  }

  // === COORDENADOR: guardar lista de portais e montar switcher ===
  if (user.role === 'coordenador' && user.portals && user.portals.length > 0) {
    window.coordPortals = user.portals;
    
    // Usar portal guardado na sessão ou o primeiro da lista
    const savedPortalId = sessionStorage.getItem('eg_active_portal');
    const activePortal = savedPortalId 
      ? user.portals.find(p => String(p.id) === savedPortalId) || user.portals[0]
      : user.portals[0];
    
    window.activePortalId = activePortal.id;
    applyPortalConfig(activePortal);
    buildPortalSwitcher(user.portals, activePortal.id);
  } else {
    // Técnico: portal único
    applyPortalConfig(user.portal);
  }

  // Adicionar botão de logout no header
  addLogoutButton();

  console.log('✅ Portal inicializado com sucesso (' + (window.portalConfig?.portalType || 'sm') + ')');
})();

// === APLICAR CONFIGURAÇÃO DO PORTAL ===
function applyPortalConfig(portalConfig) {
  // Atualizar título da página
  document.title = portalConfig.name + ' - Expressglass';
  
  // Atualizar header
  const headerTitle = document.querySelector('.page-header h1');
  if (headerTitle) {
    headerTitle.textContent = 'AGENDAMENTO ' + portalConfig.name.toUpperCase();
  }

  // Guardar configurações globalmente
  window.portalConfig = {
    id: portalConfig.id,
    name: portalConfig.name,
    departureAddress: portalConfig.departureAddress,
    localities: portalConfig.localities || {},
    portalType: portalConfig.portalType || 'sm'
  };

  // Atualizar base de partida (só SM)
  if (window.BASES_PARTIDA && portalConfig.portalType !== 'loja') {
    window.basePartidaDoDia = portalConfig.departureAddress;
  }

  // Atualizar dropdown de localidades (só SM)
  if (portalConfig.portalType !== 'loja') {
    updateLocalitiesDropdown();
  }

  // Adaptar UI para Loja
  applyLojaMode(portalConfig.portalType === 'loja');
}

// === ADAPTAR UI PARA LOJA ===
function applyLojaMode(isLoja) {
  // Localidade
  const locGroup = document.querySelector('#appointmentLocality')?.closest('.form-group') 
                || document.querySelector('#localityAutocomplete')?.closest('.form-group');
  if (locGroup) locGroup.style.display = isLoja ? 'none' : '';

  // Morada e KM
  const addressField = document.querySelector('#appointmentAddress')?.closest('.form-group');
  if (addressField) addressField.style.display = isLoja ? 'none' : '';
  const kmField = document.querySelector('#appointmentKm')?.closest('.form-group');
  if (kmField) kmField.style.display = isLoja ? 'none' : '';

  // Botão de calcular rotas
  const routeBtn = document.querySelector('[onclick*="openSelectDayModal"]') || document.querySelector('[onclick*="calculateOptimalRoutes"]');
  if (routeBtn) routeBtn.style.display = isLoja ? 'none' : '';

  // Campo de período (só Loja)
  const existingPeriod = document.getElementById('appointmentPeriod');
  const dateField = document.querySelector('#appointmentDate')?.closest('.form-group');
  
  if (isLoja && dateField && !existingPeriod) {
    const periodGroup = document.createElement('div');
    periodGroup.className = 'form-group';
    periodGroup.id = 'periodGroup';
    periodGroup.innerHTML = '<label for="appointmentPeriod">Período</label>' +
      '<select id="appointmentPeriod"><option value="Manhã">Manhã</option><option value="Tarde">Tarde</option></select>';
    dateField.parentNode.insertBefore(periodGroup, dateField.nextSibling);
  } else if (!isLoja) {
    const pg = document.getElementById('periodGroup');
    if (pg) pg.remove();
  }
}

// === SWITCHER DE PORTAIS (COORDENADOR) ===
function buildPortalSwitcher(portals, activeId) {
  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;

  // Remover switcher antigo se existir
  const old = document.getElementById('portalSwitcher');
  if (old) old.remove();

  const wrapper = document.createElement('div');
  wrapper.id = 'portalSwitcher';
  wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;margin-right:12px;';

  const label = document.createElement('span');
  label.textContent = 'Agenda:';
  label.style.cssText = 'color:rgba(255,255,255,0.8);font-size:13px;';

  const select = document.createElement('select');
  select.id = 'portalSwitcherSelect';
  select.style.cssText = 'padding:6px 12px;border-radius:8px;border:2px solid rgba(255,255,255,0.3);' +
    'background:rgba(255,255,255,0.15);color:white;font-size:14px;font-weight:600;cursor:pointer;' +
    'min-width:160px;outline:none;';

  portals.forEach(function(p) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name + (p.portalType === 'loja' ? ' (Loja)' : ' (SM)');
    opt.style.cssText = 'color:#1f2937;background:white;';
    if (p.id === activeId) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener('change', function() {
    var newId = parseInt(this.value);
    switchPortal(newId);
  });

  wrapper.appendChild(label);
  wrapper.appendChild(select);
  headerActions.insertBefore(wrapper, headerActions.firstChild);
}

// === TROCAR PORTAL (COORDENADOR) ===
async function switchPortal(newPortalId) {
  var portal = window.coordPortals.find(function(p) { return p.id === newPortalId; });
  if (!portal) return;

  // Guardar selecção na sessão
  sessionStorage.setItem('eg_active_portal', String(newPortalId));
  window.activePortalId = newPortalId;

  // Aplicar nova configuração
  applyPortalConfig(portal);

  // Recarregar agendamentos do novo portal
  try {
    if (typeof window.reloadAppointments === 'function') {
      await window.reloadAppointments();
    }
    console.log('🔄 Portal alterado para: ' + portal.name);
  } catch (err) {
    console.error('Erro ao carregar agendamentos:', err);
    alert('Erro ao carregar agendamentos do portal ' + portal.name);
  }
}

// Adicionar botão de logout
function addLogoutButton() {
  var headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;

  var logoutBtn = document.createElement('button');
  logoutBtn.id = 'logoutBtn';
  logoutBtn.className = 'header-btn';
  logoutBtn.title = 'Sair';
  logoutBtn.textContent = '🚪';
  logoutBtn.addEventListener('click', function() {
    if (confirm('Tem a certeza que deseja sair?')) {
      sessionStorage.removeItem('eg_active_portal');
      authClient.logout();
      window.location.href = '/login.html';
    }
  });

  headerActions.appendChild(logoutBtn);
}

// Atualizar dropdown de localidades
function updateLocalitiesDropdown() {
  var localitySelect = document.getElementById('appointmentLocality');
  if (!localitySelect || !window.portalConfig) return;

  var localities = window.portalConfig.localities;
  var localityNames = Object.keys(localities).sort();

  localitySelect.innerHTML = '<option value="">Selecione a localidade</option>' +
    localityNames.map(function(name) { return '<option value="' + name + '">' + name + '</option>'; }).join('');

  console.log('✅ Dropdown de localidades atualizado:', localityNames.length, 'localidades');
}

// Obter cor da localidade
window.getLocalityColor = function(localityName) {
  if (!window.portalConfig || !window.portalConfig.localities) {
    return '#9CA3AF';
  }
  return window.portalConfig.localities[localityName] || '#9CA3AF';
};
