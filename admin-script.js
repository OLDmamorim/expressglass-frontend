// admin-script.js
// Script principal do painel administrativo

// ===== VERIFICAR AUTENTICAÇÃO =====
(async () => {
  if (!authClient.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  const result = await authClient.verifyAuth();
  const user = authClient.getUser();
  
  if (!result.success || (user.role !== 'admin' && user.role !== 'coordenador')) {
    alert('Acesso negado');
    authClient.logout();
    window.location.href = '/login.html';
    return;
  }

  // Mostrar nome do utilizador
  document.getElementById('userInfo').textContent = user.username;

  // Coordenador: esconder tabs que não se aplicam
  if (user.role === 'coordenador') {
    ['portals','users','import'].forEach(tab => {
      const btn = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
      const content = document.getElementById(`${tab}Tab`);
      if (btn) btn.style.display = 'none';
      if (content) content.style.display = 'none';
    });
    // Activar tab relatórios diretamente
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const rTab = document.querySelector('.nav-tab[data-tab="reports"]');
    const rContent = document.getElementById('reportsTab');
    if (rTab) rTab.classList.add('active');
    if (rContent) rContent.classList.add('active');
  }

  // Admin: carregar dados iniciais
  if (user.role === 'admin') {
    loadPortals();
    loadUsers();
  } else {
    // Coordenador: carregar só portais para o select de relatórios
    loadPortalsForReports();
  }
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

// ===== CARREGAR PORTAIS PARA RELATÓRIOS (coordenador) =====
async function loadPortalsForReports() {
  const user = authClient.getUser();
  const portalIds = user.portalIds || [];
  if (!portalIds.length) return;
  try {
    const resp = await authClient.authenticatedFetch('/.netlify/functions/portals');
    const data = await resp.json();
    if (data.success) {
      portals = data.data.filter(p => portalIds.includes(p.id));
      window._adminPortals = portals;
      populateReportPortalSelect(portals);
    }
  } catch(e) { console.error('Erro ao carregar portais:', e); }
}

function populateReportPortalSelect(portalList) {
  const sel = document.getElementById('reportPortal');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecionar portal</option>' +
    portalList.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

// ===== GESTÃO DE PORTAIS =====
let portals = [];
let editingPortalId = null;

async function loadPortals() {
  try {
    const response = await authClient.authenticatedFetch('/.netlify/functions/portals');
    const data = await response.json();
    
    if (data.success) {
      portals = data.data;
      window._adminPortals = portals; // para relatórios
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
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Nenhum portal criado</td></tr>';
    return;
  }

  const sorted = [...portals].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt'));
  
  tbody.innerHTML = sorted.map(portal => {
    const lastImport = portal.last_import_at 
      ? new Date(portal.last_import_at).toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '<span style="color:#9ca3af">—</span>';
    const typeLabel = portal.portal_type === 'loja' 
      ? '<span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:4px;font-size:12px;">Loja</span>'
      : portal.portal_type === 'pesados'
      ? '<span style="background:#fff7ed;color:#c2410c;padding:2px 8px;border-radius:4px;font-size:12px;">Pesados</span>'
      : '<span style="background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:4px;font-size:12px;">SM</span>';
    return `
    <tr>
      <td><strong>${portal.name}</strong> ${typeLabel}</td>
      <td>${portal.departure_address}</td>
      <td>${portal.nmdos_code || '<span style="color:#9ca3af">—</span>'}</td>
      <td>${portal.service_count || 0}</td>
      <td>${lastImport}</td>
      <td class="table-actions">
        <button class="btn-edit" onclick="editPortal(${portal.id})">Editar</button>
        <button class="btn-danger" onclick="deletePortal(${portal.id})">Eliminar</button>
      </td>
    </tr>
  `}).join('');
}

// Paleta de cores para localidades
const colorPalette = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#6366f1', '#a855f7', '#f43f5e', '#22c55e', '#eab308'
];
let colorIndex = 0;

// ===== CÓDIGOS NMDOS (extraídos do Excel) =====
const NMDOS_CODES = [
  "Ficha S.Movel 1-Porto","Ficha S.Movel 2-Braga","Ficha S.Movel 3-Camarate",
  "Ficha S.Movel 5-Setubal","Ficha S.Movel 6-Coimbra","Ficha S.Movel 7-Leiria",
  "Ficha S.Movel-Rep.Coimbr","Ficha S.Movel-Rep.Leiria","Ficha S.Movel-Rep.Lisboa",
  "Ficha S.Movel-Rep.Minho","Ficha S.Movel-Rep.Porto",
  "Ficha Servico 01","Ficha Servico 02","Ficha Servico 03","Ficha Servico 04",
  "Ficha Servico 05","Ficha Servico 06","Ficha Servico 07","Ficha Servico 08",
  "Ficha Servico 09","Ficha Servico 10","Ficha Servico 11","Ficha Servico 12",
  "Ficha Servico 13","Ficha Servico 14","Ficha Servico 15","Ficha Servico 16",
  "Ficha Servico 17","Ficha Servico 18","Ficha Servico 19","Ficha Servico 20",
  "Ficha Servico 21","Ficha Servico 22","Ficha Servico 23","Ficha Servico 24",
  "Ficha Servico 25","Ficha Servico 26","Ficha Servico 27","Ficha Servico 28",
  "Ficha Servico 29","Ficha Servico 30","Ficha Servico 31","Ficha Servico 32",
  "Ficha Servico 34","Ficha Servico 35","Ficha Servico 36","Ficha Servico 37",
  "Ficha Servico 38","Ficha Servico 39","Ficha Servico 40","Ficha Servico 43",
  "Ficha Servico 44","Ficha Servico 45","Ficha Servico 46","Ficha Servico 48",
  "Ficha Servico 49","Ficha Servico 50","Ficha Servico 54","Ficha Servico 60",
  "Ficha Servico 61","Ficha Servico 62","Ficha Servico 63","Ficha Servico 64",
  "Ficha Servico 65","Ficha Servico 66","Ficha Servico 67","Ficha Servico 68",
  "Ficha Servico 69","Ficha Servico 71","Ficha Servico 72","Ficha Servico 73",
  "Ficha Servico 76","Ficha Servico 77","Ficha Servico 84","Ficha Servico 85",
  "Ficha Servico 86","Ficha Servico 91","Ficha Servico 92","Ficha Servico 94",
  "Ficha Servico 95","Ficha Servico 96","Ficha Servico 97"
];

function populateNmdosSelect() {
  const select = document.getElementById('portalNmdos');
  if (!select) return;
  // Manter a primeira opção (vazia)
  select.innerHTML = '<option value="">-- Sem código atribuído --</option>';
  // Obter códigos já usados por outros portais
  const usedCodes = new Set(portals.filter(p => p.nmdos_code && p.id !== editingPortalId).map(p => p.nmdos_code));
  NMDOS_CODES.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    if (usedCodes.has(code)) {
      opt.disabled = true;
      opt.textContent += ' (já atribuído)';
    }
    select.appendChild(opt);
  });
}

// Mostrar/esconder campos baseado no tipo de portal
function togglePortalTypeFields() {
  const type = document.getElementById('portalType').value;
  const localitiesSection = document.getElementById('localitiesSection');
  if (localitiesSection) {
    localitiesSection.style.display = type === 'loja' ? 'none' : 'block';
  }
}

// Gestão de localidades - REMOVIDO (308 concelhos automáticos no frontend)
let localitiesData = [];

document.getElementById('addPortalBtn').addEventListener('click', () => {
  editingPortalId = null;
  document.getElementById('portalModalTitle').textContent = 'Novo Portal';
  document.getElementById('portalForm').reset();
  document.getElementById('portalType').value = 'sm';
  
  populateNmdosSelect();
  togglePortalTypeFields();
  
  openModal('portalModal');
});

function editPortal(id) {
  const portal = portals.find(p => p.id === id);
  if (!portal) return;
  
  editingPortalId = id;
  document.getElementById('portalModalTitle').textContent = 'Editar Portal';
  document.getElementById('portalName').value = portal.name;
  document.getElementById('portalAddress').value = portal.departure_address;
  document.getElementById('portalType').value = portal.portal_type || 'sm';
  
  populateNmdosSelect();
  document.getElementById('portalNmdos').value = portal.nmdos_code || '';
  togglePortalTypeFields();
  
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
  const portalType = document.getElementById('portalType').value;
  
  const portalData = { 
    name, 
    departure_address: address, 
    localities: {},
    nmdos_code: document.getElementById('portalNmdos').value || null,
    portal_type: portalType
  };
  
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
  // Carregar pedidos de inscrição pendentes
  loadRegistrationRequests();
}

async function loadRegistrationRequests() {
  try {
    const resp = await authClient.authenticatedFetch('/.netlify/functions/registration-request');
    const data = await resp.json();
    if (!data.success) return;
    renderRegistrationRequests(data.requests || []);
  } catch(e) {
    console.warn('Pedidos de inscrição não disponíveis:', e.message);
  }
}

function renderRegistrationRequests(requests) {
  // Atualizar badge na tab
  const badge = document.getElementById('requestsBadge');
  if (badge) {
    badge.textContent = requests.length;
    badge.style.display = requests.length > 0 ? 'inline-flex' : 'none';
  }

  const section = document.getElementById('registrationRequestsSection');
  if (!section) return;

  if (requests.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  section.innerHTML = `
    <div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:15px;font-weight:800;color:#92400e;margin-bottom:12px;">
        ✍️ Pedidos de acesso pendentes (${requests.length})
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${requests.map(r => {
          const dt = new Date(r.created_at).toLocaleString('pt-PT', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
          const roleLabel = {coordenador:'Coordenador',user:'Técnico',comercial:'Comercial'}[r.role] || r.role;
          return `<div style="background:#fff;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;">
              <div style="font-weight:700;color:#1e293b;font-size:14px;">${r.name}</div>
              <div style="font-size:12px;color:#6b7280;">${r.email}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">
                <span style="background:#eff6ff;color:#2563eb;padding:1px 7px;border-radius:10px;font-weight:600;">${roleLabel}</span>
                ${r.portal_name ? ` · ${r.portal_name}` : ''}
                <span style="color:#9ca3af;margin-left:6px;">${dt}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <button onclick="approveRequest(${r.id},'${r.name}','${r.email}','${r.role}','${r.portal_name||''}')"
                style="background:#16a34a;color:#fff;border:none;padding:7px 14px;border-radius:7px;font-weight:700;font-size:13px;cursor:pointer;">
                ✓ Criar conta
              </button>
              <button onclick="rejectRequest(${r.id})"
                style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;padding:7px 12px;border-radius:7px;font-weight:600;font-size:13px;cursor:pointer;">
                ✕
              </button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

async function approveRequest(id, name, email, role, portalName) {
  // Gerar password automática
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let autoPass = '';
  for (let i = 0; i < 8; i++) autoPass += chars[Math.floor(Math.random() * chars.length)];

  // Guardar no form via data-attributes (mais fiável que variável global)
  const form = document.getElementById('userForm');
  form.dataset.pendingRequestId = id;
  form.dataset.pendingEmail = email;
  form.dataset.pendingName = name;
  form.dataset.pendingPassword = autoPass;

  // Abrir modal de criar utilizador pré-preenchido
  editingUserId = null;
  document.getElementById('userModalTitle').textContent = 'Criar Conta — ' + name;
  document.getElementById('userForm').reset();
  document.getElementById('passwordHint').style.display = 'none';
  document.getElementById('userPassword').required = true;
  document.getElementById('userPassword').placeholder = 'Definir password';

  // Pré-preencher
  document.getElementById('userUsername').value = name.split(' ')[0].toLowerCase();
  if (autoPass) {
    document.getElementById('userPassword').value = autoPass;
  }
  document.getElementById('userRole').value = role;
  togglePortalSelect();

  // Seleccionar portal se existir
  if (portalName) {
    const portalOpt = Array.from(document.getElementById('userPortal').options)
      .find(o => o.textContent.trim().toLowerCase().includes(portalName.toLowerCase()));
    if (portalOpt) document.getElementById('userPortal').value = portalOpt.value;
  }

  // Mostrar email como hint
  const hint = document.getElementById('passwordHint');
  if (hint) { hint.style.display = 'block'; hint.textContent = 'Email do utilizador: ' + email; }

  openModal('userModal');
  // Recarregar pedidos após fechar modal
  document.getElementById('userModal').addEventListener('click', function refreshOnClose(e) {
    if (e.target.id === 'userModal') { loadRegistrationRequests(); this.removeEventListener('click', refreshOnClose); }
  });
}

async function rejectRequest(id) {
  if (!confirm('Rejeitar este pedido de acesso?')) return;
  await authClient.authenticatedFetch('/.netlify/functions/registration-request', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status: 'rejected' })
  });
  showToast('Pedido rejeitado', 'success');
  loadRegistrationRequests();
}

function renderUsers() {
  const tbody = document.getElementById('usersTableBody');
  
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading">Nenhum utilizador criado</td></tr>';
    return;
  }

  const sorted = [...users].sort((a, b) => (a.username || '').localeCompare(b.username || '', 'pt'));
  
  tbody.innerHTML = sorted.map(user => `
    <tr>
      <td><strong>${user.username}</strong></td>
      <td><code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:13px;user-select:all;">${user.plain_password || '••••••'}</code></td>
      <td>${user.portalName || '-'}</td>
      <td><span class="badge ${user.role}">${user.role === 'admin' ? 'Admin' : user.role === 'coordenador' ? 'Coordenador' : user.role === 'comercial' ? 'Comercial' : 'Técnico'}</span></td>
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
  
  // Se coordenador, carregar portais atribuídos
  if (user.role === 'coordenador' && user.portalIds) {
    populateMultiPortalCheckboxes(user.portalIds);
  }
  // Se comercial, carregar SMs atribuídos
  if (user.role === 'comercial') {
    setTimeout(() => {
      populateComercialPortalCheckboxes(user.assigned_portal_ids || []);
    }, 50);
  }
  
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
// Alias para o onchange inline do HTML
window.onRoleChange = togglePortalSelect;

function populateComercialPortalCheckboxes(selectedIds = []) {
  const container = document.getElementById('comercialPortalCheckboxes');
  if (!container) return;
  // Normalizar IDs para inteiros para comparação correcta
  const normalizedIds = (selectedIds || []).map(id => parseInt(id)).filter(id => !isNaN(id));
  // Mostrar apenas portais do tipo SM
  const smPortals = portals.filter(p => (p.portal_type || p.portalType) === 'sm');
  container.innerHTML = smPortals.map(p => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;text-align:left;">
      <input type="checkbox" class="comercial-portal-cb" value="${p.id}" ${normalizedIds.includes(parseInt(p.id)) ? 'checked' : ''} style="width:18px;height:18px;min-width:18px;">
      <span style="flex:1;text-align:left;">${p.name}</span>
    </label>
  `).join('');
}

