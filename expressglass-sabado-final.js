// ===== EXPRESSGLASS - ADIÇÃO PERMANENTE DO SÁBADO AO CALENDÁRIO =====
// Versão Final - Para implementação no GitHub
// Data: 18/08/2025

(function() {
    'use strict';
    
    console.log('📅 ExpressGlass - Sistema de Sábado v1.0 carregado');
    
    // Configurações
    const CONFIG = {
        debug: true,
        retryAttempts: 5,
        retryDelay: 1000,
        observerDelay: 200
    };
    
    // Função de log condicional
    function log(message, type = 'info') {
        if (CONFIG.debug) {
            const emoji = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '📅';
            console.log(`${emoji} [ExpressGlass-Sábado] ${message}`);
        }
    }
    
    // Função para calcular a data do sábado
    function calculateSaturdayDate() {
        try {
            // Encontrar o cabeçalho da sexta-feira
            const fridayHeader = Array.from(document.querySelectorAll('th')).find(th => 
                th.textContent.includes('Sexta-feira')
            );
            
            if (!fridayHeader) {
                log('Cabeçalho da sexta-feira não encontrado', 'error');
                return null;
            }
            
            // Extrair data da sexta
            const fridayText = fridayHeader.textContent;
            const dateMatch = fridayText.match(/(\d{2})\/(\d{2})/);
            
            if (!dateMatch) {
                log('Não foi possível extrair a data da sexta', 'error');
                return null;
            }
            
            const [, day, month] = dateMatch;
            const currentYear = new Date().getFullYear();
            const fridayDate = new Date(currentYear, month - 1, parseInt(day));
            const saturdayDate = new Date(fridayDate);
            saturdayDate.setDate(fridayDate.getDate() + 1);
            
            const saturdayDay = saturdayDate.getDate().toString().padStart(2, '0');
            const saturdayMonth = (saturdayDate.getMonth() + 1).toString().padStart(2, '0');
            
            return {
                day: saturdayDay,
                month: saturdayMonth,
                year: currentYear,
                fullDate: `${currentYear}-${saturdayMonth}-${saturdayDay}`
            };
            
        } catch (error) {
            log(`Erro ao calcular data do sábado: ${error.message}`, 'error');
            return null;
        }
    }
    
    // Função principal para adicionar sábado
    function addSaturdayToCalendar() {
        log('Iniciando adição do sábado ao calendário...');
        
        try {
            // Encontrar a tabela do calendário
            const calendarTable = document.querySelector('table');
            if (!calendarTable) {
                log('Tabela do calendário não encontrada', 'error');
                return false;
            }
            
            // Encontrar a linha de cabeçalhos
            const headerRow = calendarTable.querySelector('tr');
            if (!headerRow) {
                log('Linha de cabeçalhos não encontrada', 'error');
                return false;
            }
            
            // Verificar se sábado já existe
            const existingSaturday = Array.from(headerRow.querySelectorAll('th')).find(th => 
                th.textContent.includes('Sábado') || th.textContent.includes('sábado')
            );
            
            if (existingSaturday) {
                log('Sábado já existe no calendário', 'success');
                return true;
            }
            
            // Calcular data do sábado
            const saturdayInfo = calculateSaturdayDate();
            if (!saturdayInfo) {
                log('Não foi possível calcular a data do sábado', 'error');
                return false;
            }
            
            // Criar cabeçalho do sábado
            const saturdayHeader = document.createElement('th');
            saturdayHeader.innerHTML = `Sábado<br>${saturdayInfo.day}/${saturdayInfo.month}`;
            
            // Aplicar estilos do cabeçalho
            Object.assign(saturdayHeader.style, {
                textAlign: 'center',
                backgroundColor: '#f1f5f9',
                fontWeight: '600',
                color: '#374151',
                border: '1px solid #e5e7eb',
                padding: '12px',
                fontSize: '14px',
                lineHeight: '1.2'
            });
            
            // Adicionar o cabeçalho do sábado
            headerRow.appendChild(saturdayHeader);
            
            // Processar linhas de manhã e tarde
            const rows = Array.from(calendarTable.querySelectorAll('tr')).slice(1); // Pular cabeçalho
            
            rows.forEach((row, index) => {
                const period = index === 0 ? 'manha' : 'tarde';
                
                // Criar célula do sábado
                const saturdayCell = document.createElement('td');
                
                // Aplicar estilos da célula
                Object.assign(saturdayCell.style, {
                    border: '1px solid #e5e7eb',
                    padding: '12px',
                    textAlign: 'left',
                    verticalAlign: 'top',
                    minHeight: '100px',
                    width: '150px',
                    backgroundColor: '#ffffff'
                });
                
                // Adicionar atributos para funcionalidade
                saturdayCell.setAttribute('data-date', saturdayInfo.fullDate);
                saturdayCell.setAttribute('data-period', period);
                saturdayCell.classList.add('calendar-cell', 'saturday-cell');
                
                // Configurar eventos de drag and drop
                setupDragAndDrop(saturdayCell);
                
                // Adicionar à linha
                row.appendChild(saturdayCell);
                
                log(`Célula do sábado ${period} adicionada`);
            });
            
            log('Sábado adicionado com sucesso ao calendário!', 'success');
            return true;
            
        } catch (error) {
            log(`Erro ao adicionar sábado: ${error.message}`, 'error');
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
                log('Função de drop não encontrada - implementar manualmente se necessário', 'warning');
            }
        });
        
        log('Eventos de drag and drop configurados para célula do sábado');
    }
    
    // Função para interceptar navegação
    function setupNavigationInterception() {
        log('Configurando interceptação da navegação...');
        
        // Encontrar botões de navegação
        const prevButton = document.querySelector('button[onclick*="anterior"], button[onclick*="prev"], button:contains("Anterior")');
        const nextButton = document.querySelector('button[onclick*="proxima"], button[onclick*="next"], button:contains("Próxima")');
        
        // Função para interceptar cliques
        function interceptNavigation(button, direction) {
            if (!button) return;
            
            const originalOnClick = button.onclick;
            
            button.addEventListener('click', function(e) {
                log(`Navegação ${direction} detectada`);
                
                // Executar função original se existir
                if (originalOnClick) {
                    originalOnClick.call(this, e);
                }
                
                // Reagendar adição do sábado
                setTimeout(() => {
                    log(`Reagendando adição do sábado após navegação ${direction}`);
                    addSaturdayToCalendar();
                }, CONFIG.observerDelay);
            });
        }
        
        interceptNavigation(prevButton, 'anterior');
        interceptNavigation(nextButton, 'próxima');
        
        if (prevButton || nextButton) {
            log('Interceptação de navegação configurada', 'success');
        } else {
            log('Botões de navegação não encontrados', 'warning');
        }
    }
    
    // Função para configurar observer de mudanças
    function setupMutationObserver() {
        log('Configurando observer de mudanças no DOM...');
        
        const observer = new MutationObserver(function(mutations) {
            let shouldAddSaturday = false;
            
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1) { // Element node
                            // Verificar se uma tabela foi adicionada/modificada
                            if (node.tagName === 'TABLE' || 
                                (node.querySelector && node.querySelector('table')) ||
                                (node.classList && node.classList.contains('calendar'))) {
                                shouldAddSaturday = true;
                            }
                        }
                    });
                }
            });
            
            if (shouldAddSaturday) {
                log('Mudança no calendário detectada, reagendando adição do sábado');
                setTimeout(addSaturdayToCalendar, CONFIG.observerDelay);
            }
        });
        
        // Observar mudanças no body
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });
        
        log('Observer de mudanças configurado', 'success');
        return observer;
    }
    
    // Função de inicialização com retry
    function initializeWithRetry(attempt = 1) {
        log(`Tentativa de inicialização ${attempt}/${CONFIG.retryAttempts}`);
        
        const success = addSaturdayToCalendar();
        
        if (success) {
            log('Inicialização bem-sucedida!', 'success');
            
            // Configurar interceptação de navegação
            setupNavigationInterception();
            
            // Configurar observer
            const observer = setupMutationObserver();
            
            // Expor funções globais para debug
            window.ExpressGlassSaturday = {
                addSaturday: addSaturdayToCalendar,
                calculateDate: calculateSaturdayDate,
                observer: observer,
                config: CONFIG
            };
            
            log('Sistema de sábado totalmente configurado!', 'success');
            
        } else if (attempt < CONFIG.retryAttempts) {
            log(`Tentativa ${attempt} falhou, tentando novamente em ${CONFIG.retryDelay}ms...`, 'warning');
            setTimeout(() => initializeWithRetry(attempt + 1), CONFIG.retryDelay);
        } else {
            log('Todas as tentativas de inicialização falharam', 'error');
        }
    }
    
    // Função principal de inicialização
    function initialize() {
        log('Inicializando sistema de adição do sábado...');
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(initializeWithRetry, 100);
            });
        } else {
            setTimeout(initializeWithRetry, 100);
        }
    }
    
    // Inicializar o sistema
    initialize();
    
    log('ExpressGlass - Sistema de Sábado carregado e pronto!', 'success');
    
})();

// ===== FIM DO SCRIPT =====

