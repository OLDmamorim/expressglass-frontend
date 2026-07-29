// admin-comercial-patch.js - v6
// Adicionar ao admin.html DEPOIS de admin-script.js

(function() {
  var baseRenderUsers = window.renderUsers;
  var baseEditUser = window.editUser;

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
    var multiGroup = document.getElementById('multiPortalGroup');
    if (!multiGroup) return;

    if (!document.getElementById('comercialPortalGroup')) {
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

    // telegramChatIdGroup já existe no admin.html
  }

  function injectConsultableGroup() {
    if (document.getElementById('consultablePortalGroup') || document.getElementById('consultableGroup')) return;
    var multiGroup = document.getElementById('multiPortalGroup');
    if (!multiGroup) return;
    var div = document.createElement('div');
    div.className = 'form-group';
    div.id = 'consultableGroup';
    div.style.display = 'none';
    div.innerHTML =
      '<label>🔒 Portais de Consulta</label>' +
      '<div id="consultablePortalCheckboxes" style="max-height:200px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;padding:8px;"></div>' +
      '<small>Portais que este coordenador pode consultar em modo só-leitura</small>';
    // Inserir depois do multiPortalGroup
    multiGroup.parentNode.insertBefore(div, multiGroup.nextSibling);
  }

  function populateConsultablePortalCheckboxes(selectedIds) {
    // Se admin-script.js já definiu esta função, usa essa; caso contrário usa esta.
    selectedIds = selectedIds || [];
    var container = document.getElementById('consultablePortalCheckboxes');
    if (!container) return;
    // Excluir portais que o coordenador já coordena (coord-portal-cb:checked)
    var coordIds = Array.from(document.querySelectorAll('.coord-portal-cb:checked'))
      .map(function(cb) { return parseInt(cb.value); });
    var smPortals = (portals || []).filter(function(p) {
      return p.portal_type !== 'loja' && coordIds.indexOf(p.id) < 0;
    });
    if (!smPortals.length) {
      container.innerHTML = '<p style="color:#9ca3af;font-size:13px;padding:8px;">Nenhum portal SM disponivel.</p>';
      return;
    }
    container.innerHTML = smPortals.map(function(p) {
      var checked = selectedIds.indexOf(p.id) >= 0 ? 'checked' : '';
      return '<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;">' +
        '<input type="checkbox" class="consultable-portal-cb" value="' + p.id + '" ' + checked + ' style="width:18px;height:18px;min-width:18px;">' +
        '<span style="flex:1;">' + p.name + ' <span style="color:#9ca3af;font-size:12px;">(consulta)</span></span>' +
        '</label>';
    }).join('');
  }
  // Expor globalmente para ser usada pelo admin-script.js se necessário
  if (typeof window.populateConsultablePortalCheckboxes !== 'function') {
    window.populateConsultablePortalCheckboxes = populateConsultablePortalCheckboxes;
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

  // A função patched que sabe lidar com comercial + consultableGroup
  function togglePortalSelectPatched() {
    var role             = document.getElementById('userRole').value;
    var portalGroup      = document.getElementById('portalSelectGroup');
    var multiGroup       = document.getElementById('multiPortalGroup');
    var comGroup         = document.getElementById('comercialPortalGroup');
    var consultableGroup = document.getElementById('consultablePortalGroup') || document.getElementById('consultableGroup');
    var portalSelect     = document.getElementById('userPortal');

    if (portalGroup)      portalGroup.style.display      = 'none';
    if (multiGroup)       multiGroup.style.display       = 'none';
    if (comGroup)         comGroup.style.display         = 'none';
    if (consultableGroup) consultableGroup.style.display = 'none';
    if (portalSelect)     portalSelect.required          = false;
    var tgGroup = document.getElementById('telegramChatIdGroup');
    if (tgGroup) tgGroup.style.display = 'none';

    if (role === 'coordenador') {
      if (multiGroup) multiGroup.style.display = 'block';
      if (typeof populateMultiPortalCheckboxes === 'function') populateMultiPortalCheckboxes();
      // Portais de consulta — só para coordenadores
      if (consultableGroup) consultableGroup.style.display = 'block';
      if (typeof populateConsultablePortalCheckboxes === 'function') populateConsultablePortalCheckboxes();
      // Re-renderizar lista de consulta sempre que coord checkboxes mudam
      setTimeout(function() {
        document.querySelectorAll('.coord-portal-cb').forEach(function(cb) {
          cb.addEventListener('change', function() {
            // Preservar seleções actuais de consulta antes de re-renderizar
            var currentConsultable = Array.from(document.querySelectorAll('.consult-portal-cb:checked, .consultable-portal-cb:checked'))
              .map(function(c) { return parseInt(c.value); });
            populateConsultablePortalCheckboxes(currentConsultable);
          });
        });
      }, 100);
    } else if (role === 'comercial') {
      if (comGroup) comGroup.style.display = 'block';
      populateComercialPortalCheckboxes();
      if (tgGroup) tgGroup.style.display = 'block';
    } else if (role !== 'admin') {
      if (portalGroup)  portalGroup.style.display = 'block';
      if (portalSelect) portalSelect.required     = true;
    }
  }
  window.togglePortalSelect = togglePortalSelectPatched;
  window.onRoleChange       = togglePortalSelectPatched;

  // Substituir o listener do botão "Novo Utilizador"
  function patchAddUserBtn() {
    var btn = document.getElementById('addUserBtn');
    if (!btn) return;
    var newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', function() {
      if (typeof window.prepareNewUserForm === 'function') {
        window.prepareNewUserForm();
        return;
      }
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
    if (typeof baseRenderUsers === 'function') return baseRenderUsers();
  };

  window.editUser = function(id) {
    if (typeof baseEditUser === 'function') return baseEditUser(id);
  };

  function patchForm() {
    var form = document.getElementById('userForm');
    if (!form) return;
    var clone = form.cloneNode(true);
    form.parentNode.replaceChild(clone, form);

    if (typeof window.handleUserFormSubmit === 'function') {
      clone.addEventListener('submit', window.handleUserFormSubmit);
    }
  }

  function init() {
    injectComercialRole();
    injectComercialGroup();
    injectConsultableGroup();
    patchForm();
    patchAddUserBtn();
    // Re-ligar onchange ao role select
    var roleSel = document.getElementById('userRole');
    if (roleSel) {
      var newRoleSel = roleSel.cloneNode(true);
      roleSel.parentNode.replaceChild(newRoleSel, roleSel);
      newRoleSel.addEventListener('change', togglePortalSelectPatched);
    }
    if (typeof window.toggleUserAccessMethod === 'function') {
      window.toggleUserAccessMethod();
    }
    console.log('Patch comercial v6 OK');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 300);
  }

})();
