// ===== SISTEMA DE ALERTA DE VIDROS A ENCOMENDAR =====

// Chave para localStorage
const GLASS_ORDERS_KEY = 'glassOrders';

// Obter estado de encomendas do localStorage
function getGlassOrders() {
  try {
    const data = localStorage.getItem(GLASS_ORDERS_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('Erro ao ler encomendas de vidros:', error);
    return {};
  }
}

// Guardar estado de encomendas no localStorage
function saveGlassOrders(orders) {
  try {
    localStorage.setItem(GLASS_ORDERS_KEY, JSON.stringify(orders));
  } catch (error) {
    console.error('Erro ao guardar encomendas de vidros:', error);
  }
}

// Obter serviços que precisam de vidros para os próximos N dias
function getGlassServicesForNextDays(days = 3) {
  if (typeof appointments === 'undefined') return [];
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const targetDate = new Date(today);
  targetDate.setDate(targetDate.getDate() + days);
  
  // Filtrar serviços:
  // 1. Têm data definida
  // 2. Data está entre hoje e daqui a N dias
  // 3. Status do vidro NÃO é "ST" (Serviço Terminado)
  const services = appointments.filter(a => {
    if (!a.date) return false;
    
    const serviceDate = new Date(a.date + 'T00:00:00');
    serviceDate.setHours(0, 0, 0, 0);
    
    // Verificar se está no intervalo
    if (serviceDate < today || serviceDate > targetDate) return false;
    
    // Verificar status do vidro (não deve ser ST)
    if (a.status === 'ST') return false;
    
    return true;
  });
  
  // Ordenar por data
  services.sort((a, b) => {
    const dateA = new Date(a.date + 'T00:00:00');
    const dateB = new Date(b.date + 'T00:00:00');
    return dateA - dateB;
  });
  
  return services;
}

// Verificar se há vidros pendentes de marcar como encomendados
function hasPendingGlassOrders() {
  const services = getGlassServicesForNextDays(3);
  const orders = getGlassOrders();
  
  console.log(`[Glass Alert] Encontrados ${services.length} serviços para próximos 3 dias`);
  
  let pendingCount = 0;
  for (const service of services) {
    const key = `${service.id}_${service.date}`;
    if (!orders[key] || !orders[key].ordered) {
      pendingCount++;
    }
  }
  
  console.log(`[Glass Alert] ${pendingCount} vidros pendentes de marcar`);
  return pendingCount > 0;
}

// Renderizar lista de vidros no modal
function renderGlassAlertList() {
  const services = getGlassServicesForNextDays(3);
  const orders = getGlassOrders();
  const listContainer = document.getElementById('glassAlertList');
  const emptyContainer = document.getElementById('glassAlertEmpty');
  const pendingCountSpan = document.getElementById('glassAlertPendingCount');
  
  if (!listContainer) return;
  
  if (services.length === 0) {
    listContainer.style.display = 'none';
    if (emptyContainer) emptyContainer.style.display = 'block';
    if (pendingCountSpan) pendingCountSpan.textContent = '0';
    return;
  }
  
  listContainer.style.display = 'block';
  if (emptyContainer) emptyContainer.style.display = 'none';
  
  let pendingCount = 0;
  let currentDate = null;
  let html = '';
  
  for (const service of services) {
    const key = `${service.id}_${service.date}`;
    const orderData = orders[key] || { ordered: false };
    const isOrdered = orderData.ordered;
    
    if (!isOrdered) pendingCount++;
    
    // Formatar data
    const serviceDate = new Date(service.date + 'T00:00:00');
    const dateStr = serviceDate.toLocaleDateString('pt-PT', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long',
      year: 'numeric'
    });
    
    // Cabeçalho de data (se mudou)
    if (service.date !== currentDate) {
      if (currentDate !== null) {
        html += '</div>'; // Fechar grupo anterior
      }
      currentDate = service.date;
      html += `
        <div style="margin-bottom: 24px;">
          <div style="background: #f3f4f6; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-weight: 600; color: #374151;">
            📅 ${dateStr}
          </div>
      `;
    }
    
    // Item do serviço
    const rowStyle = isOrdered 
      ? 'background: #d1fae5; border-left: 4px solid #10b981;' 
      : 'background: #fee2e2; border-left: 4px solid #ef4444;';
    
    html += `
      <div style="${rowStyle} padding: 12px; border-radius: 6px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: start; gap: 16px;">
          <div style="flex: 1;">
            <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">
              ${service.plate || '—'} • ${service.car || '—'}
            </div>
            <div style="font-size: 13px; color: #6b7280; display: flex; gap: 12px; flex-wrap: wrap;">
              <span>🔧 ${service.service || '—'}</span>
              <span>📍 ${service.locality || '—'}</span>
              ${service.notes ? `<span>📝 ${service.notes}</span>` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-shrink: 0;">
            <button 
              onclick="toggleGlassOrder('${key}', true)" 
              class="action-btn-small" 
              style="background: ${isOrdered ? '#10b981' : '#e5e7eb'}; color: ${isOrdered ? 'white' : '#6b7280'}; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; border: none; cursor: pointer;"
              title="Marcar como encomendado"
            >
              ✅ Encomendado
            </button>
            <button 
              onclick="toggleGlassOrder('${key}', false)" 
              class="action-btn-small" 
              style="background: ${!isOrdered ? '#ef4444' : '#e5e7eb'}; color: ${!isOrdered ? 'white' : '#6b7280'}; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; border: none; cursor: pointer;"
              title="Marcar como não encomendado"
            >
              ❌ Não Encomendado
            </button>
          </div>
        </div>
      </div>
    `;
  }
  
  if (currentDate !== null) {
    html += '</div>'; // Fechar último grupo
  }
  
  listContainer.innerHTML = html;
  
  if (pendingCountSpan) {
    pendingCountSpan.textContent = pendingCount;
  }
}

