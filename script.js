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
// ===== CACHE DE DISTÂNCIAS — evitar chamadas repetidas à Distance Matrix API =====
const _distCache = (() => {
  // Carregar cache do localStorage (persiste entre sessões)
  try {
    const saved = localStorage.getItem('eg_dist_cache');
    return saved ? JSON.parse(saved) : {};
  } catch(e) { return {}; }
})();

function _distCacheKey(from, to) {
  return `${from.trim().toLowerCase()}|||${to.trim().toLowerCase()}`;
}

function _distCacheGet(from, to) {
  return _distCache[_distCacheKey(from, to)] || null;
}

function _distCacheSet(from, to, value) {
  const key = _distCacheKey(from, to);
  _distCache[key] = value;
  // Guardar no localStorage (max 200 entradas para não crescer indefinidamente)
  try {
    const keys = Object.keys(_distCache);
    if (keys.length > 200) {
      // Remover as mais antigas (primeiras 50)
      keys.slice(0, 50).forEach(k => delete _distCache[k]);
    }
    localStorage.setItem('eg_dist_cache', JSON.stringify(_distCache));
  } catch(e) {}
}

function getDistance(from, to) {
  return new Promise((resolve) => {
    try {
      // Verificar cache primeiro
      const cached = _distCacheGet(from, to);
      if (cached !== null) { resolve(cached.distance); return; }

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
            const dist = res.rows[0].elements[0].distance.value;
            _distCacheSet(from, to, { distance: dist, duration: 0 });
            resolve(dist); // metros
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
      // Verificar cache primeiro
      const cached = _distCacheGet(from, to);
      if (cached !== null) { resolve(cached); return; }

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
            const result = {
              distance: res.rows[0].elements[0].distance.value, // metros
              duration: Math.round((res.rows[0].elements[0].duration?.value || 0) / 60) // minutos
            };
            _distCacheSet(from, to, result);
            resolve(result);
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

  // Pinnar first_of_day e second_of_day: saem da ordenação geográfica
  const pinned = lista.filter(i => i.first_of_day || i.second_of_day);
  const semPin  = lista.filter(i => !i.first_of_day && !i.second_of_day);

  const comMorada = semPin.filter(i => getAddressFromItem(i));
  if (!comMorada.length) return [...pinned, ...semPin];

  const ordenados = await ordenarAgendamentosCadeiaMaisLongePrimeiro(comMorada, getBasePartida());
  const idsOrdenados = new Set(ordenados.map(x => x.id));
  const restantes = semPin.filter(i => !idsOrdenados.has(i.id));
  return [...pinned, ...ordenados, ...restantes];
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

// ===== OTIMIZAÇÃO DE ROTAS - TODOS OS DIAS A PARTIR DE HOJE =====
async function calculateAllRoutesFromToday() {
  try {
    showProgressModal();
    updateProgress(0, 'Iniciando otimização...', 'A verificar dias com serviços...');
    await new Promise(r => setTimeout(r, 300));

    const todayISO = localISO(new Date());

    // Recolher todos os dias futuros (a partir de hoje) que têm serviços com morada
    const daysWithServices = [...new Set(
      appointments
        .filter(a => a.date && a.date >= todayISO && getAddressFromItem(a))
        .map(a => a.date)
    )].sort();

    if (daysWithServices.length === 0) {
      updateProgress(100, 'Sem serviços', 'Não há dias com serviços e morada a partir de hoje.');
      await new Promise(r => setTimeout(r, 1500));
      hideProgressModal();
      showToast('ℹ️ Não há serviços com morada a partir de hoje para otimizar.', 'info');
      return;
    }

    // Filtrar dias com rota bloqueada para técnicos
    if (!canOverrideRouteLock()) {
      const locked = daysWithServices.filter(d => isDayRouteLocked(d));
      daysWithServices.splice(0, daysWithServices.length, ...daysWithServices.filter(d => !isDayRouteLocked(d)));
      if (daysWithServices.length === 0) {
        hideProgressModal();
        showToast('🔒 Rota bloqueada pelo coordenador — não é possível calcular rotas.', 'warning');
        return;
      }
      if (locked.length > 0) showToast('⚠️ ' + locked.length + ' dia(s) com rota bloqueada foram ignorados.', 'info');
    }

    let totalOptimized = 0;

    for (let i = 0; i < daysWithServices.length; i++) {
      const dateISO = daysWithServices[i];
      const d = new Date(dateISO + 'T00:00:00');
      const dayName = d.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit' });
      const pct = Math.round(10 + (i / daysWithServices.length) * 80);

      updateProgress(pct, `Otimizando ${dayName}`, `Dia ${i + 1} de ${daysWithServices.length}`);

      const dayServices = appointments.filter(a =>
        a.date === dateISO && getAddressFromItem(a)
      );

      if (dayServices.length >= 1) {
        await optimizeDayServices(dayServices);
        totalOptimized += dayServices.length;
      }
    }

    updateProgress(95, 'A guardar...', 'Sincronizando com a base de dados...');
    await saveOptimizedRoutes();

    updateProgress(100, 'Concluído!', `${daysWithServices.length} dias otimizados (${totalOptimized} serviços)`);
    await new Promise(r => setTimeout(r, 1500));
    hideProgressModal();
    renderAll();
    showToast(`✅ Rotas otimizadas para ${daysWithServices.length} dias a partir de hoje!`, 'success');

  } catch (error) {
    console.error('Erro ao calcular rotas:', error);
    hideProgressModal();
    showToast('❌ Erro: ' + error.message, 'error');
  }
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

  // Calcular distância do último serviço de regresso à base
  const lastServiceAddr = addresses[bestOrder[bestOrder.length - 1]];
  const returnResult = await getDistanceAndTime(lastServiceAddr, base);
  const returnKmReal = returnResult.distance !== Infinity ? Math.round(returnResult.distance / 1000) : 0;
  const returnTimeReal = returnResult.duration || 0;

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

    // No último serviço, guardar km e tempo de regresso real à base
    if (i === optimizedRoute.length - 1) {
      appointments[appointmentIndex].return_km = returnKmReal;
      appointments[appointmentIndex].return_time = returnTimeReal;
    }
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

// Adapta o modal de agendamento ao tipo de portal
// — Loja / Recalibra: oculta campos de morada/localidade/km (localização fixa)
// — SM  : mostra tudo
function applyLojaModalMode() {
  const loja = isLoja() || window.portalConfig?.portalType === 'recalibra';

  // Hint "seleciona a localidade para sugestão de data"
  // (tem display:flex inline no HTML — usar classe que force none)
  const hint = document.getElementById('localityHint');
  if (hint) hint.classList.toggle('loja-hidden', loja);

  // Grupo de localidade (LINHA 2, segundo form-group)
  // (form-group tem display:flex !important no CSS — usar classe)
  const localityGroup = document.getElementById('localityFormGroup');
  if (localityGroup) localityGroup.classList.toggle('loja-hidden', loja);

  // LINHA 7 — Morada + Distância (km)
  // (form-row tem display:grid !important no CSS — usar classe)
  const addressRow = document.getElementById('addressKmRow');
  if (addressRow) addressRow.classList.toggle('loja-hidden', loja);

  // Remove/repõe required na localidade (campo hidden, evita erro de validação)
  const localityInput = document.getElementById('appointmentLocality');
  if (localityInput) localityInput.required = !loja;
}

function setRecalibraTipo(tipo) {
  const isCalib = tipo === 'calibragem';
  const btnSvc = document.getElementById('btnTipoServico');
  const btnCal = document.getElementById('btnTipoCalib');
  if (btnSvc) { btnSvc.style.background = isCalib ? 'transparent' : '#fff'; btnSvc.style.color = isCalib ? '#64748b' : '#1e293b'; btnSvc.style.boxShadow = isCalib ? '' : '0 1px 4px rgba(0,0,0,0.12)'; }
  if (btnCal) { btnCal.style.background = isCalib ? '#fff' : 'transparent'; btnCal.style.color = isCalib ? '#1e293b' : '#64748b'; btnCal.style.boxShadow = isCalib ? '0 1px 4px rgba(0,0,0,0.12)' : ''; }
  const svcRow = document.getElementById('serviceStatusRow');
  if (svcRow) svcRow.style.display = isCalib ? 'none' : '';
  const localityGroup = document.getElementById('localityFormGroup');
  if (localityGroup) localityGroup.classList.toggle('loja-hidden', isCalib);
  const localityHint = document.getElementById('localityHint');
  if (localityHint) localityHint.classList.toggle('loja-hidden', isCalib);
  const svc = document.getElementById('appointmentService');
  if (svc) { if (isCalib) { svc.value = 'CAL'; svc.required = false; } else { if (svc.value === 'CAL') svc.value = ''; svc.required = true; } }
  const statusEl = document.getElementById('appointmentStatus');
  if (statusEl) statusEl.required = !isCalib;
  const localityInput = document.getElementById('appointmentLocality');
  if (localityInput) localityInput.required = !isCalib && !isLoja();
}
window.setRecalibraTipo = setRecalibraTipo;

function applyRecalibraModalMode(serviceValue) {
  const toggle = document.getElementById('recalibraServiceToggle');
  if (!toggle) return;
  const isRecalibra = window.portalConfig?.portalType === 'recalibra';
  toggle.style.display = isRecalibra ? 'block' : 'none';
  if (isRecalibra) setRecalibraTipo(serviceValue === 'CAL' ? 'calibragem' : 'servico');
}
window.applyRecalibraModalMode = applyRecalibraModalMode;


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
  if (window.portalConfig?.portalType === 'recalibra') {
    return a.executed === true ? '#10B981' : '#F59E0B';
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
  PB_L: 90, LT_L: 45, OC_L: 60, REP_L: 30, POL_L: 45, RV_L: 30, OUT_L: 60,
  PB_P: 120, LT_P: 60, OC_P: 90, REP_P: 45, POL_P: 60, RV_P: 45, OUT_P: 90,
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
function getServiceTime(serviceCode, vehicleType, calibration, customTime) {
  const code = serviceCode ? String(serviceCode).toUpperCase().trim().split(' ')[0].split('-')[0] : 'PB';
  const vt = (vehicleType || 'L').toUpperCase().charAt(0); // L ou P
  // OUT com tempo personalizado
  if (code === 'OUT' && customTime && parseInt(customTime) > 0) {
    const base = parseInt(customTime);
    const extra = calibration ? (SERVICE_TIMES['CALIB_EXTRA_' + vt] || 30) : 0;
    return base + extra;
  }
  const key = code + '_' + vt;
  const base = SERVICE_TIMES[key] || SERVICE_TIMES[code + '_L'] || SERVICE_TIMES['PB_L'] || 90;
  const extra = calibration ? (SERVICE_TIMES['CALIB_EXTRA_' + vt] || SERVICE_TIMES['CALIB_EXTRA_L'] || 30) : 0;
  return base + extra;
}


// ===== MULTI-SERVIÇO: helpers =====
function getAllServices(a) {
  const primary = a.service ? [{ service: a.service, custom_service_time: a.custom_service_time || null }] : [];
  const extra = Array.isArray(a.extra_services) ? a.extra_services : [];
  return [...primary, ...extra];
}

function getTotalServiceTime(a) {
  const vt = a.vehicleType || a.vehicle_type || 'L';
  return getAllServices(a).reduce((sum, s, i) =>
    sum + getServiceTime(s.service, vt, i === 0 ? a.calibration : false, s.custom_service_time), 0);
}

// ── UI: linha de serviço extra no formulário ──────────────────────────────
const _SVC_OPTS = ['PB - Para-brisas','LT - Lateral','OC - Óculo','REP - Reparação','POL - Polimento','RV - Retirar Vidro','OUT - Outros']
  .map(o => { const [v, l] = o.split(' - '); return `<option value="${v}">${v} - ${l}</option>`; }).join('');

function _addExtraServiceRow(serviceVal, customTime) {
  const cont = document.getElementById('extraServicesContainer');
  if (!cont) return;
  const div = document.createElement('div');
  div.className = 'extra-svc-row';
  div.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:6px;';
  const showCustom = serviceVal === 'OUT';
  div.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;">
      <select class="extra-svc-select" style="flex:1;padding:8px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;">
        <option value="">Selecione o tipo</option>${_SVC_OPTS}
      </select>
      <button type="button" class="extra-svc-remove" style="width:32px;height:32px;border:none;background:#fee2e2;color:#ef4444;border-radius:8px;font-size:18px;cursor:pointer;flex-shrink:0;">×</button>
    </div>
    <div class="extra-svc-custom-grp" style="display:${showCustom ? 'block' : 'none'};">
      <input type="number" class="extra-svc-time" min="5" max="480" step="5" placeholder="Tempo (minutos)"
        value="${customTime || ''}" style="width:100%;padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;box-sizing:border-box;">
    </div>`;
  if (serviceVal) div.querySelector('.extra-svc-select').value = serviceVal;
  div.querySelector('.extra-svc-select').onchange = function() {
    div.querySelector('.extra-svc-custom-grp').style.display = this.value === 'OUT' ? 'block' : 'none';
  };
  div.querySelector('.extra-svc-remove').onclick = () => div.remove();
  cont.appendChild(div);
}

function _readExtraServices() {
  const cont = document.getElementById('extraServicesContainer');
  if (!cont) return [];
  return Array.from(cont.querySelectorAll('.extra-svc-row')).map(row => {
    const sel = row.querySelector('.extra-svc-select');
    const ct = row.querySelector('.extra-svc-time');
    return { service: sel?.value || '', custom_service_time: sel?.value === 'OUT' && ct?.value ? parseInt(ct.value) : null };
  }).filter(s => s.service);
}

// Inicializar botão "+" quando o DOM estiver pronto
(function initAddExtraBtn() {
  function attach() {
    const btn = document.getElementById('addExtraServiceBtn');
    if (btn && !btn._hooked) {
      btn._hooked = true;
      btn.onclick = () => _addExtraServiceRow('', null);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
  setTimeout(attach, 500);
  window.addEventListener('portalReady', attach);
})();

function buildDaySummary(dayDate, isMobile) {
  if (isLoja()) return '';
  const iso = localISO(dayDate);
  const userRole = window.authClient?.getUser()?.role;
  // Filtro baseado apenas no role — mobile e desktop devem calcular com os mesmos serviços
  const canSeeUnconfirmed = (userRole === 'admin' || userRole === 'coordenador');
  let items = appointments.filter(a => a.date && a.date === iso)
    .sort((a,b) => {
      if (a.first_of_day && !b.first_of_day) return -1;
      if (!a.first_of_day && b.first_of_day) return 1;
      if (a.second_of_day && !b.second_of_day) return -1;
      if (!a.second_of_day && b.second_of_day) return 1;
      return (a.sortIndex||0) - (b.sortIndex||0);
    });
  // Resumo: só contar serviços com localidade (confirmados e prontos para rota)
  // Pré-agendamentos sem localidade não entram no cálculo de tempo/km
  items = items.filter(a => !!a.locality);
  if (items.length === 0) return '';

  // Detetar se as rotas foram otimizadas (leg distances) ou são distâncias individuais à base
  const hasOptimized = items.some(a => (a.sortIndex || 0) > 1);

  // KM total
  let totalKm = 0;
  let hasKm = false;
  let lastServiceKm = 0;
  items.forEach((a, i) => {
    const km = getKmValue(a);
    if (km != null && km > 0) {
      totalKm += km;
      hasKm = true;
      if (i === items.length - 1) lastServiceKm = km; // último serviço para estimar regresso
    }
  });

  // Se não otimizado: km individuais à base — aplicar fator de correção de rota encadeada
  // Fator médio empírico: rota real ≈ 1.45x a soma das distâncias individuais
  if (!hasOptimized && hasKm && items.length > 1) {
    totalKm = Math.round(totalKm * 1.45);
  }

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

  // Regresso: usar km e tempo reais calculados durante otimização
  const lastItem = items[items.length - 1];
  const returnKm = hasKm
    ? (lastItem?.return_km || (hasOptimized ? Math.round(lastServiceKm * 0.8) : Math.round(totalKm * 0.12)))
    : 0;
  // Tempo de regresso: usar o valor real calculado durante otimização
  // Fallback: estimar com base no km de regresso e velocidade média
  const returnMin = lastItem?.return_time
    ? lastItem.return_time
    : Math.round((returnKm / ROUTE_CONFIG.avgSpeedKmh) * 60);
  const totalKmWithReturn = totalKm + returnKm;

  // Tempo de execução (por tipo de serviço × veículo) — multi-serviço
  let totalServiceMin = 0;
  let totalServiceCount = 0;
  items.forEach(a => {
    totalServiceMin += getTotalServiceTime(a);
    totalServiceCount += getAllServices(a).length || 1;
  });

  if (!hasKm) {
    const svcStr = fmtTime(totalServiceMin);
    return `<div class="day-summary">
      <span class="ds-item" title="Serviços agendados">📋 ${totalServiceCount}</span>
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

  // Hora estimada de regresso — usar calcularTimeline directamente (garantia de sincronia)
  let _etaCursor = 9 * 60; // fallback se timeline-rota.js não estiver carregado
  let hasLunch = false;
  if (typeof window.calcularTimeline === 'function') {
    const tlEvents = window.calcularTimeline(items);
    const fim = tlEvents.find(function(e) { return e.type === 'fim'; });
    if (fim) _etaCursor = fim.time;
    hasLunch = tlEvents.some(function(e) { return e.type === 'almoco'; });
  } else {
    // Fallback manual (caso timeline-rota.js ainda não tenha carregado)
    const _ALM_MIN = 12 * 60; const _ALM_LIM = 13 * 60 + 10; const _ALM_DUR = 60;
    let sc = _etaCursor; let lunchAfter = -1;
    items.forEach(function(a, i) {
      const tt = a.travelTime || a.travel_time || 0;
      sc += tt > 0 ? tt : (a.km > 0 ? Math.round((a.km / (ROUTE_CONFIG.avgSpeedKmh || 50)) * 60) : 0);
      sc += getServiceTime(a.service, a.vehicleType || a.vehicle_type, a.calibration, a.custom_service_time);
      if (sc >= _ALM_MIN && sc <= _ALM_LIM) lunchAfter = i;
      else if (sc > _ALM_LIM && lunchAfter === -1 && i > 0) { lunchAfter = i - 1; }
    });
    _etaCursor = 9 * 60;
    items.forEach(function(a, i) {
      const tt = a.travelTime || a.travel_time || 0;
      _etaCursor += tt > 0 ? tt : (a.km > 0 ? Math.round((a.km / (ROUTE_CONFIG.avgSpeedKmh || 50)) * 60) : 0);
      _etaCursor += getServiceTime(a.service, a.vehicleType || a.vehicle_type, a.calibration, a.custom_service_time);
      if (i === lunchAfter) { _etaCursor += _ALM_DUR; hasLunch = true; }
    });
    _etaCursor += returnMin;
  }

  // Tempo total real decorrido (incluindo almoço se aplicável)
  const totalElapsed = _etaCursor - 9 * 60;
  const totalRealStr = fmtTime(totalElapsed);

  const etaH = Math.floor(_etaCursor / 60);
  const etaM = _etaCursor % 60;
  const etaStr = `${String(etaH).padStart(2,'0')}:${String(etaM).padStart(2,'0')}`;
  if (iso === new Date().toISOString().slice(0, 10) && items.length > 0) {
    window._routeEtaMinutes = _etaCursor;
    window.teamCheckin?._scheduleCheckoutReminder?.();
  }

  return `<div class="day-summary">
    <span class="ds-item" title="Serviços agendados">📋 ${totalServiceCount}</span>
    <span class="ds-item" title="${Math.round(totalKm)}km rota + ~${returnKm}km regresso">🛣️ ${Math.round(totalKmWithReturn)} km</span>
    <span class="ds-item" title="Viagem: ${travelStr} (incl. ~${returnStr} regresso) — fonte: ${sourceLabel}">🚐 ${travelStr}</span>
    <span class="ds-item" title="Execução dos ${items.length} serviços">🔧 ${svcStr}</span>
    <span class="ds-item" title="Tempo total${hasLunch ? ' (incl. 1h almoço)' : ''}">⏱️ ${totalRealStr}</span>
    <span class="ds-item" title="Consumo (${ROUTE_CONFIG.fuelPer100km}L/100km)">⛽ ${fuelLiters}L</span>
    <span class="ds-item ds-cost" title="€${ROUTE_CONFIG.fuelPricePerLiter}/L (${ROUTE_CONFIG.fuelSource === 'DGEG' ? 'DGEG' : 'manual'})">💰 ${fuelCost}€</span>
    <span class="ds-item ds-eta" title="Regresso à loja (saída 09:00${hasLunch ? ', almoço incluído' : ''})">🏠 ${etaStr}</span>
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
    let _autoSelectTimer = null;
    search.addEventListener('input', (e) => {
      clearTimeout(_autoSelectTimer);
      renderLocalityOptions(e.target.value);
      // Se só houver um resultado, selecionar automaticamente após pausa
      if (e.target.value.trim().length >= 3) {
        _autoSelectTimer = setTimeout(() => {
          const opts = document.querySelectorAll('#localityOptions .loc-opt');
          if (opts.length === 1) window.selectLocality?.(opts[0].getAttribute('data-value'));
        }, 400);
      }
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const opts = document.querySelectorAll('#localityOptions .loc-opt');
        if (opts.length >= 1) window.selectLocality?.(opts[0].getAttribute('data-value'));
      }
    });
  }
}


// ---------- Estado ----------
let appointments = [];
let blockedDays = [];
let routeLockedDays = [];

function isDayBlocked(isoDate) {
  if (!isoDate) return null;
  const pid = String(window.activePortalId || window.portalConfig?.id || '');
  return blockedDays.find(function(b) {
    return b.date === isoDate && (b.portal_id === null || String(b.portal_id) === pid);
  }) || null;
}

async function loadBlockedDays() {
  try {
    const pid = window.activePortalId || window.portalConfig?.id;
    const url = '/.netlify/functions/blocked-days' + (pid ? '?portal_id=' + pid : '');
    console.log('📅 loadBlockedDays pid=' + pid + ' url=' + url);
    const resp = await window.authClient.authenticatedFetch(url);
    const data = await resp.json();
    if (data.success) {
      blockedDays = data.blocked || [];
      console.log('📅 blockedDays carregados:', blockedDays.length, blockedDays.filter(function(b){return !b.is_holiday;}).map(function(b){return b.date;}));
    } else {
      console.warn('loadBlockedDays resposta sem success:', data);
    }
  } catch(e) { console.warn('loadBlockedDays:', e.message); }
}

async function toggleBlockedDay(isoDate) {
  const role = window.authClient?.getUser?.()?.role;
  const canBlock = role === 'admin' || role === 'coordenador' || role === 'pesados_coord';
  if (!canBlock) return;
  const existing = isDayBlocked(isoDate);
  const pid = window.activePortalId || window.portalConfig?.id;
  const url = '/.netlify/functions/blocked-days' + (pid ? '?portal_id=' + pid : '');
  try {
    if (existing) {
      if (existing.portal_id === null && role !== 'admin') {
        showToast('Feriado nacional — só o admin pode remover.', 'info');
        return;
      }
      await window.authClient.authenticatedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: isoDate, remove_global: role === 'admin' && existing.portal_id === null })
      });
      blockedDays = blockedDays.filter(function(b) {
        return !(b.date === isoDate && (b.portal_id === null || String(b.portal_id) === String(pid)));
      });
      showToast('✅ Dia desbloqueado', 'success');
    } else {
      var reason = prompt('Motivo (opcional):', 'Feriado local');
      if (reason === null) return;
      var resp = await window.authClient.authenticatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: isoDate, reason: reason || 'Dia bloqueado', is_holiday: false })
      });
      var data = await resp.json();
      if (!data.success) { showToast('Erro ao bloquear dia', 'error'); return; }
      showToast('🔒 Dia bloqueado', 'success');
    }
    // Recarregar lista de dias bloqueados do servidor (garante formato correto) e re-renderizar
    await loadBlockedDays();
    if (typeof renderAll === 'function') renderAll(); else applyBlockedDayOverlays();
  } catch(e) { showToast('Erro: ' + e.message, 'error'); }
}

// ===== BLOQUEIO DE ROTA =====

function isDayRouteLocked(isoDate) {
  if (!isoDate) return false;
  const pid = String(window.activePortalId || window.portalConfig?.id || '');
  return routeLockedDays.some(function(r) {
    return r.date === isoDate && String(r.portal_id) === pid;
  });
}

function canOverrideRouteLock() {
  var role = window.authClient?.getUser?.()?.role;
  return role === 'admin' || role === 'coordenador' || role === 'pesados_coord';
}

async function loadRouteLocks() {
  try {
    const pid = window.activePortalId || window.portalConfig?.id;
    const url = '/.netlify/functions/route-locks' + (pid ? '?portal_id=' + pid : '');
    const resp = await window.authClient.authenticatedFetch(url);
    const data = await resp.json();
    if (data.success) routeLockedDays = data.data || [];
  } catch(e) { console.warn('loadRouteLocks:', e.message); }
}

async function toggleRouteLock(isoDate) {
  if (!canOverrideRouteLock()) return;
  const pid = window.activePortalId || window.portalConfig?.id;
  const locked = isDayRouteLocked(isoDate);
  try {
    if (locked) {
      await window.authClient.authenticatedFetch(
        '/.netlify/functions/route-locks?date=' + isoDate + (pid ? '&portal_id=' + pid : ''),
        { method: 'DELETE' }
      );
      routeLockedDays = routeLockedDays.filter(function(r) {
        return !(r.date === isoDate && String(r.portal_id) === String(pid));
      });
      showToast('🔓 Rota desbloqueada', 'success');
    } else {
      await window.authClient.authenticatedFetch(
        '/.netlify/functions/route-locks' + (pid ? '?portal_id=' + pid : ''),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: isoDate }) }
      );
      routeLockedDays.push({ date: isoDate, portal_id: pid });
      showToast('🔒 Rota bloqueada', 'success');
    }
    renderAll();
  } catch(e) { showToast('❌ Erro: ' + e.message, 'error'); }
}

function applyRouteLockOverlays() {
  var role = window.authClient?.getUser?.()?.role;
  var canToggle = canOverrideRouteLock();

  if (!document.getElementById('_rlStyles')) {
    var s = document.createElement('style');
    s.id = '_rlStyles';
    s.textContent = [
      '.th-rl{background:repeating-linear-gradient(45deg,#fffbeb,#fffbeb 6px,#fef3c7 6px,#fef3c7 12px)!important;}',
      '.th-rl .day{color:#92400e!important;}.th-rl .date{color:#b45309!important;}',
      '.rl-badge{font-size:10px;font-weight:700;color:#92400e;background:#fef3c7;border-radius:4px;padding:2px 5px;margin-top:2px;display:block;}',
      '.rl-btn{background:none;border:none;cursor:pointer;font-size:12px;padding:0 2px;opacity:.55;vertical-align:middle;}',
      '.rl-btn:hover{opacity:1;}'
    ].join('');
    document.head.appendChild(s);
  }

  document.querySelectorAll('.rl-btn,.rl-badge').forEach(function(el) { el.remove(); });
  document.querySelectorAll('.th-rl').forEach(function(el) { el.classList.remove('th-rl'); });

  var table = document.getElementById('schedule');
  if (!table) return;
  var headers = table.querySelectorAll('thead th');
  var week = [...Array(6)].map(function(_, i) { return addDays(currentMonday, i); });

  week.forEach(function(d, i) {
    var iso = localISO(d);
    var locked = isDayRouteLocked(iso);
    var th = headers[i + 1];
    if (!th) return;

    if (canToggle) {
      var btn = document.createElement('button');
      btn.className = 'rl-btn';
      btn.title = locked ? 'Desbloquear rota' : 'Bloquear rota';
      btn.textContent = locked ? '🔒' : '🔓';
      btn.setAttribute('onclick', 'toggleRouteLock("' + iso + '")');
      var dayDiv = th.querySelector('.day');
      if (dayDiv) dayDiv.appendChild(btn);
    }

    if (locked) {
      th.classList.add('th-rl');
      var badge = document.createElement('span');
      badge.className = 'rl-badge';
      badge.textContent = '🔒 Rota';
      th.appendChild(badge);
    }
  });
}

// Aplicar overlays visuais APÓS o render (não toca no renderSchedule interno)
function applyBlockedDayOverlays() {
  var role = window.authClient?.getUser?.()?.role;
  var canToggle = role === 'admin' || role === 'coordenador' || role === 'pesados_coord';

  // Injectar estilos uma vez
  if (!document.getElementById('_bdStyles')) {
    var s = document.createElement('style');
    s.id = '_bdStyles';
    s.textContent = [
      '.th-blocked{background:repeating-linear-gradient(45deg,#fef2f2,#fef2f2 6px,#fee2e2 6px,#fee2e2 12px)!important;}',
      '.th-blocked .day{color:#dc2626!important;}.th-blocked .date{color:#ef4444!important;}',
      '.bd-reason{font-size:10px;font-weight:700;color:#dc2626;background:#fff;border-radius:4px;padding:2px 5px;margin-top:2px;display:block;}',
      '.bd-lock{background:none;border:none;cursor:pointer;font-size:12px;padding:0 2px;opacity:.55;vertical-align:middle;}',
      '.bd-lock:hover{opacity:1;}',
      '.td-blocked{background:repeating-linear-gradient(45deg,#fef2f2,#fef2f2 6px,#fee2e2 6px,#fee2e2 12px)!important;pointer-events:none!important;opacity:.65;}'
    ].join('');
    document.head.appendChild(s);
  }

  // Limpar overlays anteriores
  document.querySelectorAll('.bd-lock,.bd-reason,.td-blocked-overlay').forEach(function(el) { el.remove(); });
  document.querySelectorAll('.th-blocked').forEach(function(el) { el.classList.remove('th-blocked'); });
  document.querySelectorAll('.td-blocked').forEach(function(el) { el.classList.remove('td-blocked'); });

  // Aplicar a cada coluna da semana
  var table = document.getElementById('schedule');
  if (!table) return;
  var headers = table.querySelectorAll('thead th');
  // headers[0] é "Data", headers[1..6] são os dias
  var week = [...Array(6)].map(function(_, i) { return addDays(currentMonday, i); });

  week.forEach(function(d, i) {
    var iso = localISO(d);
    var blocked = isDayBlocked(iso);
    var th = headers[i + 1];
    if (!th) return;

    // Botão de lock
    if (canToggle) {
      var btn = document.createElement('button');
      btn.className = 'bd-lock';
      btn.title = blocked ? 'Desbloquear dia' : 'Bloquear dia';
      btn.textContent = blocked ? '🔒' : '🔓';
      btn.setAttribute('onclick', 'toggleBlockedDay("' + iso + '")');
      var dayDiv = th.querySelector('.day');
      if (dayDiv) dayDiv.appendChild(btn);
    }

    if (blocked) {
      th.classList.add('th-blocked');
      var reason = document.createElement('span');
      reason.className = 'bd-reason';
      reason.textContent = blocked.reason || 'Bloqueado';
      th.appendChild(reason);

      // Bloquear células da coluna
      var colIdx = i + 1;
      table.querySelectorAll('tbody tr').forEach(function(row) {
        var td = row.cells[colIdx];
        if (td) td.classList.add('td-blocked');
      });
    }
  });
}
let currentMonday = getMonday(new Date());
let currentMobileDay = new Date();
let editingId = null;
let searchQuery = '';
let statusFilter = '';
// ===== Agenda extra filters =====
window._agendaFilters = { service: '', glassRemoved: false, notDone: false };

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
    appointments = appointments.map(a => {
      let extras = a.extra_services;
      if (typeof extras === 'string') { try { extras = JSON.parse(extras); } catch(e) { extras = []; } }
      if (!Array.isArray(extras)) extras = [];
      // Parse extra JSON for eurocode/photo_url/history
      let _extraObj = null;
      if (a.extra && typeof a.extra === 'string') {
        try { _extraObj = JSON.parse(a.extra); } catch(e) { _extraObj = null; }
      }
      return {
        ...a,
        address: a.address || a.morada || a.addr || null,
        createdAt: a.createdAt || a.created_at || null,
        extra_services: extras,
        photo_url: a.photo_url || (_extraObj ? _extraObj.photo_url || '' : '')
      };
    });
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
    const qNorm=q.replace(/[^a-z0-9]/g,'');
    f=f.filter(a=>
      (a.plate||'').replace(/[^a-z0-9]/gi,'').toLowerCase().includes(qNorm) ||
      (a.car||'').toLowerCase().includes(qNorm) ||
      (a.locality||'').toLowerCase().includes(qNorm) ||
      ((a.notes||'').toLowerCase().includes(qNorm))
    );
  }
  if(statusFilter) f=f.filter(a=>a.status===statusFilter);
  // Extra filters
  const af = window._agendaFilters || {};
  if(af.service) f=f.filter(a=>(a.service||'')===(af.service) || (Array.isArray(a.extra_services) && a.extra_services.some(s=>s.service===af.service)));
  if(af.glassRemoved) f=f.filter(a=>!!a.glass_removed);
  if(af.notDone) f=f.filter(a=>a.executed===false && !!a.not_done_reason);
  return f;
}
function highlightSearchResults(){
  document.querySelectorAll('.appointment').forEach(el=>el.classList.remove('highlight'));
  if(!searchQuery) return;
  const qNorm=searchQuery.replace(/[^a-z0-9]/gi,'').toLowerCase();
  document.querySelectorAll('.appointment').forEach(el=>{
    if(el.textContent.replace(/[^a-z0-9]/gi,'').toLowerCase().includes(qNorm)) el.classList.add('highlight');
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


// ===== CARREGAR COMERCIAIS PARA MODAL =====
async function loadComerciais() {
  try {
    const fetcher = window.authClient?.authenticatedFetch?.bind(window.authClient)
      || window.apiClient?.fetch?.bind(window.apiClient);
    if (!fetcher) return;
    const resp = await fetcher('/.netlify/functions/users');
    const data = await resp.json();
    if (!data.success) return;
    const comerciais = data.data.filter(u => u.role === 'comercial');
    const sel = document.getElementById('appointmentCommercial');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecionar comercial...</option>' +
      comerciais.map(u => `<option value="${u.id}">${u.username}</option>`).join('');
    window._comerciaisList = comerciais;
  } catch(e) { console.warn('Erro ao carregar comerciais:', e); }
}

// ===== MODAL NÃO REALIZADO =====
let _pendingNotDoneId = null;

function _injectNotDoneModal() {
  if (document.getElementById('notDoneModal')) return;
  const modal = document.createElement('div');
  modal.id = 'notDoneModal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;max-width:360px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3);">
      <h3 style="margin:0 0 6px;font-size:18px;font-weight:800;color:#1e293b;">Motivo — Não Realizado</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#64748b;">Selecione o motivo pelo qual o serviço não foi realizado:</p>
      <div id="ndOptions" style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
        <label class="nd-opt"><input type="radio" name="ndReason" value="Carro não disponível"> Carro não disponível</label>
        <label class="nd-opt"><input type="radio" name="ndReason" value="Vidro não partido"> Vidro não partido</label>
        <label class="nd-opt"><input type="radio" name="ndReason" value="Vidro errado"> Vidro errado</label>
        <label class="nd-opt"><input type="radio" name="ndReason" value="Falta de material"> Falta de material</label>
        <label class="nd-opt"><input type="radio" name="ndReason" value="__outro__">
          Outro: <input type="text" id="ndOutroText" placeholder="descreva..." style="margin-left:6px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;flex:1;">
        </label>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="closeNotDoneModal()" style="padding:10px 20px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;font-weight:600;cursor:pointer;">Cancelar</button>
        <button onclick="confirmNotDone()" style="padding:10px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer;">Confirmar</button>
      </div>
    </div>`;
  // Estilos inline para as opções
  const style = document.createElement('style');
  style.textContent = '.nd-opt{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;transition:border-color .15s;} .nd-opt:hover{border-color:#3b82f6;} .nd-opt input[type=radio]{width:16px;height:16px;accent-color:#dc2626;}';
  document.head.appendChild(style);
  document.body.appendChild(modal);
}

function openNotDoneModal(id) {
  _injectNotDoneModal();
  _pendingNotDoneId = id;
  document.querySelectorAll('input[name="ndReason"]').forEach(r => r.checked = false);
  const outro = document.getElementById('ndOutroText');
  if (outro) outro.value = '';
  const modal = document.getElementById('notDoneModal');
  modal.style.display = 'flex';
}

function closeNotDoneModal() {
  const modal = document.getElementById('notDoneModal');
  if (modal) modal.style.display = 'none';
  _pendingNotDoneId = null;
}

async function confirmNotDone() {
  const selected = document.querySelector('input[name="ndReason"]:checked');
  if (!selected) { showToast('Selecione um motivo', 'error'); return; }
  let reason = selected.value;
  if (reason === '__outro__') {
    reason = (document.getElementById('ndOutrosText')?.value || '').trim();
    if (!reason) { showToast('Descreva o motivo', 'error'); return; }
  }
  const idToSave = _pendingNotDoneId;
  closeNotDoneModal();
  await _doSaveExecuted(idToSave, false, reason);
}


// ===== ANIMAÇÕES REALIZADO / NÃO REALIZADO =====
function fireEmojis(emojis, baseDur) {
  const count = 22;
  const base = baseDur || 2800;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const size = 28 + Math.random() * 22;
    el.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;font-size:${size}px;pointer-events:none;z-index:99999;transform:translate(-50%,-50%);will-change:transform,opacity;`;
    document.body.appendChild(el);
    const angle = Math.random() * 2 * Math.PI;
    const dist  = 100 + Math.random() * 200;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 80;
    const dur = base + Math.random() * 1200;
    el.animate([
      { transform:'translate(-50%,-50%) scale(0.2)', opacity:1 },
      { transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.4)`, opacity:1, offset:0.5 },
      { transform:`translate(calc(-50% + ${dx*1.05}px),calc(-50% + ${dy+40}px)) scale(1.2)`, opacity:1, offset:0.75 },
      { transform:`translate(calc(-50% + ${dx*1.15}px),calc(-50% + ${dy+160}px)) scale(0.8)`, opacity:0 }
    ], { duration:dur, easing:'cubic-bezier(0.22,1,0.36,1)', fill:'forwards' })
      .finished.then(() => el.remove());
  }
}
function fireRealizadoEmojis() {
  fireEmojis(['✅','🎉','⭐','💪','🙌','🏆','👏','✨','🔥','🥳']);
}
function fireNaoRealizadoEmojis() {
  fireEmojis(['😢','😔','💔','😞','🥺','😿','💧','😩','😭','🫤']);
}
function fireVidroRetiradoEmojis() {
  // Emojis: carro, ferramenta, espera — duração mais longa (5s base)
  fireEmojis(['🚗','🔧','🛠️','⏳','🚘','⚙️','🔩','🪟','🚙','⌛'], 5000);
}
// Expor globalmente para uso em outros scripts (ex: glass-removed-patch.js)
window.fireEmojis = fireEmojis;
window.fireVidroRetiradoEmojis = fireVidroRetiradoEmojis;


// ===== PRIMEIRO SERVIÇO DO DIA — só um por dia =====
async function enforceSingleFirstOfDay(newId, date) {
  if (!date) return;
  const others = appointments.filter(a =>
    String(a.id) !== String(newId) &&
    a.date === date &&
    a.first_of_day === true
  );
  for (const a of others) {
    try {
      a.first_of_day = false;
      await window.apiClient.updateAppointment(a.id, { ...a, first_of_day: false });
    } catch(e) { console.warn('Erro ao limpar first_of_day:', e); }
  }
  if (others.length > 0) renderAll();
}

async function enforceSingleSecondOfDay(newId, date) {
  if (!date) return;
  const others = appointments.filter(a =>
    String(a.id) !== String(newId) &&
    a.date === date &&
    a.second_of_day === true
  );
  for (const a of others) {
    try {
      a.second_of_day = false;
      await window.apiClient.updateAppointment(a.id, { ...a, second_of_day: false });
    } catch(e) { console.warn('Erro ao limpar second_of_day:', e); }
  }
  if (others.length > 0) renderAll();
}

async function _doSaveExecuted(id, executed, reason) {
  const i = appointments.findIndex(a => String(a.id) === String(id));
  if (i < 0) return;
  const prev = { executed: appointments[i].executed, not_done_reason: appointments[i].not_done_reason, glass_removed: appointments[i].glass_removed, glass_removed_date: appointments[i].glass_removed_date };
  appointments[i].executed = executed;
  appointments[i].not_done_reason = reason || null;
  // Quando marcado como realizado, limpar "vidro retirado"
  if (executed) {
    appointments[i].glass_removed = false;
    appointments[i].glass_removed_date = null;
  }
  renderAll();
  if (executed) fireRealizadoEmojis(); else fireNaoRealizadoEmojis();
  try {
    await window.apiClient.updateAppointment(id, { ...appointments[i], executed, not_done_reason: reason || null });

    // Notificar comercial via Telegram se estiver atribuído
    if (appointments[i].commercial_user_id) {
      try {
        await authClient.authenticatedFetch('/.netlify/functions/notify-commercial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointment_id: id })
        });
      } catch(ne) { console.warn('Notificação comercial falhou:', ne); }
    }
  } catch (err) {
    appointments[i].executed = prev.executed;
    appointments[i].not_done_reason = prev.not_done_reason;
    appointments[i].glass_removed = prev.glass_removed;
    appointments[i].glass_removed_date = prev.glass_removed_date;
    showToast('Falha ao gravar: ' + err.message, 'error');
    renderAll();
  }
}

async function persistExecuted(id, executed) {
  if (!executed) {
    openNotDoneModal(id);
    return;
  }
  await _doSaveExecuted(id, true, null);
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
  if (targetBucket && targetBucket !== 'unscheduled') {
    var _dateDrop = targetBucket.split('|')[0];
    var _blockedDrop = isDayBlocked(_dateDrop);
    if (_blockedDrop) { showToast('🔒 ' + (_blockedDrop.reason || 'Dia bloqueado'), 'error'); return; }
    if (isDayRouteLocked(_dateDrop) && !canOverrideRouteLock()) {
      showToast('🔒 Rota bloqueada pelo coordenador — não pode alterar a ordem', 'error'); return;
    }
  }
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

// ===== SECÇÃO COMERCIAL NO MODAL =====
function ensureCommercialSection() {
  const section = document.getElementById('commercialSection');
  if (!section) return;
  const role = window.authClient?.getUser?.()?.role;
  section.style.display = (role === 'coordenador' || role === 'admin') ? 'block' : 'none';
  const cb = document.getElementById('hasCommercial');
  if (cb && !cb._listenerAdded) {
    cb.addEventListener('change', function() {
      document.getElementById('commercialSelectWrap').style.display = this.checked ? 'block' : 'none';
      if (!this.checked) document.getElementById('appointmentCommercial').value = '';
    });
    cb._listenerAdded = true;
    loadComerciais();
  }
}


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
  const secondCb = document.getElementById('appointmentSecondOfDay');
  if (secondCb) secondCb.checked = !!(appointment.second_of_day);
  setTimeout(function() { if (typeof window.updateSecondOfDayVisibility === 'function') window.updateSecondOfDayVisibility(); }, 50);
  document.getElementById('appointmentLocality').value = appointment.locality || '';
  if (document.getElementById('appointmentPeriod')) {
    document.getElementById('appointmentPeriod').value = appointment.period || 'Manhã';
  }
  document.getElementById('appointmentNotes').value = appointment.notes || '';
  document.getElementById('appointmentAddress').value = appointment.address || '';
  document.getElementById('appointmentPhone').value = appointment.phone || '';
  if (document.getElementById('appointmentClientName')) document.getElementById('appointmentClientName').value = appointment.client_name || '';
  if (document.getElementById('appointmentNObra')) document.getElementById('appointmentNObra').value = appointment.n_obra || '';
  // Parse extra field (may be JSON with eurocode + photo_url + history)
  let _extraParsed = null;
  if (appointment.extra) {
    try { _extraParsed = JSON.parse(appointment.extra); } catch(e) { _extraParsed = null; }
  }
  const _eurocode = _extraParsed ? (_extraParsed.eurocode || '') : (appointment.extra || '');
  const _photoUrl = _extraParsed ? (_extraParsed.photo_url || '') : (appointment.photo_url || '');
  const _history = _extraParsed ? (_extraParsed.history || '') : '';
  document.getElementById('appointmentExtra').value = _eurocode;
  if (document.getElementById('appointmentPhoto')) document.getElementById('appointmentPhoto').value = _photoUrl;
  if (document.getElementById('appointmentHistory')) document.getElementById('appointmentHistory').value = _history;
  if (document.getElementById('appointmentDamageDetails')) {
    document.getElementById('appointmentDamageDetails').value = appointment.damage_details || '';
  }

  // Vendas complementares
  const hasCS = !!(appointment.comp_sales_desc);
  const hasCompSalesCb = document.getElementById('hasCompSales');
  if (hasCompSalesCb) {
    hasCompSalesCb.checked = hasCS;
    if (typeof toggleCompSales === 'function') toggleCompSales(hasCS);
  }
  if (hasCS) {
    const el = document.getElementById('compSalesDesc');
    if (el) el.value = appointment.comp_sales_desc || '';
    const elName = document.getElementById('compSalesName');
    if (elName) elName.value = appointment.comp_sales_name || '';
    const elNif = document.getElementById('compSalesNif');
    if (elNif) elNif.value = appointment.comp_sales_nif || '';
    const elFat = document.getElementById('compSalesFaturado');
    if (elFat) elFat.checked = !!appointment.comp_sales_faturado;
  }
  if (typeof _syncCompSalesFaturadoVisibility === 'function') _syncCompSalesFaturadoVisibility();
  
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

  // Garantir secção comercial (pode chamar loadComerciais async na primeira vez)
  ensureCommercialSection();

  // Campo comercial — definir APÓS loadComerciais() para não ser apagado pelo innerHTML
  if (appointment.commercial_user_id) {
    loadComerciais().then(() => {
      const commSel = document.getElementById('appointmentCommercial');
      if (!commSel) return;
      const hasCb = document.getElementById('hasCommercial');
      if (hasCb) {
        hasCb.checked = true;
        const wrap = document.getElementById('commercialSelectWrap');
        if (wrap) wrap.style.display = 'block';
      }
      commSel.value = appointment.commercial_user_id;
    });
  } else {
    const commSel = document.getElementById('appointmentCommercial');
    if (commSel) commSel.value = '';
    const hasCb = document.getElementById('hasCommercial');
    if (hasCb) {
      hasCb.checked = false;
      const wrap = document.getElementById('commercialSelectWrap');
      if (wrap) wrap.style.display = 'none';
    }
  }

  // Alterar modal para modo edição
  document.getElementById('modalTitle').textContent = 'Editar Agendamento';
  document.getElementById('deleteAppointment').classList.remove('hidden');
  // Campos extras
  var fp2 = document.getElementById('foreignPlate');
  if (fp2) { fp2.checked = !!(appointment.foreign_plate); window.toggleForeignPlate && window.toggleForeignPlate(fp2.checked); }
  var svcSel = document.getElementById('appointmentService');
  var ctg2 = document.getElementById('customServiceTimeGroup');
  if (ctg2) ctg2.style.display = (appointment.service === 'OUT') ? 'block' : 'none';
  var ct2 = document.getElementById('appointmentCustomTime');
  if (ct2) ct2.value = appointment.custom_service_time || '';
  // Preencher serviços extra
  var extraContainer = document.getElementById('extraServicesContainer');
  if (extraContainer) {
    extraContainer.innerHTML = '';
    var extras = Array.isArray(appointment.extra_services) ? appointment.extra_services : [];
    extras.forEach(function(s) { _addExtraServiceRow(s.service, s.custom_service_time); });
  }

  // Preencher Status do Vidro (NE/VE/ST)
  const statusEl = document.getElementById('appointmentStatus');
  if (statusEl) statusEl.value = appointment.status || 'NE';

  applyLojaModalMode();
  applyRecalibraModalMode(appointment.service);
  document.getElementById('appointmentModal').classList.add('show');
}

async function deleteAppointment(id) {
  // Modal de confirmação próprio (confirm() bloqueado em PWA/mobile)
  const confirmed = await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;max-width:320px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3);">
        <div style="font-size:32px;margin-bottom:12px;">🗑️</div>
        <div style="font-weight:700;font-size:16px;color:#1e293b;margin-bottom:8px;">Eliminar agendamento?</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:20px;">Esta ação não pode ser desfeita.</div>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button id="confirmNo" style="background:#f1f5f9;color:#475569;border:none;padding:10px 20px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;flex:1;">Cancelar</button>
          <button id="confirmYes" style="background:#ef4444;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;flex:1;">Eliminar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#confirmYes').onclick = () => { document.body.removeChild(overlay); resolve(true); };
    overlay.querySelector('#confirmNo').onclick  = () => { document.body.removeChild(overlay); resolve(false); };
  });
  if (!confirmed) return;

  try {
    const appt = appointments.find(a => String(a.id) === String(id));
    const commercialUserId = appt?.commercial_user_id || appt?.commercialUserId;

    await window.apiClient.deleteAppointment(id);
    const index = appointments.findIndex(a => String(a.id) === String(id));
    if (index > -1) appointments.splice(index, 1);

    // Se era pedido de comercial, marcar como cancelado
    if (commercialUserId && appt?.plate) {
      try {
        await window.authClient.authenticatedFetch('/.netlify/functions/commercial-request', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plate: appt.plate, status: 'cancelled', commercial_id: commercialUserId })
        });
      } catch(_) {}
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
  window.originalUnscheduledServiceId = null;
  window.dispatchEvent(new CustomEvent('appointmentModalClosed'));
  document.getElementById('localityFirstOverlay')?.remove();
  document.getElementById('appointmentForm').reset();
  const calibCb = document.getElementById('appointmentCalibration');
  if (calibCb) calibCb.checked = false;
  const firstCb = document.getElementById('appointmentFirstOfDay');
  if (firstCb) firstCb.checked = false;
  ensureCommercialSection();
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
  // Limpar campos extras
  var fp = document.getElementById('foreignPlate');
  if (fp) { fp.checked = false; window.toggleForeignPlate && window.toggleForeignPlate(false); }
  var ct = document.getElementById('appointmentCustomTime');
  if (ct) ct.value = '';
  var ctg = document.getElementById('customServiceTimeGroup');
  if (ctg) ctg.style.display = 'none';
  var extraCont = document.getElementById('extraServicesContainer');
  if (extraCont) extraCont.innerHTML = '';
  
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
  const clientNameStr = a.client_name ? a.client_name : '';
  let _extraDisplay = a.extra || '';
  if (_extraDisplay) {
    try { const _p = JSON.parse(_extraDisplay); _extraDisplay = _p.eurocode || ''; } catch(e) {}
  }
  const userRole = window.authClient?.getUser()?.role;
  const canSeeUnconfirmed = userRole === 'admin' || userRole === 'coordenador';
  const sub = loja
    ? [clientNameStr, _extraDisplay, a.notes, a.n_obra ? `FS${a.n_obra}` : null].filter(Boolean).join(' | ')
    : [a.locality, clientNameStr, _extraDisplay, a.notes, a.n_obra ? `FS${a.n_obra}` : null].filter(Boolean).join(' | ');
  const encRecFooter = (a.order_ref || a.reception_ref) ? `
    <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:10px;font-weight:700;color:rgba(255,255,255,0.85);">
      ${a.order_ref ? `<span>📦 ${a.order_ref}</span>` : ''}
      ${a.reception_ref ? `<span>✅ ${a.reception_ref}</span>` : ''}
    </div>` : '';
  // SM com data mas sem localidade → piscar (só coord/admin) — mas não para pré-agendamentos (têm o seu próprio sistema)
  const isPreAgendado = a.confirmed === false;
  const isRecalibra = window.portalConfig?.portalType === 'recalibra';
  const needsLoc = !loja && !isRecalibra && a.date && !a.locality && canSeeUnconfirmed && !isPreAgendado ? ' needs-locality' : '';
  const locWarning = needsLoc ? `
      <div class="needs-loc-msg">
        <div>⚠️ Falta localidade</div>
        <div style="font-size:11px;opacity:0.8;margin-top:2px;">Confirma agendamento?</div>
      </div>` : '';
  // Auto-importado do PHC com data
  // Footer PHC: só mostrar se auto_imported E status ainda é NE (não confirmado)
  const isAutoImported = a.auto_imported && a.date && (!a.status || a.status === 'NE');
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
  const _roleDesk = window.authClient?.getUser?.()?.role || '';
  const canExecDesk = isPastOrToday || _roleDesk === 'admin' || _roleDesk === 'coordenador';
  const motivoDesktop = (a.executed === false && a.not_done_reason) ? (() => {
    const _nd = a.not_done_reason;
    const _ndAt = a.not_done_at || a.notDoneAt || a.updated_at || a.updatedAt;
    const _ndDate = _ndAt ? (() => { const _s = String(_ndAt).slice(0,10); const _d = new Date(_s + 'T12:00:00'); return isNaN(_d) ? _s : _d.toLocaleDateString('pt-PT', {day:'2-digit',month:'2-digit',year:'numeric'}); })() : null;
    return `<div style="margin:4px 0 0;padding:5px 10px;background:rgba(220,38,38,0.12);border-left:3px solid #dc2626;border-radius:5px;font-size:11px;font-weight:700;color:#dc2626;">
      ❌ ${_nd}${_ndDate ? `<span style="font-weight:400;color:#64748b;margin-left:8px;">📅 ${_ndDate}</span>` : ''}
    </div>`;
  })() : '';

  const execBadge = (canExecDesk && !isPreAgendado && a.date) ? `
    <div class="dc-exec-row" data-id="${a.id}">
      <button class="dc-exec-btn ${a.executed === false && a.not_done_reason ? 'dc-exec-ne' : ''}" data-exec="false" data-id="${a.id}">✗ N. Realizado</button>
      <button class="dc-exec-btn ${a.executed === true ? 'dc-exec-st' : ''}" data-exec="true" data-id="${a.id}">✓ Realizado</button>
    </div>${motivoDesktop}` : '';

  // Dias aberto (desde createdAt)
  const _diasAberto = a.createdAt ? (() => {
    const d = new Date(a.createdAt); d.setHours(0,0,0,0);
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    return Math.floor((hoje - d) / 86400000);
  })() : 0;
  const _diasBg = _diasAberto >= 8 ? '#dc2626' : _diasAberto >= 5 ? '#ea580c' : _diasAberto >= 3 ? '#d97706' : null;
  const diasAbertoBadge = _diasAberto > 0 && _diasBg ? `
    <div style="margin:8px 0 4px;display:inline-flex;align-items:center;gap:6px;background:${_diasBg};color:#ffffff !important;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:800;letter-spacing:0.3px;-webkit-text-fill-color:#ffffff;">
      ⏱ ${_diasAberto} ${_diasAberto === 1 ? 'dia aberto' : 'dias aberto'}
    </div>` : '';

  // Glass removed urgency
  let glassRemovedBorderStyle = '';
  let glassRemovedBadge = '';
  if (a.glass_removed && a.glass_removed_date) {
    const _grNorm = String(a.glass_removed_date).slice(0, 10);
    const _grDays = Math.floor((Date.now() - new Date(_grNorm + 'T00:00:00').getTime()) / 86400000);
    const _grDateFmt = new Date(_grNorm + 'T00:00:00').toLocaleDateString('pt-PT', {day:'2-digit',month:'2-digit',year:'numeric'});
    const _grDateDiv = `<div style="margin:2px 8px 4px;font-size:11px;font-weight:600;color:#2563eb;">🪟 Retirado: ${_grDateFmt}</div>`;
    if (_grDays >= 14) {
      glassRemovedBorderStyle = 'border-bottom:4px solid #dc2626;';
      glassRemovedBadge = `<div class="gr-urgency-badge gr-urgency-red gr-pulse">🚨 ${_grDays}d</div>${_grDateDiv}`;
    } else if (_grDays >= 7) {
      glassRemovedBorderStyle = 'border-bottom:4px solid #f59e0b;';
      glassRemovedBadge = `<div class="gr-urgency-badge gr-urgency-orange">⚠️ ${_grDays}d</div>${_grDateDiv}`;
    } else {
      glassRemovedBorderStyle = 'border-bottom:4px solid #2563eb;';
      glassRemovedBadge = _grDateDiv;
    }
  }

  return `
    <div class="appointment desk-card${needsLoc}${isPreAgendado ? ' pre-agendado' : ''}" data-id="${a.id}" draggable="true"
         data-locality="${a.locality||''}" data-loccolor="${base}"
         style="--c1:${g.c1}; --c2:${g.c2}; --tc:${textColor}; ${bar} ${glassRemovedBorderStyle}">
      <div class="dc-title"><span class="dc-title-text">${plate}</span></div>
      <div class="dc-meta" data-ms-patched="1">
        ${getAllServices(a).map(s => `<span class="dc-badge">${s.service||''}</span>`).join('')}
        ${a.calibration ? '<span class="dc-calib-badge">⊕ CALIB</span>' : ''}
        ${a.first_of_day ? '<span class="dc-calib-badge" style="background:#f59e0b;color:#fff;">⭐ 1.º SERVIÇO</span>' : ''}
        ${a.second_of_day ? '<span class="dc-calib-badge" style="background:#f97316;color:#fff;">⭐ 2.º SERVIÇO</span>' : ''}
        ${a.commercial_user_id ? '<span class="dc-calib-badge" style="background:#7c3aed !important;color:#fff !important;animation:blink 1.5s infinite;">🤝 COMERCIAL</span>' : ''}
        ${car ? `<span class="dc-car">${car}</span>` : ''}
      </div>
      ${sub ? `<div class="dc-sub">${sub}</div>` : ''}
      ${a.damage_details ? `<div class="dc-sub" style="margin-top:3px;font-style:italic;opacity:0.85;">🔍 ${a.damage_details}</div>` : ''}
      ${!isRecalibra && a.comp_sales_desc && !a.comp_sales_faturado ? `<button onclick="event.stopPropagation();openCompSalesModal('${a.id}')" style="margin-top:4px;display:inline-flex;align-items:center;gap:4px;background:#d97706;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:800;color:#fff;cursor:pointer;">💰 Venda pendente</button>` : ''}
      ${!isRecalibra && a.comp_sales_desc && a.comp_sales_faturado ? `<button onclick="event.stopPropagation();openCompSalesModal('${a.id}')" style="margin-top:4px;display:inline-flex;align-items:center;gap:4px;background:#059669;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:800;color:#fff;cursor:pointer;">✅ Venda faturada</button>` : ''}
      ${!isRecalibra && !a.comp_sales_desc ? `<button onclick="event.stopPropagation();openCompSalesModal('${a.id}')" style="margin-top:4px;display:inline-flex;align-items:center;gap:4px;background:rgba(0,0,0,0.2);border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;color:#fff;cursor:pointer;">💰 Venda compl.</button>` : ''}
      ${preAgendadoBadge}
      ${confirmBtn}
      ${locWarning}
      ${a.service !== 'CAL' ? `<div class="appt-status dc-status">
        <label><input type="checkbox" data-status="NE" ${a.status==='NE'?'checked':''}/> N/E</label>
        <label><input type="checkbox" data-status="VE" ${a.status==='VE'?'checked':''}/> V/E</label>
        <label><input type="checkbox" data-status="ST" ${a.status==='ST'?'checked':''}/> ST</label>
      </div>` : ''}
      ${execBadge}
      <div class="card-actions">
        ${a.photo_url ? `<a href="${a.photo_url}" target="_blank" rel="noopener" class="icon" title="Ver foto" style="text-decoration:none;">📷</a>` : ''}
        <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar" aria-label="Editar">✏️</button>
        <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar" aria-label="Eliminar">🗑️</button>
        ${encRecFooter}
      </div>
    ${glassRemovedBadge}${diasAbertoBadge}${loja ? '' : buildKmRow(a)}${phcFooter}</div>`;
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
          .sort((a,b) => {
            if (a.first_of_day && !b.first_of_day) return -1;
            if (!a.first_of_day && b.first_of_day) return 1;
            if (a.second_of_day && !b.second_of_day) return -1;
            if (!a.second_of_day && b.second_of_day) return 1;
            return (a.sortIndex||0) - (b.sortIndex||0);
          })
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
  window.guiaAT?.injectBadges();
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
 