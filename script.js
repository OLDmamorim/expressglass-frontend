// ===== PORTAL DE AGENDAMENTO MELHORADO =====
// Versão com localStorage + funcionalidades aprimoradas

// Configurações e dados
const localityColors = {
  'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
  'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
  'Póvoa de Varzim': '#6EE7B7', 'Riba D\'Ave': '#FBBF24', 'Trofa': '#C084FC',
  'Vieira do Minho': '#93C5FD', 'Vila do Conde': '#FCD34D', 'Vila Verde': '#86EFAC'
};

// Expor mapa para outros scripts (skin mobile)
window.LOCALITY_COLORS = localityColors;

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) return localISO(date);
  } catch (e) {
    console.warn('Erro ao converter data:', dateStr, e);
  }
  return '';
}

function formatDateForInput(dateStr) {
  if (!dateStr) return '';
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

function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

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
  items.forEach((item, index) => { item.sortIndex = index + 1; });
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 4000);
}

// ===== FORMATAÇÃO DE MATRÍCULA =====
function formatPlate(input) {
  let value = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (value.length > 2) value = value.slice(0, 2) + '-' + value.slice(2);
  if (value.length > 5) value = value.slice(0, 5) + '-' + value.slice(5, 7);
  input.value = value;
}

// ===== ARMAZENAMENTO =====
async function save() {
  try {
    showToast('Dados sincronizados com sucesso!', 'success');
  } catch (error) {
    showToast('Erro na sincronização: ' + error.message, 'error');
  }
}

async function load() {
  try {
    showToast('Carregando dados...', 'info');
    appointments = await window.apiClient.getAppointments();

    appointments.forEach(a => { if (!a.id) a.id = Date.now() + Math.random(); if (!a.sortIndex) a.sortIndex = 1; });

    const localitiesData = await window.apiClient.getLocalities();
    if (localitiesData && typeof localitiesData === 'object') {
      Object.assign(localityColors, localitiesData);
      window.LOCALITY_COLORS = localityColors; // manter global atualizado
    }

    const status = window.apiClient.getConnectionStatus();
    const statusMsg = status.online ? 'Dados carregados da cloud!' : 'Dados carregados localmente (offline)';
    showToast(statusMsg, status.online ? 'success' : 'warning');
  } catch (error) {
    appointments = [];
    showToast('Erro ao carregar dados: ' + error.message, 'error');
  }
}

// ===== PESQUISA E FILTROS =====
function filterAppointments(list) {
  let filtered = [...list];
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(a =>
      a.plate.toLowerCase().includes(query) ||
      a.car.toLowerCase().includes(query) ||
      a.locality.toLowerCase().includes(query) ||
      (a.notes && a.notes.toLowerCase().includes(query))
    );
  }
  if (statusFilter) filtered = filtered.filter(a => a.status === statusFilter);
  return filtered;
}

function highlightSearchResults() {
  if (!searchQuery) return;
  document.querySelectorAll('.appointment').forEach(el => {
    el.classList.remove('highlight');
    const text = el.textContent.toLowerCase();
    if (text.includes(searchQuery.toLowerCase())) el.classList.add('highlight');
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
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
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
  if (targetBucket === 'unscheduled