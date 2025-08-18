// ===== SOLUÇÃO DEFINITIVA - LAYOUT HORIZONTAL SERVIÇOS PENDENTES =====
// Esta solução força o layout horizontal com máxima eficácia

(function() {
    'use strict';
    
    console.log('🚀 Sistema de Layout Horizontal inicializado!');
    
    // FUNÇÃO PRINCIPAL - FORÇAR LAYOUT HORIZONTAL
    function forceHorizontalLayoutUltraAggressive() {
        console.log('⚡ Aplicando layout horizontal ultra-agressivo...');
        
        // 1. Encontrar o container principal
        const unscheduledList = document.querySelector('.unscheduled-list') || 
                               document.querySelector('#unscheduledList');
        
        if (!unscheduledList) {
            console.log('⚠️ Container não encontrado, tentando novamente...');
            return false;
        }
        
        // 2. FORÇAR FLEXBOX NO CONTAINER COM MÁXIMA ESPECIFICIDADE
        unscheduledList.style.setProperty('display', 'flex', 'important');
        unscheduledList.style.setProperty('flex-direction', 'row', 'important');
        unscheduledList.style.setProperty('flex-wrap', 'wrap', 'important');
        unscheduledList.style.setProperty('gap', '12px', 'important');
        unscheduledList.style.setProperty('align-items', 'flex-start', 'important');
        unscheduledList.style.setProperty('justify-content', 'flex-start', 'important');
        unscheduledList.style.setProperty('width', '100%', 'important');
        unscheduledList.style.setProperty('box-sizing', 'border-box', 'important');
        
        console.log('✅ Container configurado para flexbox horizontal');
        
        // 3. FORÇAR TAMANHO FIXO NOS CARDS
        const appointments = document.querySelectorAll('.appointment.unscheduled');
        
        if (appointments.length === 0) {
            console.log('⚠️ Nenhum serviço pendente encontrado');
            return false;
        }
        
        console.log(`🎯 Processando ${appointments.length} serviços pendentes`);
        
        appointments.forEach((appointment, index) => {
            // Remover qualquer estilo inline que possa interferir
            const currentStyle = appointment.getAttribute('style') || '';
            
            // Aplicar estilos com força bruta usando setProperty
            appointment.style.setProperty('width', '280px', 'important');
            appointment.style.setProperty('min-width', '280px', 'important');
            appointment.style.setProperty('max-width', '280px', 'important');
            appointment.style.setProperty('flex', '0 0 280px', 'important');
            appointment.style.setProperty('flex-shrink', '0', 'important');
            appointment.style.setProperty('flex-grow', '0', 'important');
            appointment.style.setProperty('margin', '0', 'important');
            appointment.style.setProperty('box-sizing', 'border-box', 'important');
            appointment.style.setProperty('display', 'flex', 'important');
            appointment.style.setProperty('flex-direction', 'column', 'important');
            
            // Garantir que mantém outros estilos importantes (cor de fundo, etc)
            if (currentStyle.includes('background-color')) {
                const bgMatch = currentStyle.match(/background-color:\s*([^;]+)/);
                if (bgMatch) {
                    appointment.style.setProperty('background-color', bgMatch[1], 'important');
                }
            }
            
            if (currentStyle.includes('border-left')) {
                const borderMatch = currentStyle.match(/border-left:\s*([^;]+)/);
                if (borderMatch) {
                    appointment.style.setProperty('border-left', borderMatch[1], 'important');
                }
            }
            
            console.log(`✅ Card ${index + 1} configurado: ${appointment.querySelector('.appt-header')?.textContent || 'Sem título'}`);
        });
        
        // 4. Configurar drop-zone se existir
        const dropZone = document.querySelector('.drop-zone[data-drop-bucket="unscheduled"]');
        if (dropZone) {
            dropZone.style.setProperty('display', 'flex', 'important');
            dropZone.style.setProperty('flex-wrap', 'wrap', 'important');
            dropZone.style.setProperty('gap', '12px', 'important');
            dropZone.style.setProperty('width', '100%', 'important');
            console.log('✅ Drop-zone configurada');
        }
        
        console.log('🎉 Layout horizontal ultra-agressivo aplicado com sucesso!');
        return true;
    }
    
    // FUNÇÃO DE VERIFICAÇÃO E REAPLICAÇÃO
    function checkAndApplyLayout() {
        const success = forceHorizontalLayoutUltraAggressive();
        
        if (success) {
            // Verificar se realmente funcionou
            setTimeout(() => {
                const unscheduledList = document.querySelector('.unscheduled-list') || 
                                       document.querySelector('#unscheduledList');
                const appointments = document.querySelectorAll('.appointment.unscheduled');
                
                if (unscheduledList && appointments.length > 0) {
                    const containerStyle = window.getComputedStyle(unscheduledList);
                    const firstCardStyle = window.getComputedStyle(appointments[0]);
                    
                    console.log('📊 Verificação final:');
                    console.log(`- Container display: ${containerStyle.display}`);
                    console.log(`- Container flex-wrap: ${containerStyle.flexWrap}`);
                    console.log(`- Primeiro card width: ${firstCardStyle.width}`);
                    
                    if (containerStyle.display === 'flex' && firstCardStyle.width === '280px') {
                        console.log('✅ Layout horizontal confirmado!');
                    } else {
                        console.log('⚠️ Layout pode não estar aplicado corretamente, reaplicando...');
                        setTimeout(forceHorizontalLayoutUltraAggressive, 500);
                    }
                }
            }, 200);
        }
    }
    
    // APLICAR IMEDIATAMENTE
    checkAndApplyLayout();
    
    // OBSERVADOR DE MUTAÇÕES - DETECTAR NOVOS SERVIÇOS
    const observer = new MutationObserver(function(mutations) {
        let shouldReapply = false;
        
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList') {
                // Verificar se foram adicionados novos serviços
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) { // Element node
                        if (node.classList?.contains('appointment') || 
                            node.querySelector?.('.appointment.unscheduled')) {
                            shouldReapply = true;
                        }
                    }
                });
            }
        });
        
        if (shouldReapply) {
            console.log('🔄 Novos serviços detectados, reaplicando layout...');
            setTimeout(checkAndApplyLayout, 100);
        }
    });
    
    // OBSERVAR MUDANÇAS NO DOM
    const targetNode = document.body;
    observer.observe(targetNode, {
        childList: true,
        subtree: true
    });
    
    // REAPLICAR PERIODICAMENTE (BACKUP)
    setInterval(function() {
        const unscheduledList = document.querySelector('.unscheduled-list') || 
                               document.querySelector('#unscheduledList');
        const appointments = document.querySelectorAll('.appointment.unscheduled');
        
        if (unscheduledList && appointments.length > 0) {
            const containerStyle = window.getComputedStyle(unscheduledList);
            const firstCardStyle = window.getComputedStyle(appointments[0]);
            
            // Se o layout não estiver correto, reaplicar
            if (containerStyle.display !== 'flex' || firstCardStyle.width !== '280px') {
                console.log('🔧 Layout perdido, reaplicando...');
                checkAndApplyLayout();
            }
        }
    }, 5000); // Verificar a cada 5 segundos
    
    // APLICAR QUANDO A JANELA É REDIMENSIONADA
    window.addEventListener('resize', function() {
        setTimeout(checkAndApplyLayout, 100);
    });
    
    // FUNÇÃO GLOBAL PARA DEBUG
    window.forceHorizontalLayout = checkAndApplyLayout;
    
    console.log('✅ Sistema de Layout Horizontal ativo e monitorando!');
    
})();

