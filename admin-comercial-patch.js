// admin-comercial-patch.js
// Adicionar ao admin.html DEPOIS de admin-script.js:
// <script src="admin-comercial-patch.js"></script>

// ── Sobrescrever renderUsers com suporte a Comercial ──
function renderUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Nenhum utilizador criado</td></tr>';
    return;
  }
  const roleLabels = { admin: 'Admin', coordenador: 'Coordenador', comercial: 'Comercial', user: 'Técnico' };
  const sorted = [...users].sort((a, b) => (a.username || '').localeCompare(b.username || '', 'pt'));
  tbody.innerHTML = sorted.map(user => `
    <tr>
      <td><strong>${user.username}</strong></td>
      <td><code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:13px;user-select:all;">${user.plain_password || '••••••'}</code></td>
      <td>${user.portalName || '-'}</td>
      <td><span class="badge ${user.role}">${roleLabels[user.role] || user.role}</span></td>
      <td class="table-actions">
        <button class="btn-edit" onclick="editUser(${user.id})">Editar</button>
        <button class="btn-danger" onclick="deleteUser(${user.id})">Eliminar</button>
      </td>
    </tr>`).join('');
}

// ── Checkboxes SM para Comercial ──
function populateComercialPortalCheckboxes(selectedIds = []) {
  const container = document.getElementById('comercialPortalCheckboxes');
  if (!container) return;
  const smPortals = portals.filter(p => (p.portal_type || 'sm') === 'sm');
  if (smPortals.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;padding:8px;">Nenhum portal SM disponível.</p>';
    return;
  }
  container.innerHTML = smPortals.map(p => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;">
      <input type="checkbox" class="comercial-portal-cb" value="${p.id}" ${selectedIds.includes(p.id) ? 'checked' : ''} style="width:18px;height:18px;min-width:18px;">
      <span style="flex:1;">${p.name} <span style="color:#9ca3af;font-size:12px;">(SM)</span></span>
    </label>`).join('');
}

// ── Sobrescrever togglePortalSelect com suporte a Comercial ──
function togglePortalSelect() {
  const role = document.getElementById('userRole').value;
  const portalGroup    = document.getElementById('portalSelectGroup');
  const multiGroup     = document.getElementById('multiPortalGroup');
  const comercialGroup = document.getElementById('comercialPortalGroup');
  const portalSelect   = document.getElementById('userPortal');

  portalGroup.style.display    = 'none';
  multiGroup.style.display     = 'none';
  if (comercialGroup) comercialGroup.style.display = 'none';
  portalSelect.required = false;

  if (role === 'coordenador') {
    multiGroup.style.display = 'block';
    populateMultiPortalCheckboxes();
  } else if (role === 'comercial') {
    if (comercialGroup) {
      comercialGroup.style.display = 'block';
      populateComercialPortalCheckboxes();
    }
  } else if (role !== 'admin') {
    portalGroup.style.display = 'block';
    portalSelect.required = true;
  }
}

// Alias para o onchange no admin.html
window.onRoleChange = togglePortalSelect;

// ── Sobrescrever editUser com suporte a Comercial ──
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
  if (user.role === 'coordenador' && user.portalIds) populateMultiPortalCheckboxes(user.portalIds);
  if (user.role === 'comercial' && user.portalIds) populateComercialPortalCheckboxes(user.portalIds);
  openModal('userModal');
}

// ── Sobrescrever submit do userForm com suporte a Comercial ──
// Remover listener antigo e adicionar novo
(function patchUserFormSubmit() {
  const form = document.getElementById('userForm');
  if (!form) return;
  const newForm = form.cloneNode(true); // remove old listeners
  form.parentNode.replaceChild(newForm, form);

  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('userUsername').value.trim();
    const password = document.getElementById('userPassword').value;
    const role     = document.getElementById('userRole').value;
    const portalId = document.getElementById('userPortal').value;

    if (password && password.length < 6) { showToast('Password deve ter no mínimo 6 caracteres', 'error'); return; }

    const userData = { username, role };
    if (password) userData.password = password;

    if (role === 'user' && portalId) {
      userData.portal_id = parseInt(portalId);
    }
    if (role === 'coordenador') {
      const checked = document.querySelectorAll('.coord-portal-cb:checked');
      const ids = Array.from(checked).map(cb => parseInt(cb.value));
      if (ids.length === 0) { showToast('Selecione pelo menos um portal para o coordenador', 'error'); return; }
      userData.portal_id  = ids[0];
      userData.portal_ids = ids;
    }
    if (role === 'comercial') {
      const checked = document.querySelectorAll('.comercial-portal-cb:checked');
      const ids = Array.from(checked).map(cb => parseInt(cb.value));
      if (ids.length === 0) { showToast('Selecione pelo menos um SM para o comercial', 'error'); return; }
      userData.portal_id  = ids[0];
      userData.portal_ids = ids;
    }

    try {
      const url    = editingUserId ? `/.netlify/functions/users/${editingUserId}` : '/.netlify/functions/users';
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
    } catch (err) {
      console.error('Erro ao guardar utilizador:', err);
      showToast('Erro ao guardar utilizador', 'error');
    }
  });
})();

console.log('✅ Patch comercial carregado');
