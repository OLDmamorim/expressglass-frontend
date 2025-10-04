// admin-script.js
// Script principal do painel administrativo

// ===== VERIFICAR AUTENTICAÇÃO =====
(async () => {
  if (!authClient.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  const result = await authClient.verifyAuth();
  
  if (!result.success || !authClient.isAdmin()) {
    alert('Acesso negado: apenas administradores');
    authClient.logout();
    window.location.href = '/login.html';
    return;
  }

  // Mostrar nome do utilizador
  document.getElementById('userInfo').textContent = authClient.getUser().username;

  // Carregar dados iniciais
  loadPortals();
  loadUsers();
})();

// ===== LOGOUT =====
document.getElementById('logoutBtn').addEventListener('click', () => {
  authClient.logout();
  window.location.href = '/login.html';
});

// ===== NAVEGAÇÃO ENTRE TABS =====
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');

navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;
    
    // Remover active de todos
    navTabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    // Adicionar active ao selecionado
    tab.classList.add('active');
    document.getElementById(`${targetTab}Tab`).classList.add('active');
  });
});

// ===== GESTÃO DE PORTAIS =====
let portals = [];
let editingPortalId = null;

async function loadPortals() {
  try {
    const response = await authClient.authenticatedFetch('/.netlify/functions/portals');
    const data = await response.json();
    
    if (data.success) {
      portals = data.data;
      renderPortals();
      updatePortalSelect(); // Atualizar dropdown de portais no formulário de utilizadores
    } else {
      showToast('Erro ao carregar portais', 'error');
    }
  } catch (error) {
    console.error('Erro ao carregar portais:', error);
    showToast('Erro ao carregar portais', 'error');
  }
}

function renderPortals() {
  const tbody = document.getElementById('portalsTableBody');
  
  if (portals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading">Nenhum portal criado</td></tr>';
    return;
  }
  
  tbody.innerHTML = portals.map(portal => `
    <tr>
      <td><strong>${portal.name}</strong></td>
      <td>${portal.departure_address}</td>
      <td>${portal.user_count || 0}</td>
      <td class="table-actions">
        <button class="btn-edit" onclick="editPortal(${portal.id})">Editar</button>
        <button class="btn-danger" onclick="deletePortal(${portal.id})">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('addPortalBtn').addEventListener('click', () => {
  editingPortalId = null;
  document.getElementById('portalModalTitle').textContent = 'Novo Portal';
  document.getElementById('portalForm').reset();
  document.getElementById('portalLocalities').value = JSON.stringify({
    "Localidade 1": "#3b82f6",
    "Localidade 2": "#10b981"
  }, null, 2);
  openModal('portalModal');
});

function editPortal(id) {
  const portal = portals.find(p => p.id === id);
  if (!portal) return;
  
  editingPortalId = id;
  document.getElementById('portalModalTitle').textContent = 'Editar Portal';
  document.getElementById('portalName').value = portal.name;
  document.getElementById('portalAddress').value = portal.departure_address;
  document.getElementById('portalLocalities').value = JSON.stringify(portal.localities, null, 2);
  
  openModal('portalModal');
}

async function deletePortal(id) {
  const portal = portals.find(p => p.id === id);
  if (!portal) return;
  
  if (!confirm(`Tem a certeza que deseja eliminar o portal "${portal.name}"?`)) {
    return;
  }
  
  try {
    const response = await authClient.authenticatedFetch(`/.netlify/functions/portals/${id}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Portal eliminado com sucesso', 'success');
      loadPortals();
    } else {
      showToast(data.error || 'Erro ao eliminar portal', 'error');
    }
  } catch (error) {
    console.error('Erro ao eliminar portal:', error);
    showToast('Erro ao eliminar portal', 'error');
  }
}

document.getElementById('portalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const name = document.getElementById('portalName').value.trim();
  const address = document.getElementById('portalAddress').value.trim();
  const localitiesText = document.getElementById('portalLocalities').value.trim();
  
  // Validar JSON
  let localities = {};
  if (localitiesText) {
    try {
      localities = JSON.parse(localitiesText);
    } catch (error) {
      showToast('Formato JSON inválido nas localidades', 'error');
      return;
    }
  }
  
  const portalData = { name, departure_address: address, localities };
  
  try {
    const url = editingPortalId 
      ? `/.netlify/functions/portals/${editingPortalId}`
      : '/.netlify/functions/portals';
    
    const method = editingPortalId ? 'PUT' : 'POST';
    
    const response = await authClient.authenticatedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(portalData)
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(editingPortalId ? 'Portal atualizado' : 'Portal criado', 'success');
      closeModal('portalModal');
      loadPortals();
    } else {
      showToast(data.error || 'Erro ao guardar portal', 'error');
    }
  } catch (error) {
    console.error('Erro ao guardar portal:', error);
    showToast('Erro ao guardar portal', 'error');
  }
});

