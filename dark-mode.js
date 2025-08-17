// ===== MODO ESCURO - EXPRESSGLASS PORTAL ===== 

// Função para inicializar o modo escuro
function initDarkMode() {
  // Verificar preferência salva ou preferência do sistema
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
  
  // Aplicar tema
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeToggleButton(theme);
  
  // Escutar mudanças na preferência do sistema
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) {
      const newTheme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      updateThemeToggleButton(newTheme);
    }
  });
}

// Função para alternar tema
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  // Aplicar novo tema
  document.documentElement.setAttribute('data-theme', newTheme);
  
  // Salvar preferência
  localStorage.setItem('theme', newTheme);
  
  // Atualizar botão
  updateThemeToggleButton(newTheme);
  
  // Toast notification
  const themeText = newTheme === 'dark' ? 'escuro' : 'claro';
  showToast(`Modo ${themeText} ativado!`, 'success');
}

// Função para atualizar o botão de toggle
function updateThemeToggleButton(theme) {
  const button = document.getElementById('themeToggle');
  if (button) {
    if (theme === 'dark') {
      button.innerHTML = '<span class="theme-icon">☀️</span> Claro';
      button.title = 'Alternar para modo claro';
    } else {
      button.innerHTML = '<span class="theme-icon">🌙</span> Escuro';
      button.title = 'Alternar para modo escuro';
    }
  }
}

// Função para adicionar o botão de toggle ao header
function addThemeToggleButton() {
  const headerActions = document.querySelector('.header-actions');
  if (headerActions && !document.getElementById('themeToggle')) {
    const toggleButton = document.createElement('button');
    toggleButton.id = 'themeToggle';
    toggleButton.className = 'theme-toggle';
    toggleButton.onclick = toggleTheme;
    
    // Inserir antes do último botão (pesquisa)
    const searchButton = headerActions.querySelector('button[onclick="toggleSearch()"]');
    if (searchButton) {
      headerActions.insertBefore(toggleButton, searchButton);
    } else {
      headerActions.appendChild(toggleButton);
    }
    
    // Atualizar conteúdo do botão
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    updateThemeToggleButton(currentTheme);
  }
}

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {
  initDarkMode();
  setTimeout(addThemeToggleButton, 100); // Pequeno delay para garantir que o header existe
});

// Também inicializar se o script for carregado depois do DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    initDarkMode();
    setTimeout(addThemeToggleButton, 100);
  });
} else {
  initDarkMode();
  setTimeout(addThemeToggleButton, 100);
}

// Função para ser chamada após renderização (garantir que o botão existe)
function ensureThemeToggle() {
  if (!document.getElementById('themeToggle')) {
    addThemeToggleButton();
  }
}
