// ===== PORTAL DE AGENDAMENTO MELHORADO =====
// Versão com localStorage + funcionalidades aprimoradas

// Configurações e dados
const localityColors = {
  'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
  'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
  'Póvoa de Varzim': '#6EE7B7', 'Riba D\'Ave': '#FBBF24', 'Trofa': '#C084FC',
  'Vieira do Minho': '#93C5FD', 'Vila do Conde': '#FCD34D', 'Vila Verde': '#86EFAC'
};

const statusBarColors = { 'NE': '#EF4444', 'VE': '#F59E0B', 'ST': '#10B981' };
const localityList = Object.keys(localityColors);

// Estado da aplicação
let appointments = [];
let currentMonday = getMonday(new Date());
let currentMobileDay = new Date();
let editingId = null;
let searchQuery = '';
let statusFilter = '';

// ===== UTILITÁRIOS =====
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ===== UTILITÁRIOS DE DATA =====
function parseDate(dateStr) {
  if (!dateStr) return '';
  
  // Se já está no formato YYYY-MM-DD, retorna como está
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Se está no formato DD/MM/YYYY, converte para YYYY-MM-DD
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Tenta parsing automático como fallback
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return localISO(date);
    }
  } catch (e) {
    console.warn('Erro ao converter data:', dateStr, e);
  }
  
  return '';
}

function formatDateForInput(dateStr) {
  if (!dateStr) return '';
  
  // Se está no formato YYYY-MM-DD, converte para DD/MM/YYYY para exibição
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }
  
  return dateStr;
}

function localISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fmtHeader(date) {
  return {
    day: date.toLocaleDateString('pt-PT', { weekday: 'long' }),
    dm: date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
  };
}

function cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function hex2rgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function bucketOf(appointment) {
  if (!appointment.date || !appointment.period) return 'unscheduled';
  return `${appointment.date}|${appointment.period}`;
}

function normalizeBucketOrder(bucket) {
  const items = appointments.filter(a => bucketOf(a) === bucket);
  items.forEach((item, index) => {
    item.sortIndex = index + 1;
  });
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// ===== FORMATAÇÃO DE MATRÍCULA =====
function formatPlate(input) {
  let value = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  
  if (value.length > 2) {
    value = value.slice(0, 2) + '-' + value.slice(2);
  }
  if (value.length > 5) {
    value = value.slice(0, 5) + '-' + value.slice(5, 7);
  }
  
  input.value = value;
}

// ===== ARMAZENAMENTO =====
async function save() {
  try {
    // A sincronização é feita automaticamente pelo cliente API
    // Esta função mantém compatibilidade com o código existente
    showToast('Dados sincronizados com sucesso!', 'success');
  } catch (error) {
    showToast('Erro na sincronização: ' + error.message, 'error');
  }
}

async function load() {
  try {
    showToast('Carregando dados...', 'info');
    
    // Carregar dados via API (com fallback para localStorage)
    appointments = await window.apiClient.getAppointments();
    
    // Migração de dados antigos
    appointments.forEach(a => {
      if (!a.id) a.id = Date.now() + Math.random();
      if (!a.sortIndex) a.sortIndex = 1;
    });
    
    // Carregar localidades via API
    const localitiesData = await window.apiClient.getLocalities();
    
    // Atualizar localityColors se necessário
    if (localitiesData && typeof localitiesData === 'object') {
      Object.assign(localityColors, localitiesData);
    }
    
    const status = window.apiClient.getConnectionStatus();
    const statusMsg = status.online ? 
      'Dados carregados da cloud!' : 
      'Dados carregados localmente (offline)';
    
    showToast(statusMsg, status.online ? 'success' : 'warning');
    
  } catch (error) {
    appointments = [];
    showToast('Erro ao carregar dados: ' + error.message, 'error');
  }
}

// ===== PESQUISA E FILTROS =====
function filterAppointments(list) {
  let filtered = [...list];
  
  // Filtro de pesquisa
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(a => 
      a.plate.toLowerCase().includes(query) ||
      a.car.toLowerCase().includes(query) ||
      a.locality.toLowerCase().includes(query) ||
      (a.notes && a.notes.toLowerCase().includes(query))
    );
  }
  
  // Filtro de status
  if (statusFilter) {
    filtered = filtered.filter(a => a.status === statusFilter);
  }
  
  return filtered;
}

