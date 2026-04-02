// Versão estabilizada com patches: IDs estáveis, DnD throttle, semana Seg-Sáb, impressão segura, etc.

// ==================
// SCRIPT PRINCIPAL
// ==================

// 🚨 TESTE DE DEPLOY - 25/09/2025 16:00 - SELECT CORRIGIDO
console.log('🔄 VERSÃO SELECT CORRIGIDO - 25/09/2025 16:00 - CARREGA KM + SORTINDEX!');

// ===== BASES DE PARTIDA POR EQUIPA/LOJA =====
// NOTA: A morada de partida é configurada pelo portal-init.js em window.basePartidaDoDia
// Aqui apenas definimos um fallback caso o portal não esteja configurado
const BASES_PARTIDA = {
  SM_BRAGA: "Avenida Robert Smith 59, 4715-249 Braga",
};

// Função para obter a morada de partida (usa configuração do portal ou fallback)
function getBasePartida() {
  const morada = window.basePartidaDoDia || window.portalConfig?.departureAddress || BASES_PARTIDA.SM_BRAGA;
  console.log('📍 Morada de partida:', morada);
  return morada;
}

// ---- Seletores ----
const fileInput  = document.getElementById('fileInput');
const btnUpload  = document.getElementById('btnUpload');

// Pega a API key que já está no script do Google Maps
function getGoogleApiKey() {
  const scripts = document.getElementsByTagName("script");
  for (let s of scripts) {
    if (s.src.includes("maps.googleapis.com/maps/api/js")) {
      const urlParams = new URLSearchParams(s.src.split("?")[1]);
      return urlParams.get("key");
    }
  }
  return null;
}

// ===== FUNÇÃO PARA CALCULAR DISTÂNCIA (versão Google JS API – sem CORS) =====
function getDistance(from, to) {
  return new Promise((resolve) => {
    try {
      if (!window.google || !google.maps || !google.maps.DistanceMatrixService) {
        console.warn("Google Maps JS API não carregada.");
        resolve(Infinity);
        return;
      }
      const svc = new google.maps.DistanceMatrixService();
      svc.getDistanceMatrix(
        {
          origins: [from],
          destinations: [to],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.METRIC,
        },
        (res, status) => {
          if (
            status === "OK" &&
            res?.rows?.[0]?.elements?.[0]?.status === "OK" &&
            res.rows[0].elements[0].distance?.value != null
          ) {
            resolve(res.rows[0].elements[0].distance.value); // metros
          } else {
            console.warn("DistanceMatrix falhou:", status, res?.rows?.[0]?.elements?.[0]?.status);
            resolve(Infinity);
          }
        }
      );
    } catch (err) {
      console.error("Erro a calcular distância:", err);
      resolve(Infinity);
    }
  });
}

// Versão que devolve distância E tempo de viagem do Google
function getDistanceAndTime(from, to) {
  return new Promise((resolve) => {
    try {
      if (!window.google || !google.maps || !google.maps.DistanceMatrixService) {
        resolve({ distance: Infinity, duration: 0 });
        return;
      }
      const svc = new google.maps.DistanceMatrixService();
      svc.getDistanceMatrix(
        {
          origins: [from],
          destinations: [to],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.METRIC,
        },
        (res, status) => {
          if (
            status === "OK" &&
            res?.rows?.[0]?.elements?.[0]?.status === "OK" &&
            res.rows[0].elements[0].distance?.value != null
          ) {
            resolve({
              distance: res.rows[0].elements[0].distance.value, // metros
              duration: Math.round((res.rows[0].elements[0].duration?.value || 0) / 60) // minutos
            });
          } else {
            resolve({ distance: Infinity, duration: 0 });
          }
        }
      );
    } catch (err) {
      resolve({ distance: Infinity, duration: 0 });
    }
  });
}
  

// ===== NORMALIZAR CAMPO MORADA =====
// Usa 'address' se existir; senão tenta 'morada' (para compatibilidade com dados antigos)
function getAddressFromItem(item) {
  const addr = item.address?.trim?.() || item.morada?.trim?.() || "";
  if (addr) return addr;
  return item.locality ? `${item.locality}, Portugal` : "";
}

// ===== ORDENAR EM CADEIA: MAIS LONGE PRIMEIRO =====
// Recebe um array de agendamentos do dia e devolve NOVA lista ordenada
async function ordenarAgendamentosCadeiaMaisLongePrimeiro(agendamentos, origemInicial = null) {
  origemInicial = origemInicial || getBasePartida();
  // Clonar para não mutar o array original
  const restantes = agendamentos.filter(a => getAddressFromItem(a));
  const resultado = [];
  let origem = origemInicial;

  while (restantes.length) {
    // calcular distâncias da 'origem' a todos os restantes (em paralelo)
    const distancias = await Promise.all(
      restantes.map(async (item) => {
        const to = getAddressFromItem(item);
        const d = await getDistance(origem, to);
        return { item, d };
      })
    );

    // escolher o MAIS LONGE (maior distância)
    distancias.sort((a, b) => b.d - a.d);
    const escolhido = distancias[0];

    // colocar no resultado e remover dos 'restantes'
    resultado.push({ ...escolhido.item, _kmFromPrev: Math.round(escolhido.d / 1000) });
    const idx = restantes.indexOf(escolhido.item);
    restantes.splice(idx, 1);

    // próxima origem passa a ser a morada do serviço escolhido
    origem = getAddressFromItem(escolhido.item);
  }

  return resultado;
}

// ===== CONTROLO (apenas staging, SM Braga) =====
const ORDER_ROUTE_SM_BRAGA = true;

// Ordena só os serviços com morada, mantendo os restantes no fim
async function ordenarSeNecessario(lista) {
  if (!ORDER_ROUTE_SM_BRAGA) return lista;

  // tenta detectar SM Braga (ajusta se usares outro campo para equipa)
  const comMorada = lista.filter(i => getAddressFromItem(i));
  if (!comMorada.length) return lista;

  const ordenados = await ordenarAgendamentosCadeiaMaisLongePrimeiro(comMorada, getBasePartida());
  const idsOrdenados = new Set(ordenados.map(x => x.id));
  const restantes = lista.filter(i => !idsOrdenados.has(i.id));
  return [...ordenados, ...restantes];
}

// ===== MODAL DE SELEÇÃO DE DIA =====
function openSelectDayModal() {
  const modal = document.getElementById('selectDayModal');
  const dateInput = document.getElementById('routeCalculationDate');
  
  if (!modal || !dateInput) return;
  
  // Definir data padrão como hoje
  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];
  dateInput.value = todayISO;
  
  // Mostrar modal
  modal.style.display = 'flex';
}

