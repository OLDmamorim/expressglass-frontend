// ===== FORÇAR CORES NO MODO ESCURO - JAVASCRIPT ===== 
// Script para aplicar cores corretas quando CSS não consegue

// Função para forçar cores dos agendamentos no modo escuro
function forceDarkModeColors() {
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    
    if (!isDarkMode) return;
    
    console.log('🌙 Aplicando cores forçadas no modo escuro...');
    
    // FORÇAR CORES DOS AGENDAMENTOS POR LOCALIDADE
    const appointments = document.querySelectorAll('.appointment');
    appointments.forEach(appointment => {
        // Manter cor de fundo original mas melhorar contraste
        const computedStyle = window.getComputedStyle(appointment);
        const backgroundColor = computedStyle.backgroundColor;
        
        // Forçar texto branco com sombra para melhor legibilidade
        const headers = appointment.querySelectorAll('.appt-header, h3, h4');
        headers.forEach(header => {
            header.style.color = '#ffffff !important';
            header.style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.8)';
            header.style.fontWeight = '600';
        });
        
        const subs = appointment.querySelectorAll('.appt-sub, .appt-details, p, span, div');
        subs.forEach(sub => {
            if (!sub.querySelector('input') && !sub.classList.contains('appt-header')) {
                sub.style.color = 'rgba(255, 255, 255, 0.9) !important';
                sub.style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.8)';
            }
        });
        
        // Melhorar borda
        appointment.style.border = '2px solid rgba(255, 255, 255, 0.3)';
        appointment.style.borderRadius = '8px';
    });
    
    // FORÇAR CORES DOS STATUS (N/E, V/E, ST)
    const statusCheckboxes = document.querySelectorAll('.appointment input[type="checkbox"]');
    statusCheckboxes.forEach(checkbox => {
        const label = document.querySelector(`label[for="${checkbox.id}"]`) || 
                     checkbox.nextElementSibling || 
                     checkbox.parentElement.querySelector('label');
        
        if (label) {
            // Identificar tipo de status pelo ID ou texto
            const statusType = checkbox.id.toLowerCase();
            
            if (statusType.includes('ne') || label.textContent.includes('N/E')) {
                // Status N/E - Vermelho
                if (checkbox.checked) {
                    label.style.backgroundColor = '#dc2626 !important';
                    label.style.color = '#ffffff !important';
                    label.style.padding = '4px 8px';
                    label.style.borderRadius = '4px';
                    label.style.fontWeight = 'bold';
                }
            } else if (statusType.includes('ve') || label.textContent.includes('V/E')) {
                // Status V/E - Laranja
                if (checkbox.checked) {
                    label.style.backgroundColor = '#d97706 !important';
                    label.style.color = '#ffffff !important';
                    label.style.padding = '4px 8px';
                    label.style.borderRadius = '4px';
                    label.style.fontWeight = 'bold';
                }
            } else if (statusType.includes('st') || label.textContent.includes('ST')) {
                // Status ST - Verde
                if (checkbox.checked) {
                    label.style.backgroundColor = '#16a34a !important';
                    label.style.color = '#ffffff !important';
                    label.style.padding = '4px 8px';
                    label.style.borderRadius = '4px';
                    label.style.fontWeight = 'bold';
                }
            }
            
            // Melhorar visibilidade do label
            label.style.color = '#ffffff !important';
            label.style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.8)';
            label.style.fontWeight = 'bold';
        }
        
        // Melhorar visibilidade do checkbox
        checkbox.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        checkbox.style.border = '2px solid rgba(255, 255, 255, 0.5)';
        checkbox.style.borderRadius = '4px';
    });
    
    // FORÇAR CORES NA TABELA SERVIÇOS
    const serviceRows = document.querySelectorAll('.services-table tbody tr');
    serviceRows.forEach(row => {
        const statusCell = row.querySelector('td:nth-last-child(3)'); // Coluna Estado
        if (statusCell) {
            const statusText = statusCell.textContent.trim();
            
            // Aplicar cor de fundo baseada no status
            if (statusText === 'NE' || statusText === 'N/E') {
                statusCell.style.backgroundColor = '#dc2626 !important';
                statusCell.style.color = '#ffffff !important';
                statusCell.style.fontWeight = 'bold';
                statusCell.style.textAlign = 'center';
                statusCell.style.borderRadius = '4px';
            } else if (statusText === 'VE' || statusText === 'V/E') {
                statusCell.style.backgroundColor = '#d97706 !important';
                statusCell.style.color = '#ffffff !important';
                statusCell.style.fontWeight = 'bold';
                statusCell.style.textAlign = 'center';
                statusCell.style.borderRadius = '4px';
            } else if (statusText === 'ST') {
                statusCell.style.backgroundColor = '#16a34a !important';
                statusCell.style.color = '#ffffff !important';
                statusCell.style.fontWeight = 'bold';
                statusCell.style.textAlign = 'center';
                statusCell.style.borderRadius = '4px';
            }
        }
    });
    
    console.log('✅ Cores forçadas aplicadas com sucesso!');
}

// Função para aplicar cores quando o tema muda
function onThemeChange() {
    // Aguardar um pouco para o DOM se atualizar
    setTimeout(forceDarkModeColors, 100);
}

// Função para observar mudanças no atributo data-theme
function observeThemeChanges() {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                onThemeChange();
            }
        });
    });
    
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
    });
}

// Função para aplicar cores quando novos agendamentos são adicionados
function observeAppointmentChanges() {
    const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                // Verificar se foram adicionados novos agendamentos
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList && node.classList.contains('appointment') ||
                            node.querySelector && node.querySelector('.appointment')) {
                            shouldUpdate = true;
                        }
                    }
                });
            }
        });
        
        if (shouldUpdate) {
            setTimeout(forceDarkModeColors, 100);
        }
    });
    
    // Observar mudanças no calendário e tabela
    const calendar = document.querySelector('.calendar-container');
    const servicesTable = document.querySelector('.services-container');
    
    if (calendar) {
        observer.observe(calendar, { childList: true, subtree: true });
    }
    
    if (servicesTable) {
        observer.observe(servicesTable, { childList: true, subtree: true });
    }
}

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {
    // Aplicar cores iniciais
    setTimeout(forceDarkModeColors, 500);
    
    // Observar mudanças de tema
    observeThemeChanges();
    
    // Observar mudanças nos agendamentos
    observeAppointmentChanges();
    
    console.log('🚀 Sistema de cores forçadas inicializado!');
});

// Também inicializar se o script for carregado depois do DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(forceDarkModeColors, 500);
        observeThemeChanges();
        observeAppointmentChanges();
    });
} else {
    setTimeout(forceDarkModeColors, 500);
    observeThemeChanges();
    observeAppointmentChanges();
}

// Função global para forçar atualização (pode ser chamada manualmente)
window.forceDarkModeColors = forceDarkModeColors;

// Aplicar cores sempre que a página for renderizada novamente
setInterval(() => {
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
        forceDarkModeColors();
    }
}, 2000); // Verificar a cada 2 segundos

