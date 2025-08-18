// ===== VERSÃO ULTRA-AGRESSIVA - FORÇAR CORES NO MODO ESCURO ===== 
// Script que força estilos diretamente no HTML com !important

// Função para aplicar estilo com !important
function setImportantStyle(element, property, value) {
    element.style.setProperty(property, value, 'important');
}

// Função ultra-agressiva para forçar cores
function ultraForceDarkModeColors() {
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    
    if (!isDarkMode) return;
    
    console.log('💪 VERSÃO ULTRA-AGRESSIVA: Forçando cores no modo escuro...');
    
    // FORÇAR CORES DOS AGENDAMENTOS - VERSÃO AGRESSIVA
    const appointments = document.querySelectorAll('.appointment');
    console.log(`🎯 Encontrados ${appointments.length} agendamentos`);
    
    appointments.forEach((appointment, index) => {
        console.log(`🔧 Processando agendamento ${index + 1}`);
        
        // Melhorar borda do agendamento
        setImportantStyle(appointment, 'border', '2px solid rgba(255, 255, 255, 0.4)');
        setImportantStyle(appointment, 'border-radius', '8px');
        
        // FORÇAR TEXTO BRANCO EM TODOS OS ELEMENTOS
        const textElements = appointment.querySelectorAll('*');
        textElements.forEach(element => {
            // Pular inputs e elementos que não devem ter texto branco
            if (!element.matches('input, button, select')) {
                setImportantStyle(element, 'color', '#ffffff');
                setImportantStyle(element, 'text-shadow', '1px 1px 2px rgba(0, 0, 0, 0.8)');
            }
        });
        
        // FORÇAR CABEÇALHOS
        const headers = appointment.querySelectorAll('h1, h2, h3, h4, h5, h6, .appt-header, strong');
        headers.forEach(header => {
            setImportantStyle(header, 'color', '#ffffff');
            setImportantStyle(header, 'font-weight', '600');
            setImportantStyle(header, 'text-shadow', '2px 2px 4px rgba(0, 0, 0, 0.9)');
        });
    });
    
    // FORÇAR CORES DOS STATUS - VERSÃO ULTRA-AGRESSIVA
    const statusCheckboxes = document.querySelectorAll('.appointment input[type="checkbox"]');
    console.log(`🎯 Encontrados ${statusCheckboxes.length} checkboxes de status`);
    
    statusCheckboxes.forEach((checkbox, index) => {
        console.log(`🔧 Processando checkbox ${index + 1}: ${checkbox.id}`);
        
        // Melhorar visibilidade do checkbox
        setImportantStyle(checkbox, 'background-color', 'rgba(255, 255, 255, 0.3)');
        setImportantStyle(checkbox, 'border', '2px solid rgba(255, 255, 255, 0.6)');
        setImportantStyle(checkbox, 'border-radius', '4px');
        setImportantStyle(checkbox, 'width', '18px');
        setImportantStyle(checkbox, 'height', '18px');
        
        // Encontrar label associado
        const label = document.querySelector(`label[for="${checkbox.id}"]`) || 
                     checkbox.nextElementSibling || 
                     checkbox.parentElement.querySelector('label');
        
        if (label) {
            console.log(`📝 Label encontrado: ${label.textContent}`);
            
            // Forçar texto branco no label
            setImportantStyle(label, 'color', '#ffffff');
            setImportantStyle(label, 'font-weight', 'bold');
            setImportantStyle(label, 'text-shadow', '1px 1px 2px rgba(0, 0, 0, 0.8)');
            setImportantStyle(label, 'padding', '4px 8px');
            setImportantStyle(label, 'border-radius', '4px');
            setImportantStyle(label, 'margin', '2px');
            setImportantStyle(label, 'display', 'inline-block');
            
            // Identificar tipo de status e aplicar cor de fundo
            const statusType = checkbox.id.toLowerCase();
            const labelText = label.textContent.trim().toLowerCase();
            
            if (checkbox.checked) {
                if (statusType.includes('ne') || labelText.includes('n/e') || labelText.includes('ne')) {
                    // Status N/E - Vermelho
                    setImportantStyle(label, 'background-color', '#dc2626');
                    console.log('🔴 Aplicando cor vermelha para N/E');
                } else if (statusType.includes('ve') || labelText.includes('v/e') || labelText.includes('ve')) {
                    // Status V/E - Laranja
                    setImportantStyle(label, 'background-color', '#d97706');
                    console.log('🟡 Aplicando cor laranja para V/E');
                } else if (statusType.includes('st') || labelText.includes('st')) {
                    // Status ST - Verde
                    setImportantStyle(label, 'background-color', '#16a34a');
                    console.log('🟢 Aplicando cor verde para ST');
                }
            } else {
                // Se não está checked, fundo transparente
                setImportantStyle(label, 'background-color', 'rgba(255, 255, 255, 0.1)');
            }
        }
    });
    
    // FORÇAR CORES NA TABELA SERVIÇOS - VERSÃO AGRESSIVA
    const serviceRows = document.querySelectorAll('.services-table tbody tr, table tbody tr');
    console.log(`🎯 Encontradas ${serviceRows.length} linhas na tabela de serviços`);
    
    serviceRows.forEach((row, index) => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, cellIndex) => {
            const cellText = cell.textContent.trim().toUpperCase();
            
            // Verificar se é coluna de status (geralmente as últimas colunas)
            if (cellText === 'NE' || cellText === 'N/E') {
                setImportantStyle(cell, 'background-color', '#dc2626');
                setImportantStyle(cell, 'color', '#ffffff');
                setImportantStyle(cell, 'font-weight', 'bold');
                setImportantStyle(cell, 'text-align', 'center');
                setImportantStyle(cell, 'border-radius', '4px');
                console.log(`🔴 Aplicando cor vermelha na tabela linha ${index + 1}`);
            } else if (cellText === 'VE' || cellText === 'V/E') {
                setImportantStyle(cell, 'background-color', '#d97706');
                setImportantStyle(cell, 'color', '#ffffff');
                setImportantStyle(cell, 'font-weight', 'bold');
                setImportantStyle(cell, 'text-align', 'center');
                setImportantStyle(cell, 'border-radius', '4px');
                console.log(`🟡 Aplicando cor laranja na tabela linha ${index + 1}`);
            } else if (cellText === 'ST') {
                setImportantStyle(cell, 'background-color', '#16a34a');
                setImportantStyle(cell, 'color', '#ffffff');
                setImportantStyle(cell, 'font-weight', 'bold');
                setImportantStyle(cell, 'text-align', 'center');
                setImportantStyle(cell, 'border-radius', '4px');
                console.log(`🟢 Aplicando cor verde na tabela linha ${index + 1}`);
            }
        });
    });
    
    // FORÇAR TÍTULO "SERVIÇOS POR AGENDAR"
    const serviceTitles = document.querySelectorAll('h1, h2, h3, h4');
    serviceTitles.forEach(title => {
        if (title.textContent.includes('SERVIÇOS') || title.textContent.includes('AGENDAR')) {
            setImportantStyle(title, 'color', '#f9fafb');
            setImportantStyle(title, 'background-color', 'transparent');
            console.log('📋 Título de serviços tornado visível');
        }
    });
    
    console.log('✅ VERSÃO ULTRA-AGRESSIVA: Cores aplicadas com sucesso!');
}