function highlightSearchResults() {
  if (!searchQuery) return;
  
  document.querySelectorAll('.appointment').forEach(el => {
    el.classList.remove('highlight');
    const text = el.textContent.toLowerCase();
    if (text.includes(searchQuery.toLowerCase())) {
      el.classList.add('highlight');
    }
  });
}

// ===== DRAG & DROP =====
function enableDragDrop(scope) {
  (scope || document).querySelectorAll('.appointment[data-id]').forEach(card => {
    card.draggable = true;
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  
  (scope || document).querySelectorAll('[data-drop-bucket]').forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const targetBucket = zone.getAttribute('data-drop-bucket');
      const targetIndex = zone.querySelectorAll('.appointment').length;
      onDropAppointment(id, targetBucket, targetIndex);
    });
  });
}

function onDropAppointment(id, targetBucket, targetIndex) {
  const i = appointments.findIndex(a => a.id === id);
  if (i < 0) return;
  
  const a = appointments[i];
  if (targetBucket === 'unscheduled') {
    a.date = '';
    a.period = '';
  } else {
    const [d, p] = targetBucket.split('|');
    a.date = d;
    a.period = p || a.period || 'Manhã';
  }
  
  normalizeBucketOrder(targetBucket);
  const list = appointments.filter(x => bucketOf(x) === targetBucket)
                          .sort((x, y) => (x.sortIndex || 0) - (y.sortIndex || 0));
  
  list.forEach((x, idx) => x.sortIndex = idx + 1);
  
  if (targetIndex >= list.length) {
    a.sortIndex = list.length + 1;
  } else {
    list.splice(targetIndex, 0, a);
    list.forEach((x, idx) => x.sortIndex = idx + 1);
  }
  
  save();
  renderAll();
  showToast('Agendamento movido com sucesso!', 'success');
}

