// admin-comercial-patch.js - v3
// Adicionar ao admin.html DEPOIS de admin-script.js

(function() {

  function injectComercialRole() {
    var sel = document.getElementById('userRole');
    if (!sel || sel.querySelector('option[value="comercial"]')) return;
    var opt = document.createElement('option');
    opt.value = 'comercial';
    opt.textContent = 'Comercial (acesso a varios SM)';
    var adminOpt = sel.querySelector('option[value="admin"]');
    if (adminOpt) sel.insertBefore(opt, adminOpt);
    else sel.appendChild(opt);
  }

  function injectComercialGroup() {
    if (document.getElementById('comercialPortalGroup')) return;
    var multiGroup = document.getElementById('multiPortalGroup');
    if (!multiGroup) return;
    var div = document.createElement('div');
    div.className = 'form-group';
    div.id = 'comercialPortalGroup';
    div.style.display = 'none';
    div.innerHTML =
      '<label>SM do Comercial *</label>' +
      '<div id="comercialPortalCheckboxes" style="max-height:200px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;padding:8px;"></div>' +
      '<small>Selecione os portais SM a que o comercial tera acesso</small>';
    multiGroup.parentNode.insertBefore(div, multiGroup.nextSibling);
  }

  function populateComercialPortalCheckboxes(selectedIds) {
    selectedIds = selectedIds || [];
    var container = document.getElementById('comercialPortalCheckboxes');
    if (!container) return;
    var smPortals = (portals || []).filter(function(p) {
      return p.portal_type !== 'loja';
    });
    if (!smPortals.length) {
      container.innerHTML = '<p style="color:#9ca3af;font-size:13px;padding:8px;">Nenhum portal SM disponivel.</p>';
      return;
    }
    container.innerHTML = smPortals.map(function(p) {
      var checked = selectedIds.indexOf(p.id) >= 0 ? 'checked' : '';
      return '<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;">' +
        '<input type="checkbox" class="comercial-portal-cb" value="' + p.id + '" ' + checked + ' style="width:18px;height:18px;min-width:18px;">' +
        '<span style="flex:1;">' + p.name + ' <span style="color:#9ca3af;font-size:12px;">(SM)</span></span>' +
        '</label>';
    }).join('');
  }
  window.populateComercialPortalCheckboxes = populateComercialPortalCheckboxes;

  // A função patched que sabe lidar com comercial
  function togglePortalSelectPatched() {
    var role         = document.getElementById('userRole').value;
    var portalGroup  = document.getElementById('portalSelectGroup');
    var multiGroup   = document.getElementById('multiPortalGroup');
    var comGroup     = document.getElementById('comercialPortalGroup');
    var portalSelect = document.getElementById('userPortal');

    if (portalGroup)  portalGroup.style.display  = 'none';
    if (multiGroup)   multiGroup.style.display   = 'none';
    if (comGroup)     comGroup.style.display     = 'none';
    if (portalSelect) portalSelect.required      = false;

    if (role === 'coordenador') {
      if (multiGroup) multiGroup.style.display = 'block';
      if (typeof populateMultiPortalCheckboxes === 'function') populateMultiPortalCheckboxes();
    } else if (role === 'comercial') {
      if (comGroup) comGroup.style.display = 'block';
      populateComercialPortalCheckboxes();
    } else if (role !== 'admin') {
      if (portalGroup)  portalGroup.style.display = 'block';
      if (portalSelect) portalSelect.required     = true;
    }
  }
  window.togglePortalSelect = togglePortalSelectPatched;
  window.onRoleChange       = togglePortalSelectPatched;

  // Substituir o listener do botão "Novo Utilizador"
  // (o original tem closure para a função antiga)
  function patchAddUserBtn() {
    var btn = document.getElementById('addUserBtn');
    if (!btn) return;
    var newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', function() {
      window.editingUserId = null;
      var form = document.getElementById('userForm');
      if (form) form.reset();
      var hint = document.getElementById('passwordHint');
      var pass = document.getElementById('userPassword');
      var title = document.getElementById('userModalTitle');
      if (hint)  hint.style.display = 'none';
      if (pass)  { pass.required = true; pass.placeholder = 'Minimo 6 caracteres'; }
      if (title) title.textContent = 'Novo Utilizador';
      togglePortalSelectPatched();
      if (typeof openModal === 'function') openModal('userModal');
    });
  }

  window.renderUsers = function() {
    var tbody = document.getElementById('usersTableBody');
    if (!users || !users.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading">Nenhum utilizador criado</td></tr>';
      return;
    }
    var labels = { admin:'Admin', coordenador:'Coordenador', comercial:'Comercial', user:'Tecnico' };
    var sorted = users.slice().sort(function(a,b) {
      return (a.username||'').localeCompare(b.username||'','pt');
    });
    tbody.innerHTML = sorted.map(function(u) {
      return '<tr>' +
        '<td><strong>' + u.username + '</strong></td>' +
        '<td><code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:13px;user-select:all;">' + (u.plain_password||'••••••') + '</code></td>' +
        '<td>' + (u.portalName||'-') + '</td>' +
        '<td><span class="badge ' + u.role + '">' + (labels[u.role]||u.role) + '</span></td>' +
        '<td class="table-actions">' +
          '<button class="btn-edit" onclick="editUser(' + u.id + ')">Editar</button>' +
          '<button class="btn-danger" onclick="deleteUser(' + u.id + ')">Eliminar</button>' +
        '</td></tr>';
    }).join('');
  };

  window.editUser = function(id) {
    var user = (window.users||[]).find(function(u){ return u.id === id; });
    if (!user) return;
    window.editingUserId = id;
    document.getElementById('userModalTitle').textContent = 'Editar Utilizador';
    document.getElementById('userUsername').value = user.username;
    document.getElementById('userPassword').value = '';
    document.getElementById('userPassword').required = false;
    document.getElementById('userPassword').placeholder = 'Deixe em branco para manter';
    document.getElementById('passwordHint').style.display = 'block';
    document.getElementById('userRole').value = user.role;
    document.getElementById('userPortal').value = user.portalId || '';
    togglePortalSelectPatched();
    if (user.role === 'coordenador' && user.portalIds && typeof populateMultiPortalCheckboxes === 'function')
      populateMultiPortalCheckboxes(user.portalIds);
    if (user.role === 'comercial' && user.portalIds)
      populateComercialPortalCheckboxes(user.portalIds);
    if (typeof openModal === 'function') openModal('userModal');
  };

  function patchForm() {
    var form = document.getElementById('userForm');
    if (!form) return;
    var clone = form.cloneNode(true);
    form.parentNode.replaceChild(clone, form);

    clone.addEventListener('submit', async function(e) {
      e.preventDefault();
      var username = document.getElementById('userUsername').value.trim();
      var password = document.getElementById('userPassword').value;
      var role     = document.getElementById('userRole').value;
      var portalId = document.getElementById('userPortal').value;

      if (password && password.length < 6) {
        if (typeof showToast==='function') showToast('Password deve ter no minimo 6 caracteres','error');
        return;
      }

      var userData = { username: username, role: role };
      if (password) userData.password = password;

      if (role === 'user' && portalId) {
        userData.portal_id = parseInt(portalId);
      }
      if (role === 'coordenador') {
        var ids = Array.from(document.querySelectorAll('.coord-portal-cb:checked')).map(function(cb){ return parseInt(cb.value); });
        if (!ids.length) { if (typeof showToast==='function') showToast('Selecione pelo menos um portal','error'); return; }
        userData.portal_id  = ids[0];
        userData.portal_ids = ids;
      }
      if (role === 'comercial') {
        var ids = Array.from(document.querySelectorAll('.comercial-portal-cb:checked')).map(function(cb){ return parseInt(cb.value); });
        if (!ids.length) { if (typeof showToast==='function') showToast('Selecione pelo menos um SM','error'); return; }
        userData.portal_id  = ids[0];
        userData.portal_ids = ids;
      }

      try {
        var url    = window.editingUserId ? ('/.netlify/functions/users/' + window.editingUserId) : '/.netlify/functions/users';
        var method = window.editingUserId ? 'PUT' : 'POST';
        var resp   = await authClient.authenticatedFetch(url, {
          method: method,
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(userData)
        });
        var data = await resp.json();
        if (data.success) {
          if (typeof showToast==='function') showToast(window.editingUserId ? 'Utilizador atualizado':'Utilizador criado','success');
          if (typeof closeModal==='function') closeModal('userModal');
          if (typeof loadUsers==='function') loadUsers();
        } else {
          if (typeof showToast==='function') showToast(data.error||'Erro ao guardar','error');
        }
      } catch(err) {
        if (typeof showToast==='function') showToast('Erro: '+err.message,'error');
      }
    });
  }

  function init() {
    injectComercialRole();
    injectComercialGroup();
    patchForm();
    patchAddUserBtn(); // <-- FIX: substituir o listener do botão
    // Re-ligar onchange ao role select
    var roleSel = document.getElementById('userRole');
    if (roleSel) {
      var newRoleSel = roleSel.cloneNode(true);
      roleSel.parentNode.replaceChild(newRoleSel, roleSel);
      newRoleSel.addEventListener('change', togglePortalSelectPatched);
    }
    console.log('Patch comercial v3 OK');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 300);
  }

})();
