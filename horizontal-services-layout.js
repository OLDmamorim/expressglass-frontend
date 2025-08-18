// ===== LAYOUT HORIZONTAL PARA SERVIÇOS PENDENTES =====
// Versão final testada e funcionando

function applyHorizontalServicesLayout() {
    // Encontrar a seção de serviços pendentes
    const unscheduledList = document.querySelector('.unscheduled-list');
    
    if (unscheduledList) {
        // Aplicar layout horizontal com flexbox
        unscheduledList.style.cssText = `
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 12px !important;
            align-items: flex-start !important;
        `;
        
        // Definir largura fixa para os quadrados (260px)
        const appointments = unscheduledList.querySelectorAll('.appointment.unscheduled');
        appointments.forEach(appointment => {
            appointment.style.cssText += `
                width: 260px !important;
                flex: none !important;
                margin: 0 !important;
                box-sizing: border-box !important;
            `;
        });
        
        console.log(`✅ Layout horizontal aplicado a ${appointments.length} serviços pendentes`);
    }
}

// Aplicar quando a página carrega
document.addEventListener('DOMContentLoaded', applyHorizontalServicesLayout);

// Aplicar quando há mudanças no DOM (novos serviços adicionados)
const observer = new MutationObserver(function(mutations) {
    let shouldApply = false;
    
    mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
            // Verificar se foram adicionados novos serviços pendentes
            const addedNodes = Array.from(mutation.addedNodes);
            const hasUnscheduledServices = addedNodes.some(node => 
                node.nodeType === 1 && 
                (node.classList?.contains('appointment') && node.classList?.contains('unscheduled') ||
                 node.querySelector?.('.appointment.unscheduled'))
            );
            
            if (hasUnscheduledServices) {
                shouldApply = true;
            }
        }
    });
    
    if (shouldApply) {
        setTimeout(applyHorizontalServicesLayout, 100);
    }
});

// Observar mudanças na seção de serviços pendentes
const unscheduledContainer = document.querySelector('.unscheduled-container') || document.body;
observer.observe(unscheduledContainer, {
    childList: true,
    subtree: true
});

// Aplicar imediatamente se a página já carregou
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyHorizontalServicesLayout);
} else {
    applyHorizontalServicesLayout();
}

// Reaplica o layout quando a janela é redimensionada
window.addEventListener('resize', function() {
    setTimeout(applyHorizontalServicesLayout, 100);
});

// Função global para aplicar manualmente (para debug)
window.applyHorizontalServicesLayout = applyHorizontalServicesLayout;

// Log de inicialização
console.log('🚀 Sistema de layout horizontal para serviços pendentes inicializado!');