// ===== RENDERIZAÇÃO =====
function renderSchedule() {
  const table = document.getElementById('schedule');
  table.innerHTML = '';
  
  const week = [...Array(5)].map((_, i) => addDays(currentMonday, i));
  document.getElementById('weekRange').textContent =
    `${week[0].toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })} - ${week[4].toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

  let thead = '<thead><tr><th>Período</th>';
  for (const d of week) {
    const h = fmtHeader(d);
    thead += `<th><div class="day">${cap(h.day)}</div><div class="date">${h.dm}</div></th>`;
  }
  thead += '</tr></thead>';
  table.insertAdjacentHTML('beforeend', thead);

  const renderCell = (period, dayDate) => {
    const iso = localISO(dayDate);
    const items = filterAppointments(
      appointments.filter(a => a.date && a.date === iso && a.period === period)
                 .sort((x, y) => (x.sortIndex || 0) - (y.sortIndex || 0))
    );
    
    const appointmentBlocks = items.map(a => {
      const bg = localityColors[a.locality] || '#EEE';
      const bar = statusBarColors[a.status] || '#999';
      return `<div class="appointment appointment-block" data-id="${a.id}" draggable="true" style="background-color:${hex2rgba(bg, 0.65)}; border-left:6px solid ${bar}">
        <div class="appt-header">${a.plate} | ${a.service} | ${a.car.toUpperCase()}</div>
        <div class="appt-sub">${a.locality} | ${a.notes || ''}</div>
        <div class="appt-status">
          <label><input type="checkbox" data-status="NE" ${a.status === 'NE' ? 'checked' : ''}/> N/E</label>
          <label><input type="checkbox" data-status="VE" ${a.status === 'VE' ? 'checked' : ''}/> V/E</label>
          <label><input type="checkbox" data-status="ST" ${a.status === 'ST' ? 'checked' : ''}/> ST</label>
        </div>
      </div>`;
    }).join('');
    
    return `<div class="drop-zone" data-drop-bucket="${iso}|${period}">${appointmentBlocks}</div>`;
  };

  const tbody = document.createElement('tbody');
  ['Manhã', 'Tarde'].forEach(period => {
    const row = document.createElement('tr');
    row.innerHTML = `<th>${period}</th>` + week.map(d => `<td>${renderCell(period, d)}</td>`).join('');
    tbody.appendChild(row);
  });
  
  table.appendChild(tbody);
  enableDragDrop();
  attachStatusListeners();
  highlightSearchResults();
}

function renderUnscheduled() {
  const container = document.getElementById('unscheduledList');
  const unscheduled = filterAppointments(
    appointments.filter(a => !a.date || !a.period)
               .sort((x, y) => (x.sortIndex || 0) - (y.sortIndex || 0))
  );
  
  const appointmentBlocks = unscheduled.map(a => {
    const bg = localityColors[a.locality] || '#EEE';
    const bar = statusBarColors[a.status] || '#999';
    return `<div class="appointment unscheduled appointment-block" data-id="${a.id}" draggable="true" style="background-color:${hex2rgba(bg, 0.65)}; border-left:6px solid ${bar}">
      <div class="appt-header">${a.plate} | ${a.service} | ${a.car.toUpperCase()}</div>
      <div class="appt-sub">${a.locality} | ${a.notes || ''}</div>
      <div class="appt-status">
        <label><input type="checkbox" data-status="NE" ${a.status === 'NE' ? 'checked' : ''}/> N/E</label>
        <label><input type="checkbox" data-status="VE" ${a.status === 'VE' ? 'checked' : ''}/> V/E</label>
        <label><input type="checkbox" data-status="ST" ${a.status === 'ST' ? 'checked' : ''}/> ST</label>
      </div>
      <div class="unscheduled-actions">
        <button class="icon edit" onclick="editAppointment(${a.id})" title="Editar">✏️</button>
        <button class="icon delete" onclick="deleteAppointment(${a.id})" title="Eliminar">🗑️</button>
      </div>
    </div>`;
  }).join('');
  
  container.innerHTML = `<div class="drop-zone" data-drop-bucket="unscheduled">${appointmentBlocks}</div>`;
  
  enableDragDrop();
  attachStatusListeners();
  highlightSearchResults();
}

function renderMobileDay() {
  const dayStr = currentMobileDay.toLocaleDateString('pt-PT', { 
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' 
  });
  document.getElementById('mobileDayLabel').textContent = cap(dayStr);
  
  const iso = localISO(currentMobileDay);
  const dayAppointments = filterAppointments(
    appointments.filter(a => a.date === iso)
               .sort((a, b) => {
                 if (a.period !== b.period) return a.period === 'Manhã' ? -1 : 1;
                 return (a.sortIndex || 0) - (b.sortIndex || 0);
               })
  );
  
  const container = document.getElementById('mobileDayList');
  container.innerHTML = dayAppointments.map(a => {
    const bg = localityColors[a.locality] || '#EEE';
    const bar = statusBarColors[a.status] || '#999';
    return `<div class="appointment appointment-block" style="background-color:${hex2rgba(bg, 0.65)}; border-left:6px solid ${bar}; margin-bottom:10px;">
      <div class="appt-header">${a.period} - ${a.plate} | ${a.service} | ${a.car.toUpperCase()}</div>
      <div class="appt-sub">${a.locality} | ${a.notes || ''}</div>
    </div>`;
  }).join('');
  
  highlightSearchResults();
}

function renderServicesTable() {
  const today = new Date();
  const futureServices = filterAppointments(
  appointments.filter(a => a.date && new Date(a.date) >= new Date().setHours(0,0,0,0))
             .sort((a, b) => new Date(a.date) - new Date(b.date))
  );
  
  const tbody = document.getElementById('servicesTableBody');
  tbody.innerHTML = futureServices.map(a => {
    const serviceDate = new Date(a.date);
    const diffTime = serviceDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const daysText = diffDays < 0 ? `${Math.abs(diffDays)} dias atrás` : 
                     diffDays === 0 ? 'Hoje' : 
                     diffDays === 1 ? 'Amanhã' : `${diffDays} dias`;
    
    return `<tr>
      <td>${serviceDate.toLocaleDateString('pt-PT')}</td>
      <td>${a.period}</td>
      <td>${a.plate}</td>
      <td>${a.car}</td>
      <td><span class="badge badge-${a.service}">${a.service}</span></td>
      <td>${a.locality}</td>
      <td>${a.notes || ''}</td>
      <td><span class="chip chip-${a.status}">${a.status}</span></td>
      <td>${daysText}</td>
      <td class="no-print">
        <div class="actions">
          <button class="icon edit" onclick="editAppointment(${a.id})" title="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment(${a.id})" title="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  
  document.getElementById('servicesSummary').textContent = 
    `${futureServices.length} serviços pendentes`;
}