function closeSelectDayModal() {
  const modal = document.getElementById('selectDayModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function confirmCalculateRoutes() {
  const dateInput = document.getElementById('routeCalculationDate');
  
  if (!dateInput || !dateInput.value) {
    showToast('⚠️ Por favor, selecione uma data.', 'error');
    return;
  }
  
  const selectedDate = dateInput.value; // YYYY-MM-DD
  
  // Fechar modal
  closeSelectDayModal();
  
  // Calcular rotas para o dia selecionado
  calculateOptimalRoutesForDay(selectedDate);
}

// ===== OTIMIZAÇÃO DE ROTAS - DIA ESPECÍFICO =====
async function calculateOptimalRoutesForDay(selectedDateISO) {
  try {
    // Mostrar modal de progresso
    showProgressModal();
    updateProgress(0, 'Iniciando otimização...', 'Preparando análise dos serviços...');
    
    // Pequena pausa para mostrar o início
    await new Promise(resolve => setTimeout(resolve, 500));
    
    updateProgress(10, 'Analisando serviços do dia...', 'Contando serviços com morada...');
    
    // Formatar data para exibição
    const selectedDate = new Date(selectedDateISO + 'T00:00:00');
    const dayName = selectedDate.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
    
    // Obter serviços do dia que têm morada
    const dayServices = appointments.filter(a => 
      a.date === selectedDateISO && 
      getAddressFromItem(a)
    );
    
    if (dayServices.length < 2) {
      updateProgress(50, 'Analisando serviços...', `Apenas ${dayServices.length} serviço(s) com morada encontrado(s)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      updateProgress(100, 'Análise concluída', 'Não há serviços suficientes para otimizar rotas');
      await new Promise(resolve => setTimeout(resolve, 1500));
      hideProgressModal();
      showToast(`ℹ️ ${dayName}: Não há serviços suficientes para otimizar (mínimo 2 com morada).`, 'info');
      return;
    }
    
    // Otimizar serviços do dia
    updateProgress(
      50,
      `Otimizando ${dayName}`,
      `${dayServices.length} serviços a reorganizar`
    );
    
    await optimizeDayServices(dayServices);
    
    updateProgress(95, 'Guardando alterações...', 'Sincronizando com a base de dados...');
    
    // Guardar alterações na base de dados
    await saveOptimizedRoutes();
    
    updateProgress(100, 'Concluído!', `${dayServices.length} serviços reorganizados com sucesso`);
    
    // Aguardar um pouco para mostrar 100%
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    hideProgressModal();
    renderAll();
    showToast(`✅ Rotas otimizadas para ${dayName}! ${dayServices.length} serviços reorganizados.`, 'success');
    
  } catch (error) {
    console.error('Erro ao calcular rotas:', error);
    hideProgressModal();
    showToast('❌ Erro ao calcular rotas: ' + error.message, 'error');
  }
}

// ===== OTIMIZAÇÃO DE ROTAS - ALGORITMO PRINCIPAL (SEMANA COMPLETA - DEPRECATED) =====
async function calculateOptimalRoutes() {
  try {
    // Mostrar modal de progresso
    showProgressModal();
    updateProgress(0, 'Iniciando otimização...', 'Preparando análise dos serviços...');
    
    // Pequena pausa para mostrar o início
    await new Promise(resolve => setTimeout(resolve, 500));
    
    updateProgress(10, 'Analisando serviços da semana...', 'Contando serviços com morada...');
    
    // Obter semana atual
    const week = [...Array(6)].map((_, i) => addDays(currentMonday, i));
    let totalOptimized = 0;
    let processedDays = 0;
    
    // Contar total de dias para otimizar
    let totalPeriods = 0;
    for (const dayDate of week) {
      const dayISO = localISO(dayDate);
      // Obter serviços do dia que têm morada
      const dayServices = appointments.filter(a => 
        a.date === dayISO && 
        getAddressFromItem(a)
      );
      
      if (dayServices.length >= 2) totalPeriods++;
    }
    
    if (totalPeriods === 0) {
      updateProgress(50, 'Analisando serviços...', 'Não foram encontrados serviços para otimizar');
      await new Promise(resolve => setTimeout(resolve, 1000));
      updateProgress(100, 'Análise concluída', 'Não há serviços suficientes para otimizar rotas');
      await new Promise(resolve => setTimeout(resolve, 1500));
      hideProgressModal();
      showToast('ℹ️ Não há serviços suficientes para otimizar rotas.', 'info');
      return;
    }
    
    let processedPeriods = 0;
    
    for (const dayDate of week) {
      const dayISO = localISO(dayDate);
      const dayName = dayDate.toLocaleDateString('pt-PT', { weekday: 'long' });
      
      updateProgress(
        Math.round((processedDays / 6) * 50), 
        `Processando ${dayName}...`,
        `Analisando serviços do dia ${processedDays + 1}/6`
      );
      
      // Obter serviços do dia que têm morada
      const dayServices = appointments.filter(a => 
        a.date === dayISO && 
        getAddressFromItem(a)
      );
      
      if (dayServices.length < 2) {
        processedDays++;
        continue;
      }
      
      // Otimizar todos os serviços do dia
      updateProgress(
        Math.round(50 + (processedPeriods / totalPeriods) * 40),
        `Otimizando ${dayName}`,
        `${dayServices.length} serviços a reorganizar`
      );
      await optimizeDayServices(dayServices);
      totalOptimized += dayServices.length;
      processedPeriods++;
      
      processedDays++;
    }
    
    if (totalOptimized > 0) {
      updateProgress(95, 'Guardando alterações...', 'Sincronizando com a base de dados...');
      
      // Guardar alterações na base de dados
      await saveOptimizedRoutes();
      
      updateProgress(100, 'Concluído!', `${totalOptimized} serviços reorganizados com sucesso`);
      
      // Aguardar um pouco para mostrar 100%
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      hideProgressModal();
      renderAll();
      showToast(`✅ Rotas otimizadas! ${totalOptimized} serviços reorganizados.`, 'success');
    } else {
      updateProgress(100, 'Análise concluída', 'Nenhum serviço foi reorganizado');
      await new Promise(resolve => setTimeout(resolve, 1500));
      hideProgressModal();
      showToast('ℹ️ Não há serviços suficientes para otimizar rotas.', 'info');
    }
    
  } catch (error) {
    console.error('Erro ao calcular rotas:', error);
    hideProgressModal();
    showToast('❌ Erro ao calcular rotas: ' + error.message, 'error');
  }
}

// Otimizar serviços de um dia específico
async function optimizeDayServices(services) {
  if (services.length < 2) return;

  const base = getBasePartida();

  // Verificar se há serviço marcado como "Primeiro serviço do dia"
  const pinnedIdx = services.findIndex(s => s.first_of_day);
  const hasPinned = pinnedIdx >= 0;
  const pinned = hasPinned ? services[pinnedIdx] : null;
  // Serviços a optimizar (sem o fixo se existir)
  const toOptimize = hasPinned ? services.filter((_, i) => i !== pinnedIdx) : services;

  // Se só há o fixo, apenas calcular km da base para ele
  if (toOptimize.length === 0 && hasPinned) {
    const idx = appointments.findIndex(a => a.id === pinned.id);
    if (idx >= 0) {
      appointments[idx].sortIndex = 1;
      const r = await getDistanceAndTime(base, getAddressFromItem(pinned));
      appointments[idx].km = r.distance !== Infinity ? Math.round(r.distance / 1000) : 0;
      appointments[idx].travelTime = r.duration || 0;
      appointments[idx]._optimized = true;
    }
    return;
  }

  // Ponto de partida para os restantes: se há fixo, partir dele; senão da base
  const startPoint = hasPinned ? getAddressFromItem(pinned) : base;
  const addresses = toOptimize.map(s => getAddressFromItem(s));
  const n = toOptimize.length;

  const dist = [];
  const time = [];
  for (let i = 0; i <= n; i++) {
    dist.push(new Array(n + 1).fill(Infinity));
    time.push(new Array(n + 1).fill(0));
  }

  // Calcular startPoint → cada serviço
  for (let j = 0; j < n; j++) {
    const r = await getDistanceAndTime(startPoint, addresses[j]);
    dist[0][j + 1] = r.distance;
    time[0][j + 1] = r.duration || 0;
  }

  // Calcular serviço → serviço
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { dist[i+1][j+1] = 0; time[i+1][j+1] = 0; continue; }
      const r = await getDistanceAndTime(addresses[i], addresses[j]);
      dist[i+1][j+1] = r.distance;
      time[i+1][j+1] = r.duration || 0;
    }
  }

  let bestOrder = null;
  let bestTotal = Infinity;

  if (n <= 8) {
    const permutations = getPermutations([...Array(n).keys()]);
    for (const perm of permutations) {
      let total = time[0][perm[0] + 1];
      for (let i = 0; i < perm.length - 1; i++) {
        total += time[perm[i] + 1][perm[i+1] + 1];
      }
      if (total < bestTotal) { bestTotal = total; bestOrder = perm; }
    }
  } else {
    for (let start = 0; start < n; start++) {
      const visited = new Array(n).fill(false);
      const route = [start];
      visited[start] = true;
      let total = time[0][start + 1];
      while (route.length < n) {
        const last = route[route.length - 1];
        let nearest = -1, minT = Infinity;
        for (let j = 0; j < n; j++) {
          if (!visited[j] && time[last + 1][j + 1] < minT) { minT = time[last + 1][j + 1]; nearest = j; }
        }
        if (nearest === -1) break;
        route.push(nearest);
        visited[nearest] = true;
        total += minT;
      }
      if (total < bestTotal) { bestTotal = total; bestOrder = route; }
    }
  }

  if (!bestOrder) return;

  // Se há fixo: calcular km da base→fixo e atribuir sortIndex=1
  if (hasPinned) {
    const pinnedAppIdx = appointments.findIndex(a => a.id === pinned.id);
    if (pinnedAppIdx >= 0) {
      appointments[pinnedAppIdx].sortIndex = 1;
      const r = await getDistanceAndTime(base, getAddressFromItem(pinned));
      appointments[pinnedAppIdx].km = r.distance !== Infinity ? Math.round(r.distance / 1000) : 0;
      appointments[pinnedAppIdx].travelTime = r.duration || 0;
      appointments[pinnedAppIdx]._optimized = true;
    }
  }

  // Restantes: sortIndex começa em 2 se há fixo, 1 se não
  const startSortIndex = hasPinned ? 2 : 1;
  const optimizedRoute = bestOrder.map(i => toOptimize[i]);

  for (let i = 0; i < optimizedRoute.length; i++) {
    const service = optimizedRoute[i];
    const appointmentIndex = appointments.findIndex(a => a.id === service.id);
    if (appointmentIndex < 0) continue;

    appointments[appointmentIndex].sortIndex = startSortIndex + i;

    const fromIdx = i === 0 ? 0 : bestOrder[i - 1] + 1;
    const toIdx   = bestOrder[i] + 1;
    const newKm   = dist[fromIdx][toIdx] !== Infinity ? Math.round(dist[fromIdx][toIdx] / 1000) : 0;
    const travelMin = time[fromIdx][toIdx] || 0;

    appointments[appointmentIndex].km = newKm;
    appointments[appointmentIndex].travelTime = travelMin;
    appointments[appointmentIndex]._optimized = true;
  }
}

// Gera todas as permutações de um array
function getPermutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of getPermutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

// Guardar rotas otimizadas na base de dados
async function saveOptimizedRoutes() {
  const optimizedServices = appointments.filter(a => a._optimized);
  if (optimizedServices.length === 0) return;

  for (const service of optimizedServices) {
    try {
      // Enviar objecto completo — nenhum campo se perde
      await window.apiClient.updateAppointment(service.id, { ...service });
      console.log(`✅ Rota gravada: ${service.plate} calibration=${service.calibration}`);
    } catch (error) {
      console.error('❌ Erro ao guardar rota:', service.plate, error);
      showToast(`Erro ao guardar: ${error.message}`, 'error');
    }
  }

  appointments.forEach(a => delete a._optimized);
}

// ===== FUNÇÕES DO MODAL DE PROGRESSO =====
function showProgressModal() {
  console.log('📊 CRIANDO BARRA DE PROGRESSO SIMPLES');
  
  // Remover barra existente se houver
  const existing = document.getElementById('progressBar');
  if (existing) {
    existing.remove();
  }
  
  // Criar barra de progresso no topo da página
  const progressContainer = document.createElement('div');
  progressContainer.id = 'progressBar';
  progressContainer.innerHTML = `
    <div style="
      background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
      color: white;
      padding: 15px 20px;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      border-radius: 0 0 10px 10px;
      margin: 0 20px 20px 20px;
    ">
      <div style="display: flex; align-items: center; justify-content: center; gap: 15px;">
        <div style="font-size: 20px;">🗺️</div>
        <div>
          <div id="progressText" style="font-weight: 600; margin-bottom: 5px;">Otimizando Rotas...</div>
          <div style="background: rgba(255,255,255,0.2); border-radius: 10px; height: 8px; width: 300px; overflow: hidden;">
            <div id="progressBarFill" style="
              background: white;
              height: 100%;
              width: 0%;
              transition: width 0.3s ease;
              border-radius: 10px;
            "></div>
          </div>
          <div id="progressPercentage" style="font-size: 12px; margin-top: 5px; opacity: 0.9;">0%</div>
        </div>
      </div>
    </div>
  `;
  
  // Posicionar abaixo do cabeçalho
  Object.assign(progressContainer.style, {
    position: 'fixed',
    top: '80px', // Abaixo do cabeçalho azul
    left: '0',
    right: '0',
    zIndex: '10000',
    margin: '0',
    padding: '0'
  });
  
  // Encontrar o cabeçalho e adicionar a barra logo após
  const header = document.querySelector('header') || document.querySelector('.header') || document.body;
  if (header.nextSibling) {
    header.parentNode.insertBefore(progressContainer, header.nextSibling);
  } else {
    header.parentNode.appendChild(progressContainer);
  }
  
  // Ajustar margem do conteúdo principal
  const mainContent = document.querySelector('main') || document.querySelector('.container') || document.body;
  if (mainContent) {
    mainContent.style.marginTop = '20px';
  }
  
  console.log('✅ BARRA DE PROGRESSO CRIADA NO TOPO!');
  
  return progressContainer;
}

function hideProgressModal() {
  const progressBar = document.getElementById('progressBar');
  if (progressBar) {
    progressBar.remove();
    
    // Resetar margens
    const mainContent = document.querySelector('main') || document.querySelector('.container') || document.body;
    if (mainContent) {
      mainContent.style.marginTop = '0';
    }
    
    console.log('✅ Barra de progresso removida');
  }
}

function updateProgress(percentage, text, details) {
  const progressBarFill = document.getElementById('progressBarFill');
  const progressText = document.getElementById('progressText');
  const progressPercentage = document.getElementById('progressPercentage');
  
  if (progressBarFill) {
    progressBarFill.style.width = percentage + '%';
  }
  if (progressText) {
    progressText.textContent = text || 'Otimizando Rotas...';
  }
  if (progressPercentage) {
    progressPercentage.textContent = percentage + '%';
  }
  
  console.log(`📊 Progresso: ${percentage}% - ${text}`);
}

// ---------- Configurações e dados ----------
// Paleta de 25 cores maximamente distintas (testadas para contraste visual)
const _COLOR_PALETTE = [
  '#E63946', // vermelho vivo
  '#1D8CF8', // azul brilhante
  '#2DC653', // verde esmeralda
  '#F77F00', // laranja forte
  '#7B2D8E', // roxo escuro
  '#00B4D8', // ciano/turquesa
  '#E9C46A', // dourado/mostarda
  '#D63384', // magenta/rosa
  '#0B7A3E', // verde floresta
  '#6F42C1', // violeta
  '#FD7E14', // tangerina
  '#20C997', // verde-menta
  '#DC3545', // carmesim
  '#0DCAF0', // azul-gelo
  '#6610F2', // índigo
  '#198754', // verde-bandeira
  '#D35400', // cobre
  '#6C63FF', // lavanda elétrica
  '#C71585', // rosa-choque
  '#17A2B8', // azul-petróleo
  '#8D6E63', // castanho/terra
  '#28B463', // verde-lima escuro
  '#E74C3C', // tomate
  '#3498DB', // azul-céu
  '#9B59B6', // ametista
];

// Hash determinístico do nome (para localidades novas fora da paleta)
function _hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(31, h) + name.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

// Gera cor HSL única para localidades além da paleta
function _generateExtraColor(name) {
  const h = _hashName(name);
  const hue = (h * 137.508) % 360;
  const sat = 60 + (h % 25);       // 60-85%
  const lum = 40 + ((h >> 8) % 20); // 40-60%
  const s = sat / 100, ll = lum / 100;
  const a = s * Math.min(ll, 1 - ll);
  const f = n => { const k = (n + hue / 30) % 12; return Math.round(255 * (ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// === Todos os 308 concelhos de Portugal (Continental + Ilhas) ===
const CONCELHOS_PT = [
  "Águeda","Albergaria-a-Velha","Anadia","Arouca","Aveiro","Castelo de Paiva",
  "Espinho","Estarreja","Ílhavo","Mealhada","Murtosa","Oliveira de Azeméis",
  "Oliveira do Bairro","Ovar","Santa Maria da Feira","São João da Madeira",
  "Sever do Vouga","Vagos","Vale de Cambra",
  "Aljustrel","Almodôvar","Alvito","Barrancos","Beja","Castro Verde","Cuba",
  "Ferreira do Alentejo","Mértola","Moura","Odemira","Ourique","Serpa","Vidigueira",
  "Amares","Barcelos","Braga","Cabeceiras de Basto","Celorico de Basto",
  "Esposende","Fafe","Guimarães","Póvoa de Lanhoso","Terras de Bouro",
  "Vieira do Minho","Vila Nova de Famalicão","Vila Verde","Vizela",
  "Alfândega da Fé","Bragança","Carrazeda de Ansiães","Freixo de Espada à Cinta",
  "Macedo de Cavaleiros","Miranda do Douro","Mirandela","Mogadouro",
  "Torre de Moncorvo","Vila Flor","Vimioso","Vinhais",
  "Belmonte","Castelo Branco","Covilhã","Fundão","Idanha-a-Nova",
  "Oleiros","Penamacor","Proença-a-Nova","Sertã","Vila de Rei","Vila Velha de Ródão",
  "Arganil","Cantanhede","Coimbra","Condeixa-a-Nova","Figueira da Foz",
  "Góis","Lousã","Mira","Miranda do Corvo","Montemor-o-Velho","Oliveira do Hospital",
  "Pampilhosa da Serra","Penacova","Penela","Soure","Tábua","Vila Nova de Poiares",
  "Alandroal","Arraiolos","Borba","Estremoz","Évora","Montemor-o-Novo",
  "Mora","Mourão","Portel","Redondo","Reguengos de Monsaraz",
  "Vendas Novas","Viana do Alentejo","Vila Viçosa",
  "Albufeira","Alcoutim","Aljezur","Castro Marim","Faro","Lagoa",
  "Lagos","Loulé","Monchique","Olhão","Portimão","São Brás de Alportel",
  "Silves","Tavira","Vila do Bispo","Vila Real de Santo António",
  "Aguiar da Beira","Almeida","Celorico da Beira","Figueira de Castelo Rodrigo",
  "Fornos de Algodres","Gouveia","Guarda","Manteigas","Mêda",
  "Pinhel","Sabugal","Seia","Trancoso","Vila Nova de Foz Côa",
  "Alcobaça","Alvaiázere","Ansião","Batalha","Bombarral","Caldas da Rainha",
  "Castanheira de Pêra","Figueiró dos Vinhos","Leiria","Marinha Grande",
  "Nazaré","Óbidos","Pedrógão Grande","Peniche","Pombal","Porto de Mós",
  "Alenquer","Amadora","Arruda dos Vinhos","Azambuja","Cadaval","Cascais",
  "Lisboa","Loures","Lourinhã","Mafra","Odivelas","Oeiras",
  "Sintra","Sobral de Monte Agraço","Torres Vedras","Vila Franca de Xira",
  "Alter do Chão","Arronches","Avis","Campo Maior","Castelo de Vide",
  "Crato","Elvas","Fronteira","Gavião","Marvão","Monforte",
  "Nisa","Ponte de Sor","Portalegre","Sousel",
  "Amarante","Baião","Felgueiras","Gondomar","Lousada","Maia",
  "Marco de Canaveses","Matosinhos","Paços de Ferreira","Paredes",
  "Penafiel","Porto","Póvoa de Varzim","Santo Tirso","Trofa",
  "Valongo","Vila do Conde","Vila Nova de Gaia",
  "Abrantes","Alcanena","Almeirim","Alpiarça","Benavente","Cartaxo",
  "Chamusca","Constância","Coruche","Entroncamento","Ferreira do Zêzere",
  "Golegã","Mação","Ourém","Rio Maior","Salvaterra de Magos",
  "Santarém","Sardoal","Tomar","Torres Novas","Vila Nova da Barquinha",
  "Alcácer do Sal","Alcochete","Almada","Barreiro","Grândola","Moita",
  "Montijo","Palmela","Santiago do Cacém","Seixal","Sesimbra","Setúbal","Sines",
  "Arcos de Valdevez","Caminha","Melgaço","Monção","Paredes de Coura",
  "Ponte da Barca","Ponte de Lima","Valença","Viana do Castelo","Vila Nova de Cerveira",
  "Alijó","Boticas","Chaves","Mesão Frio","Mondim de Basto","Montalegre",
  "Murça","Peso da Régua","Ribeira de Pena","Sabrosa","Santa Marta de Penaguião",
  "Valpaços","Vila Pouca de Aguiar","Vila Real",
  "Armamar","Carregal do Sal","Castro Daire","Cinfães","Lamego",
  "Mangualde","Moimenta da Beira","Mortágua","Nelas","Oliveira de Frades",
  "Penalva do Castelo","Penedono","Resende","Santa Comba Dão",
  "São João da Pesqueira","São Pedro do Sul","Sátão","Sernancelhe",
  "Tabuaço","Tarouca","Tondela","Vila Nova de Paiva","Viseu","Vouzela",
  "Angra do Heroísmo","Calheta (Açores)","Corvo","Horta","Lagoa (Açores)",
  "Lajes das Flores","Lajes do Pico","Madalena","Nordeste","Ponta Delgada",
  "Povoação","Praia da Vitória","Ribeira Grande","Santa Cruz da Graciosa",
  "Santa Cruz das Flores","São Roque do Pico","Velas","Vila do Porto",
  "Vila Franca do Campo",
  "Calheta (Madeira)","Câmara de Lobos","Funchal","Machico","Ponta do Sol",
  "Porto Moniz","Porto Santo","Ribeira Brava","Santa Cruz","Santana","São Vicente"
];

// Atribuir cores a todos os concelhos — cor única gerada pelo hash do nome
// (garante que mesmo localidades com nomes próximos ficam com cores distintas)
const localityColors = { 'Outra': '#9CA3AF' };
CONCELHOS_PT.forEach((name) => {
  localityColors[name] = _generateExtraColor(name);
});
window.LOCALITY_COLORS = localityColors;

// Função para obter cor da localidade (usa configuração do portal se disponível)
// Gera cor automaticamente para QUALQUER localidade nova — nunca repete
const getLocColor = loc => {
  // Prioridade 1: Cores do portal configuradas no portal-init.js
  if (window.portalConfig?.localities?.[loc]) {
    return window.portalConfig.localities[loc];
  }
  // Prioridade 2: Cores já atribuídas
  if (localityColors[loc]) {
    return localityColors[loc];
  }
  // Prioridade 3: Função global do portal-init.js
  if (window.getLocalityColor) {
    return window.getLocalityColor(loc);
  }
  // Prioridade 4: Gerar cor para localidade nova
  const usedCount = Object.keys(localityColors).length;
  const newColor = usedCount < _COLOR_PALETTE.length
    ? _COLOR_PALETTE[usedCount]
    : _generateExtraColor(loc);
  localityColors[loc] = newColor;
  window.LOCALITY_COLORS = localityColors;
  return newColor;
};

const statusBarColors = { NE:'#EF4444', VE:'#F59E0B', ST:'#10B981' };

// === TIPO DE PORTAL (loja vs sm) ===
function isLoja() { return window.portalConfig?.portalType === 'loja'; }

// Cores dos cards para Loja (baseadas no status do vidro)
const glassCardColors = {
  NE: '#EF4444', // Vermelho - Não encomendado
  VE: '#F59E0B', // Amarelo - Vidro encomendado
  ST: '#10B981'  // Verde - Stock
};

// Cor base do card conforme tipo de portal
function getCardBaseColor(a) {
  if (isLoja()) {
    return glassCardColors[a.status] || '#9CA3AF';
  }
  return getLocColor(a.locality);
}

// === TOTALIZADOR DIÁRIO (SM) ===
// Configurações default (serão sobrescritas pela API)
const ROUTE_CONFIG = {
  avgSpeedKmh: 50,
  fuelPer100km: 7.5,
  fuelPricePerLiter: 1.65
};
const SERVICE_TIMES = { 
  PB_L: 90, LT_L: 45, OC_L: 60, REP_L: 30, POL_L: 45,
  PB_P: 120, LT_P: 60, OC_P: 90, REP_P: 45, POL_P: 60,
  // Tempo extra por calibragem ADAS (em minutos, somado ao serviço base)
  CALIB_EXTRA_L: 30,
  CALIB_EXTRA_P: 45
};

// Carregar configurações da API
async function loadRouteSettings() {
  try {
    const token = window.authClient?.getToken();
    if (!token) return;
    
    // Carregar configurações gerais
    const resp = await fetch('/.netlify/functions/settings', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await resp.json();
    if (data.success && data.data) {
      const s = data.data;
      if (s.avgSpeedKmh) ROUTE_CONFIG.avgSpeedKmh = s.avgSpeedKmh;
      if (s.fuelPer100km) ROUTE_CONFIG.fuelPer100km = s.fuelPer100km;
      if (s.fuelPricePerLiter) ROUTE_CONFIG.fuelPricePerLiter = s.fuelPricePerLiter;
      if (s.serviceTimes) {
        Object.assign(SERVICE_TIMES, s.serviceTimes);
        // garantir que CALIB_EXTRA fica sempre disponível com defaults
        if (!SERVICE_TIMES.CALIB_EXTRA_L) SERVICE_TIMES.CALIB_EXTRA_L = 30;
        if (!SERVICE_TIMES.CALIB_EXTRA_P) SERVICE_TIMES.CALIB_EXTRA_P = 45;
      }
    }

    // Carregar preço do combustível da DGEG (sobrescreve o manual)
    try {
      const fuelResp = await fetch('/.netlify/functions/fuel-price', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const fuelData = await fuelResp.json();
      if (fuelData.success && fuelData.data && fuelData.data.price) {
        ROUTE_CONFIG.fuelPricePerLiter = fuelData.data.price;
        ROUTE_CONFIG.fuelSource = fuelData.data.source;
        console.log('⛽ Preço combustível:', fuelData.data.price, '€/L (fonte:', fuelData.data.source + ')');
      }
    } catch (e) {
      console.warn('⚠️ Não foi possível obter preço DGEG, usando valor manual');
    }

    console.log('✅ Configurações carregadas:', ROUTE_CONFIG, SERVICE_TIMES);
  } catch (e) {
    console.warn('⚠️ Não foi possível carregar configurações, usando defaults');
  }
}

// Obter tempo de execução de um serviço (baseado no tipo + veículo + calibragem)
function getServiceTime(serviceCode, vehicleType, calibration) {
  const code = serviceCode ? String(serviceCode).toUpperCase().trim().split(' ')[0].split('-')[0] : 'PB';
  const vt = (vehicleType || 'L').toUpperCase().charAt(0); // L ou P
  const key = code + '_' + vt;
  const base = SERVICE_TIMES[key] || SERVICE_TIMES[code + '_L'] || SERVICE_TIMES['PB_L'] || 90;
  const extra = calibration ? (SERVICE_TIMES['CALIB_EXTRA_' + vt] || SERVICE_TIMES['CALIB_EXTRA_L'] || 30) : 0;
  return base + extra;
}

function buildDaySummary(dayDate, isMobile) {
  if (isLoja()) return '';
  const iso = localISO(dayDate);
  const userRole = window.authClient?.getUser()?.role;
  // Filtro baseado apenas no role — mobile e desktop devem calcular com os mesmos serviços
  const canSeeUnconfirmed = (userRole === 'admin' || userRole === 'coordenador');
  let items = appointments.filter(a => a.date && a.date === iso)
    .sort((a,b) => (a.sortIndex||0) - (b.sortIndex||0));
  // Resumo: só contar serviços com localidade (confirmados e prontos para rota)
  // Pré-agendamentos sem localidade não entram no cálculo de tempo/km
  items = items.filter(a => !!a.locality);
  if (items.length === 0) return '';

  // KM total
  let totalKm = 0;
  let hasKm = false;
  let lastServiceKm = 0; // KM do último serviço (para estimar regresso)
  items.forEach((a, i) => {
    const km = getKmValue(a);
    if (km != null && km > 0) {
      totalKm += km;
      hasKm = true;
      if (i === 0) lastServiceKm = km; // Primeiro = mais longe da base
    }
  });

  // Tempo de viagem total (do Google Maps, guardado em cada serviço)
  let totalTravelMin = 0;
  let hasGoogleTime = false;
  items.forEach(a => {
    const tt = a.travelTime || a.travel_time || 0;
    if (tt > 0) {
      totalTravelMin += tt;
      hasGoogleTime = true;
    }
  });

  // Fallback: se não tem tempos do Google, calcular pela velocidade média
  if (!hasGoogleTime && hasKm) {
    totalTravelMin = Math.round((totalKm / ROUTE_CONFIG.avgSpeedKmh) * 60);
  }

  // Estimar regresso: metade do KM do primeiro serviço (na rota otimizada, último serviço está perto)
  const returnKm = hasKm ? Math.round(lastServiceKm * 0.5) : 0;
  const returnMin = hasGoogleTime ? Math.round(totalTravelMin * 0.15) : Math.round((returnKm / ROUTE_CONFIG.avgSpeedKmh) * 60);
  const totalKmWithReturn = totalKm + returnKm;

  // Tempo de execução (por tipo de serviço × veículo)
  let totalServiceMin = 0;
  items.forEach(a => {
    totalServiceMin += getServiceTime(a.service, a.vehicleType || a.vehicle_type, a.calibration);
  });

  if (!hasKm) {
    const svcStr = fmtTime(totalServiceMin);
    return `<div class="day-summary">
      <span class="ds-item" title="Serviços agendados">📋 ${items.length}</span>
      <span class="ds-item" title="Tempo estimado de execução">🔧 ${svcStr}</span>
      <span class="ds-item ds-muted">Sem KM calculados</span>
    </div>`;
  }

  // Formatação
  const travelWithReturn = totalTravelMin + returnMin;
  const totalMin = travelWithReturn + totalServiceMin;
  const travelStr = fmtTime(travelWithReturn);
  const svcStr = fmtTime(totalServiceMin);
  const totalStr = fmtTime(totalMin);
  const returnStr = fmtTime(returnMin);
  const sourceLabel = hasGoogleTime ? 'Google Maps' : 'estimativa';

  // Combustível
  const fuelLiters = (totalKmWithReturn * ROUTE_CONFIG.fuelPer100km / 100).toFixed(1);
  const fuelCost = (fuelLiters * ROUTE_CONFIG.fuelPricePerLiter).toFixed(2);

  // Hora estimada de regresso
  // Início: 09:00, Almoço: 13:00-14:00 (1h pausa)
  const startAt = 9 * 60; // 09:00 em minutos
  const lunchStart = 13 * 60; // 13:00
  const lunchDuration = 60; // 1 hora
  
  let elapsed = 0;
  let clock = startAt;
  let remaining = totalMin;
  
  // Trabalhar até ao almoço
  const workBeforeLunch = lunchStart - startAt; // 240 min (09:00-13:00)
  if (remaining <= workBeforeLunch) {
    // Termina antes do almoço
    clock = startAt + remaining;
  } else {
    // Passa do almoço: adicionar pausa
    remaining -= workBeforeLunch;
    clock = lunchStart + lunchDuration + remaining; // 14:00 + resto
  }
  
  const etaH = Math.floor(clock / 60);
  const etaM = clock % 60;
  const etaStr = `${String(etaH).padStart(2,'0')}:${String(etaM).padStart(2,'0')}`;

  return `<div class="day-summary">
    <span class="ds-item" title="Serviços agendados">📋 ${items.length}</span>
    <span class="ds-item" title="${Math.round(totalKm)}km rota + ~${returnKm}km regresso">🛣️ ${Math.round(totalKmWithReturn)} km</span>
    <span class="ds-item" title="Viagem: ${travelStr} (incl. ~${returnStr} regresso) — fonte: ${sourceLabel}">🚐 ${travelStr}</span>
    <span class="ds-item" title="Execução dos ${items.length} serviços">🔧 ${svcStr}</span>
    <span class="ds-item" title="Viagem + Execução">⏱️ ${totalStr}</span>
    <span class="ds-item" title="Consumo (${ROUTE_CONFIG.fuelPer100km}L/100km)">⛽ ${fuelLiters}L</span>
    <span class="ds-item ds-cost" title="€${ROUTE_CONFIG.fuelPricePerLiter}/L (${ROUTE_CONFIG.fuelSource === 'DGEG' ? 'DGEG' : 'manual'})">💰 ${fuelCost}€</span>
    <span class="ds-item ds-eta" title="Regresso à loja (saída 09:00, almoço 13-14h)">🏠 ${etaStr}</span>
  </div>`;
}

// Formatar minutos em horas:minutos
function fmtTime(min) {
  if (!min || min <= 0) return '0 min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2,'0') : ''}` : `${m} min`;
}

const localityList = Object.keys(localityColors);

// === Preencher e ligar o dropdown de Localidade (com pesquisa) ===

// Normaliza texto para pesquisa (remove acentos)
function _normalizeSearch(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Gera HTML para um botão de localidade
function _locOptHtml(loc) {
  const color = getLocColor(loc);
  return `<button type="button" class="loc-opt" data-value="${loc}">
    <span class="dot" style="background:${color}"></span>
    <span class="txt">${loc}</span>
  </button>`;
}

// Renderiza as opções filtradas no dropdown
function renderLocalityOptions(filter) {
  const list = document.getElementById('localityOptions');
  if (!list) return;

  const query = _normalizeSearch(filter || '');

  if (!query) {
    // Sem filtro: pedir para escrever
    list.innerHTML = '<div class="loc-no-results">Escreva o nome do concelho...</div>';
    return;
  }

  const matched = CONCELHOS_PT.filter(loc => _normalizeSearch(loc).includes(query));

  if (matched.length === 0) {
    list.innerHTML = '<div class="loc-no-results">Nenhum concelho encontrado</div>';
  } else {
    list.innerHTML = matched.map(loc => _locOptHtml(loc)).join('');
  }

  // Bind click events
  list.querySelectorAll('.loc-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      window.selectLocality?.(btn.getAttribute('data-value'));
    });
  });
}

function buildLocalityOptions() {
  const list = document.getElementById('localityOptions');
  const search = document.getElementById('localitySearch');
  if (!list) return;

  // Render inicial (favoritas)
  renderLocalityOptions('');

  // Ligar evento de pesquisa
  if (search) {
    search.addEventListener('input', (e) => {
      renderLocalityOptions(e.target.value);
    });
  }
}


// ---------- Estado ----------
let appointments = [];
let currentMonday = getMonday(new Date());
let currentMobileDay = new Date();
let editingId = null;
let searchQuery = '';
let statusFilter = '';

// ---------- Utils ----------
function getMonday(date){ const d=new Date(date); const day=d.getDay(); const diff=d.getDate()-day+(day===0?-6:1); d.setDate(diff); d.setHours(0,0,0,0); return d; }
function addDays(date,days){ const r=new Date(date); r.setDate(r.getDate()+days); r.setHours(0,0,0,0); return r; }
function localISO(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function parseDate(dateStr){
  if(!dateStr) return null;
  const s=String(dateStr).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)){ const [d,m,y]=s.split('/'); return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  try{ const d=new Date(s); if(!isNaN(d.getTime())) return localISO(d); }catch{}
  return null;
}
function formatDateForInput(s){ if(!s) return ''; if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; } return s; }
function fmtHeader(date){ return {day: date.toLocaleDateString('pt-PT',{weekday:'long'}), dm: date.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})}; }
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : s;
function parseColor(str){
  if(!str) return null; str=String(str).trim();
  if(str[0]==='#'){ if(str.length===4) return {r:parseInt(str[1]+str[1],16), g:parseInt(str[2]+str[2],16), b:parseInt(str[3]+str[3],16)};
                    if(str.length>=7) return {r:parseInt(str.slice(1,3),16), g:parseInt(str.slice(3,5),16), b:parseInt(str.slice(5,7),16)};}
  const m=str.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i); if(m) return {r:+m[1], g:+m[2], b:+m[3]}; return null;
}
const clamp=n=>Math.max(0,Math.min(255,Math.round(n))); const toHex=n=>n.toString(16).padStart(2,'0');
const rgbToHex=({r,g,b})=>'#'+toHex(clamp(r))+toHex(clamp(g))+toHex(clamp(b));
const lighten=(rgb,a)=>({ r:rgb.r+(255-rgb.r)*a, g:rgb.g+(255-rgb.g)*a, b:rgb.b+(255-rgb.b)*a });
const darken=(rgb,a)=>({ r:rgb.r*(1-a), g:rgb.g*(1-a), b:rgb.b*(1-a) });
function gradFromBase(hex){ const rgb=parseColor(hex)||parseColor('#1e88e5'); return { c1: rgbToHex(lighten(rgb,0.06)), c2: rgbToHex(darken(rgb,0.18)) }; }