// ===== GESTÃO DE UTILIZADORES =====
let users = [];
let editingUserId = null;

async function loadUsers() {
  try {
    const response = await authClient.authenticatedFetch('/.netlify/functions/users');
    const data = await response.json();
    
    if (data.success) {
      users = data.data;
      renderUsers();
    } else {
      showToast('Erro ao carregar utilizadores', 'error');
    }
  } catch (error) {
    console.error('Erro ao carregar utilizadores:', error);
    showToast('Erro ao carregar utilizadores', 'error');
  }
}

function renderUsers() {
  const tbody = document.getElementById('usersTableBody');
  
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading">Nenhum utilizador criado</td></tr>';
    return;
  }
  
  tbody.innerHTML = users.map(user => `
    <tr>
      <td><strong>${user.username}</strong></td>
      <td>${user.portalName || '-'}</td>
      <td><span class="badge ${user.role}">${user.role === 'admin' ? 'Admin' : 'Utilizador'}</span></td>
      <td class="table-actions">
        <button class="btn-edit" onclick="editUser(${user.id})">Editar</button>
        <button class="btn-danger" onclick="deleteUser(${user.id})">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

function updatePortalSelect() {
  const select = document.getElementById('userPortal');
  select.innerHTML = '<option value="">Selecione um portal</option>' +
    portals.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

document.getElementById('addUserBtn').addEventListener('click', () => {
  editingUserId = null;
  document.getElementById('userModalTitle').textContent = 'Novo Utilizador';
  document.getElementById('userForm').reset();
  document.getElementById('passwordHint').style.display = 'none';
  document.getElementById('userPassword').required = true;
  document.getElementById('userPassword').placeholder = 'Mínimo 6 caracteres';
  togglePortalSelect();
  openModal('userModal');
});

function editUser(id) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  
  editingUserId = id;
  document.getElementById('userModalTitle').textContent = 'Editar Utilizador';
  document.getElementById('userUsername').value = user.username;
  document.getElementById('userPassword').value = '';
  document.getElementById('userPassword').required = false;
  document.getElementById('userPassword').placeholder = 'Deixe em branco para manter';
  document.getElementById('passwordHint').style.display = 'block';
  document.getElementById('userRole').value = user.role;
  document.getElementById('userPortal').value = user.portalId || '';
  
  togglePortalSelect();
  openModal('userModal');
}

async function deleteUser(id) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  
  if (!confirm(`Tem a certeza que deseja eliminar o utilizador "${user.username}"?`)) {
    return;
  }
  
  try {
    const response = await authClient.authenticatedFetch(`/.netlify/functions/users/${id}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Utilizador eliminado com sucesso', 'success');
      loadUsers();
    } else {
      showToast(data.error || 'Erro ao eliminar utilizador', 'error');
    }
  } catch (error) {
    console.error('Erro ao eliminar utilizador:', error);
    showToast('Erro ao eliminar utilizador', 'error');
  }
}

// Mostrar/esconder campo de portal baseado no role
document.getElementById('userRole').addEventListener('change', togglePortalSelect);

function togglePortalSelect() {
  const role = document.getElementById('userRole').value;
  const portalGroup = document.getElementById('portalSelectGroup');
  const portalSelect = document.getElementById('userPortal');
  
  if (role === 'admin') {
    portalGroup.style.display = 'none';
    portalSelect.required = false;
  } else {
    portalGroup.style.display = 'block';
    portalSelect.required = true;
  }
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('userUsername').value.trim();
  const password = document.getElementById('userPassword').value;
  const role = document.getElementById('userRole').value;
  const portalId = document.getElementById('userPortal').value;
  
  // Validar password (apenas se estiver preenchida)
  if (password && password.length < 6) {
    showToast('Password deve ter no mínimo 6 caracteres', 'error');
    return;
  }
  
  const userData = { username, role };
  
  if (password) {
    userData.password = password;
  }
  
  if (role !== 'admin' && portalId) {
    userData.portal_id = parseInt(portalId);
  }
  
  try {
    const url = editingUserId 
      ? `/.netlify/functions/users/${editingUserId}`
      : '/.netlify/functions/users';
    
    const method = editingUserId ? 'PUT' : 'POST';
    
    const response = await authClient.authenticatedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(editingUserId ? 'Utilizador atualizado' : 'Utilizador criado', 'success');
      closeModal('userModal');
      loadUsers();
    } else {
      showToast(data.error || 'Erro ao guardar utilizador', 'error');
    }
  } catch (error) {
    console.error('Erro ao guardar utilizador:', error);
    showToast('Erro ao guardar utilizador', 'error');
  }
});

// ===== MODAL =====
function openModal(modalId) {
  document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}

// Fechar modal ao clicar no X ou fora do conteúdo
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', function() {
    this.closest('.modal').classList.remove('show');
  });
});

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', function(e) {
    if (e.target === this) {
      this.classList.remove('show');
    }
  });
});

// ===== TOAST =====
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}