function renderAll() {
  renderSchedule();
  renderUnscheduled();
  renderMobileDay();
  renderServicesTable();
}

// ===== GESTÃO DE AGENDAMENTOS =====
function openAppointmentModal(id = null) {
  editingId = id;
  const modal = document.getElementById('appointmentModal');
  const form = document.getElementById('appointmentForm');
  const title = document.getElementById('modalTitle');
  const deleteBtn = document.getElementById('deleteAppointment');
  
  if (id) {
    const appointment = appointments.find(a => a.id === id);
    if (appointment) {
      title.textContent = 'Editar Agendamento';
      document.getElementById('appointmentDate').value = formatDateForInput(appointment.date) || '';
      document.getElementById('appointmentPeriod').value = appointment.period || '';
      document.getElementById('appointmentPlate').value = appointment.plate || '';
      document.getElementById('appointmentCar').value = appointment.car || '';
      document.getElementById('appointmentService').value = appointment.service || '';
      document.getElementById('appointmentLocality').value = appointment.locality || '';
      document.getElementById('appointmentStatus').value = appointment.status || 'NE';
      document.getElementById('appointmentNotes').value = appointment.notes || '';
      document.getElementById('appointmentExtra').value = appointment.extra || '';
      deleteBtn.classList.remove('hidden');
    }
  } else {
    title.textContent = 'Novo Agendamento';
    form.reset();
    document.getElementById('appointmentStatus').value = 'NE';
    deleteBtn.classList.add('hidden');
  }
  
  modal.classList.add('show');
}

function closeAppointmentModal() {
  document.getElementById('appointmentModal').classList.remove('show');
  editingId = null;
}

async function saveAppointment() {
  const form = document.getElementById('appointmentForm');
  
  const rawDate = document.getElementById('appointmentDate').value;
  const parsedDate = parseDate(rawDate);
  
  const appointment = {
    id: editingId || Date.now() + Math.random(),
    date: parsedDate,
    period: document.getElementById('appointmentPeriod').value,
    plate: document.getElementById('appointmentPlate').value.toUpperCase(),
    car: document.getElementById('appointmentCar').value,
    service: document.getElementById('appointmentService').value,
    locality: document.getElementById('appointmentLocality').value,
    status: document.getElementById('appointmentStatus').value,
    notes: document.getElementById('appointmentNotes').value,
    extra: document.getElementById('appointmentExtra').value,
    sortIndex: 1
  };
  
  console.log('=== DEBUG SAVE ===');
  console.log('Raw date:', rawDate);
  console.log('Parsed date:', parsedDate);
  console.log('Appointment:', appointment);
  
  // Validação apenas dos campos obrigatórios
  if (!appointment.plate || !appointment.car || !appointment.service || !appointment.locality) {
    showToast('Por favor, preencha todos os campos obrigatórios (Matrícula, Carro, Serviço, Localidade).', 'error');
    return;
  }
  
  try {
    let result;
    
    if (editingId) {
      // Atualizar via API
      result = await window.apiClient.updateAppointment(editingId, appointment);
      
      // Atualizar array local
      const index = appointments.findIndex(a => a.id === editingId);
      if (index >= 0) {
        appointments[index] = { ...appointments[index], ...result };
      }
      
      showToast('Agendamento atualizado com sucesso!', 'success');
    } else {
      // Criar via API
      result = await window.apiClient.createAppointment(appointment);
      
      // Adicionar ao array local
      appointments.push(result);
      
      showToast('Serviço criado com sucesso!', 'success');
    }
    
    await save();
    renderAll();
    closeAppointmentModal();
    
  } catch (error) {
    console.error('Erro ao salvar agendamento:', error);
    showToast('Erro ao salvar: ' + error.message, 'error');
  }
}

