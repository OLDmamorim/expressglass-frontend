// coord-relatorio-patch.js
// Para coordenadores: o botão "Relatório" passa a abrir o dashboard completo
// (admin.html), filtrado pelos portais atribuídos.
// Para outros roles: comportamento antigo (modal de relatório semanal).
// Carregar DEPOIS do script.js no index.html.

(function() {
  function aplicarPatch() {
    const role = window.authClient?.getUser?.()?.role;
    if (role !== 'coordenador') return; // só para coordenadores

    function redirecionarParaAdmin(e) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      window.location.href = '/admin.html';
    }

    // Substituir handlers existentes (clonar o nó remove todos os listeners)
    ['btnRelatorioDesk', 'btnRelatorio'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);
      clone.addEventListener('click', redirecionarParaAdmin);
    });

    console.log('✅ Patch coordenador: botão Relatório redireciona para /admin.html');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(aplicarPatch, 300));
  } else {
    setTimeout(aplicarPatch, 300);
  }
})();
