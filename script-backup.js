// ===== FUNÇÃO PARA VERIFICAR MATRÍCULA EXISTENTE =====
function setupPlateVerification() {
  const plateInput = document.getElementById('appointmentPlate');
  if (!plateInput) return;

  // Remover listeners anteriores para evitar duplicação
  const newPlateInput = plateInput.cloneNode(true);
  plateInput.parentNode.replaceChild(newPlateInput, plateInput);

  // Adicionar listener para verificação em tempo real
  newPlateInput.addEventListener('input', function(e) {
    let value = e.target.value.toUpperCase();
    
    // Formatação automática XX-XX-XX
    value = value.replace(/[^A-Z0-9]/g, '');
    if (value.length > 2 && value.length <= 4) {
      value = value.slice(0, 2) + '-' + value.slice(2);
    } else if (value.length > 4) {
      value = value.slice(0, 2) + '-' + value.slice(2, 4) + '-' + value.slice(4, 6);
    }
    
    e.target.value = value;
    
    // Verificar se matrícula existe quando tiver formato completo
    if (value.length === 8 && value.match(/^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/)) {
      checkExistingPlate(value);
    }
  });

  // Verificar também quando o campo perde o foco
  newPlateInput.addEventListener('blur', function(e) {
    const value = e.target.value;
    if (value.length === 8 && value.match(/^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/)) {
      checkExistingPlate(value);
    }
  });
}

// ===== VERIFICAR SE MATRÍCULA JÁ EXISTE =====
function checkExistingPlate(plate) {
  console.log(`🔍 Verificando matrícula: ${plate}`);
  
  // Normalizar matrícula para comparação (remover hífens)
  const normalizedPlate = plate.replace(/-/g, '');
  
  // Procurar nos serviços por agendar (sem data)
  const existingService = appointments.find(appointment => {
    if (appointment.date) return false; // Ignorar serviços já agendados
    
    const existingPlateNormalized = (appointment.plate || '').replace(/-/g, '');
    return existingPlateNormalized === normalizedPlate;
  });
  
  if (existingService) {
    console.log(`✅ Matrícula encontrada! Carregando dados existentes...`, existingService);
    
    // Mostrar notificação ao utilizador
    showPlateExistsNotification(plate);
    
    // Carregar dados da ficha existente
    loadExistingServiceData(existingService);
  } else {
    console.log(`ℹ️ Matrícula ${plate} não encontrada. Novo serviço.`);
    
    // Limpar notificação se existir
    hidePlateExistsNotification();
  }
}

// ===== MOSTRAR NOTIFICAÇÃO DE MATRÍCULA EXISTENTE =====
function showPlateExistsNotification(plate) {
  // Remover notificação anterior se existir
  hidePlateExistsNotification();
  
  const plateInput = document.getElementById('appointmentPlate');
  if (!plateInput) return;
  
  // Criar elemento de notificação
  const notification = document.createElement('div');
  notification.id = 'plateExistsNotification';
  notification.className = 'plate-exists-notification';
  notification.innerHTML = `
    <div class="notification-content">
      <span class="notification-icon">ℹ️</span>
      <span class="notification-text">Matrícula <strong>${plate}</strong> já existe. Carregando dados existentes...</span>
    </div>
  `;
  
  // Inserir após o campo de matrícula
  plateInput.parentNode.insertBefore(notification, plateInput.nextSibling);
  
  // Adicionar estilo se não existir
  if (!document.getElementById('plateNotificationStyles')) {
    const style = document.createElement('style');
    style.id = 'plateNotificationStyles';
    style.textContent = `
      .plate-exists-notification {
        background: #e3f2fd;
        border: 1px solid #2196f3;
        border-radius: 4px;
        padding: 8px 12px;
        margin-top: 5px;
        font-size: 14px;
        color: #1976d2;
        animation: slideDown 0.3s ease-out;
      }
      
      .notification-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .notification-icon {
        font-size: 16px;
      }
      
      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }
}

// ===== ESCONDER NOTIFICAÇÃO =====
function hidePlateExistsNotification() {
  const notification = document.getElementById('plateExistsNotification');
  if (notification) {
    notification.remove();
  }
}

// ===== CARREGAR DADOS DO SERVIÇO EXISTENTE =====
function loadExistingServiceData(service) {
  console.log(`📋 Carregando dados do serviço:`, service);
  
  // Definir que estamos editando este serviço
  editingId = service.id;
  
  // Alterar título do modal
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) {
    modalTitle.textContent = 'Editar Agendamento Existente';
  }
  
  // Mostrar botão de eliminar
  const deleteBtn = document.getElementById('deleteAppointment');
  if (deleteBtn) {
    deleteBtn.classList.remove('hidden');
  }
  
  // Preencher campos do formulário
  const fields = {
    'appointmentDate': service.date || '',
    'appointmentPlate': service.plate || '',
    'appointmentCar': service.car || '',
    'appointmentLocality': service.locality || '',
    'appointmentService': service.service || '',
    'appointmentStatus': service.status || 'NE',
    'appointmentNotes': service.notes || '',
    'appointmentAddress': service.address || '',
    'appointmentPhone': service.phone || '',
    'appointmentKm': service.km || '',
    'appointmentExtra': service.extra || ''
  };
  
  // Preencher cada campo
  Object.entries(fields).forEach(([fieldId, value]) => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.value = value;
      
      // Disparar evento change para atualizar dropdowns customizados
      if (field.tagName === 'SELECT') {
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
  
  console.log(`✅ Dados carregados com sucesso para edição`);
}