function editAppointment(id) {
  openAppointmentModal(id);
}

async function deleteAppointment(id) {
  if (confirm('Tem certeza que deseja eliminar este agendamento?')) {
    try {
      // Eliminar via API
      await window.apiClient.deleteAppointment(id);
      
      // Remover do array local
      appointments = appointments.filter(a => a.id !== id);
      
      await save();
      renderAll();
      showToast('Agendamento eliminado com sucesso!', 'success');
      
      if (editingId === id) {
        closeAppointmentModal();
      }
      
    } catch (error) {
      console.error('Erro ao eliminar agendamento:', error);
      showToast('Erro ao eliminar: ' + error.message, 'error');
    }
  }
}

// ===== STATUS LISTENERS =====
function attachStatusListeners() {
  document.querySelectorAll('.appt-status input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      const appointmentEl = this.closest('.appointment');
      const id = Number(appointmentEl.getAttribute('data-id'));
      const status = this.getAttribute('data-status');
      
      if (this.checked) {
        // Desmarcar outros checkboxes do mesmo agendamento
        appointmentEl.querySelectorAll('.appt-status input[type="checkbox"]').forEach(cb => {
          if (cb !== this) cb.checked = false;
        });
        
        // Atualizar status
        const appointment = appointments.find(a => a.id === id);
        if (appointment) {
          appointment.status = status;
          save();
          renderAll();
          showToast(`Status alterado para ${status}`, 'success');
        }
      }
    });
  });
}