function populateMultiPortalCheckboxes(selectedIds = []) {
  const container = document.getElementById('multiPortalCheckboxes');
  if (!container) return;
  container.innerHTML = portals.map(p => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;text-align:left;">
      <input type="checkbox" class="coord-portal-cb" value="${p.id}" ${selectedIds.includes(p.id) ? 'checked' : ''} style="width:18px;height:18px;min-width:18px;">
      <span style="flex:1;text-align:left;">${p.name} <span style="color:#9ca3af;font-size:12px;">(${p.portal_type === 'loja' ? 'Loja' : p.portal_type === 'pesados' ? 'Pesados' : 'SM'})</span></span>
    </label>
  `).join('');
}

function togglePortalSelect() {
  const role = document.getElementById('userRole').value;
  const portalGroup = document.getElementById('portalSelectGroup');
  const multiGroup = document.getElementById('multiPortalGroup');
  const portalSelect = document.getElementById('userPortal');
  
  if (role === 'admin') {
    portalGroup.style.display = 'none';
    multiGroup.style.display = 'none';
    portalSelect.required = false;
  } else if (role === 'coordenador') {
    portalGroup.style.display = 'none';
    multiGroup.style.display = 'block';
    portalSelect.required = false;
    document.getElementById('comercialPortalGroup').style.display = 'none';
    populateMultiPortalCheckboxes();
  } else if (role === 'comercial') {
    portalGroup.style.display = 'none';
    multiGroup.style.display = 'none';
    portalSelect.required = false;
    const cg = document.getElementById('comercialPortalGroup');
    if (cg) { cg.style.display = 'block'; populateComercialPortalCheckboxes(); }
  } else {
    portalGroup.style.display = 'block';
    if (document.getElementById('comercialPortalGroup')) document.getElementById('comercialPortalGroup').style.display = 'none';
    multiGroup.style.display = 'none';
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
  
  if (role === 'user' && portalId) {
    userData.portal_id = parseInt(portalId);
  }
  
  if (role === 'coordenador') {
    // Recolher portais selecionados
    const checked = document.querySelectorAll('.coord-portal-cb:checked');
    const portalIds = Array.from(checked).map(cb => parseInt(cb.value));
    if (portalIds.length === 0) {
      showToast('Selecione pelo menos um portal para o coordenador', 'error');
      return;
    }
    userData.portal_id = portalIds[0]; // Portal principal (primeiro)
    userData.portal_ids = portalIds;   // Todos os portais
  }

  if (role === 'comercial') {
    // Ler TODOS os checkboxes (incluindo os fora do viewport por causa do scroll)
    const allCbs = Array.from(document.querySelectorAll('.comercial-portal-cb'));
    const smIds = allCbs.filter(cb => cb.checked).map(cb => parseInt(cb.value));
    console.log('[admin] comercial smIds:', smIds, 'total cbs:', allCbs.length);
    if (smIds.length === 0) {
      showToast('Selecione pelo menos um SM para o comercial', 'error');
      return;
    }
    userData.assigned_portal_ids = smIds;
  }
  
  try {
    const url = editingUserId 
      ? `/.netlify/functions/users/${editingUserId}`
      : '/.netlify/functions/users';
    
    const method = editingUserId ? 'PUT' : 'POST';
    
    console.log('[admin] PUT userData:', JSON.stringify(userData));
    const response = await authClient.authenticatedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(editingUserId ? 'Utilizador atualizado' : 'Utilizador criado', 'success');

      // Se veio de um pedido de inscrição, enviar email de boas-vindas
      const form2 = document.getElementById('userForm');
      const pendingRequestId = form2.dataset.pendingRequestId;
      if (!editingUserId && pendingRequestId) {
        const pendingEmail    = form2.dataset.pendingEmail;
        const pendingName     = form2.dataset.pendingName;
        const pendingPassword = form2.dataset.pendingPassword;
        const username        = document.getElementById('userUsername').value.trim();
        // Limpar data-attributes
        delete form2.dataset.pendingRequestId;
        delete form2.dataset.pendingEmail;
        delete form2.dataset.pendingName;
        delete form2.dataset.pendingPassword;
        try {
          await authClient.authenticatedFetch('/.netlify/functions/registration-request', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: parseInt(pendingRequestId),
              status: 'approved',
              welcome_email: { to: pendingEmail, name: pendingName, username, password: pendingPassword }
            })
          });
          showToast('📧 Email de boas-vindas enviado para ' + pendingEmail, 'success');
        } catch(e) {
          console.warn('Email boas-vindas falhou:', e);
          showToast('⚠️ Conta criada mas email não enviado', 'error');
        }
      }

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
  if (modalId === 'userModal') {
    // Limpar dados de pedido pendente
    const form = document.getElementById('userForm');
    if (form) {
      delete form.dataset.pendingRequestId;
      delete form.dataset.pendingEmail;
      delete form.dataset.pendingName;
      delete form.dataset.pendingPassword;
    }
  }
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

// ===== IMPORTAÇÃO EXCEL GLOBAL =====
let importExcelData = []; // Raw rows from Excel
let importHeaders = [];

// Excel date serial → JS Date
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + Math.floor(serial) * 86400000).toISOString();
}

// Normalizar matrícula
function normalizePlate(plate) {
  if (!plate) return '';
  let n = String(plate).replace(/\s+/g, '').toUpperCase();
  if (!n.includes('-') && n.length === 6) {
    n = n.slice(0,2) + '-' + n.slice(2,4) + '-' + n.slice(4,6);
  }
  return n;
}

// Setup upload area
(function setupImportUpload() {
  const area = document.getElementById('importUploadArea');
  const input = document.getElementById('importExcelFile');
  if (!area || !input) return;

  area.addEventListener('click', () => input.click());
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.style.borderColor = '#3b82f6'; });
  area.addEventListener('dragleave', () => { area.style.borderColor = '#d1d5db'; });
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.style.borderColor = '#d1d5db';
    if (e.dataTransfer.files.length) handleImportFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', (e) => {
    if (e.target.files.length) handleImportFile(e.target.files[0]);
  });
})();

async function handleImportFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Por favor selecione um ficheiro Excel', 'error');
    return;
  }

  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (json.length < 2) {
      showToast('Ficheiro vazio ou sem dados', 'error');
      return;
    }

    importHeaders = json[0].map(h => String(h || '').trim());
    importExcelData = json.slice(1).filter(row => row.some(c => c != null && String(c).trim() !== ''));

    // Mostrar info do ficheiro
    document.getElementById('importFileName').textContent = file.name;
    document.getElementById('importFileStats').textContent = `${importExcelData.length} linhas · ${importHeaders.length} colunas`;
    document.getElementById('importFileInfo').style.display = 'block';

    // Analisar distribuição por portal
    analyzeDistribution();

  } catch (err) {
    console.error('Erro ao ler Excel:', err);
    showToast('Erro ao ler ficheiro: ' + err.message, 'error');
  }
}

function analyzeDistribution() {
  // Col B (index 1) = nmdos
  const nmdosCol = importHeaders.findIndex(h => h.toLowerCase() === 'nmdos');
  if (nmdosCol < 0) {
    showToast('Coluna "nmdos" não encontrada no Excel', 'error');
    return;
  }

  // Contar serviços por nmdos
  const countByNmdos = {};
  importExcelData.forEach(row => {
    const code = String(row[nmdosCol] || '').trim();
    if (code) countByNmdos[code] = (countByNmdos[code] || 0) + 1;
  });

  // Mapear portais com código nmdos
  const tbody = document.getElementById('importSummaryBody');
  let matched = 0, unmatched = 0;
  const rows = [];

  portals.forEach(portal => {
    if (!portal.nmdos_code) return;
    const count = countByNmdos[portal.nmdos_code] || 0;
    matched += count;
    rows.push(`
      <tr>
        <td><strong>${portal.name}</strong></td>
        <td>${portal.nmdos_code}</td>
        <td>${count}</td>
      </tr>
    `);
  });

  // Total de linhas no Excel
  const totalExcel = importExcelData.length;
  unmatched = totalExcel - matched;

  // Portais sem código
  const portaisSemCodigo = portals.filter(p => !p.nmdos_code);
  portaisSemCodigo.forEach(portal => {
    rows.push(`
      <tr style="opacity:0.5">
        <td>${portal.name}</td>
        <td><em>sem código</em></td>
        <td>—</td>
      </tr>
    `);
  });

  tbody.innerHTML = rows.join('');

  // Info de não correspondidos
  const info = document.getElementById('importUnmatchedInfo');
  if (unmatched > 0) {
    info.textContent = `⚠️ ${unmatched} serviços no Excel não correspondem a nenhum portal configurado (códigos nmdos não atribuídos).`;
    info.style.display = 'block';
  } else {
    info.style.display = 'none';
  }

  document.getElementById('importPortalSummary').style.display = 'block';
}

async function startImport() {
  const nmdosCol = importHeaders.findIndex(h => h.toLowerCase() === 'nmdos');
  const plateCol = importHeaders.findIndex(h => h.toLowerCase() === 'matricula');
  const marcaCol = importHeaders.findIndex(h => h.toLowerCase() === 'marca');
  const modeloCol = importHeaders.findIndex(h => h.toLowerCase() === 'modelo');
  const refCol = importHeaders.findIndex(h => h.toLowerCase() === 'ref');
  const statusCol = importHeaders.findIndex(h => h.toLowerCase() === 'status');
  const obsCol = importHeaders.findIndex(h => h.toLowerCase() === 'obs');
  const seguradoCol = importHeaders.findIndex(h => h.toLowerCase() === 'segurado');
  const nomeCol = importHeaders.findIndex(h => h.toLowerCase() === 'nome');
  const dataObraCol = importHeaders.findIndex(h => h.toLowerCase() === 'dataobra');
  const dataServicoCol = importHeaders.findIndex(h => h.toLowerCase().replace('í','i').replace('ç','c') === 'dataservico');
  const phoneCol = importHeaders.findIndex(h => h.toLowerCase() === 'u_contsega');
  const emailCol = importHeaders.findIndex(h => h.toLowerCase() === 'email');
  const eurocodeCol = importHeaders.findIndex(h => h.toLowerCase() === 'eurocode');
  const horaInicioCol = importHeaders.findIndex(h => h.toLowerCase().replace('í','i') === 'hora_inicio');
  const horaFimCol = importHeaders.findIndex(h => h.toLowerCase() === 'hora_fim');

  // Mapear nmdos_code → {portal_id, portal_type}
  const codeToPortal = {};
  portals.forEach(p => {
    if (p.nmdos_code) codeToPortal[p.nmdos_code] = { id: p.id, type: p.portal_type || 'sm' };
  });

  // Helper: converter hora Excel (decimal ou string) em minutos desde 00:00
  function parseHoraToMinutes(val) {
    if (val == null || val === '') return null;
    // Excel time: número decimal (0.375 = 09:00, 0.583 = 14:00)
    if (typeof val === 'number' && val < 1) {
      return Math.round(val * 24 * 60);
    }
    // String "09:00" ou "14:00"
    const str = String(val).trim();
    const match = str.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      return parseInt(match[1]) * 60 + parseInt(match[2]);
    }
    return null;
  }

  // Helper: converter data Excel para YYYY-MM-DD
  function excelDateToYMD(serial) {
    if (!serial) return null;
    if (typeof serial === 'number') {
      const epoch = new Date(1899, 11, 30);
      const d = new Date(epoch.getTime() + Math.floor(serial) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    // Já é string de data
    const s = String(serial).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }

  // Preparar serviços
  const services = [];
  importExcelData.forEach(row => {
    const code = String(row[nmdosCol] || '').trim();
    const portalInfo = codeToPortal[code];
    if (!portalInfo) return;

    const plate = normalizePlate(row[plateCol]);
    if (!plate) return;

    const marca = row[marcaCol] ? String(row[marcaCol]).trim() : '';
    const modelo = row[modeloCol] ? String(row[modeloCol]).trim() : '';
    const car = [marca, modelo].filter(Boolean).join(' ') || 'Sem modelo';

    const ref = refCol >= 0 && row[refCol] ? String(row[refCol]).trim() : '';
    const status = statusCol >= 0 && row[statusCol] ? String(row[statusCol]).trim() : '';
    const obs = obsCol >= 0 && row[obsCol] ? String(row[obsCol]).trim() : '';
    const segurado = seguradoCol >= 0 && row[seguradoCol] ? String(row[seguradoCol]).trim() : '';
    const nome = nomeCol >= 0 && row[nomeCol] ? String(row[nomeCol]).trim() : '';
    const phone = phoneCol >= 0 && row[phoneCol] ? String(row[phoneCol]).trim() : '';
    const email = emailCol >= 0 && row[emailCol] ? String(row[emailCol]).trim() : '';
    const eurocode = eurocodeCol >= 0 && row[eurocodeCol] ? String(row[eurocodeCol]).trim() : '';

    // Observações: eurocode da coluna ref
    const notes = ref || eurocode || '';

    // Outros dados: só o nome do segurado
    const extra = segurado || '';

    const createdAt = dataObraCol >= 0 ? excelDateToISO(row[dataObraCol]) : null;

    // === AGENDAMENTO AUTOMÁTICO: Loja E SM, com hora entre 09:00-18:00 ===
    let scheduleDate = null;
    let schedulePeriod = null;

    const horaMin = horaInicioCol >= 0 ? parseHoraToMinutes(row[horaInicioCol]) : null;
    if (horaMin !== null && horaMin >= 540 && horaMin < 1080) {
      scheduleDate = (dataServicoCol >= 0 ? excelDateToYMD(row[dataServicoCol]) : null)
                  || (dataObraCol >= 0 ? excelDateToYMD(row[dataObraCol]) : null);
      if (scheduleDate && portalInfo.type === 'loja') {
        schedulePeriod = horaMin < 840 ? 'Manhã' : 'Tarde';
      }
      // SM: entra na agenda com data mas SEM localidade/morada → coordenador preenche depois
    }
    // Fora de horas → pendentes (sem data)

    services.push({
      portal_id: portalInfo.id,
      plate,
      car,
      service: 'PB',
      notes,
      extra,
      phone,
      status: 'NE',
      createdAt,
      date: scheduleDate || null,
      period: schedulePeriod || null,
      confirmed: false  // sempre pré-agendamento ao importar do Excel
    });
  });

  if (services.length === 0) {
    showToast('Nenhum serviço para importar (portais sem código atribuído?)', 'error');
    return;
  }

  // Mostrar progress
  document.getElementById('importProgress').style.display = 'block';
  document.getElementById('btnStartImport').disabled = true;

  // Enviar em batches de 50
  const batchSize = 50;
  let totalCreated = 0, totalUpdated = 0, totalErrors = 0;

  for (let i = 0; i < services.length; i += batchSize) {
    const batch = services.slice(i, i + batchSize);
    const pct = Math.round(((i + batch.length) / services.length) * 100);

    document.getElementById('importProgressBar').style.width = pct + '%';
    document.getElementById('importProgressText').textContent = `A importar... ${i + batch.length} / ${services.length} (${pct}%)`;

    try {
      const response = await authClient.authenticatedFetch('/.netlify/functions/import-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: batch })
      });
      const result = await response.json();
      if (result.success) {
        totalCreated += result.data.created;
        totalUpdated += result.data.updated;
        totalErrors += result.data.errors;
      }
    } catch (err) {
      console.error('Erro no batch:', err);
      totalErrors += batch.length;
    }
  }

  // Mostrar resultados
  document.getElementById('importProgressBar').style.width = '100%';
  document.getElementById('importProgressText').textContent = 'Concluído!';
  document.getElementById('btnStartImport').disabled = false;

  const resultsHtml = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;">
      <div style="text-align:center;padding:16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
        <div style="font-size:28px;font-weight:700;color:#16a34a;">${totalCreated}</div>
        <div style="font-size:13px;color:#6b7280;">Criados</div>
      </div>
      <div style="text-align:center;padding:16px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
        <div style="font-size:28px;font-weight:700;color:#2563eb;">${totalUpdated}</div>
        <div style="font-size:13px;color:#6b7280;">Atualizados</div>
      </div>
      <div style="text-align:center;padding:16px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;">
        <div style="font-size:28px;font-weight:700;color:#dc2626;">${totalErrors}</div>
        <div style="font-size:13px;color:#6b7280;">Erros</div>
      </div>
    </div>
  `;
  document.getElementById('importResultsContent').innerHTML = resultsHtml;
  document.getElementById('importResults').style.display = 'block';

  showToast(`Importação concluída: ${totalCreated} criados, ${totalUpdated} atualizados`, 'success');
}

// ===== SINCRONIZAÇÃO COMPLETA COM EXCEL (apaga o que não está no Excel) =====
async function startSync() {
  if (!confirm('🔄 SINCRONIZAR COM EXCEL\n\nO que vai acontecer:\n✅ Cria os serviços que faltam\n✅ Move para agenda os que têm hora\n🗑️ Apaga os pendentes (sem data) que não estão no Excel\n🔒 Nunca toca nos já agendados (com data)\n\nTens a certeza?')) return;

  const nmdosCol = importHeaders.findIndex(h => h.toLowerCase() === 'nmdos');
  const plateCol = importHeaders.findIndex(h => h.toLowerCase() === 'matricula');
  const marcaCol = importHeaders.findIndex(h => h.toLowerCase() === 'marca');
  const modeloCol = importHeaders.findIndex(h => h.toLowerCase() === 'modelo');
  const refCol = importHeaders.findIndex(h => h.toLowerCase() === 'ref');
  const obsCol = importHeaders.findIndex(h => h.toLowerCase() === 'obs');
  const seguradoCol = importHeaders.findIndex(h => h.toLowerCase() === 'segurado');
  const phoneCol = importHeaders.findIndex(h => h.toLowerCase() === 'u_contsega');
  const eurocodeCol = importHeaders.findIndex(h => h.toLowerCase() === 'eurocode');
  const dataObraCol = importHeaders.findIndex(h => h.toLowerCase() === 'dataobra');
  const dataServicoCol = importHeaders.findIndex(h => h.toLowerCase().replace('í','i').replace('ç','c') === 'dataservico');
  const horaInicioCol = importHeaders.findIndex(h => h.toLowerCase().replace('í','i') === 'hora_inicio');

  function parseHoraToMinutes(val) {
    if (val == null || val === '') return null;
    if (typeof val === 'number' && val < 1) return Math.round(val * 24 * 60);
    const str = String(val).trim();
    const match = str.match(/^(\d{1,2}):(\d{2})/);
    if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
    return null;
  }

  function excelDateToYMD(serial) {
    if (!serial) return null;
    if (typeof serial === 'number') {
      const epoch = new Date(1899, 11, 30);
      const d = new Date(epoch.getTime() + Math.floor(serial) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(serial).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }

  const codeToPortal = {};
  portals.forEach(p => { if (p.nmdos_code) codeToPortal[p.nmdos_code] = { id: p.id, type: p.portal_type || 'sm' }; });

  // Agrupar serviços por portal
  const byPortal = {};
  importExcelData.forEach(row => {
    const code = String(row[nmdosCol] || '').trim();
    const portalInfo = codeToPortal[code];
    if (!portalInfo) return;
    const plate = normalizePlate(row[plateCol]);
    if (!plate) return;

    const marca = row[marcaCol] ? String(row[marcaCol]).trim() : '';
    const modelo = row[modeloCol] ? String(row[modeloCol]).trim() : '';
    const car = [marca, modelo].filter(Boolean).join(' ') || 'Sem modelo';
    const ref = refCol >= 0 && row[refCol] ? String(row[refCol]).trim() : '';
    const eurocode = eurocodeCol >= 0 && row[eurocodeCol] ? String(row[eurocodeCol]).trim() : '';
    const notes = ref || eurocode || '';
    const extra = seguradoCol >= 0 && row[seguradoCol] ? String(row[seguradoCol]).trim() : '';
    const phone = phoneCol >= 0 && row[phoneCol] ? String(row[phoneCol]).trim() : '';
    const createdAt = dataObraCol >= 0 ? excelDateToISO(row[dataObraCol]) : null;

    // Loja e SM: agenda automática se hora entre 09:00-18:00
    let scheduleDate = null, schedulePeriod = null;
    const horaMinSync = horaInicioCol >= 0 ? parseHoraToMinutes(row[horaInicioCol]) : null;
    if (horaMinSync !== null && horaMinSync >= 540 && horaMinSync < 1080) {
      scheduleDate = (dataServicoCol >= 0 ? excelDateToYMD(row[dataServicoCol]) : null)
                  || (dataObraCol >= 0 ? excelDateToYMD(row[dataObraCol]) : null);
      if (scheduleDate && portalInfo.type === 'loja') {
        schedulePeriod = horaMinSync < 840 ? 'Manhã' : 'Tarde';
      }
    }

    if (!byPortal[portalInfo.id]) byPortal[portalInfo.id] = [];
    byPortal[portalInfo.id].push({
      portal_id: portalInfo.id, plate, car, service: 'PB',
      notes, extra, phone, status: 'NE', createdAt,
      date: scheduleDate || null, period: schedulePeriod || null,
      confirmed: false  // sempre pré-agendamento ao importar do Excel
    });
  });

  const portalIds = Object.keys(byPortal);
  if (portalIds.length === 0) {
    showToast('Nenhum portal reconhecido no Excel', 'error');
    return;
  }

  document.getElementById('importProgress').style.display = 'block';
  document.getElementById('btnSyncImport').disabled = true;
  document.getElementById('btnStartImport').disabled = true;

  let totalCreated = 0, totalUpdated = 0, totalDeleted = 0, totalSkipped = 0, totalErrors = 0;
  let done = 0;
  const total = portalIds.length;

  for (const portalId of portalIds) {
    const services = byPortal[portalId];
    const pct = Math.round(((done + 1) / total) * 100);
    document.getElementById('importProgressBar').style.width = pct + '%';
    document.getElementById('importProgressText').textContent = `A sincronizar portal ${done + 1}/${total} (${services.length} serviços)...`;

    try {
      const response = await authClient.authenticatedFetch('/.netlify/functions/sync-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal_id: parseInt(portalId), services })
      });
      const result = await response.json();
      if (result.success) {
        totalCreated += result.data.created || 0;
        totalUpdated += result.data.updated || 0;
        totalDeleted += result.data.deleted || 0;
        totalSkipped += result.data.skipped || 0;
        totalErrors  += result.data.errors  || 0;
      }
    } catch (err) {
      console.error('Erro sync portal', portalId, err);
      totalErrors++;
    }
    done++;
  }

  document.getElementById('importProgressBar').style.width = '100%';
  document.getElementById('importProgressText').textContent = 'Sincronização concluída!';
  document.getElementById('btnSyncImport').disabled = false;
  document.getElementById('btnStartImport').disabled = false;

  document.getElementById('importResultsContent').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px;">
      <div style="text-align:center;padding:16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
        <div style="font-size:28px;font-weight:700;color:#16a34a;">${totalCreated}</div>
        <div style="font-size:13px;color:#6b7280;">Criados</div>
      </div>
      <div style="text-align:center;padding:16px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
        <div style="font-size:28px;font-weight:700;color:#2563eb;">${totalUpdated}</div>
        <div style="font-size:13px;color:#6b7280;">Agendados</div>
      </div>
      <div style="text-align:center;padding:16px;background:#fff7ed;border-radius:8px;border:1px solid #fed7aa;">
        <div style="font-size:28px;font-weight:700;color:#ea580c;">${totalDeleted}</div>
        <div style="font-size:13px;color:#6b7280;">Apagados</div>
      </div>
      <div style="text-align:center;padding:16px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;">
        <div style="font-size:28px;font-weight:700;color:#dc2626;">${totalErrors}</div>
        <div style="font-size:13px;color:#6b7280;">Erros</div>
      </div>
    </div>
  `;
  document.getElementById('importResults').style.display = 'block';
  showToast(`Sync concluído: ${totalCreated} criados, ${totalUpdated} agendados, ${totalDeleted} apagados`, 'success');
}

// ===== GESTÃO DE PASSWORDS =====
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  document.getElementById('userPassword').value = pass;
}

function copyPassword() {
  const pass = document.getElementById('userPassword').value;
  if (!pass) {
    showToast('Nenhuma password para copiar', 'error');
    return;
  }
  navigator.clipboard.writeText(pass).then(() => {
    showToast('Password copiada!', 'success');
  }).catch(() => {
    // Fallback para browsers antigos
    const temp = document.createElement('input');
    temp.value = pass;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    showToast('Password copiada!', 'success');
  });
}

// ===== CONFIGURAÇÕES =====
let settingsLoaded = false;

async function loadSettings() {
  try {
    const response = await authClient.authenticatedFetch('/.netlify/functions/settings');
    const data = await response.json();
    if (data.success) {
      const s = data.data;
      // Ligeiros
      document.getElementById('timePB_L').value = s.serviceTimes?.PB_L ?? s.serviceTimes?.PB ?? 90;
      document.getElementById('timeLT_L').value = s.serviceTimes?.LT_L ?? s.serviceTimes?.LT ?? 45;
      document.getElementById('timeOC_L').value = s.serviceTimes?.OC_L ?? s.serviceTimes?.OC ?? 60;
      document.getElementById('timeREP_L').value = s.serviceTimes?.REP_L ?? s.serviceTimes?.REP ?? 30;
      document.getElementById('timePOL_L').value = s.serviceTimes?.POL_L ?? s.serviceTimes?.POL ?? 45;
      // Pesados
      document.getElementById('timePB_P').value = s.serviceTimes?.PB_P ?? 120;
      document.getElementById('timeLT_P').value = s.serviceTimes?.LT_P ?? 60;
      document.getElementById('timeOC_P').value = s.serviceTimes?.OC_P ?? 90;
      document.getElementById('timeREP_P').value = s.serviceTimes?.REP_P ?? 45;
      document.getElementById('timePOL_P').value = s.serviceTimes?.POL_P ?? 60;
      // Calibragem ADAS
      document.getElementById('timeCALIB_EXTRA_L').value = s.serviceTimes?.CALIB_EXTRA_L ?? 30;
      document.getElementById('timeCALIB_EXTRA_P').value = s.serviceTimes?.CALIB_EXTRA_P ?? 45;
      // Rota
      document.getElementById('avgSpeed').value = s.avgSpeedKmh ?? 50;
      document.getElementById('fuelConsumption').value = s.fuelPer100km ?? 7.5;
      document.getElementById('fuelPrice').value = s.fuelPricePerLiter ?? 1.65;
      settingsLoaded = true;
    }
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

async function saveSettings() {
  const settings = {
    serviceTimes: {
      PB_L: parseInt(document.getElementById('timePB_L').value) || 90,
      LT_L: parseInt(document.getElementById('timeLT_L').value) || 45,
      OC_L: parseInt(document.getElementById('timeOC_L').value) || 60,
      REP_L: parseInt(document.getElementById('timeREP_L').value) || 30,
      POL_L: parseInt(document.getElementById('timePOL_L').value) || 45,
      PB_P: parseInt(document.getElementById('timePB_P').value) || 120,
      LT_P: parseInt(document.getElementById('timeLT_P').value) || 60,
      OC_P: parseInt(document.getElementById('timeOC_P').value) || 90,
      REP_P: parseInt(document.getElementById('timeREP_P').value) || 45,
      POL_P: parseInt(document.getElementById('timePOL_P').value) || 60,
      CALIB_EXTRA_L: parseInt(document.getElementById('timeCALIB_EXTRA_L').value) || 30,
      CALIB_EXTRA_P: parseInt(document.getElementById('timeCALIB_EXTRA_P').value) || 45
    },
    avgSpeedKmh: parseFloat(document.getElementById('avgSpeed').value) || 50,
    fuelPer100km: parseFloat(document.getElementById('fuelConsumption').value) || 7.5,
    fuelPricePerLiter: parseFloat(document.getElementById('fuelPrice').value) || 1.65
  };

  try {
    const response = await authClient.authenticatedFetch('/.netlify/functions/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await response.json();
    if (data.success) {
      showToast('Configurações guardadas', 'success');
      const status = document.getElementById('settingsSaveStatus');
      status.style.display = 'inline';
      setTimeout(() => { status.style.display = 'none'; }, 3000);
    } else {
      showToast(data.error || 'Erro ao guardar', 'error');
    }
  } catch (err) {
    console.error('Erro ao guardar configurações:', err);
    showToast('Erro ao guardar configurações', 'error');
  }
}

// Carregar settings ao abrir a tab
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.tab === 'settings' && !settingsLoaded) {
      loadSettings();
      loadDGEGPrice();
    }
    if (tab.dataset.tab === 'reports') {
      initReportFilters();
    }
  });
});

// Buscar preço DGEG
async function loadDGEGPrice() {
  const el = document.getElementById('dgegPrice');
  if (!el) return;
  el.textContent = 'A carregar...';
  try {
    const response = await authClient.authenticatedFetch('/.netlify/functions/fuel-price');
    const data = await response.json();
    if (data.success && data.data) {
      const d = data.data;
      const sourceText = d.source === 'DGEG' ? 'DGEG (média de ' + (d.stations || '?') + ' postos)' : d.source;
      const dateText = d.date ? new Date(d.date).toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
      el.innerHTML = '<strong style="font-size:18px;color:#1e40af;">' + d.price.toFixed(3) + ' €/litro</strong>' +
        '<br><span style="color:#6b7280;font-size:11px;">Fonte: ' + sourceText + (d.cached ? ' (cache)' : '') + ' · ' + dateText + '</span>';
      
      document.getElementById('fuelPriceInfo').textContent = 'Este valor é usado como fallback se a DGEG estiver indisponível';
    }
  } catch (err) {
    el.textContent = 'Erro ao carregar preço da DGEG';
    console.error('Erro DGEG:', err);
  }
}

async function refreshFuelPrice() {
  showToast('A atualizar preço da DGEG...', 'info');
  await loadDGEGPrice();
  showToast('Preço DGEG atualizado', 'success');
}

// ===== BACKUP GERAL (admin) =====
document.getElementById('adminBtnExportBackup')?.addEventListener('click', async () => {
  const btn = document.getElementById('adminBtnExportBackup');
  btn.textContent = '⏳ A exportar...';
  btn.disabled = true;
  try {
    const token = authClient?.getToken?.() || '';
    const resp = await fetch('/.netlify/functions/backup-all', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // Verificar se é JSON válido antes de fazer parse
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Função não encontrada (HTTP ${resp.status}). Verifica se backup-all.js está em netlify/functions/.`);
    }

    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Erro');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const filename = `backup_GERAL_${stamp}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    showToast(`✅ Backup guardado: ${filename} (${data.total} agendamentos)`, 'success');
  } catch(e) {
    showToast('❌ Erro no backup: ' + e.message, 'error');
  } finally {
    btn.textContent = '💾 Fazer Backup Agora';
    btn.disabled = false;
  }
});

