// ===== LAYOUT HORIZONTAL PARA SERVIÇOS PENDENTES =====

function applyHorizontalLayout() {
    // Encontrar a seção de serviços pendentes
    const unscheduledList = document.querySelector('.unscheduled-list');
    
    if (unscheduledList) {
        // Aplicar layout horizontal com CSS Grid
        unscheduledList.style.cssText = `
            display: grid !important;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)) !important;
            gap: 12px !important;
            align-items: start !important;
        `;
        
        // Garantir que os cards mantêm o tamanho correto
        const appointments = unscheduledList.querySelectorAll('.appointment.unscheduled');
        appointments.forEach(appointment => {
            appointment.style.cssText += `
                width: 100% !important;
                margin: 0 !important;
                box-sizing: border-box !important;
            `;
        });
        
        console.log('✅ Layout horizontal aplicado aos serviços pendentes');
    }
}

// Aplicar quando a página carrega
document.addEventListener('DOMContentLoaded', applyHorizontalLayout);

// Aplicar quando há mudanças no DOM (novos serviços adicionados)
const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
            // Verificar se foram adicionados novos serviços
            const addedNodes = Array.from(mutation.addedNodes);
            const hasUnscheduledServices = addedNodes.some(node => 
                node.nodeType === 1 && 
                (node.classList?.contains('appointment') || 
                 node.querySelector?.('.appointment.unscheduled'))
            );
            
            if (hasUnscheduledServices) {
                setTimeout(applyHorizontalLayout, 100);
            }
        }
    });
});

// Observar mudanças na seção de serviços pendentes
const unscheduledContainer = document.querySelector('.unscheduled-container');
if (unscheduledContainer) {
    observer.observe(unscheduledContainer, {
        childList: true,
        subtree: true
    });
}

// Aplicar imediatamente se a página já carregou
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyHorizontalLayout);
} else {
    applyHorizontalLayout();
}

// Reaplica o layout quando a janela é redimensionada
window.addEventListener('resize', function() {
    setTimeout(applyHorizontalLayout, 100);
});

// Função global para aplicar manualmente (para debug)
window.applyHorizontalLayout = applyHorizontalLayout;

