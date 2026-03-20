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
  
  // 1. Encontrar o serviço mais distante da loja
  let farthestService = null;
  let maxDistance = 0;
  
  for (const service of services) {
    const address = getAddressFromItem(service);
    const distance = await getDistance(getBasePartida(), address);
    if (distance > maxDistance && distance !== Infinity) {
      maxDistance = distance;
      farthestService = service;
    }
  }
  
  if (!farthestService) return;
  
  // 2. Criar rota otimizada começando pelo mais distante
  const optimizedRoute = [farthestService];
  const remaining = services.filter(s => s.id !== farthestService.id);
  
  // 3. Para cada posição seguinte, encontrar o mais próximo do anterior
  while (remaining.length > 0) {
    const currentLocation = getAddressFromItem(optimizedRoute[optimizedRoute.length - 1]);
    let closestService = null;
    let minDistance = Infinity;
    
    for (const service of remaining) {
      const serviceAddress = getAddressFromItem(service);
      const distance = await getDistance(currentLocation, serviceAddress);
      if (distance < minDistance && distance !== Infinity) {
        minDistance = distance;
        closestService = service;
      }
    }
    
    if (closestService) {
      optimizedRoute.push(closestService);
      const index = remaining.indexOf(closestService);
      remaining.splice(index, 1);
    } else {
      // Se não conseguir calcular distância, adiciona o restante na ordem original
      optimizedRoute.push(...remaining);
      break;
    }
  }
  
  // 4. Recalcular quilómetros entre pontos da rota otimizada
  for (let i = 0; i < optimizedRoute.length; i++) {
    const service = optimizedRoute[i];
    const appointmentIndex = appointments.findIndex(a => a.id === service.id);
    
    if (appointmentIndex >= 0) {
      // Atualizar sortIndex
      appointments[appointmentIndex].sortIndex = i + 1;
      
      // Calcular quilómetros do ponto anterior para este
      let newKm = 0;
      if (i === 0) {
        // Primeiro serviço: distância da loja
        const serviceAddress = getAddressFromItem(service);
        const distanceFromBase = await getDistance(getBasePartida(), serviceAddress);
        newKm = distanceFromBase !== Infinity ? Math.round(distanceFromBase / 1000) : 0;
      } else {
        // Serviços seguintes: distância do serviço anterior
        const previousService = optimizedRoute[i - 1];
        const previousAddress = getAddressFromItem(previousService);
        const currentAddress = getAddressFromItem(service);
        const distanceFromPrevious = await getDistance(previousAddress, currentAddress);
        newKm = distanceFromPrevious !== Infinity ? Math.round(distanceFromPrevious / 1000) : 0;
      }
      
      // Atualizar quilómetros no appointment
      appointments[appointmentIndex].km = newKm;
      
      // Marcar como otimizado para feedback visual
      appointments[appointmentIndex]._optimized = true;
      
      console.log(`🗺️ Serviço ${i + 1}: ${newKm}km ${i === 0 ? 'da loja' : 'do anterior'}`);
    }
  }
}