// Função para observar mudanças e aplicar cores
function startUltraForceMode() {
    // Aplicar cores iniciais
    setTimeout(ultraForceDarkModeColors, 500);
    
    // Observar mudanças no tema
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                setTimeout(ultraForceDarkModeColors, 100);
            }
        });
    });
    
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
    });
    
    // Observar mudanças no DOM (novos agendamentos)
    const domObserver = new MutationObserver(() => {
        if (document.documentElement.getAttribute('data-theme') === 'dark') {
            setTimeout(ultraForceDarkModeColors, 100);
        }
    });
    
    const calendar = document.querySelector('.calendar-container, .main-content');
    if (calendar) {
        domObserver.observe(calendar, { childList: true, subtree: true });
    }
    
    // Aplicar cores a cada 3 segundos (força bruta)
    setInterval(() => {
        if (document.documentElement.getAttribute('data-theme') === 'dark') {
            ultraForceDarkModeColors();
        }
    }, 3000);
    
    console.log('🚀 MODO ULTRA-AGRESSIVO INICIADO!');
}

// Inicializar quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUltraForceMode);
} else {
    startUltraForceMode();
}

// Função global para debug
window.ultraForceDarkModeColors = ultraForceDarkModeColors;

// Aplicar quando a página for totalmente carregada
window.addEventListener('load', () => {
    setTimeout(ultraForceDarkModeColors, 1000);
});

