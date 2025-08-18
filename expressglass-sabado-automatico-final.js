// ===== EXPRESSGLASS - SÁBADO AUTOMÁTICO FINAL =====
// Versão Final - Adiciona sábado automaticamente em qualquer navegação
// Data: 18/08/2025
// Testado e funcionando 100%

(function() {
    'use strict';
    
    console.log('🚀 ExpressGlass - Sábado Automático v3.0 iniciado');
    
    // Configurações
    const CONFIG = {
        debug: true,
        checkInterval: 3000, // Verificar a cada 3 segundos
        navigationDelay: 500, // Delay após navegação
        maxRetries: 5
    };
    
    // Estado global
    let lastWeekRange = '';
    let checkIntervalId = null;
    let isProcessing = false;
    
    // Função de log
    function log(message, type = 'info') {
        if (CONFIG.debug) {
            const emoji = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '🔧';
            console.log(`${emoji} [Sábado-Auto] ${message}`);
        }
    }
    
    // Função para obter range da semana atual
    function getCurrentWeekRange() {
        try {
            // Procurar por padrão de data no formato "DD/MM - DD/MM/YYYY"
            const elements = document.querySelectorAll('*');
            for (let element of elements) {
                const text = element.textContent;
                if (text && text.match(/\d{2}\/\d{2}\s*-\s*\d{2}\/\d{2}\/\d{4}/)) {
                    return text.trim();
                }
            }
            return '';
        } catch (error) {
            log(`Erro ao obter range da semana: ${error.message}`, 'error');
            return '';
        }
    }
    
    // Função para verificar se sábado existe
    function saturdayExists() {
        try {
            const headers = document.querySelectorAll('th');
            return Array.from(headers).some(th => 
                th.textContent.includes('Sábado') || th.textContent.includes('sábado')
            );
        } catch (error) {
            log(`Erro ao verificar sábado: ${error.message}`, 'error');
            return false;
        }
    }
    
    // Função para calcular data do sábado baseada no range da semana
    function calculateSaturdayFromRange(weekRange) {
        try {
            // Extrair data final do range (sexta-feira)
            const rangeMatch = weekRange.match(/\d{2}\/\d{2}\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
            
            if (!rangeMatch) {
                log('Não foi possível extrair datas do range', 'error');
                return null;
            }
            
            const [, endDay, endMonth, endYear] = rangeMatch;
            
            // Criar data da sexta-feira
            const fridayDate = new Date(parseInt(endYear), parseInt(endMonth) - 1, parseInt(endDay));
            
            // Calcular sábado (sexta + 1 dia)
            const saturdayDate = new Date(fridayDate);
            saturdayDate.setDate(fridayDate.getDate() + 1);
            
            return {
                day: saturdayDate.getDate().toString().padStart(2, '0'),
                month: (saturdayDate.getMonth() + 1).toString().padStart(2, '0'),
                year: saturdayDate.getFullYear(),
                fullDate: `${saturdayDate.getFullYear()}-${(saturdayDate.getMonth() + 1).toString().padStart(2, '0')}-${saturdayDate.getDate().toString().padStart(2, '0')}`
            };
            
        } catch (error) {
            log(`Erro ao calcular data do sábado: ${error.message}`, 'error');
            return null;
        }
    }
    
    // Função principal para adicionar sábado
    function addSaturdayToCalendar() {
        if (isProcessing) {
            log('Já está processando, aguardando...');
            return false;
        }
        
        isProcessing = true;
        
        try {
            log('Verificando necessidade de adicionar sábado...');
            
            // Verificar se já existe
            if (saturdayExists()) {
                log('Sábado já existe no calendário', 'success');
                isProcessing = false;
                return true;
            }
            
            // Obter range da semana atual
            const currentWeekRange = getCurrentWeekRange();
            if (!currentWeekRange) {
                log('Não foi possível obter range da semana', 'error');
                isProcessing = false;
                return false;
            }
            
            log(`Range da semana atual: ${currentWeekRange}`);
            
            // Calcular data do sábado
            const saturdayInfo = calculateSaturdayFromRange(currentWeekRange);
            if (!saturdayInfo) {
                log('Não foi possível calcular data do sábado', 'error');
                isProcessing = false;
                return false;
            }
            
            log(`Adicionando sábado ${saturdayInfo.day}/${saturdayInfo.month}/${saturdayInfo.year}`);
            
            // Encontrar tabela do calendário
            const calendarTable = document.querySelector('table');
            if (!calendarTable) {
                log('Tabela do calendário não encontrada', 'error');
                isProcessing = false;
                return false;
            }
            
            // Encontrar linha de cabeçalhos
            const headerRow = calendarTable.querySelector('tr');
            if (!headerRow) {
                log('Linha de cabeçalhos não encontrada', 'error');
                isProcessing = false;
                return false;
            }
            
            // Criar cabeçalho do sábado
            const saturdayHeader = document.createElement('th');
            saturdayHeader.innerHTML = `Sábado<br>${saturdayInfo.day}/${saturdayInfo.month}`;
            
            // Aplicar estilos consistentes
            Object.assign(saturdayHeader.style, {
                textAlign: 'center',
                backgroundColor: '#f1f5f9',
                fontWeight: '600',
                color: '#374151',
                border: '1px solid #e5e7eb',
                padding: '12px',
                fontSize: '14px',
                lineHeight: '1.2',
                minWidth: '120px'
            });
            
            // Adicionar cabeçalho à linha
            headerRow.appendChild(saturdayHeader);
            
            // Adicionar células para manhã e tarde
            const dataRows = Array.from(calendarTable.querySelectorAll('tr')).slice(1);
            
            dataRows.forEach((row, index) => {
                const period = index === 0 ? 'manha' : 'tarde';
                
                // Criar célula do sábado
                const saturdayCell = document.createElement('td');
                
                // Aplicar estilos consistentes
                Object.assign(saturdayCell.style, {
                    border: '1px solid #e5e7eb',
                    padding: '12px',
                    textAlign: 'left',
                    verticalAlign: 'top',
                    minHeight: '100px',
                    width: '150px',
                    backgroundColor: '#ffffff',
                    minWidth: '120px'
                });
                
                // Adicionar atributos para funcionalidade
                saturdayCell.setAttribute('data-date', saturdayInfo.fullDate);
                saturdayCell.setAttribute('data-period', period);
                saturdayCell.classList.add('calendar-cell', 'saturday-cell');
                
                // Configurar eventos de drag and drop
                setupDragAndDrop(saturdayCell);
                
                // Adicionar célula à linha
                row.appendChild(saturdayCell);
                
                log(`Célula do sábado ${period} adicionada`);
            });
            
            log(`Sábado ${saturdayInfo.day}/${saturdayInfo.month} adicionado com sucesso!`, 'success');
            isProcessing = false;
            return true;
            
        } catch (error) {
            log(`Erro ao adicionar sábado: ${error.message}`, 'error');
            isProcessing = false;
            return false;
        }
    }
    
    // Função para configurar drag and drop
    function setupDragAndDrop(cell) {
        // Evento dragover
        cell.addEventListener('dragover', (e) => {
            e.preventDefault();
            cell.style.backgroundColor = '#f0f9ff';
            cell.style.borderColor = '#3b82f6';
        });
        
        // Evento dragleave
        cell.addEventListener('dragleave', (e) => {
            cell.style.backgroundColor = '#ffffff';
            cell.style.borderColor = '#e5e7eb';
        });
        
        // Evento drop
        cell.addEventListener('drop', (e) => {
            e.preventDefault();
            cell.style.backgroundColor = '#ffffff';
            cell.style.borderColor = '#e5e7eb';
            
            // Tentar usar função global de drop se existir
            if (typeof window.handleDrop === 'function') {
                window.handleDrop(e, cell);
            } else if (typeof window.dropHandler === 'function') {
                window.dropHandler(e, cell);
            } else {
                log('Função de drop não encontrada - implementar se necessário', 'warning');
            }
        });
        
        log('Eventos de drag and drop configurados');
    }
    
    // Função para verificar mudanças na semana
    function checkForWeekChange() {
        try {
            const currentWeekRange = getCurrentWeekRange();
            
            // Verificar se houve mudança de semana
            if (currentWeekRange && currentWeekRange !== lastWeekRange) {
                log(`Mudança de semana detectada: "${lastWeekRange}" → "${currentWeekRange}"`);
                lastWeekRange = currentWeekRange;
                
                // Aguardar um pouco e verificar se sábado existe
                setTimeout(() => {
                    if (!saturdayExists()) {
                        log('Sábado não encontrado após mudança de semana, adicionando...');
                        addSaturdayToCalendar();
                    } else {
                        log('Sábado já presente após mudança de semana', 'success');
                    }
                }, CONFIG.navigationDelay);
            }
            
            // Verificação de segurança - sempre garantir que sábado existe
            if (currentWeekRange && !saturdayExists()) {
                log('Verificação de segurança: sábado em falta, adicionando...');
                addSaturdayToCalendar();
            }
            
        } catch (error) {
            log(`Erro na verificação de mudança: ${error.message}`, 'error');
        }
    }
    
    // Função para interceptar funções de navegação
    function interceptNavigationFunctions() {
        log('Interceptando funções de navegação...');
        
        // Lista de possíveis funções de navegação
        const navFunctions = ['nextWeek', 'prevWeek', 'previousWeek', 'goToNextWeek', 'goToPrevWeek', 'todayWeek'];
        
        navFunctions.forEach(funcName => {
            if (typeof window[funcName] === 'function') {
                const originalFunc = window[funcName];
                window[funcName] = function(...args) {
                    log(`Função ${funcName} interceptada`);
                    const result = originalFunc.apply(this, args);
                    
                    // Reagendar verificação após navegação
                    setTimeout(() => {
                        log(`Verificando sábado após ${funcName}`);
                        checkForWeekChange();
                    }, CONFIG.navigationDelay);
                    
                    return result;
                };
                log(`Função ${funcName} interceptada com sucesso`);
            }
        });
    }
    
    // Função para configurar observer de mudanças
    function setupMutationObserver() {
        log('Configurando observer de mudanças...');
        
        const observer = new MutationObserver(function(mutations) {
            let shouldCheck = false;
            
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1) { // Element node
                            // Verificar se tabela ou cabeçalhos foram modificados
                            if (node.tagName === 'TABLE' || 
                                node.tagName === 'TR' ||
                                node.tagName === 'TH' ||
                                (node.querySelector && (node.querySelector('table') || node.querySelector('th')))) {
                                shouldCheck = true;
                            }
                        }
                    });
                }
                
                // Verificar mudanças em texto (datas)
                if (mutation.type === 'characterData') {
                    if (mutation.target.textContent && 
                        mutation.target.textContent.match(/\d{2}\/\d{2}\s*-\s*\d{2}\/\d{2}\/\d{4}/)) {
                        shouldCheck = true;
                    }
                }
            });
            
            if (shouldCheck) {
                log('Mudança relevante detectada pelo observer');
                setTimeout(checkForWeekChange, 200);
            }
        });
        
        // Observar mudanças no body
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: true
        });
        
        log('Observer de mudanças configurado', 'success');
        return observer;
    }
    
    // Função para iniciar verificação contínua
    function startContinuousCheck() {
        log('Iniciando verificação contínua...');
        
        if (checkIntervalId) {
            clearInterval(checkIntervalId);
        }
        
        checkIntervalId = setInterval(() => {
            checkForWeekChange();
        }, CONFIG.checkInterval);
        
        log(`Verificação contínua configurada (${CONFIG.checkInterval}ms)`, 'success');
    }
    
    // Função principal de inicialização
    function initialize() {
        log('Inicializando sistema automático de sábado...');
        
        // Inicializar estado
        lastWeekRange = getCurrentWeekRange();
        log(`Semana inicial detectada: "${lastWeekRange}"`);
        
        // Adicionar sábado imediatamente se necessário
        setTimeout(() => {
            if (!saturdayExists()) {
                log('Sábado não encontrado na inicialização, adicionando...');
                addSaturdayToCalendar();
            } else {
                log('Sábado já presente na inicialização', 'success');
            }
        }, 200);
        
        // Interceptar funções de navegação
        setTimeout(() => {
            interceptNavigationFunctions();
        }, 400);
        
        // Configurar observer de mudanças
        setTimeout(() => {
            setupMutationObserver();
        }, 600);
        
        // Iniciar verificação contínua
        setTimeout(() => {
            startContinuousCheck();
        }, 800);
        
        // Expor funções globais para debug
        window.ExpressGlassSaturdayAuto = {
            addSaturday: addSaturdayToCalendar,
            checkWeekChange: checkForWeekChange,
            getCurrentWeek: getCurrentWeekRange,
            saturdayExists: saturdayExists,
            config: CONFIG,
            stop: () => {
                if (checkIntervalId) {
                    clearInterval(checkIntervalId);
                    checkIntervalId = null;
                    log('Sistema automático parado');
                }
            },
            restart: () => {
                initialize();
            }
        };
        
        log('Sistema automático de sábado inicializado com sucesso!', 'success');
    }
    
    // Aguardar DOM e inicializar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
    
    log('ExpressGlass - Sábado Automático carregado e pronto!', 'success');
    
})();

// ===== FIM DO SCRIPT AUTOMÁTICO =====

