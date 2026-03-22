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
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Nenhum portal criado</td></tr>';
    return;
  }
  
  tbody.innerHTML = portals.map(portal => {
    const lastImport = portal.last_import_at 
      ? new Date(portal.last_import_at).toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '<span style="color:#9ca3af">—</span>';
    const typeLabel = portal.portal_type === 'loja' 
      ? '<span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:4px;font-size:12px;">Loja</span>'
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
  
  // Se coordenador, carregar portais atribuídos
  if (user.role === 'coordenador' && user.portalIds) {
    populateMultiPortalCheckboxes(user.portalIds);
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

function populateMultiPortalCheckboxes(selectedIds = []) {
  const container = document.getElementById('multiPortalCheckboxes');
  if (!container) return;
  container.innerHTML = portals.map(p => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;text-align:left;">
      <input type="checkbox" class="coord-portal-cb" value="${p.id}" ${selectedIds.includes(p.id) ? 'checked' : ''} style="width:18px;height:18px;min-width:18px;">
      <span style="flex:1;text-align:left;">${p.name} <span style="color:#9ca3af;font-size:12px;">(${p.portal_type === 'loja' ? 'Loja' : 'SM'})</span></span>
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
    populateMultiPortalCheckboxes();
  } else {
    portalGroup.style.display = 'block';
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
  const phoneCol = importHeaders.findIndex(h => h.toLowerCase() === 'u_contsega');
  const emailCol = importHeaders.findIndex(h => h.toLowerCase() === 'email');
  const eurocodeCol = importHeaders.findIndex(h => h.toLowerCase() === 'eurocode');

  // Mapear nmdos_code → portal_id
  const codeToPortal = {};
  portals.forEach(p => {
    if (p.nmdos_code) codeToPortal[p.nmdos_code] = p.id;
  });

  // Preparar serviços
  const services = [];
  importExcelData.forEach(row => {
    const code = String(row[nmdosCol] || '').trim();
    const portalId = codeToPortal[code];
    if (!portalId) return; // Ignorar se não tem portal

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

    services.push({
      portal_id: portalId,
      plate,
      car,
      service: 'PB',
      notes,
      extra,
      phone,
      status: 'NE',
      createdAt
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
      POL_P: parseInt(document.getElementById('timePOL_P').value) || 60
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