// Guardar rotas otimizadas na base de dados
async function saveOptimizedRoutes() {
  const optimizedServices = appointments.filter(a => a._optimized);
  
  console.log(`🔍 DEBUG - Serviços com flag _optimized: ${optimizedServices.length}`);
  console.log('🔍 DEBUG - Todos os appointments:', appointments.length);
  
  // Debug: Mostrar todos os sortIndex atuais
  appointments.forEach(a => {
    if (a.date === '2025-09-26') { // Ajustar data conforme necessário
      console.log(`🔍 DEBUG - ${a.plate}: sortIndex=${a.sortIndex}, _optimized=${a._optimized}`);
    }
  });
  
  if (optimizedServices.length === 0) {
    console.log('⚠️ AVISO: Nenhum serviço marcado como _optimized para guardar!');
    return;
  }
  
  console.log(`💾 Guardando ${optimizedServices.length} serviços otimizados na BASE DE DADOS...`);
  
  for (const service of optimizedServices) {
    try {
      // Preparar dados para guardar (incluindo km e sortIndex)
      const serviceData = {
        id: service.id,
        date: service.date,
        address: service.address,
        km: service.km, // ← IMPORTANTE: Incluir quilómetros recalculados
        sortIndex: service.sortIndex, // ← IMPORTANTE: Incluir nova ordem
        // Incluir todos os outros campos necessários
        plate: service.plate,
        car: service.car,
        service: service.service,
        locality: service.locality,
        notes: service.notes,
        status: service.status,
        phone: service.phone,
        extra: service.extra
      };
      
      console.log(`💾 DEBUG - Guardando serviço ${service.plate}: km=${service.km}, sortIndex=${service.sortIndex}`);
      console.log(`💾 DEBUG - Dados enviados:`, serviceData);
      
      const result = await window.apiClient.updateAppointment(service.id, serviceData);
      console.log(`✅ DEBUG - Resultado da gravação:`, result);
      
    } catch (error) {
      console.error('❌ Erro ao guardar serviço otimizado:', service.id, error);
      showToast(`Erro ao guardar serviço: ${error.message}`, 'error');
      throw error; // Re-throw para parar o processo se houver erro
    }
  }
  
  console.log('✅ Todos os serviços otimizados foram guardados na BASE DE DADOS');
  
  // Limpar flags temporários
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

// Atribuir cores a todos os concelhos
const localityColors = { 'Outra': '#9CA3AF' };
CONCELHOS_PT.forEach((name, i) => {
  localityColors[name] = _COLOR_PALETTE[i % _COLOR_PALETTE.length];
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
function bucketOf(a){ if(!a.date) return 'unscheduled'; return a.date; }
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

    // 🔍 DEBUG: Verificar dados RAW da base de dados
    console.log('🔍 LOAD DEBUG - Dados RAW da base de dados:');
    appointments.forEach(a => {
      if (a.date === '2025-09-26') {
        console.log(`🔍 RAW - ${a.plate}: sortIndex=${a.sortindex || a.sortIndex}, km=${a.km}`);
      }
    });

    appointments.forEach(a => {
      if (a.date) {
        a.date = String(a.date).slice(0, 10); // fica só "YYYY-MM-DD"
      }
    });

    // IDs e ordem estáveis
    appointments.forEach(a=>{ 
      if(!a.id) a.id=Date.now()+Math.random(); 
      
      // 🔍 DEBUG: Verificar antes e depois
      const beforeSortIndex = a.sortIndex || a.sortindex;
      
      // 🔧 CORREÇÃO: Só definir sortIndex=1 se for null/undefined, não se for 0 ou outro valor
      if(a.sortIndex === null || a.sortIndex === undefined) {
        // Verificar se vem como 'sortindex' (minúsculo) da base de dados
        if(a.sortindex !== null && a.sortindex !== undefined) {
          a.sortIndex = a.sortindex;
        } else {
          a.sortIndex = 1;
        }
      }
      
      if (a.date === '2025-09-26') {
        console.log(`🔍 LOAD - ${a.plate}: antes=${beforeSortIndex}, depois=${a.sortIndex}`);
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


// ---------- Status Listeners ----------
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
  persistTimer = setTimeout(runPersistFlush, 350);
}

async function runPersistFlush(){
  const queue = [...persistQueue];
  persistQueue = [];
  try{
    for (const item of queue) {
      let ok=false, attempts=0;
      while(!ok && attempts<2){
        attempts++;
        try { await window.apiClient.updateAppointment(item.id, item); ok=true; }
        catch(e){ if(attempts>=2) throw e; }
      }
    }
    showToast('Alterações gravadas.', 'success');
  }catch(e){
    showToast('Falha a gravar alguns itens.', 'error');
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

  if(targetBucket === 'unscheduled'){ a.date=null; }
  else { a.date=targetBucket; }

  const dest = getBucketList(targetBucket).filter(x=>String(x.id)!==String(a.id));
  dest.splice(Math.min(targetIndex, dest.length), 0, a);
  dest.forEach((x,idx)=> x.sortIndex = idx+1);

  if (oldBucket !== targetBucket){
    const orig = getBucketList(oldBucket);
    orig.forEach((x,idx)=> x.sortIndex = idx+1);
  }

  renderAll();
  const bucketsToPersist = new Set([targetBucket, oldBucket]);
  await persistBuckets(bucketsToPersist);
}

// ===== FUNÇÕES DE EDIÇÃO E ELIMINAÇÃO =====

function editAppointment(id) {
  const appointment = appointments.find(a => String(a.id) === String(id));
  if (!appointment) {
    showToast('Agendamento não encontrado', 'error');
    return;
  }

  editingId = id;
  
  // Preencher formulário
  document.getElementById('appointmentDate').value = appointment.date || '';
  document.getElementById('appointmentPlate').value = appointment.plate || '';
  document.getElementById('appointmentCar').value = appointment.car || '';
  document.getElementById('appointmentService').value = appointment.service || '';
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
  const base = getLocColor(a.locality);
  const g = gradFromBase(base);
  const bar = statusBarColors[a.status] || '#999';
  const title = `${a.plate} | ${a.service} | ${(a.car||'').toUpperCase()}`;
  const sub   = [a.locality, a.notes].filter(Boolean).join(' | ');
  return `
    <div class="appointment desk-card" data-id="${a.id}" draggable="true"
         data-locality="${a.locality||''}" data-loccolor="${base}"
         style="--c1:${g.c1}; --c2:${g.c2}; border-left:6px solid ${bar}">
      <div class="dc-title">${title}</div>
      <div class="dc-sub">${sub}</div>
      <div class="appt-status dc-status">
        <label><input type="checkbox" data-status="NE" ${a.status==='NE'?'checked':''}/> N/E</label>
        <label><input type="checkbox" data-status="VE" ${a.status==='VE'?'checked':''}/> V/E</label>
        <label><input type="checkbox" data-status="ST" ${a.status==='ST'?'checked':''}/> ST</label>
      </div>
      <div class="card-actions">
        <button class="icon edit" onclick="editAppointment('${a.id}')" title="Editar" aria-label="Editar">✏️</button>
        <button class="icon delete" onclick="deleteAppointment('${a.id}')" title="Eliminar" aria-label="Eliminar">🗑️</button>
      </div>
    ${buildKmRow(a)}</div>`;
}

function renderSchedule(){
  const table=document.getElementById('schedule'); if(!table) return;
  table.innerHTML='';
  const week=[...Array(6)].map((_,i)=>addDays(currentMonday,i)); // Seg-Sáb
  const wr=document.getElementById('weekRange');
  if(wr){ wr.textContent = `${week[0].toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit'})} - ${week[5].toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'})}`; }

  let thead='<thead><tr><th>Data</th>';
  for(const d of week){ const h=fmtHeader(d); thead+=`<th><div class="day">${cap(h.day)}</div><div class="date">${h.dm}</div></th>`; }
  thead+='</tr></thead>';
  table.insertAdjacentHTML('beforeend', thead);

  const renderCell=(dayDate)=>{
    const iso=localISO(dayDate);
    const items=filterAppointments(
      appointments.filter(a=>a.date&&a.date===iso)
        .sort((a,b)=>(a.sortIndex||0)-(b.sortIndex||0))
    );
    const blocks = items.map(buildDesktopCard).join('');
    return `<div class="drop-zone" data-drop-bucket="${iso}">${blocks}</div>`;
  };

  const tbody=document.createElement('tbody');
  const row=document.createElement('tr');
  row.innerHTML=`<th>Serviços</th>` + week.map(d=>`<td>${renderCell(d)}</td>`).join('');
  tbody.appendChild(row);
  table.appendChild(tbody);
  enableDragDrop(); attachStatusListeners(); highlightSearchResults();
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
  
  enableDragDrop(); attachStatusListeners(); highlightSearchResults();
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

  const base = getLocColor(a.locality);
  const g = gradFromBase(base);
  const title = `${a.plate} • ${(a.car||'').toUpperCase()}`;
  const chips = [
    a.period ? `<span class="m-chip">${a.period}</span>` : '',
    a.service ? `<span class="m-chip">${a.service}</span>` : '',
    a.locality ? `<span class="m-chip">${a.locality}</span>` : ''
  ].join('');
  const notes = a.notes ? `<div class="m-info">${a.notes}</div>` : '';

  return `
    <div class="appointment m-card" data-id="${a.id}"
         style="--c1:${g.c1}; --c2:${g.c2}; position:relative;">
      <div class="map-icons">
        ${wazeBtn}${mapsBtn}${telBtn}
      </div>
      <div class="m-title">${title}</div>
      <div class="m-chips">${chips}</div>
      ${notes}
    ${buildKmRow(a)}</div>
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
      .sort((a,b)=> (a.period||'').localeCompare(b.period||'') || (a.sortIndex||0)-(b.sortIndex||0))
  );

  // 🔍 DEBUG: Verificar dados carregados
  console.log('🔍 MOBILE DEBUG - Items do dia:', itemsRaw.length);
  itemsRaw.forEach(item => {
    console.log(`🔍 Item ${item.plate}: sortIndex=${item.sortIndex}, km=${item.km}`);
  });

  // Verificar se já existe ordem otimizada (sortIndex > 1 em algum item)
  const hasOptimizedOrder = itemsRaw.some(item => (item.sortIndex || 0) > 1);
  console.log('🔍 MOBILE DEBUG - Tem ordem otimizada?', hasOptimizedOrder);
  
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

  const allServices = items.map(buildMobileCard).join('');

  list.innerHTML = allServices || '<p style="text-align:center;color:#6b7280;margin:20px;">Nenhum serviço agendado</p>';
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

// Bootstrap da app (carrega BD e desenha)
document.addEventListener('DOMContentLoaded', async ()=>{
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

  // Botão Calcular Rotas - Abrir modal de seleção de dia
  document.getElementById('calculateRoutes')?.addEventListener('click', openSelectDayModal);

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
      // ===== ADICIONAR OS QUILÓMETROS CALCULADOS =====
      km: calculatedKm
    };
  }

  async function onSubmit(e) {
    e?.preventDefault?.();

    const payload = await collectFormData();

    // defaults mínimos
    if (!payload.plate) { showToast('Matrícula é obrigatória', 'error'); return; }
    if (!payload.service) { showToast('Tipo de serviço é obrigatório', 'error'); return; }
    if (!payload.locality) { showToast('Localidade é obrigatória', 'error'); return; }

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
}); // 👈 FECHO DO DOMContentLoaded

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
    
    // ✨ PREENCHIMENTO AUTOMÁTICO: Procurar matrícula nos serviços por agendar
    if (ok && !editingId) { // Apenas para novos agendamentos
      const plate = e.target.value.trim();
      
      // Procurar serviço por agendar com esta matrícula
      const existingService = appointments.find(a => 
        !a.date && // Sem data (por agendar)
        a.plate && a.plate.toUpperCase() === plate.toUpperCase()
      );
      
      if (existingService) {
        console.log('✨ Matrícula encontrada nos serviços por agendar:', existingService);
        
        // Preencher campos automaticamente
        if (existingService.car) {
          document.getElementById('appointmentCar').value = existingService.car;
        }
        if (existingService.service) {
          document.getElementById('appointmentService').value = existingService.service;
        }
        if (existingService.locality) {
          document.getElementById('appointmentLocality').value = existingService.locality;
        }
        if (existingService.notes) {
          document.getElementById('appointmentNotes').value = existingService.notes;
        }
        if (existingService.address) {
          document.getElementById('appointmentAddress').value = existingService.address;
        }
        if (existingService.phone) {
          document.getElementById('appointmentPhone').value = existingService.phone;
        }
        if (existingService.extra) {
          document.getElementById('appointmentExtra').value = existingService.extra;
        }
        if (existingService.status) {
          document.getElementById('appointmentStatus').value = existingService.status;
        }
        
        // Guardar ID do serviço original para eliminar depois
        window.originalUnscheduledServiceId = existingService.id;
        
        showToast('✨ Dados preenchidos automaticamente do serviço por agendar!', 'info');
      }
    }
  });
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
  // isto é obrigatório na versão atual para poderes ler name/formatted_address
  fields: ['place_id', 'name', 'formatted_address']
});

    // Restrição por país (PT). Usa o método suportado.
    // Em versões recentes aceita string ou array; esta forma é compatível.
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
        
        // Calcular distância automaticamente
        try {
          showToast('Calculando distância...', 'info');
          const distanceInMeters = await getDistance(getBasePartida(), txt);
          if (distanceInMeters !== Infinity && distanceInMeters > 0) {
            const calculatedKm = Math.round(distanceInMeters / 1000);
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