// Calcula luminância relativa (WCAG) e devolve '#000' ou '#fff' conforme contraste
function textColorForBg(hex) {
  const rgb = parseColor(hex);
  if (!rgb) return '#fff';
  // sRGB linearization
  const lin = v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  // branco se escuro (L < 0.35), preto se claro
  return L > 0.35 ? '#111' : '#fff';
}
function bucketOf(a){ 
  if(!a.date) return 'unscheduled'; 
  if(isLoja()) return `${a.date}|${a.period || 'Manhã'}`;
  return a.date; 
}
function getBucketList(bucket){ return appointments.filter(x=>bucketOf(x)===bucket).sort((a,b)=>(a.sortIndex||0)-(b.sortIndex||0)); }
function normalizeBucketOrder(bucket){ appointments.filter(a=>bucketOf(a)===bucket).forEach((x,i)=>x.sortIndex=i+1); }

// ---------- Toast ----------
function showToast(msg,type='info'){
  const c=document.getElementById('toastContainer'); if(!c) return;
  const t=document.createElement('div'); t.className=`toast ${type}`;
  t.innerHTML=`<span>${type==='success'?'✅':type==='error'?'❌':'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t); setTimeout(()=>t.remove(),4000);
}

// ---------- Matrícula ----------
function formatPlate(input){
  let v=input.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(v.length>2) v=v.slice(0,2)+'-'+v.slice(2);
  if(v.length>5) v=v.slice(0,5)+'-'+v.slice(5,7);
  input.value=v;
}

// ---------- Connection Badge ----------
function updateConnBadge(){
  const status = document.getElementById('connectionStatus');
  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');
  
  if (!status || !icon || !text) return;
  
  const connStatus = window.apiClient?.getConnectionStatus() || { online: navigator.onLine };
  
  if (connStatus.online) {
    status.className = 'connection-status online';
    icon.textContent = '🌐';
    text.textContent = 'Online';
  } else {
    status.className = 'connection-status offline';
    icon.textContent = '📱';
    text.textContent = 'Offline';
  }
}

// ---------- API load ----------
async function load(){
  try{
    showToast('Carregando dados...','info');
   appointments = window.apiClient?.getAppointments
  ? await window.apiClient.getAppointments()
  : [];

    appointments.forEach(a => {
      if (a.date) {
        a.date = String(a.date).slice(0, 10); // fica só "YYYY-MM-DD"
      }
      // Normalizar created_at → createdAt
      if (!a.createdAt && a.created_at) a.createdAt = a.created_at;
    });

    // IDs e ordem estáveis
    appointments.forEach(a=>{ 
      if(!a.id) a.id=Date.now()+Math.random(); 
      // Normalizar sortindex (minúsculas BD) → sortIndex
      if(a.sortIndex === null || a.sortIndex === undefined) {
        a.sortIndex = (a.sortindex !== null && a.sortindex !== undefined) ? a.sortindex : 1;
      }
    });
    // 🔁 Normalização de morada e data de criação (compatibilidade com dados antigos)
    appointments = appointments.map(a => ({
      ...a,
      address: a.address || a.morada || a.addr || null,
      createdAt: a.createdAt || a.created_at || null // Normalizar created_at (snake_case) para createdAt (camelCase)
    }));
    // Sincronizar cores do portal se disponíveis
    if (window.portalConfig?.localities) {
      Object.assign(localityColors, window.portalConfig.localities);
      window.LOCALITY_COLORS = localityColors;
      console.log('✅ Cores do portal sincronizadas:', Object.keys(window.portalConfig.localities).length, 'localidades');
    }
    
    // Carregar cores da API (fallback ou atualização)
    const locs=await window.apiClient.getLocalities();
    if(locs && typeof locs==='object'){ 
      Object.assign(localityColors,locs); 
      window.LOCALITY_COLORS=localityColors;
      window._localityList = Object.keys(locs); // para detecção automática pela morada
      for (const [k,v] of Object.entries(localityColors)) {
        if (!/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v)) localityColors[k] = '#3b82f6';
      }
    }
    const st = window.apiClient?.getConnectionStatus?.() || { online: navigator.onLine };
    showToast(st.online?'Dados carregados da cloud!':'Dados carregados localmente (offline)', st.online?'success':'info');
  }catch(e){
    appointments=[]; showToast('Erro ao carregar dados: '+e.message,'error');
  } finally {
    updateConnBadge();
  }
}

// ---------- Filtros ----------
function filterAppointments(list){
  let f=[...list];
  if(searchQuery){
    const q=searchQuery.toLowerCase();
    f=f.filter(a=>
      (a.plate||'').toLowerCase().includes(q) ||
      (a.car||'').toLowerCase().includes(q) ||
      (a.locality||'').toLowerCase().includes(q) ||
      ((a.notes||'').toLowerCase().includes(q))
    );
  }
  if(statusFilter) f=f.filter(a=>a.status===statusFilter);
  return f;
}
function highlightSearchResults(){
  document.querySelectorAll('.appointment').forEach(el=>el.classList.remove('highlight'));
  if(!searchQuery) return;
  document.querySelectorAll('.appointment').forEach(el=>{
    if(el.textContent.toLowerCase().includes(searchQuery.toLowerCase())) el.classList.add('highlight');
  });
}

// ---------- Persistência de STATUS (exclusivo) ----------
async function persistStatus(id, newStatus) {
  const i = appointments.findIndex(a => String(a.id) === String(id));
  if (i < 0) return;

  const valid = ['NE','VE','ST'];
  if (!valid.includes(newStatus)) return;

  const prev = appointments[i].status;

  // Atualização otimista para não “piscar”
  appointments[i].status = newStatus;
  renderAll();

  try {
    const res = await window.apiClient.updateAppointment(id, { ...appointments[i], status: newStatus });

    if (res && typeof res === 'object') {
      // ✅ Normaliza para o formato que o calendário espera
      const normalized = {
        ...appointments[i],
        ...res,
        date: res.date ? String(res.date).slice(0, 10) : (appointments[i].date ?? null),
        address: res.address || res.morada || res.addr || appointments[i].address || null,
        sortIndex: appointments[i].sortIndex || 1,
        id: appointments[i].id ?? res.id
      };
      appointments[i] = normalized;
    }

    showToast(`Status guardado: ${newStatus}`, 'success');
  } catch (err) {
    // rollback
    appointments[i].status = prev;
    showToast('Falha ao gravar status: ' + err.message, 'error');
  } finally {
    renderAll();
  }
}


// ---------- Executed (realizado pelo técnico) ----------
async function persistConfirmed(id, confirmed) {
  const i = appointments.findIndex(a => String(a.id) === String(id));
  if (i < 0) return;
  const prev = { confirmed: appointments[i].confirmed, auto_imported: appointments[i].auto_imported };
  appointments[i].confirmed = confirmed;
  if (confirmed) appointments[i].auto_imported = false; // remove badge PHC
  renderAll();
  try {
    await window.apiClient.updateAppointment(id, { ...appointments[i], confirmed, auto_imported: confirmed ? false : appointments[i].auto_imported });
  } catch (err) {
    appointments[i].confirmed = prev.confirmed;
    appointments[i].auto_imported = prev.auto_imported;
    showToast('Falha ao confirmar: ' + err.message, 'error');
    renderAll();
  }
}


async function persistExecuted(id, executed) {
  const i = appointments.findIndex(a => String(a.id) === String(id));
  if (i < 0) return;
  const prev = appointments[i].executed;
  appointments[i].executed = executed;
  renderAll();
  try {
    await window.apiClient.updateAppointment(id, { ...appointments[i], executed });
  } catch (err) {
    appointments[i].executed = prev;
    showToast('Falha ao gravar: ' + err.message, 'error');
    renderAll();
  }
}
// ---------- Exec Listeners (desktop) ----------
function attachExecListeners(){
  document.querySelectorAll('.dc-exec-btn').forEach(btn => {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      const id = this.dataset.id;
      const executed = this.dataset.exec === 'true';
      await persistExecuted(id, executed);
    });
  });
  document.querySelectorAll('.dc-confirm-btn').forEach(btn => {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      await persistConfirmed(this.dataset.confirm, true);
    });
  });
}

function attachStatusListeners(){
  document.querySelectorAll('.appt-status input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', async function(e) {
      if (!this.checked) return;
      
      const appointmentEl = this.closest('.appointment');
      const id = appointmentEl?.getAttribute('data-id');
      const newStatus = this.getAttribute('data-status');
      
      if (!id || !newStatus) return;
      
      // Desmarcar outros checkboxes do mesmo agendamento
      appointmentEl.querySelectorAll('.appt-status input[type="checkbox"]').forEach(cb => {
        if (cb !== this) cb.checked = false;
      });
      
      await persistStatus(id, newStatus);
    });
  });
}

// ---------- Drag & Drop (com persistência throttle) ----------
let persistQueue = [];
let persistTimer = null;

async function persistBuckets(buckets){
  const payload = [];
  for (const bucket of buckets){
    const list = getBucketList(bucket);
    for (const item of list) payload.push({ ...item });
  }
  persistQueue = payload;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(runPersistFlush, 50); // reduzido para 50ms
}

async function runPersistFlush(){
  const queue = [...persistQueue];
  persistQueue = [];
  if (queue.length === 0) return;

  window._pausePolling = true;
  let saved = 0, failed = 0;
  try {
    for (const item of queue) {
      try {
        console.log(`💾 A gravar ID=${item.id} date=${item.date} portal=${window.activePortalId}`);
        await window.apiClient.updateAppointment(item.id, item);
        saved++;
        console.log(`✅ Gravado ID=${item.id}`);
      } catch(e) {
        failed++;
        console.error(`❌ Falha ID=${item.id}:`, e.message);
        showToast(`❌ Erro ao gravar ${item.plate}: ${e.message}`, 'error');
      }
    }
    if (saved > 0 && failed === 0) showToast('✅ Alterações gravadas.', 'success');
  } finally {
    window._pausePolling = false;
  }
}

function enableDragDrop(scope){
  (scope||document).querySelectorAll('.appointment[data-id]').forEach(card=>{
    card.draggable=true;
    card.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain',card.getAttribute('data-id'));
      e.dataTransfer.effectAllowed='move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  });

  if (!enableDragDrop._bound){
    document.addEventListener('dragover', (e)=>{
      const zone = e.target.closest('[data-drop-bucket]'); if(!zone) return;
      e.preventDefault(); zone.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e)=>{
      const zone = e.target.closest('[data-drop-bucket]'); if(zone) zone.classList.remove('drag-over');
    });
    document.addEventListener('drop', async (e)=>{
      const zone = e.target.closest('[data-drop-bucket]'); if(!zone) return;
      e.preventDefault(); zone.classList.remove('drag-over');
      const id    = e.dataTransfer.getData('text/plain');
      const bucket= zone.getAttribute('data-drop-bucket');
      const idxIn = zone.querySelectorAll('.appointment').length;
      console.log(`🖱️ DROP id=${id} bucket=${bucket}`);
      await onDropAppointment(id, bucket, idxIn);
    });
    enableDragDrop._bound = true;
  }
}

async function onDropAppointment(id, targetBucket, targetIndex){
  const i = appointments.findIndex(a => String(a.id) === String(id));
  if (i < 0) return;
  const a = appointments[i];
  const oldBucket = bucketOf(a);

  if(targetBucket === 'unscheduled'){
    a.date = null;
    a.period = null;
  } else if (targetBucket.includes('|')) {
    const [date, period] = targetBucket.split('|');
    a.date = date;
    a.period = period;
  } else {
    a.date = targetBucket;
  }

  const dest = getBucketList(targetBucket).filter(x=>String(x.id)!==String(a.id));
  dest.splice(Math.min(targetIndex, dest.length), 0, a);
  dest.forEach((x,idx)=> x.sortIndex = idx+1);

  if (oldBucket !== targetBucket){
    const orig = getBucketList(oldBucket);
    orig.forEach((x,idx)=> x.sortIndex = idx+1);
  }

  // 1. GRAVAR NA BD IMEDIATAMENTE (antes de qualquer outra coisa)
  window._pausePolling = true;
  const bucketsToPersist = new Set([targetBucket, oldBucket]);
  for (const bucket of bucketsToPersist) {
    for (const item of getBucketList(bucket)) {
      try {
        console.log(`💾 Gravando ID=${item.id} date=${item.date}`);
        await window.apiClient.updateAppointment(item.id, item);
        console.log(`✅ ID=${item.id} gravado`);
      } catch(e) {
        console.error(`❌ ID=${item.id}:`, e.message);
        showToast(`❌ Erro: ${e.message}`, 'error');
      }
    }
  }
  window._pausePolling = false;

  // 2. Render
  renderAll();

  // 3. Recalc km em background (não bloqueia, não afecta dados)
  if (!isLoja()) {
    const dateBucket = targetBucket.split('|')[0];
    const oldDateBucket = oldBucket.split('|')[0];
    if (dateBucket !== 'unscheduled') recalcKmForBucket(dateBucket);
    if (oldDateBucket !== dateBucket && oldDateBucket !== 'unscheduled') recalcKmForBucket(oldDateBucket);
  }

  showToast('✅ Alterações gravadas.', 'success');
}

// ===== RECALCULAR KM ENTRE SERVIÇOS DE UM DIA (após reordenar) =====
async function recalcKmForBucket(bucket) {
  const list = getBucketList(bucket).filter(a => getAddressFromItem(a));
  if (list.length === 0) return;

  let changed = false;

  for (let i = 0; i < list.length; i++) {
    const service = list[i];
    const serviceAddr = getAddressFromItem(service);
    if (!serviceAddr) continue;

    let newKm = 0;
    let travelMin = 0;
    try {
      if (i === 0) {
        const result = await getDistanceAndTime(getBasePartida(), serviceAddr);
        newKm = result.distance !== Infinity ? Math.round(result.distance / 1000) : 0;
        travelMin = result.duration || 0;
      } else {
        const prevAddr = getAddressFromItem(list[i - 1]);
        if (prevAddr) {
          const result = await getDistanceAndTime(prevAddr, serviceAddr);
          newKm = result.distance !== Infinity ? Math.round(result.distance / 1000) : 0;
          travelMin = result.duration || 0;
        }
      }
    } catch (e) {
      console.warn('Erro ao recalcular km:', e);
    }

    const idx = appointments.findIndex(a => a.id === service.id);
    if (idx >= 0) {
      if (appointments[idx].km !== newKm || appointments[idx].travelTime !== travelMin) {
        appointments[idx].km = newKm;
        appointments[idx].travelTime = travelMin;
        changed = true;
        console.log(`🔄 Recalculado: ${service.plate} → ${newKm}km, ${travelMin}min ${i === 0 ? '(da base)' : '(do anterior)'}`);
      }
    }
  }

  if (changed) {
    renderAll();
    showToast('🔄 Quilómetros e tempos recalculados', 'info');
  }
}

// ===== FUNÇÕES DE EDIÇÃO E ELIMINAÇÃO =====

function editAppointment(id) {
  const appointment = appointments.find(a => String(a.id) === String(id));
  if (!appointment) {
    showToast('Agendamento não encontrado', 'error');
    return;
  }

  editingId = id;
  
  // Estado confirmado
  setConfirmed(appointment.confirmed !== false);
  document.getElementById('appointmentDate').value = appointment.date || '';
  document.getElementById('appointmentPlate').value = appointment.plate || '';
  document.getElementById('appointmentCar').value = appointment.car || '';
  document.getElementById('appointmentService').value = appointment.service || '';
  if (document.getElementById('appointmentVehicleType')) {
    document.getElementById('appointmentVehicleType').value = appointment.vehicleType || appointment.vehicle_type || 'L';
  }
  const calibCb = document.getElementById('appointmentCalibration');
  if (calibCb) calibCb.checked = !!(appointment.calibration);
  const firstCb = document.getElementById('appointmentFirstOfDay');
  if (firstCb) firstCb.checked = !!(appointment.first_of_day);
  document.getElementById('appointmentLocality').value = appointment.locality || '';
  document.getElementById('appointmentNotes').value = appointment.notes || '';
  document.getElementById('appointmentAddress').value = appointment.address || '';
  document.getElementById('appointmentPhone').value = appointment.phone || '';
  document.getElementById('appointmentExtra').value = appointment.extra || '';
  
  // Preencher campo de quilómetros se existir
  const kmValue = getKmValue(appointment);
  const kmField = document.getElementById('appointmentKm');
  if (kmField) {
    kmField.value = kmValue || '';
  }

  // Atualizar dropdown de localidade
  if (appointment.locality) {
    const selectedText = document.getElementById('selectedLocalityText');
    const selectedDot = document.getElementById('selectedLocalityDot');
    if (selectedText && selectedDot) {
      selectedText.textContent = appointment.locality;
      selectedDot.style.backgroundColor = getLocColor(appointment.locality);
    }
  }

  // Alterar modal para modo edição
  document.getElementById('modalTitle').textContent = 'Editar Agendamento';
  document.getElementById('deleteAppointment').classList.remove('hidden');
  document.getElementById('appointmentModal').classList.add('show');
}

async function deleteAppointment(id) {
  if (!confirm('Tem a certeza que pretende eliminar este agendamento?')) {
    return;
  }

  try {
    await window.apiClient.deleteAppointment(id);
    const index = appointments.findIndex(a => String(a.id) === String(id));
    if (index > -1) {
      appointments.splice(index, 1);
    }
    
    showToast('Agendamento eliminado com sucesso', 'success');
    renderAll();
    document.getElementById('appointmentModal').classList.remove('show');
    
  } catch (error) {
    showToast('Erro ao eliminar agendamento: ' + error.message, 'error');
  }
}

function cancelEdit() {
  editingId = null;
  window.originalUnscheduledServiceId = null; // Limpar ID do serviço original
  document.getElementById('appointmentForm').reset();
  const calibCb = document.getElementById('appointmentCalibration');
  if (calibCb) calibCb.checked = false;
  const firstCb = document.getElementById('appointmentFirstOfDay');
  if (firstCb) firstCb.checked = false;
  document.getElementById('modalTitle').textContent = 'Novo Agendamento';
  document.getElementById('deleteAppointment').classList.add('hidden');
  
  // Limpar campo de quilómetros
  const kmField = document.getElementById('appointmentKm');
  if (kmField) {
    kmField.value = '';
  }
  
  const selectedText = document.getElementById('selectedLocalityText');
  const selectedDot = document.getElementById('selectedLocalityDot');
  if (selectedText && selectedDot) {
    selectedText.textContent = 'Selecione a localidade';
    selectedDot.style.backgroundColor = '';
  }
  
  document.getElementById('appointmentModal').classList.remove('show');
}

// ---------- Render DESKTOP (cartões) ----------

// ===== KM helpers =====
function getKmValue(ag) {
  const v = ag.km ?? ag.kms ?? ag.kilometers ?? ag.kilometros ?? ag.quilometros ?? ag.kilómetros ?? ag.km_total ?? ag.distancia;
  if (v == null) return null;
  const n = String(v).match(/[\d,.]+/);
  if (!n) return null;
  const parsed = parseFloat(n[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildKmRow(ag) {
  const km = getKmValue(ag);
  if (km == null) return '';
  const kmFmt = Math.round(km);
  return `
    <div class="card-km" data-km-row style="display: flex; align-items: center; gap: 6px; margin-top: 8px; color: white; font-size: 14px; font-weight: 600;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="flex-shrink: 0;">
        <path d="M5 17h2c0 1.1.9 2 2 2s2-.9 2-2h6c0 1.1.9 2 2 2s2-.9 2-2h2v-5l-3-4H5v7z" fill="white"/>
        <path d="M5 11V6c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v5" stroke="white" stroke-width="1.5" fill="none"/>
        <circle cx="9" cy="17" r="1.5" fill="white"/>
        <circle cx="19" cy="17" r="1.5" fill="white"/>
        <path d="M6 8h4M6 10h3" stroke="white" stroke-width="1" opacity="0.8"/>
      </svg>
      <span style="font-size: 12px; opacity: 0.9;">→</span>
      <span>${kmFmt} km</span>
    </div>
  `;
}
function buildDesktopCard(a){
  const base = getCardBaseColor(a);
  const g = gradFromBase(base);
  const textColor = textColorForBg(base);
  const loja = isLoja();
  const bar = loja ? '' : `border-left:5px solid ${statusBarColors[a.status] || '#475569'}`;
  // Nova hierarquia: matrícula em Barlow Condensed, badge serviço, carro secundário
  const plate = (a.plate || '').toUpperCase();
  const service = a.service || 'PB';
  const car = (a.car || '').toUpperCase();
  const sub = loja
    ? [a.notes].filter(Boolean).join(' | ')
    : [a.locality, a.notes].filter(Boolean).join(' | ');
  // SM com data mas sem localidade → piscar (só coord/admin) — mas não para pré-agendamentos (têm o seu próprio sistema)
  const userRole = window.authClient?.getUser()?.role;
  const canSeeUnconfirmed = userRole === 'admin' || userRole === 'coordenador';
  const isPreAgendado = a.confirmed === false;
  const needsLoc = !loja && a.date && !a.locality && canSeeUnconfirmed && !isPreAgendado ? ' needs-locality' : '';
  const locWarning = needsLoc ? `
      <div class="needs-loc-msg">
        <div>⚠️ Falta localidade</div>
        <div style="font-size:11px;opacity:0.8;margin-top:2px;">Confirma agendamento?</div>
      </div>` : '';
  // Auto-importado do PHC com data
  const isAutoImported = a.auto_imported && a.date;
  const phcFooter = isAutoImported ? `
      <div class="phc-import-footer">
        <div>Importado direto PHC, mantém?</div>
        <div>Confirma status vidro</div>
      </div>` : '';
  // Para SM: botão confirmar só aparece com localidade preenchida
  // Para Loja: aparece sempre
  const canConfirm = isPreAgendado && (loja || !!a.locality);
  const needsLocMsg = isPreAgendado && !loja && !a.locality
    ? `<div style="font-size:11px;font-weight:700;color:#fef3c7;background:rgba(0,0,0,0.3);border-radius:6px;padding:4px 8px;margin-top:6px;">📍 Adicionar localidade e morada para confirmar</div>`
    : '';

  const preAgendadoBadge = isPreAgendado ? `<span class="pre-agendado-badge">⏳ Aguarda confirmação</span>` : '';
  const confirmBtn = canConfirm
    ? `<button class="dc-confirm-btn" data-confirm="${a.id}">✅ Confirmar agendamento</button>`
    : needsLocMsg;

  const todayISO2 = localISO(new Date());
  const isPastOrToday = a.date && a.date <= todayISO2;
  const execBadge = isPastOrToday ? `
    <div class="dc-exec-row" data-id="${a.id}">
      <button class="dc-exec-btn ${!a.executed ? 'dc-exec-ne' : ''}" data-exec="false" data-id="${a.id}">✗ N. Realizado</button>
      <button class="dc-exec-btn ${a.executed ? 'dc-exec-st' : ''}" data-exec="true" data-id="${a.id}">✓ Realizado</button>
    </div>` : '';

  return `
    <div class="appointment desk-card${needsLoc}${isPreAgendado ? ' pre-agendado' : ''}" data-id="${a.id}" draggable="true"
         data-locality="${a.locality||''}" data-loccolor="${base}"
         style="--c1:${g.c1}; --c2:${g.c2}; --tc:${textColor}; ${bar}">
      <div class="dc-title"><span class="dc-title-text">${plate}</span></div>
      <div class="dc-meta">
        <span class="dc-badge">${service}</span>
        ${a.calibration ? '<span class="dc-calib-badge">⊕ CALIB</span>' : ''}
        ${a.first_of_day ? '<span class="dc-calib-badge" style="background:#f59e0b;color:#fff;">⭐ 1.º SERVIÇO</span>' : ''}
        ${car ? `<span class="dc-car">${car}</span>` : ''}
      </div>
      ${sub ? `<div class="dc-sub">${sub}</div>` : ''}
      ${preAgendadoBadge}
      ${confirmBtn}
      ${locWarning}
      <div class="appt-status dc-status">
        <label><input type="checkbox" data-status="NE" ${a.status==='NE'?'checked':''}/> N/E</label>
        <label><input type="checkbox" data-status="VE" ${a.status==='VE'?'checked':''}/> V/E</label>
        <label><input type="checkbox" data-status="ST" ${a.status==='ST'?'checked':''}/> ST</label>
      </div>
      ${execBadge}
      <div class="card-actions">
        <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar" aria-label="Editar">✏️</button>
        <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar" aria-label="Eliminar">🗑️</button>
      </div>
    ${loja ? '' : buildKmRow(a)}${phcFooter}</div>`;
}

function renderSchedule(){
  const table=document.getElementById('schedule'); if(!table) return;
  table.innerHTML='';
  const week=[...Array(6)].map((_,i)=>addDays(currentMonday,i)); // Seg-Sáb
  const wr=document.getElementById('weekRange');
  if(wr){ wr.textContent = `${week[0].toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})} - ${week[5].toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'})}`; }

  const todayISO = localISO(new Date());
  const isToday = d => localISO(d) === todayISO;

  let thead='<thead><tr><th>Data</th>';
  for(const d of week){
    const h=fmtHeader(d);
    const cls = isToday(d) ? ' class="is-today"' : '';
    thead+=`<th${cls}><div class="day">${cap(h.day)}</div><div class="date">${h.dm}</div>${isToday(d) ? '<div class="today-dot"></div>' : ''}</th>`;
  }
  thead+='</tr></thead>';
  table.insertAdjacentHTML('beforeend', thead);

  const tbody=document.createElement('tbody');

  if (isLoja()) {
    // LOJA: duas linhas por dia (Manhã / Tarde)
    const renderPeriodCell = (dayDate, period) => {
      const iso = localISO(dayDate);
      const items = filterAppointments(
        appointments.filter(a => a.date && a.date === iso && (a.period || 'Manhã') === period)
          .sort((a,b) => (a.sortIndex||0) - (b.sortIndex||0))
      );
      const blocks = items.map(buildDesktopCard).join('');
      return `<div class="drop-zone" data-drop-bucket="${iso}|${period}">${blocks}</div>`;
    };

    const rowM = document.createElement('tr');
    rowM.innerHTML = `<th>Manhã</th>` + week.map(d => `<td${isToday(d)?' class="is-today"':''}>${renderPeriodCell(d, 'Manhã')}</td>`).join('');
    tbody.appendChild(rowM);

    const rowT = document.createElement('tr');
    rowT.innerHTML = `<th>Tarde</th>` + week.map(d => `<td${isToday(d)?' class="is-today"':''}>${renderPeriodCell(d, 'Tarde')}</td>`).join('');
    tbody.appendChild(rowT);
  } else {
    // SM: resumo do dia + serviços
    const userRole = window.authClient?.getUser()?.role;
    const canSeeUnconfirmed = userRole === 'admin' || userRole === 'coordenador';

    const renderCell = (dayDate) => {
      const iso = localISO(dayDate);
      let items = filterAppointments(
        appointments.filter(a => a.date && a.date === iso)
          .sort((a,b) => (a.sortIndex||0) - (b.sortIndex||0))
      );
      // Técnicos: esconder serviços SM sem localidade
      if (!canSeeUnconfirmed) {
        items = items.filter(a => !!a.locality);
      }
      const blocks = items.map(buildDesktopCard).join('');
      return `<div class="drop-zone" data-drop-bucket="${iso}">${blocks}</div>`;
    };

    // Linha de resumo (KM, tempo, combustível)
    const summaryRow = document.createElement('tr');
    summaryRow.className = 'summary-row';
    summaryRow.innerHTML = `<th>Resumo</th>` + week.map(d => `<td${isToday(d)?' class="is-today"':''}>${buildDaySummary(d)}</td>`).join('');
    tbody.appendChild(summaryRow);

    // Linha de serviços
    const row = document.createElement('tr');
    row.innerHTML = `<th>Serviços</th>` + week.map(d => `<td${isToday(d)?' class="is-today"':''}>${renderCell(d)}</td>`).join('');
    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  enableDragDrop(); attachStatusListeners(); attachExecListeners(); highlightSearchResults();
}

// ---------- Render PENDENTES ----------
function renderUnscheduled(){
  const tableBody=document.getElementById('unscheduledTableBody');
  if (!tableBody) return;
  
  // Ordenar por data de criação (mais antigos primeiro)
  const unscheduled=filterAppointments(
    appointments.filter(a=>!a.date).sort((x,y)=>{
      const dateX = x.createdAt ? new Date(x.createdAt) : new Date();
      const dateY = y.createdAt ? new Date(y.createdAt) : new Date();
      return dateX - dateY;
    })
  );
  
  // Vista em cartões removida - apenas vista em tabela disponível
  
  // Renderizar vista em tabela
  if (tableBody) {
    const rows = unscheduled.map(a => {
      const statusBadge = a.status ? `<span class="status-badge ${a.status}">${a.status}</span>` : '';
      
      // Formatar data de criação (DD.MM.YY)
      const dataCriacao = a.createdAt ? formatDateShortPortal(a.createdAt) : '—';
      
      // Calcular dias aberto
      const diasAberto = a.createdAt ? calcularDiasDesdePortal(a.createdAt) : 0;
      const diasAbertoText = diasAberto > 0 ? `${diasAberto} ${diasAberto === 1 ? 'dia' : 'dias'}` : '—';
      
      // Calcular antiguidade e aplicar cor
      let rowClass = '';
      if (a.createdAt) {
        if (diasAberto >= 8) {
          rowClass = 'antiguidade-vermelho';
        } else if (diasAberto >= 5) {
          rowClass = 'antiguidade-laranja';
        } else if (diasAberto >= 3) {
          rowClass = 'antiguidade-amarelo';
        }
      }
      
      return `
        <tr class="${rowClass}" data-id="${a.id}" data-plate="${a.plate||''}" data-locality="${a.locality||''}">
          <td class="date-cell">${dataCriacao}</td>
          <td class="days-open-cell">${diasAbertoText}</td>
          <td class="plate-cell">${a.plate || ''}</td>
          <td>${a.car || ''}</td>
          <td>${a.notes || ''}</td>
          <td>${statusBadge}</td>
          <td class="actions-cell">
            <button class="action-btn-small edit" onclick="editAppointment('${a.id}')" title="Editar">✏️</button>
            <button class="action-btn-small delete" onclick="deleteAppointment('${a.id}')" title="Eliminar">🗑️</button>
          </td>
        </tr>`;
    }).join('');
    tableBody.innerHTML = rows;
  }
  
  // 🔢 ATUALIZAR CONTADOR: Mostrar número de serviços por agendar
  const countBadge = document.getElementById('unscheduledCount');
  if (countBadge) {
    countBadge.textContent = unscheduled.length;
  }
  
  enableDragDrop(); attachStatusListeners(); attachExecListeners(); highlightSearchResults();
}

// Formatar data no formato DD.MM.YY (para portal)
function formatDateShortPortal(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

// Calcular dias desde uma data (para portal)
function calcularDiasDesdePortal(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diffMs = hoje - d;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ---------- Header da tabela ----------
function ensureServicesHeader(){
  const table = document.querySelector('.services-table'); if(!table) return;
  let thead = table.querySelector('thead'); if(!thead){ thead = document.createElement('thead'); table.prepend(thead); }
  const headers = ['Data','Matrícula','Carro','Serviço','Localidade','Observações','Estado','Dias','Ações'];
  thead.innerHTML = `<tr>${
    headers.map(h => h==='Ações'
      ? `<th class="no-print actions-col" style="width:100px;text-align:left">Ações</th>`
      : `<th>${h}</th>`
    ).join('')
  }</tr>`;
}

// ---------- Render TABELA FUTURA ----------
function renderServicesTable(){
  const tbody=document.getElementById('servicesTableBody'); if(!tbody) return;
  ensureServicesHeader();
  const today = new Date(); today.setHours(0,0,0,0);
  const future = filterAppointments(
    appointments.filter(a => a.date && new Date(a.date) >= today)
               .sort((a,b) => new Date(a.date) - new Date(b.date))
  );
  tbody.innerHTML=future.map(a=>{
    const d=new Date(a.date); d.setHours(0,0,0,0);
    const diff=Math.ceil((d - today)/(1000*60*60*24));
    const when = diff<0? `${Math.abs(diff)} dias atrás` : diff===0? 'Hoje' : diff===1? 'Amanhã' : `${diff} dias`;
    const notes = (a.notes||'').replace(/"/g,'&quot;');
    return `<tr>
      <td>${d.toLocaleDateString('pt-PT')}</td>
      <td>${a.plate||''}</td>
      <td>${a.car||''}</td>
      <td><span class="badge badge-${a.service}">${a.service||''}</span></td>
      <td>${a.locality||''}</td>
      <td title="${notes}">${a.notes||''}</td>
      <td><span class="chip chip-${a.status}">${a.status||''}</span></td>
      <td>${when}</td>
      <td class="no-print">
        <div class="actions">
          <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar" aria-label="Editar">✏️</button>
          <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar" aria-label="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  const sum=document.getElementById('servicesSummary'); if(sum) sum.textContent=`${future.length} serviços pendentes`;
}

// Helper: tenta apanhar nº de telefone dentro de texto
function extractPhoneFromText(txt){
  if(!txt) return '';
  const m = String(txt).match(/(\+?\d[\d\s()-]{6,})/); // 9+ dígitos
  return m ? m[1].trim() : '';
}

// ---------- Render MOBILE (lista do dia) ----------
function buildMobileCard(a){
  // Ícones oficiais (fallback para emoji se falhar)
  const mapsBtn = a.address ? `
    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer" class="icon-btn" title="Abrir no Google Maps">
      <img src="https://cdn.simpleicons.org/googlemaps/ffffff" alt="Google Maps" width="18" height="18"
           onerror="this.src=''; this.parentElement.textContent='🌍';"/>
    </a>` : '';

  // Botão telefone (se houver número) — único e com classe para forçar branco
  // Botão telefone (agora com SVG inline branco)
const phone = a.phone || extractPhoneFromText(a.extra) || extractPhoneFromText(a.notes);
const telBtn = phone ? `
  <a href="tel:${phone.replace(/\s+/g,'')}" class="icon-btn" title="Telefonar" aria-label="Telefonar">
    <svg viewBox="0 0 24 24" width="18" height="18" role="img" aria-hidden="true">
      <path fill="#fff"
        d="M2.003 5.884l3.065-.611a1 1 0 011.023.51l1.5 2.598a1 1 0 01-.091 1.09l-1.2 1.6a12.044 12.044 0 005.516 5.516l1.6-1.2a1 1 0 011.09-.091l2.598 1.5a1 1 0 01.51 1.023l-.611 3.065A1 1 0 0114 21C7.94 21 3 16.06 3 10a1 1 0 01.815-.985z"/>
    </svg>
  </a>
` : '';

  const wazeBtn = a.address ? `
    <a href="https://waze.com/ul?q=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer" class="icon-btn" title="Abrir no Waze">
      <img src="https://cdn.simpleicons.org/waze/ffffff" alt="Waze" width="18" height="18"
           onerror="this.src=''; this.parentElement.textContent='🗺️';"/>
    </a>` : '';

  const base = getCardBaseColor(a);
  const g = gradFromBase(base);
  const textColor = textColorForBg(base);

  // Hierarquia visual: matrícula em destaque, carro secundário
  const hasIcons = !!(wazeBtn || mapsBtn || telBtn);
  const iconPadding = hasIcons ? 'padding-right: 52px;' : '';

  const plate = (a.plate || '').toUpperCase();
  const car = (a.car || '').toUpperCase();
  const chips = [
    a.period ? `<span class="m-chip">${a.period}</span>` : '',
    a.service ? `<span class="m-chip">${a.service}</span>` : '',
    !isLoja() && a.locality ? `<span class="m-chip">${a.locality}</span>` : '',
    a.calibration ? `<span class="m-chip m-chip-calib">⊕ CALIB</span>` : '',
    a.first_of_day ? `<span class="m-chip" style="background:#f59e0b;color:#fff;font-weight:700;">⭐ 1.º</span>` : ''
  ].filter(Boolean).join('');
  const notes = a.notes ? `<div class="m-info">${a.notes}</div>` : '';
  const isAutoImported = a.auto_imported && a.date;
  const phcFooter = isAutoImported ? `
      <div class="phc-import-footer">
        <div>Importado direto PHC, mantém?</div>
        <div>Confirma status vidro</div>
      </div>` : '';

  const isRealizado = !!a.executed;
  const preAgendadoM = a.confirmed === false;
  const todayISO = localISO(new Date());
  const isPastOrToday = a.date && a.date <= todayISO;

  const statusToggle = isPastOrToday ? `
    <div class="m-status-row">
      <button class="m-status-btn ${!isRealizado ? 'm-status-active-ne' : ''}" data-exec="false" data-id="${a.id}">
        <span class="m-status-dot m-dot-ne"></span>
        N. Realizado
      </button>
      <button class="m-status-btn ${isRealizado ? 'm-status-active-st' : ''}" data-exec="true" data-id="${a.id}">
        <span class="m-status-dot m-dot-st"></span>
        Realizado
      </button>
    </div>` : '';

  return `
    <div class="appointment m-card${preAgendadoM ? ' pre-agendado' : ''}" data-id="${a.id}"
         style="--c1:${g.c1}; --c2:${g.c2}; --tc:${textColor}; position:relative;">
      <div class="map-icons">
        ${wazeBtn}${mapsBtn}${telBtn}
      </div>
      <div style="${iconPadding}">
        <div class="m-title"><span class="m-title-text">${plate}</span></div>
        ${car ? `<div class="m-car">${car}</div>` : ''}
        ${chips ? `<div class="m-chips">${chips}</div>` : ''}
        ${notes}
        ${preAgendadoM ? `<span class="pre-agendado-badge">⏳ Aguarda confirmação</span>` : ''}
        ${preAgendadoM
          ? `<div class="m-pending-confirm">⏳ Aguarda confirmação do coordenador</div>`
          : ''
        }
        ${isLoja() ? '' : buildKmRow(a)}
      </div>
      ${statusToggle}
      ${phcFooter}
    </div>
  `;
}

// ===== [PATCH FINAL] — bootstrap + mobile render =====

// Lista (mobile) do dia — com ordenação por distância
async function renderMobileDay(){
  const list  = document.getElementById('mobileDayList');
  const label = document.getElementById('mobileDayLabel');
  if(!list || !label) return;

  const iso = localISO(currentMobileDay);
  const weekday = currentMobileDay.toLocaleDateString('pt-PT',{ weekday:'long' });
  const dm = currentMobileDay.toLocaleDateString('pt-PT',{ day:'2-digit', month:'2-digit' });
  label.textContent = `${cap(weekday)} • ${dm}`;

  // Itens do dia (base)
  const itemsRaw = filterAppointments(
    appointments
      .filter(a => a.date === iso)
      .sort((a,b) => {
        // Loja: ordenar por período (Manhã/Tarde) e depois sortIndex
        // SM: ordenar apenas por sortIndex (rota optimizada)
        if (isLoja()) {
          return (a.period||'').localeCompare(b.period||'') || (a.sortIndex||0)-(b.sortIndex||0);
        }
        return (a.sortIndex||0) - (b.sortIndex||0);
      })
  );

  // Verificar se já existe ordem otimizada (sortIndex > 1 em algum item)
  const hasOptimizedOrder = itemsRaw.some(item => (item.sortIndex || 0) > 1);
  
  let items;
  if (hasOptimizedOrder) {
    // Se já tem ordem otimizada, usar essa ordem (respeitar sortIndex)
    console.log('✅ MOBILE - Usando ordem otimizada (sortIndex)');
    items = itemsRaw; // Já está ordenado por sortIndex na query acima
  } else {
    // Se não tem ordem otimizada, aplicar ordenação automática
    console.log('🔄 MOBILE - Aplicando ordenação automática');
    items = await ordenarSeNecessario(itemsRaw);
  }

  if(items.length === 0){
    list.innerHTML = `<div class="m-card" style="--c1:#9ca3af;--c2:#6b7280;">Sem serviços para este dia.</div>`;
    return;
  }

  // Mobile SM: mostrar serviços com localidade OU pré-agendamentos importados (sem localidade mas com data)
  // Esconder apenas os que não têm nem data nem localidade (pendentes normais sem atribuição)
  if (!isLoja()) {
    items = items.filter(a => !!a.locality || (!!a.date && a.confirmed === false));
  }

  if(items.length === 0){
    list.innerHTML = `<div class="m-card" style="--c1:#9ca3af;--c2:#6b7280;">Sem serviços confirmados para este dia.</div>`;
    return;
  }

  // Resumo do dia (só SM)
  const summary = buildDaySummary(currentMobileDay, true);
  const allServices = items.map(buildMobileCard).join('');

  list.innerHTML = (summary ? `<div class="mobile-day-summary">${summary}</div>` : '') + allServices || '<p style="text-align:center;color:#6b7280;margin:20px;">Nenhum serviço agendado</p>';
  highlightSearchResults();
}

// Render global
function renderAll(){
  // 🔧 expõe sempre o estado atual para o módulo de impressão
  window.appointments = appointments;
  try { renderSchedule(); } catch(e){ console.error('Erro renderSchedule:', e); }
  try { renderUnscheduled(); } catch(e){ console.error('Erro renderUnscheduled:', e); }
  try { renderServicesTable(); } catch(e){ console.error('Erro renderServicesTable:', e); }
  try { renderMobileDay(); } catch(e){ console.error('Erro renderMobileDay:', e); }
}

// Função global para recarregar appointments (usada pelo switcher do coordenador)
window.reloadAppointments = async function() {
  try {
    const raw = await window.apiClient.getAppointments();
    appointments = raw.map(a => ({
      ...a,
      date: a.date ? String(a.date).slice(0,10) : null,
      address: a.address || a.morada || a.addr || null,
      sortIndex: a.sortIndex || a.sortindex || 1,
      id: a.id ?? (Date.now() + Math.random()),
      createdAt: a.createdAt || a.created_at || null
    }));
    renderAll();
  } catch(e) { console.error('Erro ao recarregar:', e); }
};

// Auto-refresh a cada 30s — mantém vistas sincronizadas entre utilizadores
// Só corre se a página está visível (não gasta bateria em background)
(function startPolling() {
  const INTERVAL = 30000; // 30 segundos
  let timer = null;

  function poll() {
    if (window._pausePolling) return; // aguardar gravação pendente
    if (document.visibilityState === 'visible' && window.reloadAppointments) {
      window.reloadAppointments().catch(() => {});
    }
  }

  function start() { if (!timer) timer = setInterval(poll, INTERVAL); }
  function stop()  { if (timer) { clearInterval(timer); timer = null; } }

  // Pausa quando a aba está em background, retoma quando volta ao primeiro plano
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { poll(); start(); }
    else stop();
  });

  // Inicia após o portalReady (dados já carregados)
  window.addEventListener('portalReady', () => setTimeout(start, 5000), { once: true });
})();

// ===== RELATÓRIO SEMANAL =====
function buildRelatorio() {
  const el = document.getElementById('relatorioContent');
  if (!el) return;

  // Semana actual (seg–sáb)
  const week = [...Array(6)].map((_, i) => addDays(currentMonday, i));
  const weekStart = week[0].toLocaleDateString('pt-PT', {day:'2-digit', month:'2-digit'});
  const weekEnd   = week[5].toLocaleDateString('pt-PT', {day:'2-digit', month:'2-digit', year:'numeric'});

  const loja = isLoja();

  // Filtrar agendamentos da semana
  const isoWeek = week.map(d => localISO(d));
  const weekAppts = appointments.filter(a => a.date && isoWeek.includes(a.date));

  const total     = weekAppts.length;
  const realized  = weekAppts.filter(a => !!a.executed).length;
  const notDone   = total - realized;

  let html = `<div style="font-family:'Figtree',sans-serif;">
    <div style="font-size:13px;color:#6b7280;margin-bottom:16px;">${weekStart} — ${weekEnd}</div>`;

  // Resumo de serviços
  html += `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
      <div class="rel-stat">
        <div class="rel-n">${total}</div>
        <div class="rel-l">Agendados</div>
      </div>
      <div class="rel-stat rel-stat-green">
        <div class="rel-n">${realized}</div>
        <div class="rel-l">Realizados</div>
      </div>
      <div class="rel-stat rel-stat-red">
        <div class="rel-n">${notDone}</div>
        <div class="rel-l">Não realizados</div>
      </div>
    </div>`;

  // SM: totais de km, horas e combustível — mesma lógica do buildDaySummary por dia
  if (!loja) {
    let totalKm = 0, totalTravelMin = 0, totalServiceMin = 0;

    week.forEach(d => {
      const iso = localISO(d);
      const items = appointments.filter(a => a.date === iso)
        .sort((a,b) => (a.sortIndex||0) - (b.sortIndex||0))
        .filter(a => !!a.locality); // só confirmados

      if (!items.length) return;

      // KM com regresso (igual ao buildDaySummary)
      let dayKm = 0, hasKm = false, lastKm = 0;
      items.forEach((a, i) => {
        const km = getKmValue(a);
        if (km != null && km > 0) { dayKm += km; hasKm = true; if (i === 0) lastKm = km; }
      });
      const returnKm = hasKm ? Math.round(lastKm * 0.5) : 0;
      totalKm += dayKm + returnKm;

      // Tempo de viagem (Google Maps ou estimativa)
      let dayTravel = 0, hasGoogle = false;
      items.forEach(a => { const tt = a.travelTime || a.travel_time || 0; if (tt > 0) { dayTravel += tt; hasGoogle = true; } });
      if (!hasGoogle && hasKm) dayTravel = Math.round((dayKm / ROUTE_CONFIG.avgSpeedKmh) * 60);
      const returnMin = hasGoogle ? Math.round(dayTravel * 0.15) : Math.round((returnKm / ROUTE_CONFIG.avgSpeedKmh) * 60);
      totalTravelMin += dayTravel + returnMin;

      // Tempo de execução
      items.forEach(a => { totalServiceMin += getServiceTime(a.service, a.vehicleType || a.vehicle_type, a.calibration); });
    });

    const totalMin = totalTravelMin + totalServiceMin;
    const totalHours = Math.floor(totalMin / 60);
    const totalMins  = totalMin % 60;
    const fuelL = (totalKm * ROUTE_CONFIG.fuelPer100km / 100).toFixed(1);
    const fuelEur = (fuelL * ROUTE_CONFIG.fuelPricePerLiter).toFixed(2);

    html += `
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:4px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-bottom:12px;">Serviço Móvel</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
          <div class="rel-stat">
            <div class="rel-n" style="font-size:22px;">🛣️ ${totalKm} km</div>
            <div class="rel-l">Total km</div>
          </div>
          <div class="rel-stat">
            <div class="rel-n" style="font-size:22px;">⏱️ ${totalHours}h${String(totalMins).padStart(2,'0')}</div>
            <div class="rel-l">Horas trabalho</div>
          </div>
          <div class="rel-stat">
            <div class="rel-n" style="font-size:22px;">⛽ ${fuelL}L</div>
            <div class="rel-l">Combustível</div>
          </div>
          <div class="rel-stat rel-stat-orange">
            <div class="rel-n" style="font-size:22px;">💰 ${fuelEur}€</div>
            <div class="rel-l">Custo combustível</div>
          </div>
        </div>
      </div>`;
  }

  // Lista dia a dia
  html += `<div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-bottom:10px;">Por dia</div>`;

  week.forEach(d => {
    const iso = localISO(d);
    const dayAppts = weekAppts.filter(a => a.date === iso);
    if (!dayAppts.length) return;
    const dR = dayAppts.filter(a => !!a.executed).length;
    const dN = dayAppts.length - dR;
    const dayLabel = d.toLocaleDateString('pt-PT', {weekday:'short', day:'2-digit', month:'2-digit'});
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;">
      <span style="font-weight:600;color:#374151;">${dayLabel}</span>
      <span>
        <span style="color:#16a34a;font-weight:700;">${dR} ✓</span>
        <span style="color:#6b7280;margin:0 4px;">/</span>
        <span style="color:#dc2626;font-weight:700;">${dN} ✗</span>
        <span style="color:#9ca3af;font-size:12px;margin-left:4px;">(${dayAppts.length} total)</span>
      </span>
    </div>`;
  });

  html += `</div></div>`;
  el.innerHTML = html;
}

// Selector Pré-agendamento / Confirmado
function setConfirmed(value) {
  document.getElementById('appointmentConfirmed').value = value ? 'true' : 'false';
  const btnPre  = document.getElementById('btnPreAgendado');
  const btnConf = document.getElementById('btnConfirmado');
  if (!btnPre || !btnConf) return;
  if (value) {
    btnConf.style.cssText = 'padding:14px 10px;border-radius:10px;border:2px solid #16a34a;background:#dcfce7;color:#14532d;font-weight:800;font-size:14px;cursor:pointer;';
    btnPre.style.cssText  = 'padding:14px 10px;border-radius:10px;border:2px solid #d1d5db;background:#f9fafb;color:#6b7280;font-weight:800;font-size:14px;cursor:pointer;';
  } else {
    btnPre.style.cssText  = 'padding:14px 10px;border-radius:10px;border:2px solid #f59e0b;background:#fef3c7;color:#92400e;font-weight:800;font-size:14px;cursor:pointer;';
    btnConf.style.cssText = 'padding:14px 10px;border-radius:10px;border:2px solid #d1d5db;background:#f9fafb;color:#6b7280;font-weight:800;font-size:14px;cursor:pointer;';
  }
}


function bootApp() {
  (async () => {
    try { await loadRouteSettings(); } catch(e){ console.warn('loadRouteSettings falhou', e); }
    try { await load(); } catch(e){ console.error('load() falhou', e); }
    try { buildLocalityOptions?.(); } catch(e){}
    renderAll();
  document.querySelector('.locality-select')?.addEventListener('click', toggleLocalityDropdown);


  // Navegação mínima (se existirem botões)
  document.getElementById('todayWeek')?.addEventListener('click', ()=>{ currentMonday = getMonday(new Date()); renderAll(); });
  document.getElementById('prevWeek')?.addEventListener('click', ()=>{ currentMonday = addDays(currentMonday, -7); renderAll(); });
  document.getElementById('nextWeek')?.addEventListener('click', ()=>{ currentMonday = addDays(currentMonday,  7); renderAll(); });

  document.getElementById('prevDay')?.addEventListener('click', ()=>{ currentMobileDay = addDays(currentMobileDay, -1); renderMobileDay(); });
  document.getElementById('todayDay')?.addEventListener('click', ()=>{ currentMobileDay = new Date(); currentMobileDay.setHours(0,0,0,0); renderMobileDay(); });
  document.getElementById('nextDay')?.addEventListener('click', ()=>{ currentMobileDay = addDays(currentMobileDay, 1); renderMobileDay(); });

  // Status toggle nos cards mobile (delegado) — usa campo executed
  document.getElementById('mobileDayList')?.addEventListener('click', async (e) => {
    // Confirmar agendamento
    const confirmBtn = e.target.closest('[data-confirm]');
    if (confirmBtn) {
      await persistConfirmed(confirmBtn.dataset.confirm, true);
      return;
    }
    // Realizado/N.Realizado
    const btn = e.target.closest('[data-exec]');
    if (!btn) return;
    const id = btn.dataset.id;
    const executed = btn.dataset.exec === 'true';
    if (!id) return;
    await persistExecuted(id, executed);
  });

  // Botão Calcular Rotas - Abrir modal de seleção de dia
  document.getElementById('calculateRoutes')?.addEventListener('click', openSelectDayModal);

  // ── Relatório semanal (mobile + desktop) ──
  const openRelatorio = () => {
    buildRelatorio();
    document.getElementById('relatorioModal')?.classList.add('show');
  };
  document.getElementById('btnRelatorio')?.addEventListener('click', openRelatorio);
  document.getElementById('btnRelatorioDesk')?.addEventListener('click', openRelatorio);
  document.getElementById('closeRelatorio')?.addEventListener('click', () => {
    document.getElementById('relatorioModal')?.classList.remove('show');
  });

  // Event listeners para edição
  document.getElementById('cancelForm')?.addEventListener('click', cancelEdit);
  document.getElementById('closeModal')?.addEventListener('click', cancelEdit);
  document.getElementById('deleteAppointment')?.addEventListener('click', function() {
    if (editingId) deleteAppointment(editingId);
  });

  // === Guardar Agendamento (criar/editar) ===
(function hookFormSubmit() {
  const form = document.getElementById('appointmentForm');
  const saveBtn = document.getElementById('saveAppointment'); // se existir
  if (!form) return;

  async function collectFormData() {
    const get = id => document.getElementById(id)?.value?.trim() || '';

    // normaliza data p/ YYYY-MM-DD
    const rawDate = get('appointmentDate');   // dd/mm/aaaa ou yyyy-mm-dd
    let date = '';
    if (rawDate) {
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
        const [d,m,y] = rawDate.split('/');
        date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        date = rawDate;
      }
    }

    // ===== CÁLCULO AUTOMÁTICO DE QUILÓMETROS =====
    let calculatedKm = null;
    const address = get('appointmentAddress');
    
    if (address) {
      try {
        showToast('Calculando distância...', 'info');
        const distanceInMeters = await getDistance(getBasePartida(), address);
        if (distanceInMeters !== Infinity && distanceInMeters > 0) {
          calculatedKm = Math.round(distanceInMeters / 1000); // converter metros para km
          // Atualizar o campo visual dos quilómetros
          const kmField = document.getElementById('appointmentKm');
          if (kmField) {
            kmField.value = calculatedKm;
          }
          showToast(`Distância calculada: ${calculatedKm} km`, 'success');
        } else {
          showToast('Não foi possível calcular a distância', 'error');
        }
      } catch (error) {
        console.error('Erro ao calcular distância:', error);
        showToast('Erro ao calcular distância', 'error');
      }
    }

    return {
      // campos base
      date,
      plate:  get('appointmentPlate').toUpperCase(),
      car:    get('appointmentCar'),
      service:get('appointmentService'),
      locality:get('appointmentLocality'),
      notes:  get('appointmentNotes'),
      address:get('appointmentAddress'),
      phone:  get('appointmentPhone'),
      extra:  get('appointmentExtra'),
      status: (document.getElementById('appointmentStatus')?.value || 'NE'),
      vehicleType: (document.getElementById('appointmentVehicleType')?.value || localStorage.getItem('eg_last_vehicleType') || 'L'),
      calibration: document.getElementById('appointmentCalibration')?.checked || false,
      first_of_day: document.getElementById('appointmentFirstOfDay')?.checked || false,
      // ===== ADICIONAR OS QUILÓMETROS CALCULADOS =====
      km: calculatedKm,
      confirmed: document.getElementById('appointmentConfirmed')?.value !== 'false'
    };
  }

  async function onSubmit(e) {
    e?.preventDefault?.();

    const payload = await collectFormData();

    // Guardar último tipo de veículo selecionado
    if (payload.vehicleType) localStorage.setItem('eg_last_vehicleType', payload.vehicleType);

    // defaults mínimos
    if (!payload.plate) { showToast('Matrícula é obrigatória', 'error'); return; }
    if (!payload.service) { showToast('Tipo de serviço é obrigatório', 'error'); return; }
    if (!payload.locality && !isLoja()) { showToast('Localidade é obrigatória', 'error'); return; }

    try {
      if (editingId) {
        // UPDATE
        const updated = await window.apiClient.updateAppointment(editingId, payload);
        // aplica no array local
        const idx = appointments.findIndex(a => String(a.id) === String(editingId));
        if (idx >= 0) appointments[idx] = { ...appointments[idx], ...updated, ...payload };
        showToast('Agendamento atualizado', 'success');
      } else {
        // CREATE
        const created = await window.apiClient.createAppointment(payload);
        
        // ✨ ELIMINAR SERVIÇO ORIGINAL: Se foi preenchido de um serviço por agendar
        if (window.originalUnscheduledServiceId && payload.date) {
          try {
            console.log('🗑️ Eliminando serviço original por agendar:', window.originalUnscheduledServiceId);
            await window.apiClient.deleteAppointment(window.originalUnscheduledServiceId);
            
            // Remover do array local
            const index = appointments.findIndex(a => String(a.id) === String(window.originalUnscheduledServiceId));
            if (index > -1) {
              appointments.splice(index, 1);
            }
            
            console.log('✅ Serviço original eliminado com sucesso');
          } catch (error) {
            console.error('⚠️ Erro ao eliminar serviço original:', error);
          } finally {
            // Limpar ID guardado
            window.originalUnscheduledServiceId = null;
          }
        }
       
       // Refaça o array e redesenha já
appointments = await window.apiClient.getAppointments();

// 🔧 NORMALIZAÇÃO (igual ao load)
appointments = appointments.map(a => ({
  ...a,
  date: a.date ? String(a.date).slice(0, 10) : null,
  address: a.address || a.morada || a.addr || null,
  sortIndex: a.sortIndex || 1,
  id: a.id ?? (Date.now() + Math.random())
}));

renderAll();

// (opcional) fechar modal
cancelEdit?.();

// ⛔️ APAGAR/COMENTAR tudo o que estava aqui:
// // 👉 Mete já no array em memória e força re-render
// const id = created?.id ?? (Date.now() + Math.random());
// const newItem = { ...payload, id, ...normalização... };
// appointments = [newItem]; // ou qualquer atribuição que substitua a lista
// renderAll();

        const item = { id: created?.id || (Date.now()+Math.random()), sortIndex: 1, ...payload, ...created };
        appointments.push(item);
        showToast('Agendamento criado', 'success');
      }

      // re-render e fechar modal
      renderAll();
      document.getElementById('appointmentModal')?.classList?.remove('show');
      form.reset();
      editingId = null;

    } catch (err) {
      // fallback offline (caso a API falhe)
      try {
        if (editingId) {
          const local = window.apiClient.updateAppointmentOffline(editingId, payload);
          const idx = appointments.findIndex(a => String(a.id) === String(editingId));
          if (idx >= 0) appointments[idx] = { ...appointments[idx], ...local };
        } else {
          const local = window.apiClient.createAppointmentOffline(payload);
          appointments.push(local);
        }
        renderAll();
        showToast('Guardado localmente (offline).', 'info');
        document.getElementById('appointmentModal')?.classList?.remove('show');
        form.reset();
        editingId = null;
      } catch (e2) {
        showToast('Falha ao guardar: ' + e2.message, 'error');
      }
    }
  }

  // garante que o botão "Guardar" submete o form
  form.addEventListener('submit', onSubmit);
  if (saveBtn) saveBtn.addEventListener('click', onSubmit);
})();

  
  // --- Novo Serviço (desktop) ---
  document.getElementById('addServiceBtn')?.addEventListener('click', () => {
    editingId = null;
    document.getElementById('appointmentForm').reset();
    document.getElementById('modalTitle').textContent = 'Novo Agendamento';
    document.getElementById('deleteAppointment').classList.add('hidden');
    setConfirmed(false); // default: pré-agendamento

    // Carregar último tipo de veículo usado
    const lastVT = localStorage.getItem('eg_last_vehicleType') || 'L';
    const vtSelect = document.getElementById('appointmentVehicleType');
    if (vtSelect) vtSelect.value = lastVT;

    // Reset dropdown da localidade
    const selectedText = document.getElementById('selectedLocalityText');
    const selectedDot = document.getElementById('selectedLocalityDot');
    if (selectedText && selectedDot) {
      selectedText.textContent = 'Selecione a localidade';
      selectedDot.style.backgroundColor = '';
    }

    document.getElementById('appointmentModal').classList.add('show');
    
    // 🎯 FOCO AUTOMÁTICO: Colocar cursor no campo de matrícula
    setTimeout(() => {
      const plateInput = document.getElementById('appointmentPlate');
      if (plateInput) {
        plateInput.focus();
      }
    }, 100);
  });

  // --- Novo Serviço (mobile) ---
  document.getElementById('addServiceMobile')?.addEventListener('click', () => {
    editingId = null;
    document.getElementById('appointmentForm').reset();
    document.getElementById('modalTitle').textContent = 'Novo Agendamento';
    document.getElementById('deleteAppointment').classList.add('hidden');
    setConfirmed(false); // default: pré-agendamento

    // Carregar último tipo de veículo usado
    const lastVT = localStorage.getItem('eg_last_vehicleType') || 'L';
    const vtSelect = document.getElementById('appointmentVehicleType');
    if (vtSelect) vtSelect.value = lastVT;

    const selectedText = document.getElementById('selectedLocalityText');
    const selectedDot = document.getElementById('selectedLocalityDot');
    if (selectedText && selectedDot) {
      selectedText.textContent = 'Selecione a localidade';
      selectedDot.style.backgroundColor = '';
    }

    document.getElementById('appointmentModal').classList.add('show');
    
    // 🎯 FOCO AUTOMÁTICO: Colocar cursor no campo de matrícula
    setTimeout(() => {
      const plateInput = document.getElementById('appointmentPlate');
      if (plateInput) {
        plateInput.focus();
      }
    }, 100);
  });

  // --- Importar Excel ---
  document.getElementById('importExcelBtn')?.addEventListener('click', () => {
    openExcelImportModal();
  });
  
  // --- Limpar Todos os Serviços por Agendar ---
  document.getElementById('clearAllUnscheduledBtn')?.addEventListener('click', async () => {
    const unscheduled = appointments.filter(a => !a.date);
    
    if (unscheduled.length === 0) {
      showToast('ℹ️ Não há serviços por agendar para limpar.', 'info');
      return;
    }
    
    const confirmMessage = `Tem a certeza que pretende eliminar TODOS os ${unscheduled.length} serviços por agendar?\n\nEsta ação não pode ser revertida!`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    try {
      showToast('🗑️ A eliminar serviços...', 'info');
      
      let successCount = 0;
      let errorCount = 0;
      
      // Eliminar cada serviço individualmente
      for (const service of unscheduled) {
        try {
          await window.apiClient.deleteAppointment(service.id);
          const index = appointments.findIndex(a => String(a.id) === String(service.id));
          if (index > -1) {
            appointments.splice(index, 1);
          }
          successCount++;
        } catch (error) {
          console.error(`Erro ao eliminar serviço ${service.id}:`, error);
          errorCount++;
        }
      }
      
      renderAll();
      
      if (errorCount === 0) {
        showToast(`✅ ${successCount} serviços eliminados com sucesso!`, 'success');
      } else {
        showToast(`⚠️ ${successCount} serviços eliminados, ${errorCount} falharam.`, 'warning');
      }
      
    } catch (error) {
      showToast('❌ Erro ao eliminar serviços: ' + error.message, 'error');
    }
  });
  })(); // fecho do async IIFE dentro de bootApp
} // fecho de bootApp

// Aguardar que o portal-init.js termine (dispara 'portalReady')
// antes de carregar os dados — resolve race condition no arranque
window.addEventListener('portalReady', bootApp, { once: true });

// Fallback: se o portal-init não disparar o evento (ex: redirect para login),
// não fazer nada — a página vai redirecionar de qualquer forma

// === PRINT: Preenche secções de impressão (Hoje, Amanhã, Por Agendar) ===
(function(){
  if (window.fillPrintFromAppointments) return; // evitar duplicar
  function toISO(d){
    if (!(d instanceof Date)) d = new Date(d);
    d.setHours(0,0,0,0);
    const z = new Date(d.getTime() - d.getTimezoneOffset()*60000);
    return z.toISOString().slice(0,10);
  }
  function cap(s){ return (s||'').toString().charAt(0).toUpperCase()+ (s||'').toString().slice(1); }
    function normPeriod(p){
      return ''; // Sem períodos
    }
  // Função para serviços agendados (Hoje/Amanhã) - 7 colunas
  function rowScheduled(a){
    const dataFormatada = a.date ? new Date(a.date).toLocaleDateString('pt-PT') : '—';
    
    return `<tr>
      <td>${dataFormatada}</td>
      <td>${a.plate||'—'}</td>
      <td>${(a.car||'').toUpperCase()}</td>
      <td>${a.service||'—'}</td>
      <td>${a.locality||'—'}</td>
      <td>${a.notes || a.observations || '—'}</td>
      <td>${a.status||'—'}</td>
    </tr>`;
  }
  
  // Função para serviços por agendar - 8 colunas (com Data Criação)
  function rowUnscheduled(a){
    const dataFormatada = a.date ? new Date(a.date).toLocaleDateString('pt-PT') : '—';
    const dataCriacao = a.createdAt ? formatDateShort(a.createdAt) : '—';
    
    // Calcular antiguidade e aplicar cor
    let rowClass = '';
    if (!a.date && a.createdAt) {
      const dias = calcularDiasDesde(a.createdAt);
      if (dias >= 8) {
        rowClass = 'antiguidade-vermelho';
      } else if (dias >= 5) {
        rowClass = 'antiguidade-laranja';
      } else if (dias >= 3) {
        rowClass = 'antiguidade-amarelo';
      }
    }
    
    return `<tr class="${rowClass}">
      <td>${dataFormatada}</td>
      <td>${dataCriacao}</td>
      <td>${a.plate||'—'}</td>
      <td>${(a.car||'').toUpperCase()}</td>
      <td>${a.service||'—'}</td>
      <td>${a.locality||'—'}</td>
      <td>${a.notes || a.observations || '—'}</td>
      <td>${a.status||'—'}</td>
    </tr>`;
  }
  
  // Formatar data no formato DD.MM.YY
  function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}.${month}.${year}`;
  }
  
  // Calcular dias desde uma data
  function calcularDiasDesde(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    const diffMs = hoje - d;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
  function buildTable(title, dateLabel, list){
    const headDate = dateLabel ? `<div class="print-date">${dateLabel}</div>` : '';
    const empty = list.length===0 ? `<div class="print-empty">Sem registos</div>` : '';
    
    // Cabeçalho diferente para "Serviços por Agendar" (com coluna Data Criação)
    const isUnscheduled = title.includes('POR AGENDAR');
    const tableHeader = isUnscheduled 
      ? '<thead><tr><th>Data</th><th>Data Criação</th><th>Matrícula</th><th>Carro</th><th>Serviço</th><th>Localidade</th><th>Observações</th><th>Estado</th></tr></thead>'
      : '<thead><tr><th>Data</th><th>Matrícula</th><th>Carro</th><th>Serviço</th><th>Localidade</th><th>Observações</th><th>Estado</th></tr></thead>';
    
    // Usar função de linha apropriada conforme tipo de tabela
    const rowFunction = isUnscheduled ? rowUnscheduled : rowScheduled;
    
    return `<section class="print-section">
      <h2 class="print-title">${title}</h2>
      ${headDate}
      <table class="print-table">
        ${tableHeader}
        <tbody>${list.map(rowFunction).join('')}</tbody>
      </table>
      ${empty}
    </section>`;
  }
  window.fillPrintFromAppointments = function(){
    try{
      const contOld = document.getElementById('print-container-temp');
      if (contOld) contOld.remove();
      const cont = document.createElement('div');
      cont.id = 'print-container-temp';
      document.body.appendChild(cont);

      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);

      const isoToday = toISO(today);
      const isoTomorrow = toISO(tomorrow);

      const list = (Array.isArray(window.appointments)? window.appointments : []).slice();

        const unscheduled = list.filter(a => !a.date)
                            .sort((a,b)=> {
                              // Ordenar por data de criação (mais antigos primeiro)
                              const dateA = a.createdAt ? new Date(a.createdAt) : new Date();
                              const dateB = b.createdAt ? new Date(b.createdAt) : new Date();
                              return dateA - dateB;
                            });
      const todayServices = list.filter(a => a.date === isoToday)
                            .sort((a,b)=> (a.sortIndex||0)-(b.sortIndex||0));
      const tomorrowServices = list.filter(a => a.date === isoTomorrow)
                               .sort((a,b)=> (a.sortIndex||0)-(b.sortIndex||0));

      const dm = d => new Date(d).toLocaleDateString('pt-PT', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' });
      const titleToday = `SERVIÇOS DE HOJE`;
      const titleTomorrow = `SERVIÇOS DE AMANHÃ`;
      const titleUnscheduled = `SERVIÇOS POR AGENDAR`;

      cont.innerHTML = [
        buildTable(titleToday, cap(dm(today)), todayServices),
        buildTable(titleTomorrow, cap(dm(tomorrow)), tomorrowServices),
        buildTable(titleUnscheduled, '', unscheduled),
      ].join('');

      }catch(e){
    console.error('fillPrintFromAppointments falhou:', e);
  }
  };         
})();         

// === Máscara da matrícula ===
(function initPlateMask(){
  const el = document.getElementById('appointmentPlate');
  if (!el) return;

  el.addEventListener('input', (e) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const parts = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)].filter(Boolean);
    e.target.value = parts.join('-');
  });

  el.addEventListener('blur', (e) => {
    const ok = /^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/.test(e.target.value);
    e.target.setCustomValidity(ok ? '' : 'Use o formato XX-XX-XX');
    tryAutoFill(e.target.value);
  });

  // Também tentar no input (útil quando matrícula é colada ou preenchida pelo browser)
  let autoFillTimer = null;
  el.addEventListener('input', (e) => {
    clearTimeout(autoFillTimer);
    autoFillTimer = setTimeout(() => tryAutoFill(e.target.value), 400);
  });

  function tryAutoFill(rawPlate) {
    if (editingId) return; // só para novos agendamentos
    const norm = rawPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (norm.length < 6) return;

    // Procurar matrícula em TODOS os registos (pendentes e agendados)
    const existingService = appointments.find(a =>
      a.plate && a.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase() === norm
    );

    if (existingService) {
      // Usar editingId para actualizar o registo existente
      editingId = existingService.id;
      window.originalUnscheduledServiceId = null;

      // Preencher campos
      if (existingService.car) document.getElementById('appointmentCar').value = existingService.car;
      if (existingService.service) document.getElementById('appointmentService').value = existingService.service;
      if (existingService.locality) document.getElementById('appointmentLocality').value = existingService.locality;
      if (existingService.notes) document.getElementById('appointmentNotes').value = existingService.notes;
      if (existingService.address) document.getElementById('appointmentAddress').value = existingService.address;
      if (existingService.phone) document.getElementById('appointmentPhone').value = existingService.phone;
      if (existingService.extra) document.getElementById('appointmentExtra').value = existingService.extra;
      if (existingService.status) {
        const statusEl = document.getElementById('appointmentStatus');
        if (statusEl) statusEl.value = existingService.status;
      }
      // NÃO alterar o estado confirmed — manter o que o coordenador seleccionou

      showToast('✨ Dados preenchidos automaticamente', 'info');
    }
  }
})();


// === Autocomplete de Morada (Google Places) ===
(function initAddressAutocomplete(){
  const input = document.getElementById('appointmentAddress');
  if (!input) return;

  function run() {
    if (!(window.google && google.maps && google.maps.places)) {
      console.warn('Google Places API ainda não disponível.');
      return;
    }

    // ⚠️ Sem 'types' e sem 'fields' — assim apanha moradas *e* empresas/POIs
    const ac = new google.maps.places.Autocomplete(input, {
      fields: ['place_id', 'name', 'formatted_address', 'address_components']
    });

    if (ac.setComponentRestrictions) {
      ac.setComponentRestrictions({ country: ['pt'] });
    }

    ac.addListener('place_changed', async () => {
      const place = ac.getPlace();
      const txt = [place?.name, place?.formatted_address]
        .filter(Boolean)
        .join(' - ');
      if (txt) {
        input.value = txt;

        // Extrair localidade dos address_components
        if (place.address_components) {
          // Tentar: locality → administrative_area_level_2 → postal_town
          const types = ['locality', 'postal_town', 'administrative_area_level_2'];
          let detectedLocality = null;
          for (const type of types) {
            const comp = place.address_components.find(c => c.types.includes(type));
            if (comp) { detectedLocality = comp.long_name; break; }
          }

          if (detectedLocality) {
            // Verificar se corresponde a alguma localidade conhecida
            const localityField = document.getElementById('appointmentLocality');
            const currentLocality = localityField?.value || '';
            const known = window._localityList || [];
            const match = known.find(l => 
              l.toLowerCase() === detectedLocality.toLowerCase() ||
              detectedLocality.toLowerCase().includes(l.toLowerCase()) ||
              l.toLowerCase().includes(detectedLocality.toLowerCase())
            );
            const toSet = match || detectedLocality;

            if (currentLocality && currentLocality !== toSet) {
              showToast(`📍 Localidade actualizada: ${toSet}`, 'info');
            } else if (!currentLocality) {
              showToast(`📍 Localidade detectada: ${toSet}`, 'success');
            }

            if (toSet && typeof window.selectLocality === 'function') {
              window.selectLocality(toSet);
            } else if (localityField) {
              localityField.value = toSet;
            }
          } else {
            showToast('📍 Não foi possível detectar a localidade — preenche manualmente', 'warning');
          }
        }

        // Calcular distância automaticamente
        try {
          showToast('Calculando distância...', 'info');
          const distanceInMeters = await getDistance(getBasePartida(), txt);
          if (distanceInMeters !== Infinity && distanceInMeters > 0) {
            const calculatedKm = Math.round(distanceInMeters / 1000);
            const kmField = document.getElementById('appointmentKm');
            if (kmField) kmField.value = calculatedKm;
            showToast(`Distância calculada: ${calculatedKm} km`, 'success');
          } else {
            showToast('Não foi possível calcular a distância', 'error');
          }
        } catch (error) {
          console.error('Erro ao calcular distância:', error);
          showToast('Erro ao calcular distância', 'error');
        }
      }
    });
  }

  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();


// === Localidade: handlers mínimos (fix undefined) ===
window.toggleLocalityDropdown = function () {
  const dd = document.getElementById('localityDropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open') || dd.classList.contains('show');
  dd.classList.toggle('open');
  dd.classList.toggle('show');
  if (!isOpen) {
    // Ao abrir: limpar pesquisa, mostrar favoritas, focar input
    const search = document.getElementById('localitySearch');
    if (search) {
      search.value = '';
      renderLocalityOptions('');
      setTimeout(() => search.focus(), 50);
    }
  }
};

window.selectLocality = function (value) {
  const field = document.getElementById('appointmentLocality');
  const txt   = document.getElementById('selectedLocalityText');
  const dot   = document.getElementById('selectedLocalityDot');
  if (field) field.value = value || '';
  if (txt)   txt.textContent = value || 'Selecione a localidade';
  if (dot)   dot.style.backgroundColor = value ? getLocColor(value) : '';
  const dd = document.getElementById('localityDropdown');
  dd?.classList.remove('open'); dd?.classList.remove('show');
  // Limpar pesquisa
  const search = document.getElementById('localitySearch');
  if (search) search.value = '';
};

// fecha o dropdown ao clicar fora
document.addEventListener('click', (e) => {
  const ac = document.getElementById('localityAutocomplete');
  if (!ac) return;
  if (!ac.contains(e.target)) {
    const dd = document.getElementById('localityDropdown');
    dd?.classList.remove('open'); dd?.classList.remove('show');
  }
});


// ========== FUNCIONALIDADES DE PROCURA E VISTA TABELA ==========

// Formatação automática da matrícula na caixa de procura
function formatPlateInput(input) {
  let value = input.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (value.length > 6) value = value.substring(0, 6);
  
  if (value.length >= 2) {
    value = value.substring(0, 2) + '-' + value.substring(2);
  }
  if (value.length >= 6) {
    value = value.substring(0, 5) + '-' + value.substring(5);
  }
  
  input.value = value;
}

// Filtrar serviços por matrícula
function filterServicesByPlate(searchTerm) {
  const normalizedSearch = searchTerm.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  
  // Filtrar linhas da tabela
  const rows = document.querySelectorAll('#unscheduledTableBody tr');
  rows.forEach(row => {
    const plate = row.getAttribute('data-plate') || '';
    const normalizedPlate = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    
    if (normalizedSearch === '' || normalizedPlate.includes(normalizedSearch)) {
      row.classList.remove('filtered-out');
    } else {
      row.classList.add('filtered-out');
    }
  });
}

// Vista em tabela é agora a única vista disponível

// Inicializar funcionalidades quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {

  // ── Backup / Restaurar (independente do portalReady) ──
  function openBackupModal() {
    document.getElementById('backupModal')?.classList.add('show');
  }
  function closeBackupModalFn() {
    document.getElementById('backupModal')?.classList.remove('show');
    const s = document.getElementById('restoreStatus');
    if (s) { s.style.display = 'none'; s.textContent = ''; }
    const fi = document.getElementById('restoreFile');
    if (fi) fi.value = '';
  }

  document.getElementById('btnBackupRapido')?.addEventListener('click', openBackupModal);
  document.getElementById('backupBtn')?.addEventListener('click', openBackupModal);
  document.getElementById('closeBackupModal')?.addEventListener('click', closeBackupModalFn);
  document.getElementById('backupModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'backupModal') closeBackupModalFn();
  });

  document.getElementById('btnExportBackup')?.addEventListener('click', async () => {
    try {
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      const role = window.authClient?.getUser()?.role;
      const isAdmin = role === 'admin';

      let appts, filename, exportData;

      if (isAdmin) {
        // Admin: backup geral de todos os portais
        const token = window.authClient?.getToken();
        const resp = await fetch('/.netlify/functions/backup-all', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Erro no backup');
        appts = data.appointments;
        filename = `backup_GERAL_${stamp}.json`;
        exportData = { exportedAt: data.exportedAt, portals: data.portals, total: data.total, appointments: appts };
      } else {
        // Outros: só portal activo
        appts = window.appointments || [];
        if (!appts.length) { alert('Sem agendamentos para exportar.'); return; }
        const portalName = (window.portalConfig?.name || 'portal').replace(/\s+/g, '-');
        filename = `backup_${portalName}_${stamp}.json`;
        exportData = { portal: portalName, exportedAt: now.toISOString(), total: appts.length, appointments: appts };
      }

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      alert(`✅ Backup guardado: ${filename}\n${appts.length} agendamentos exportados.`);
    } catch(e) { alert('Erro ao criar backup: ' + e.message); }
  });

  document.getElementById('btnChooseRestore')?.addEventListener('click', () => {
    document.getElementById('restoreFile')?.click();
  });

  document.getElementById('restoreFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const statusEl = document.getElementById('restoreStatus');
    statusEl.style.display = 'block';
    statusEl.style.color = '#6b7280';
    statusEl.textContent = '⏳ A ler ficheiro...';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const toRestore = data.appointments || (Array.isArray(data) ? data : []);
      if (!toRestore.length) {
        statusEl.style.color = '#dc2626';
        statusEl.textContent = '❌ Ficheiro vazio ou inválido.';
        return;
      }
      statusEl.textContent = `⏳ A restaurar ${toRestore.length} agendamentos...`;
      const existing = new Set((window.appointments||[]).map(a => (a.plate||'').replace(/[^A-Z0-9]/gi,'').toUpperCase()));
      let created = 0, skipped = 0, errors = 0;
      for (const appt of toRestore) {
        const n = (appt.plate||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
        if (existing.has(n)) { skipped++; continue; }
        try {
          const { id, ...payload } = appt;
          await window.apiClient.createAppointment(payload);
          existing.add(n); created++;
        } catch(err) {
          if (err.message?.includes('já existe')) skipped++;
          else errors++;
        }
      }
      statusEl.style.color = '#16a34a';
      statusEl.textContent = `✅ ${created} restaurados, ${skipped} ignorados${errors ? `, ${errors} erros` : ''}.`;
      if (created > 0 && typeof renderAll === 'function') {
        if (typeof load === 'function') await load();
        renderAll();
      }
    } catch(err) {
      statusEl.style.color = '#dc2626';
      statusEl.textContent = '❌ Erro: ' + err.message;
    }
    e.target.value = '';
  });

  // Event listener para caixa de procura
  const searchInput = document.getElementById('searchPlate');
  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      formatPlateInput(e.target);
      filterServicesByPlate(e.target.value);
    });
    
    searchInput.addEventListener('keydown', function(e) {
      // Permitir apenas letras, números e teclas de controle
      const allowedKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!allowedKeys.includes(e.key) && !/^[A-Za-z0-9]$/.test(e.key)) {
        e.preventDefault();
      }
    });
  }
  
  // Vista em tabela é agora a única vista disponível
});