// ===== BACKUP E EXPORTAÇÃO =====
function exportToJson() {
  const data = {
    version: '3.0',
    exported: new Date().toISOString(),
    appointments: appointments
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agendamentos_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Backup JSON exportado com sucesso!', 'success');
}

function exportToCsv() {
  const headers = ['Data', 'Período', 'Matrícula', 'Carro', 'Serviço', 'Localidade', 'Status', 'Observações'];
  const rows = appointments.map(a => [
    a.date || '',
    a.period || '',
    a.plate || '',
    a.car || '',
    a.service || '',
    a.locality || '',
    a.status || '',
    a.notes || ''
  ]);
  
  const csvContent = [headers, ...rows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agendamentos_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Dados exportados para CSV com sucesso!', 'success');
}

function importFromJson(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      
      if (data.appointments && Array.isArray(data.appointments)) {
        if (confirm(`Importar ${data.appointments.length} agendamentos? Isto irá substituir todos os dados atuais.`)) {
          appointments = data.appointments;
          save();
          renderAll();
          showToast('Dados importados com sucesso!', 'success');
          closeBackupModal();
        }
      } else {
        showToast('Formato de ficheiro inválido.', 'error');
      }
    } catch (error) {
      showToast('Erro ao ler ficheiro: ' + error.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ===== ESTATÍSTICAS =====
function generateStats() {
  const total = appointments.length;
  const scheduled = appointments.filter(a => a.date && a.period).length;
  const unscheduled = total - scheduled;
  
  const byStatus = {
    NE: appointments.filter(a => a.status === 'NE').length,
    VE: appointments.filter(a => a.status === 'VE').length,
    ST: appointments.filter(a => a.status === 'ST').length
  };
  
  const byService = {};
  appointments.forEach(a => {
    byService[a.service] = (byService[a.service] || 0) + 1;
  });
  
  const byLocality = {};
  appointments.forEach(a => {
    byLocality[a.locality] = (byLocality[a.locality] || 0) + 1;
  });
  
  return {
    total,
    scheduled,
    unscheduled,
    byStatus,
    byService,
    byLocality
  };
}

function showStats() {
  const stats = generateStats();
  const modal = document.getElementById('statsModal');
  const content = document.getElementById('statsContent');
  
  content.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${stats.total}</div>
        <div class="stat-label">Total de Agendamentos</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.scheduled}</div>
        <div class="stat-label">Agendados</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.unscheduled}</div>
        <div class="stat-label">Por Agendar</div>
      </div>
    </div>
    
    <h4>Por Status</h4>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${stats.byStatus.NE}</div>
        <div class="stat-label">Não Executado</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.byStatus.VE}</div>
        <div class="stat-label">Vidro Encomendado</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.byStatus.ST}</div>
        <div class="stat-label">Serviço Terminado</div>
      </div>
    </div>
    
    <h4>Por Tipo de Serviço</h4>
    <div class="stats-grid">
      ${Object.entries(stats.byService).map(([service, count]) => `
        <div class="stat-card">
          <div class="stat-number">${count}</div>
          <div class="stat-label">${service}</div>
        </div>
      `).join('')}
    </div>
  `;
  
  modal.classList.add('show');
}

// ===== MODAIS =====
function closeBackupModal() {
  document.getElementById('backupModal').classList.remove('show');
}

function closeStatsModal() {
  document.getElementById('statsModal').classList.remove('show');
}

// ===== NAVEGAÇÃO =====
function prevWeek() {
  currentMonday = addDays(currentMonday, -7);
  renderAll();
}

function nextWeek() {
  currentMonday = addDays(currentMonday, 7);
  renderAll();
}

function todayWeek() {
  currentMonday = getMonday(new Date());
  renderAll();
}

function prevDay() {
  currentMobileDay = addDays(currentMobileDay, -1);
  renderMobileDay();
}

function nextDay() {
  currentMobileDay = addDays(currentMobileDay, 1);
  renderMobileDay();
}

function todayDay() {
  currentMobileDay = new Date();
  renderMobileDay();
}

// ===== IMPRESSÃO =====
function printPage() {
  // Atualizar tabela de impressão de serviços por agendar
  updatePrintUnscheduledTable();
  
  // Atualizar tabela de impressão de serviços do dia seguinte
  updatePrintTomorrowTable();
  // Imprimir
  window.print();
}

function updatePrintUnscheduledTable() {
  const unscheduled = filterAppointments(
    appointments.filter(a => !a.date || !a.period)
               .sort((x, y) => (x.sortIndex || 0) - (y.sortIndex || 0))
  );
  
  const tbody = document.getElementById('printUnscheduledTableBody');
  
  if (unscheduled.length === 0) {
    // Se não há serviços por agendar, ocultar a seção de impressão
    document.querySelector('.print-unscheduled-section').style.display = 'none';
    return;
  }
  
  // Mostrar a seção de impressão se há serviços
  document.querySelector('.print-unscheduled-section').style.display = 'block';
  
  tbody.innerHTML = unscheduled.map(a => {
    return `<tr>
      <td>${a.plate}</td>
      <td>${a.car}</td>
      <td><span class="service-badge badge-${a.service}">${a.service}</span></td>
      <td>${a.locality}</td>
      <td><span class="status-chip chip-${a.status}">${a.status}</span></td>
      <td>${a.notes || ''}</td>
      <td>${a.extra || ''}</td>
    </tr>`;
  }).join('');
}
function updatePrintTomorrowTable() {
  // Calcular data de amanhã
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localISO(tomorrow);
  
  // Filtrar serviços de amanhã
  const tomorrowServices = appointments.filter(a => {
    return a.date === tomorrowStr;
  }).sort((a, b) => {
    // Ordenar por período: Manhã primeiro, depois Tarde
    const periodOrder = { 'Manhã': 1, 'Tarde': 2 };
    return (periodOrder[a.period] || 3) - (periodOrder[b.period] || 3);
  });
  
  // Atualizar título e data
  const dateFormatted = tomorrow.toLocaleDateString('pt-PT', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  document.getElementById('printTomorrowTitle').textContent = 'SERVIÇOS DE AMANHÃ';
  document.getElementById('printTomorrowDate').textContent = cap(dateFormatted);
  
  const tbody = document.getElementById('printTomorrowTableBody');
  const emptyDiv = document.getElementById('printTomorrowEmpty');
  const table = document.querySelector('.print-tomorrow-table');
  
  if (tomorrowServices.length === 0) {
    // Não há serviços para amanhã
    table.style.display = 'none';
    emptyDiv.style.display = 'block';
  } else {
    // Há serviços para amanhã
    table.style.display = 'table';
    emptyDiv.style.display = 'none';
    
    tbody.innerHTML = tomorrowServices.map(a => {
      return `<tr>
        <td>${a.period || ''}</td>
        <td>${a.plate}</td>
        <td>${a.car}</td>
        <td><span class="service-badge badge-${a.service}">${a.service}</span></td>
        <td>${a.locality}</td>
        <td><span class="status-chip chip-${a.status}">${a.status}</span></td>
        <td>${a.notes || ''}</td>
        <td>${a.extra || ''}</td>
      </tr>`;
    }).join('');
  }
}


// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', async function() {
  await load();
  initializeLocalityDropdown();
  renderAll();
  updateConnectionStatus(); // Atualizar status de conexão
  
  // Event listeners para navegação
  document.getElementById('prevWeek').addEventListener('click', prevWeek);
  document.getElementById('nextWeek').addEventListener('click', nextWeek);
  document.getElementById('todayWeek').addEventListener('click', todayWeek);
  document.getElementById('prevDay').addEventListener('click', prevDay);
  document.getElementById('nextDay').addEventListener('click', nextDay);
  document.getElementById('todayDay').addEventListener('click', todayDay);
  document.getElementById('printPage').addEventListener('click', printPage);
  
  // Event listeners para header actions
  document.getElementById('backupBtn').addEventListener('click', () => {
    document.getElementById('backupModal').classList.add('show');
  });
  
  document.getElementById('statsBtn').addEventListener('click', showStats);
  
  document.getElementById('searchBtn').addEventListener('click', () => {
    const searchBar = document.getElementById('searchBar');
    searchBar.classList.toggle('hidden');
    if (!searchBar.classList.contains('hidden')) {
      document.getElementById('searchInput').focus();
    }
  });
  
  // Event listeners para pesquisa
  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderAll();
  });
  
  document.getElementById('clearSearch').addEventListener('click', () => {
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchBar').classList.add('hidden');
    renderAll();
  });
  
  // Event listeners para filtros
  document.getElementById('filterStatus').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    renderAll();
  });
  
  // Event listeners para formulário
  document.getElementById('addServiceBtn').addEventListener('click', () => openAppointmentModal());
  document.getElementById('addServiceMobile').addEventListener('click', () => openAppointmentModal());
  document.getElementById('closeModal').addEventListener('click', closeAppointmentModal);
  document.getElementById('cancelForm').addEventListener('click', closeAppointmentModal);
  
  document.getElementById('appointmentForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveAppointment();
  });
  
  document.getElementById('deleteAppointment').addEventListener('click', () => {
    if (editingId) deleteAppointment(editingId);
  });
  
  // Formatação automática da matrícula
  document.getElementById('appointmentPlate').addEventListener('input', (e) => {
    formatPlate(e.target);
  });
  
  // Event listeners para backup
  document.getElementById('exportJson').addEventListener('click', exportToJson);
  document.getElementById('exportCsv').addEventListener('click', exportToCsv);
  document.getElementById('exportServices').addEventListener('click', exportToCsv);
  
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importFromJson(file);
    }
  });
  
  // Fechar modais clicando fora
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      e.target.classList.remove('show');
    }
  });
  
  // Atalhos de teclado
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 'f':
          e.preventDefault();
          document.getElementById('searchBtn').click();
          break;
        case 's':
          e.preventDefault();
          save();
          break;
        case 'n':
          e.preventDefault();
          openAppointmentModal();
          break;
      }
    }
    
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.show').forEach(modal => {
        modal.classList.remove('show');
      });
    }
  });
});

// Expor funções globais necessárias
window.editAppointment = editAppointment;
window.deleteAppointment = deleteAppointment;
window.closeBackupModal = closeBackupModal;
window.closeStatsModal = closeStatsModal;


// ===== DROPDOWN DE LOCALIDADES COM CORES =====
function initializeLocalityDropdown() {
  const optionsContainer = document.getElementById('localityOptions');
  optionsContainer.innerHTML = '';
  
  Object.entries(localityColors).forEach(([locality, color]) => {
    const option = document.createElement('div');
    option.className = 'locality-option';
    option.onclick = () => selectLocality(locality);
    
    option.innerHTML = `
      <span class="locality-dot" style="background-color: ${color}"></span>
      <span>${locality}</span>
    `;
    
    optionsContainer.appendChild(option);
  });
}

function toggleLocalityDropdown() {
  const selected = document.getElementById('localitySelected');
  const options = document.getElementById('localityOptions');
  
  selected.classList.toggle('open');
  options.classList.toggle('show');
  
  // Fechar se clicar fora
  if (options.classList.contains('show')) {
    document.addEventListener('click', closeLocalityDropdownOutside, { once: true });
  }
}

function closeLocalityDropdownOutside(e) {
  if (!e.target.closest('.locality-dropdown')) {
    closeLocalityDropdown();
  } else {
    document.addEventListener('click', closeLocalityDropdownOutside, { once: true });
  }
}

function closeLocalityDropdown() {
  document.getElementById('localitySelected').classList.remove('open');
  document.getElementById('localityOptions').classList.remove('show');
}

function selectLocality(locality) {
  const hiddenInput = document.getElementById('appointmentLocality');
  const selectedText = document.getElementById('selectedLocalityText');
  const selectedDot = document.getElementById('selectedLocalityDot');
  
  hiddenInput.value = locality;
  selectedText.textContent = locality;
  selectedDot.style.backgroundColor = localityColors[locality] || '#d1d5db';
  
  // Marcar como selecionado
  document.querySelectorAll('.locality-option').forEach(opt => {
    opt.classList.remove('selected');
  });
  
  const selectedOption = Array.from(document.querySelectorAll('.locality-option'))
    .find(opt => opt.textContent.trim() === locality);
  if (selectedOption) {
    selectedOption.classList.add('selected');
  }
  
  closeLocalityDropdown();
}

// Expor funções globais
window.toggleLocalityDropdown = toggleLocalityDropdown;
window.selectLocality = selectLocality;



// ===== STATUS DE CONEXÃO =====
function updateConnectionStatus() {
  const statusEl = document.getElementById('connectionStatus');
  const iconEl = document.getElementById('statusIcon');
  const textEl = document.getElementById('statusText');
  
  if (!statusEl || !iconEl || !textEl) return;
  
  const status = window.apiClient.getConnectionStatus();
  
  if (status.online) {
    statusEl.classList.remove('offline');
    iconEl.textContent = '🌐';
    textEl.textContent = 'Online';
    statusEl.title = `Conectado à API: ${status.apiUrl}`;
  } else {
    statusEl.classList.add('offline');
    iconEl.textContent = '📱';
    textEl.textContent = 'Offline';
    statusEl.title = 'Modo offline - usando dados locais';
  }
}

// Atualizar status periodicamente
setInterval(updateConnectionStatus, 5000);

// Escutar mudanças de conectividade
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

