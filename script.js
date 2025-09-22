// SOLUÇÃO PERSISTENTE - Intercepta re-renders e mantém ícones
// Remove o código de teste anterior e usa este

// 1. Interceptar a função buildMobileCard PERMANENTEMENTE
const originalBuildMobileCard = window.buildMobileCard;

window.buildMobileCard = function(a) {
    console.log('🎨 buildMobileCard interceptada para:', a.plate);
    
    // Chamar função original primeiro
    let html = originalBuildMobileCard ? originalBuildMobileCard.call(this, a) : '';
    
    // Verificar se tem morada
    const endereco = a.address || a.morada || a.addr || null;
    
    if (endereco && endereco.trim()) {
        console.log('📍 Adicionando ícones para:', endereco);
        
        // Adicionar ícones ao HTML
        const addr = encodeURIComponent(endereco.trim());
        const iconsHtml = `
            <div class="nav-icons" style="position:absolute;top:8px;right:8px;z-index:100;display:flex;gap:6px;">
                <a href="https://www.google.com/maps/search/?api=1&query=${addr}" 
                   target="_blank" 
                   style="background:#fff;border-radius:50%;padding:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);text-decoration:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;"
                   title="Google Maps">
                    📍
                </a>
                <a href="https://waze.com/ul?q=${addr}" 
                   target="_blank"
                   style="background:#fff;border-radius:50%;padding:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);text-decoration:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;"
                   title="Waze">
                    🚗
                </a>
            </div>
        `;
        
        // Inserir ícones no HTML (após a abertura da div principal)
        html = html.replace(
            /(<div[^>]*class="[^"]*m-card[^"]*"[^>]*>)/,
            `$1${iconsHtml}`
        );
    }
    
    return html;
};

// 2. Interceptar renderMobileDay para garantir que sempre aplica
const originalRenderMobileDay = window.renderMobileDay;

window.renderMobileDay = function() {
    console.log('🔄 renderMobileDay interceptada');
    
    // Chamar função original
    if (originalRenderMobileDay) {
        originalRenderMobileDay.call(this);
    }
    
    // Garantir que ícones estão presentes após render
    setTimeout(() => {
        console.log('🔧 Verificando ícones após render...');
        addIconsToExistingCards();
    }, 100);
};

// 3. Função para adicionar ícones a cartões existentes
function addIconsToExistingCards() {
    const cards = document.querySelectorAll('.m-card[data-id]');
    console.log(`📱 Verificando ${cards.length} cartões`);
    
    cards.forEach(card => {
        // Verificar se já tem ícones
        if (card.querySelector('.nav-icons')) {
            return; // Já tem ícones
        }
        
        // Encontrar dados do agendamento
        const dataId = card.getAttribute('data-id');
        const appointment = appointments.find(a => String(a.id) === String(dataId));
        
        if (appointment) {
            const endereco = appointment.address || appointment.morada || appointment.addr;
            
            if (endereco && endereco.trim()) {
                console.log('➕ Adicionando ícones ao cartão:', appointment.plate);
                
                const addr = encodeURIComponent(endereco.trim());
                const iconsDiv = document.createElement('div');
                iconsDiv.className = 'nav-icons';
                iconsDiv.style.cssText = 'position:absolute;top:8px;right:8px;z-index:100;display:flex;gap:6px;';
                
                iconsDiv.innerHTML = `
                    <a href="https://www.google.com/maps/search/?api=1&query=${addr}" 
                       target="_blank" 
                       style="background:#fff;border-radius:50%;padding:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);text-decoration:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;"
                       title="Google Maps">
                        📍
                    </a>
                    <a href="https://waze.com/ul?q=${addr}" 
                       target="_blank"
                       style="background:#fff;border-radius:50%;padding:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);text-decoration:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;"
                       title="Waze">
                        🚗
                    </a>
                `;
                
                card.appendChild(iconsDiv);
            }
        }
    });
}

// 4. Observer para detectar mudanças no DOM
const observer = new MutationObserver((mutations) => {
    let shouldCheck = false;
    
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && (
                    node.classList?.contains('m-card') || 
                    node.querySelector?.('.m-card')
                )) {
                    shouldCheck = true;
                }
            });
        }
    });
    
    if (shouldCheck) {
        setTimeout(addIconsToExistingCards, 50);
    }
});

// Iniciar observação
observer.observe(document.body, {
    childList: true,
    subtree: true
});

// 5. Aplicar imediatamente
setTimeout(() => {
    console.log('🚀 Aplicando solução persistente...');
    addIconsToExistingCards();
    
    // Forçar re-render se necessário
    if (typeof renderMobileDay === 'function') {
        renderMobileDay();
    }
}, 500);

console.log('✅ Solução persistente instalada - ícones devem permanecer!');