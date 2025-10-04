// auth-client.js
// Cliente de autenticação para o frontend

class AuthClient {
  constructor() {
    this.baseURL = '/.netlify/functions';
    this.token = this.getStoredToken();
    this.user = this.getStoredUser();
  }

  // ===== ARMAZENAMENTO LOCAL =====

  getStoredToken() {
    return localStorage.getItem('eg_auth_token');
  }

  setStoredToken(token) {
    if (token) {
      localStorage.setItem('eg_auth_token', token);
      this.token = token;
    } else {
      localStorage.removeItem('eg_auth_token');
      this.token = null;
    }
  }

  getStoredUser() {
    const userData = localStorage.getItem('eg_auth_user');
    return userData ? JSON.parse(userData) : null;
  }

  setStoredUser(user) {
    if (user) {
      localStorage.setItem('eg_auth_user', JSON.stringify(user));
      this.user = user;
    } else {
      localStorage.removeItem('eg_auth_user');
      this.user = null;
    }
  }

  // ===== LOGIN =====

  async login(username, password) {
    try {
      const response = await fetch(`${this.baseURL}/auth-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Erro ao fazer login');
      }

      // Armazenar token e dados do utilizador
      this.setStoredToken(data.token);
      this.setStoredUser(data.user);

      console.log('✅ Login bem-sucedido:', data.user.username);

      return {
        success: true,
        user: data.user
      };

    } catch (error) {
      console.error('❌ Erro no login:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ===== LOGOUT =====

  logout() {
    this.setStoredToken(null);
    this.setStoredUser(null);
    console.log('✅ Logout realizado');
  }

  // ===== VERIFICAR AUTENTICAÇÃO =====

  async verifyAuth() {
    if (!this.token) {
      return { success: false, error: 'Não autenticado' };
    }

    try {
      const response = await fetch(`${this.baseURL}/auth-verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        // Token inválido ou expirado
        this.logout();
        throw new Error(data.error || 'Token inválido');
      }

      // Atualizar dados do utilizador
      this.setStoredUser(data.user);

      return {
        success: true,
        user: data.user
      };

    } catch (error) {
      console.error('❌ Erro ao verificar autenticação:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ===== VERIFICAÇÕES =====

  isAuthenticated() {
    return !!this.token && !!this.user;
  }

  isAdmin() {
    return this.user && this.user.role === 'admin';
  }

  getUser() {
    return this.user;
  }

  getToken() {
    return this.token;
  }

  getPortalId() {
    return this.user?.portal?.id || null;
  }

  getPortalConfig() {
    return this.user?.portal || null;
  }

  // ===== REQUISIÇÕES AUTENTICADAS =====

  async authenticatedFetch(url, options = {}) {
    if (!this.token) {
      throw new Error('Não autenticado');
    }

    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${this.token}`
    };

    return fetch(url, { ...options, headers });
  }
}

// Instância global
window.authClient = new AuthClient();

console.log('🔐 Cliente de autenticação inicializado');