document.getElementById('adminBtnChooseRestore')?.addEventListener('click', () => {
  document.getElementById('adminRestoreFile')?.click();
});

document.getElementById('adminRestoreFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const statusEl = document.getElementById('adminRestoreStatus');
  statusEl.style.display = 'block';
  statusEl.style.color = '#6b7280';
  statusEl.textContent = '⏳ A ler ficheiro...';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const toRestore = data.appointments || (Array.isArray(data) ? data : []);
    if (!toRestore.length) { statusEl.style.color='#dc2626'; statusEl.textContent='❌ Ficheiro vazio ou inválido.'; return; }
    statusEl.textContent = `⏳ A restaurar ${toRestore.length} agendamentos...`;
    const token = authClient?.getToken?.() || '';
    let created = 0, skipped = 0, errors = 0;
    for (const appt of toRestore) {
      const { id, portal_name, ...payload } = appt;
      try {
        const resp = await fetch(`/.netlify/functions/appointments?portal_id=${appt.portal_id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        const r = await resp.json();
        if (resp.status === 409 || !r.success) skipped++;
        else created++;
      } catch { errors++; }
    }
    statusEl.style.color = '#16a34a';
    statusEl.textContent = `✅ ${created} restaurados, ${skipped} ignorados (já existiam)${errors ? `, ${errors} erros` : ''}.`;
  } catch(err) {
    statusEl.style.color = '#dc2626';
    statusEl.textContent = '❌ Erro: ' + err.message;
  }
  e.target.value = '';
});

// ===== RELATÓRIOS =====
let reportCharts = {};

function initReportFilters() {
  // Preencher selector de portais
  const sel = document.getElementById('reportPortal');
  if (!sel || sel.options.length > 1) return;
  const portals = window._adminPortals || [];
  portals.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });

  // Default: mês actual
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('reportFrom').value = ym;
  document.getElementById('reportTo').value = ym;
}

async function generateReport() {
  const portalId = document.getElementById('reportPortal').value;
  const fromMonth = document.getElementById('reportFrom').value;
  const toMonth   = document.getElementById('reportTo').value;
  if (!portalId || !fromMonth || !toMonth) { showToast('Preenche todos os campos', 'error'); return; }

  const dateFrom = fromMonth + '-01';
  const dateTo   = toMonth + '-' + new Date(toMonth.split('-')[0], toMonth.split('-')[1], 0).getDate();

  document.getElementById('reportLoading').style.display = 'block';
  document.getElementById('reportContent').style.display = 'none';
  document.getElementById('btnDownloadPDF').style.display = 'none';

  try {
    const token = authClient.getToken();
    const resp = await fetch(`/.netlify/functions/reports?portal_id=${portalId}&date_from=${dateFrom}&date_to=${dateTo}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);
    renderReport(data);
  } catch(e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    document.getElementById('reportLoading').style.display = 'none';
  }
}

function renderReport(data) {
  const { portal, period, totals, byLocality, byWeekday, byWeek, byService, byComercial, byMotivo } = data;

  // Header
  const portalDisplayName = portal.name || 'Portal';
  document.getElementById('reportTitle').textContent = portalDisplayName;

  // Título da página com portal + período
  const fmtDate = d => new Date(d+'T12:00:00').toLocaleDateString('pt-PT',{day:'2-digit',month:'long',year:'numeric'});
  const fromDate = new Date(period.from + 'T12:00:00');
  const toDate = new Date(period.to + 'T12:00:00');
  const sameMonth = fromDate.getMonth() === toDate.getMonth() && fromDate.getFullYear() === toDate.getFullYear();
  const periodLabel = sameMonth
    ? fromDate.toLocaleDateString('pt-PT', {month:'long', year:'numeric'})
    : `${fmtDate(period.from)} → ${fmtDate(period.to)}`;
  document.getElementById('reportPeriod').textContent = `${fmtDate(period.from)} → ${fmtDate(period.to)}`;
  // Atualizar título do documento para impressão
  document.title = `${portalDisplayName} — ${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)} | ExpressGlass`;

  // KPIs calculados
  const total = parseInt(totals.total_agendados)||0;
  const realiz = parseInt(totals.total_realizados)||0;
  const nRealiz = parseInt(totals.total_nao_realizados)||0;
  const taxa = total > 0 ? Math.round((realiz/total)*100) : 0;
  const km = parseInt(totals.total_km)||0;
  const diasComServicos = parseInt(totals.dias_com_servicos)||1;
  const mediaDiaria = diasComServicos > 0 ? (total/diasComServicos).toFixed(1) : '—';
  const travelMin = parseInt(totals.total_travel_min)||0;
  const travelHoras = Math.floor(travelMin/60);
  const travelMins = travelMin%60;
  const travelStr = travelMin > 0 ? `${travelHoras}h${String(travelMins).padStart(2,'0')}` : '—';

  // Tempo total de trabalho estimado (km / velocidade média 80kmh → horas estrada + serviços a 60min cada)
  const horasEstrada = km > 0 ? (km/80) : 0;
  const horasServico = total * 1; // 60min por serviço em horas
  const horasTotal = horasEstrada + horasServico;
  const horasTotalStr = horasTotal > 0 ? `${Math.floor(horasTotal)}h${String(Math.round((horasTotal%1)*60)).padStart(2,'0')}` : '—';

  // Custos
  const fuelLitros = (km * 7.5 / 100);
  const custoGasoleo = (fuelLitros * 1.95).toFixed(2);
  const custoTotal = custoGasoleo; // pode expandir com portagens, etc

  document.getElementById('kpiTotal').textContent = total;
  document.getElementById('kpiRealizados').textContent = realiz;
  document.getElementById('kpiNaoRealizados').textContent = nRealiz;
  document.getElementById('kpiTaxa').textContent = taxa + '%';
  document.getElementById('kpiKm').textContent = km + ' km';
  document.getElementById('kpiPendentes').textContent = parseInt(totals.total_pendentes)||0;
  document.getElementById('kpiMediaDiaria').textContent = mediaDiaria;
  document.getElementById('kpiTempoEstrada').textContent = travelStr;
  document.getElementById('kpiCusto').textContent = custoGasoleo + '€';

  // Destruir charts anteriores
  Object.values(reportCharts).forEach(c => c?.destroy());
  reportCharts = {};

  const COLORS = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#db2777','#0891b2','#65a30d','#ea580c','#6366f1'];

  // Gráfico: por localidade (bar horizontal)
  const locLabels = byLocality.map(r => r.locality);
  const locTotals = byLocality.map(r => parseInt(r.total));
  const locRealizados = byLocality.map(r => parseInt(r.realizados));
  reportCharts.locality = new Chart(document.getElementById('chartLocality'), {
    type: 'bar',
    data: {
      labels: locLabels,
      datasets: [
        { label: 'Total', data: locTotals, backgroundColor: '#bfdbfe', borderColor: '#2563eb', borderWidth: 1.5, borderRadius: 4 },
        { label: 'Realizados', data: locRealizados, backgroundColor: '#bbf7d0', borderColor: '#16a34a', borderWidth: 1.5, borderRadius: 4 }
      ]
    },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { position: 'top' } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  // Gráfico: Dias Aberto — criar imediatamente com dados vazios, actualizar com fetch
  const _bucketsInit = [0,0,0,0,0];
  reportCharts.weekly = new Chart(document.getElementById('chartWeekly'), {
    type: 'bar',
    data: {
      labels: ['0-2 dias', '3-6 dias', '7-13 dias', '14-29 dias', '30+ dias'],
      datasets: [{
        label: 'Serviços',
        data: _bucketsInit,
        backgroundColor: ['#16a34a','#65a30d','#d97706','#ea580c','#dc2626'],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });

  // Carregar dados reais de forma assíncrona e actualizar gráfico
  (async () => {
    try {
      const token = authClient.getToken();
      const portalId = document.getElementById('reportPortal').value;
      const resp2 = await fetch(`/.netlify/functions/appointments?portal_id=${portalId}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const apptData = await resp2.json();
      const normDate = s => s ? String(s).slice(0, 10) : null;
      const appts = (apptData.data || []).filter(a => {
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

      // Actualizar gráfico com dados reais
      reportCharts.weekly.data.datasets[0].data = buckets;
      reportCharts.weekly.update();

      // Actualizar KPI média
      const media = diasList.length > 0
        ? (diasList.reduce((s,d) => s+d, 0) / diasList.length).toFixed(1)
        : '—';
      document.getElementById('kpiMediaDiaria').textContent = media + (media !== '—' ? ' dias' : '');

    } catch(e) { console.warn('Erro ao gerar gráfico dias aberto:', e); }
  })();

  // Gráfico: por dia da semana (bar)
  const dowNames = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
  const dowData = Array(7).fill(0);
  byWeekday.forEach(r => { const i = parseInt(r.dow_num)-1; if(i>=0&&i<7) dowData[i]=parseInt(r.total); });
  reportCharts.weekday = new Chart(document.getElementById('chartWeekday'), {
    type: 'bar',
    data: {
      labels: dowNames,
      datasets: [{ label: 'Serviços', data: dowData, backgroundColor: COLORS, borderRadius: 6 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  // Gráfico: por tipo de serviço (doughnut)
  const svcMap = { PB:'Para-brisas', LT:'Lateral', OC:'Óculo', REP:'Reparação', POL:'Polimento', MO:'Montante' };
  reportCharts.service = new Chart(document.getElementById('chartService'), {
    type: 'doughnut',
    data: {
      labels: byService.map(r => svcMap[r.service]||r.service),
      datasets: [{ data: byService.map(r=>parseInt(r.total)), backgroundColor: COLORS, borderWidth: 2 }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, cutout: '55%' }
  });

  // Tabela localidades
  const tbody = document.getElementById('reportLocalityTable');
  tbody.innerHTML = byLocality.map((r,i) => {
    const t = parseInt(r.total), rl = parseInt(r.realizados);
    const tx = t > 0 ? Math.round((rl/t)*100) : 0;
    const taxaColor = tx>=80?'#16a34a':tx>=50?'#d97706':'#dc2626';
    return `<tr style="border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafafa':''}">
      <td style="padding:10px 12px;font-weight:600;">${r.locality}</td>
      <td style="text-align:center;padding:10px;">${t}</td>
      <td style="text-align:center;padding:10px;color:#16a34a;font-weight:700;">${rl}</td>
      <td style="text-align:center;padding:10px;"><span style="background:${taxaColor}15;color:${taxaColor};font-weight:700;padding:2px 8px;border-radius:20px;">${tx}%</span></td>
      <td style="text-align:center;padding:10px;color:#7c3aed;font-weight:600;">${parseInt(r.km)||0} km</td>
    </tr>`;
  }).join('');

  // ===== SECÇÃO COMERCIAL =====
  const comercialSection = document.getElementById('reportComercialSection');
  if (comercialSection) {
    if (byComercial && byComercial.length > 0) {
      const totalCom = byComercial.reduce((s, r) => s + parseInt(r.total), 0);
      const realizCom = byComercial.reduce((s, r) => s + parseInt(r.realizados), 0);
      const taxaCom = totalCom > 0 ? Math.round((realizCom / totalCom) * 100) : 0;
      comercialSection.innerHTML = `
        <div style="border-top:2px solid #7c3aed;padding-top:24px;margin-top:32px;">
          <h3 style="font-size:16px;font-weight:700;color:#7c3aed;margin-bottom:16px;">🤝 Serviços Encaminhados por Comercial</h3>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
            <div style="background:#f5f3ff;border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#7c3aed;">${totalCom}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:4px;">Total encaminhados</div>
            </div>
            <div style="background:#f0fdf4;border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#16a34a;">${realizCom}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:4px;">Realizados</div>
            </div>
            <div style="background:#fefce8;border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#d97706;">${taxaCom}%</div>
              <div style="font-size:12px;color:#6b7280;margin-top:4px;">Taxa realização</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="background:#f5f3ff;">
                <th style="padding:10px 12px;text-align:left;font-weight:700;color:#7c3aed;">Comercial</th>
                <th style="padding:10px;text-align:center;font-weight:700;">Total</th>
                <th style="padding:10px;text-align:center;font-weight:700;color:#16a34a;">Realizados</th>
                <th style="padding:10px;text-align:center;font-weight:700;color:#dc2626;">Não real.</th>
                <th style="padding:10px;text-align:center;font-weight:700;color:#d97706;">Pendentes</th>
                <th style="padding:10px;text-align:center;font-weight:700;">Taxa</th>
                <th style="padding:10px;text-align:center;font-weight:700;">Média dias</th>
              </tr>
            </thead>
            <tbody>
              ${byComercial.map((r, i) => {
                const t = parseInt(r.total), rl = parseInt(r.realizados);
                const nr = parseInt(r.nao_realizados), p = parseInt(r.pendentes);
                const tx = t > 0 ? Math.round((rl/t)*100) : 0;
                const txColor = tx>=80?'#16a34a':tx>=50?'#d97706':'#dc2626';
                const md = r.media_dias ? parseFloat(r.media_dias).toFixed(1) + ' dias' : '—';
                return `<tr style="border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafafa':''}">
                  <td style="padding:10px 12px;font-weight:700;">${r.comercial_name}</td>
                  <td style="text-align:center;padding:10px;font-weight:700;color:#7c3aed;">${t}</td>
                  <td style="text-align:center;padding:10px;color:#16a34a;font-weight:700;">${rl}</td>
                  <td style="text-align:center;padding:10px;color:#dc2626;font-weight:700;">${nr}</td>
                  <td style="text-align:center;padding:10px;color:#d97706;font-weight:700;">${p}</td>
                  <td style="text-align:center;padding:10px;"><span style="background:${txColor}15;color:${txColor};font-weight:700;padding:2px 10px;border-radius:20px;">${tx}%</span></td>
                  <td style="text-align:center;padding:10px;color:#6b7280;">${md}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
      comercialSection.style.display = 'block';
      comercialSection.style.visibility = 'visible';
    } else {
      comercialSection.style.display = 'none';
    }
  }

  // ===== MOTIVOS DE NÃO REALIZAÇÃO =====
  const motivosSection = document.getElementById('reportMotivosSection');
  if (motivosSection) {
    if (byMotivo && byMotivo.length > 0) {
      motivosSection.innerHTML = `
        <div style="border-top:2px solid #dc2626;padding-top:24px;margin-top:32px;">
          <h3 style="font-size:16px;font-weight:700;color:#dc2626;margin-bottom:16px;">❌ Motivos de Não Realização</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="background:#fef2f2;">
                <th style="padding:10px 12px;text-align:left;font-weight:700;color:#dc2626;">Motivo</th>
                <th style="padding:10px;text-align:center;font-weight:700;">Ocorrências</th>
              </tr>
            </thead>
            <tbody>
              ${byMotivo.map((r, i) => `
                <tr style="border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafafa':''}">
                  <td style="padding:10px 12px;color:#374151;">${r.motivo}</td>
                  <td style="text-align:center;padding:10px;"><span style="background:#fef2f2;color:#dc2626;font-weight:700;padding:2px 12px;border-radius:20px;">${r.total}×</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      motivosSection.style.display = 'block';
      motivosSection.style.visibility = 'visible';
    } else {
      motivosSection.style.display = 'none';
    }
  }

  document.getElementById('reportContent').style.display = 'block';
  document.getElementById('btnDownloadPDF').style.display = 'inline-block';
}

function downloadReportPDF() {
  window.print();
}