// Alternar estado de encomenda de um vidro
function toggleGlassOrder(key, ordered) {
  const orders = getGlassOrders();
  orders[key] = {
    ordered: ordered,
    timestamp: new Date().toISOString()
  };
  saveGlassOrders(orders);
  renderGlassAlertList();
  
  // Mostrar feedback
  const message = ordered ? '✅ Marcado como encomendado' : '❌ Marcado como não encomendado';
  if (typeof showToast === 'function') {
    showToast(message, ordered ? 'success' : 'info');
  }
}

// Abrir modal de alerta de vidros
function openGlassAlertModal() {
  renderGlassAlertList();
  const modal = document.getElementById('glassAlertModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

// Fechar modal de alerta de vidros
function closeGlassAlertModal() {
  const modal = document.getElementById('glassAlertModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Imprimir lista de vidros em nova janela
function printGlassAlert() {
  const services = getGlassServicesForNextDays(3);
  const orders = getGlassOrders();
  
  console.log('[Glass Alert] Preparando impressão de', services.length, 'vidros');
  
  // Gerar data de impressão
  const today = new Date();
  const printDate = today.toLocaleDateString('pt-PT', { 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  // Gerar linhas da tabela
  let tableRows = '';
  for (const service of services) {
    const key = `${service.id}_${service.date}`;
    const orderData = orders[key] || { ordered: false };
    const isOrdered = orderData.ordered;
    
    const serviceDate = new Date(service.date + 'T00:00:00');
    const dateStr = serviceDate.toLocaleDateString('pt-PT', { 
      day: '2-digit', 
      month: '2-digit',
      year: 'numeric'
    });
    
    const checkboxHtml = isOrdered 
      ? '<span style="display: inline-block; width: 18px; height: 18px; border: 2px solid #000; background: #000; color: #fff; text-align: center; line-height: 18px; vertical-align: middle;">✓</span>' 
      : '<span style="display: inline-block; width: 18px; height: 18px; border: 2px solid #000; vertical-align: middle;"></span>';
    
    tableRows += `
      <tr>
        <td>${dateStr}</td>
        <td>${service.plate || '—'}</td>
        <td>${service.car || '—'}</td>
        <td>${service.service || '—'}</td>
        <td>${service.locality || '—'}</td>
        <td>${service.notes || '—'}</td>
        <td style="text-align: center;">${checkboxHtml}</td>
      </tr>
    `;
  }
  
  // Criar HTML completo para nova janela
  const printHtml = `
    <!DOCTYPE html>
    <html lang="pt-PT">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>⚠️ Vidros a Encomendar</title>
      <style>
        @page { 
          margin: 20mm; 
          size: A4 portrait;
        }
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body { 
          font-family: Arial, sans-serif;
          padding: 20px;
        }
        
        .print-header { 
          text-align: center; 
          margin-bottom: 30px;
        }
        
        .print-header h1 { 
          margin: 0 0 10px 0; 
          font-size: 24px;
          font-weight: bold;
        }
        
        .print-header p { 
          margin: 5px 0; 
          color: #666;
          font-size: 14px;
        }
        
        .print-table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-top: 20px;
        }
        
        .print-table th, 
        .print-table td { 
          border: 1px solid #333; 
          padding: 8px 6px; 
          text-align: left;
          font-size: 12px;
        }
        
        .print-table th { 
          background: #e5e7eb; 
          font-weight: bold;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        
        .print-table tr:nth-child(even) { 
          background: #f9fafb;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="print-header">
        <h1>⚠️ Vidros a Encomendar</h1>
        <p>Impresso em ${printDate}</p>
        <p>Próximos 3 dias</p>
      </div>
      
      <table class="print-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Matrícula</th>
            <th>Carro</th>
            <th>Serviço</th>
            <th>Localidade</th>
            <th>Observações</th>
            <th style="width: 80px;">Encomendado</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      
      <script>
        // Imprimir automaticamente ao carregar
        window.onload = function() {
          window.print();
          // Fechar janela após impressão (opcional)
          // window.onafterprint = function() { window.close(); };
        };
      </script>
    </body>
    </html>
  `;
  
  // Abrir nova janela com o conteúdo
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (printWindow) {
    printWindow.document.write(printHtml);
    printWindow.document.close();
    console.log('[Glass Alert] Nova janela de impressão aberta');
  } else {
    alert('⚠️ Não foi possível abrir a janela de impressão. Verifique se o bloqueador de pop-ups está desativado.');
    console.error('[Glass Alert] Falha ao abrir janela de impressão');
  }
}

// Verificar e mostrar alerta automaticamente ao carregar (apenas desktop)
function checkAndShowGlassAlert() {
  // Verificar se é desktop (largura > 768px)
  const isDesktop = window.innerWidth > 768;
  if (!isDesktop) return;
  
  // Verificar se há vidros pendentes
  if (hasPendingGlassOrders()) {
    // Aguardar um pouco para garantir que tudo está carregado
    setTimeout(() => {
      openGlassAlertModal();
    }, 1000);
  }
}

// Limpar encomendas antigas (opcional - manter apenas últimos 30 dias)
function cleanOldGlassOrders() {
  const orders = getGlassOrders();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  let changed = false;
  for (const key in orders) {
    const parts = key.split('_');
    if (parts.length === 2) {
      const dateStr = parts[1];
      const date = new Date(dateStr + 'T00:00:00');
      if (date < thirtyDaysAgo) {
        delete orders[key];
        changed = true;
      }
    }
  }
  
  if (changed) {
    saveGlassOrders(orders);
  }
}

// Inicializar ao carregar a página
if (typeof window !== 'undefined') {
  // Aguardar que os dados estejam carregados
  function waitForAppointments() {
    if (typeof appointments !== 'undefined' && Array.isArray(appointments)) {
      console.log('[Glass Alert] Dados carregados, verificando vidros...');
      // Limpar encomendas antigas
      cleanOldGlassOrders();
      
      // Verificar e mostrar alerta
      checkAndShowGlassAlert();
    } else {
      console.log('[Glass Alert] Aguardando dados...');
      setTimeout(waitForAppointments, 500);
    }
  }
  
  window.addEventListener('DOMContentLoaded', () => {
    console.log('[Glass Alert] DOM carregado, aguardando dados...');
    waitForAppointments();
  });
  
  // Também tentar após load completo
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (typeof appointments !== 'undefined') {
        console.log('[Glass Alert] Load completo, verificando novamente...');
        checkAndShowGlassAlert();
      }
    }, 2000);
  });
}

