// admin-coord-only.js
// Para coordenadores no admin.html: esconder TUDO menos a tab Relatórios + botão Sair.
// Esconde header (Vista Comercial, Agendas, etc), e todas as tabs menos Relatórios.

(function() {
  function aplicar() {
    const role = window.authClient?.getUser?.()?.role;
    if (role !== 'coordenador') return;

    // 1) Esconder TUDO no header (logo, vista comercial, agendas, nome user)
    //    excepto o botão Sair
    const header = document.querySelector('.admin-header, header');
    if (header) {
      header.querySelectorAll('a, button, img').forEach(el => {
        if (el.id === 'logoutBtn') return; // manter botão Sair
        if (el.textContent && /sair/i.test(el.textContent)) return; // manter qualquer "Sair"
        el.style.display = 'none';
      });
      // Substituir título do header por um simples
      const h1 = header.querySelector('h1, h2, .header-title');
      if (h1) {
        h1.style.display = '';
        h1.textContent = '📊 Relatórios';
      }
    }

    // 2) Esconder TODAS as tabs excepto Relatórios
    document.querySelectorAll('.nav-tab').forEach(tab => {
      if (tab.dataset.tab !== 'reports') {
        tab.style.display = 'none';
      }
    });

    // 3) Esconder tab content de tudo menos reports
    document.querySelectorAll('.tab-content').forEach(t => {
      if (t.id !== 'reportsTab') t.style.display = 'none';
    });

    console.log('✅ Modo coordenador: só Relatórios visível');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(aplicar, 200));
  } else {
    setTimeout(aplicar, 200);
  }
})();
