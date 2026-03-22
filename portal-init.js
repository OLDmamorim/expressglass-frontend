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
  if (!user.portal) {
    alert('Erro: Utilizador sem portal atribuído. Contacte o administrador.');
    authClient.logout();
    window.location.href = '/login.html';
    return;
  }

  // Carregar configurações do portal
  const portalConfig = user.portal;
  
  console.log('✅ Portal carregado:', portalConfig.name);
  console.log('📍 Morada de partida:', portalConfig.departureAddress);
  console.log('📍 Localidades:', portalConfig.localities);

  // Atualizar título da página
  document.title = `${portalConfig.name} - Expressglass`;
  
  // Atualizar header
  const headerTitle = document.querySelector('.page-header h1');
  if (headerTitle) {
    headerTitle.textContent = `AGENDAMENTO ${portalConfig.name.toUpperCase()}`;
  }

  // Adicionar botão de logout no header
  addLogoutButton();

  // Guardar configurações globalmente para uso no script principal
  window.portalConfig = {
    id: portalConfig.id,
    name: portalConfig.name,
    departureAddress: portalConfig.departureAddress,
    localities: portalConfig.localities || {},
    portalType: portalConfig.portalType || 'sm'
  };

  // Atualizar base de partida para cálculo de rotas (só SM)
  if (window.BASES_PARTIDA && portalConfig.portalType !== 'loja') {
    window.basePartidaDoDia = portalConfig.departureAddress;
  }

  // Atualizar dropdown de localidades no formulário (só SM)
  if (portalConfig.portalType !== 'loja') {
    updateLocalitiesDropdown();
  }

  // Esconder elementos não aplicáveis a Loja
  if (portalConfig.portalType === 'loja') {
    // Esconder campo de localidade no formulário
    const locGroup = document.querySelector('#appointmentLocality')?.closest('.form-group') 
                  || document.querySelector('#localityAutocomplete')?.closest('.form-group');
    if (locGroup) locGroup.style.display = 'none';
    
    // Esconder campo de morada e km
    const addressField = document.querySelector('#appointmentAddress')?.closest('.form-group');
    if (addressField) addressField.style.display = 'none';
    const kmField = document.querySelector('#appointmentKm')?.closest('.form-group');
    if (kmField) kmField.style.display = 'none';
    
    // Esconder botão de calcular rotas
    const routeBtn = document.querySelector('[onclick*="openSelectDayModal"]') || document.querySelector('[onclick*="calculateOptimalRoutes"]');
    if (routeBtn) routeBtn.style.display = 'none';

    // Adicionar campo de período ao formulário se não existir
    const dateField = document.querySelector('#appointmentDate')?.closest('.form-group');
    if (dateField && !document.getElementById('appointmentPeriod')) {
      const periodGroup = document.createElement('div');
      periodGroup.className = 'form-group';
      periodGroup.innerHTML = `
        <label for="appointmentPeriod">Período</label>
        <select id="appointmentPeriod">
          <option value="Manhã">Manhã</option>
          <option value="Tarde">Tarde</option>
        </select>
      `;
      dateField.parentNode.insertBefore(periodGroup, dateField.nextSibling);
    }
  }

  console.log('✅ Portal inicializado com sucesso (' + (portalConfig.portalType || 'sm') + ')');
})();

// Adicionar botão de logout
function addLogoutButton() {
  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;

  const logoutBtn = document.createElement('button');
  logoutBtn.id = 'logoutBtn';
  logoutBtn.className = 'header-btn';
  logoutBtn.title = 'Sair';
  logoutBtn.textContent = '🚪';
  logoutBtn.addEventListener('click', () => {
    if (confirm('Tem a certeza que deseja sair?')) {
      authClient.logout();
      window.location.href = '/login.html';
    }
  });

  headerActions.appendChild(logoutBtn);
}

// Atualizar dropdown de localidades
function updateLocalitiesDropdown() {
  const localitySelect = document.getElementById('appointmentLocality');
  if (!localitySelect || !window.portalConfig) return;

  const localities = window.portalConfig.localities;
  const localityNames = Object.keys(localities).sort();

  localitySelect.innerHTML = '<option value="">Selecione a localidade</option>' +
    localityNames.map(name => `<option value="${name}">${name}</option>`).join('');

  console.log('✅ Dropdown de localidades atualizado:', localityNames.length, 'localidades');
}

// Obter cor da localidade
window.getLocalityColor = function(localityName) {
  if (!window.portalConfig || !window.portalConfig.localities) {
    return '#9CA3AF'; // Cor padrão
  }
  return window.portalConfig.localities[localityName] || '#9CA3AF';
};
