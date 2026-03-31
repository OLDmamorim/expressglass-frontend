// 🌐 Cliente API para Portal de Agendamento Expressglass
// Comunicação com Netlify Functions + fallback para localStorage

class ApiClient {
  constructor() {
    this.baseURL = this.detectApiUrl();
    this.isOnline = navigator.onLine;
    this.retryAttempts = 3;
    this.retryDelay = 1000;

    // Limpar dados offline antigos do localStorage que causavam POST duplicados
    ['eg_appointments_v31_api','eg_appointments_v30','eg_appointments_v29b'].forEach(k => {
      try {
        const raw = localStorage.getItem(k);
        if (raw) {
          const data = JSON.parse(raw);
          if (Array.isArray(data) && data.some(a => a._offline || a._created || a._updated)) {
            localStorage.removeItem(k);
            console.log(`🧹 Limpo localStorage offline: ${k}`);
          }
        }
      } catch(e) {}
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('📱 Offline');
    });
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🌐 Online');
    });
  }
  
  // Detectar URL da API automaticamente
  detectApiUrl() {
  // ✅ Agora usa as Netlify Functions do MESMO projeto
  return '/.netlify/functions';
}

  
  // Fazer requisição HTTP com retry automático
  async makeRequest(endpoint, options = {}) {
    // Coordenadores: anexar portal_id activo a todos os pedidos
    let url = `${this.baseURL}${endpoint}`;
    if (window.activePortalId) {
      const sep = url.includes('?') ? '&' : '?';
      url += sep + 'portal_id=' + window.activePortalId;
    }
    
    // Adicionar token de autenticação se disponível
    const token = window.authClient?.getToken();
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers
      },
      ...options
    };
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        console.log(`🔄 API Request (tentativa ${attempt}):`, options.method || 'GET', url);
        
        const response = await fetch(url, defaultOptions);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        
        console.log('✅ API Response:', data);
        return data;
        
      } catch (error) {
        console.warn(`❌ API Error (tentativa ${attempt}):`, error.message);
        
        if (attempt === this.retryAttempts) {
          throw error;
        }
        
        // Aguardar antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
      }
    }
  }
  
  // ===== AGENDAMENTOS =====
  
  async getAppointments() {
    try {
      console.log('🔄 Carregando agendamentos da base de dados...');
      
      const response = await this.makeRequest('/appointments');
      
      if (response.success) {
        console.log('✅ Agendamentos carregados da base de dados:', response.data.length);
        return response.data;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.error('❌ ERRO: Não foi possível carregar da base de dados:', error.message);
      throw new Error(`Falha na conexão com a base de dados: ${error.message}`);
    }
  }
  
  async createAppointment(appointmentData) {
    try {
      console.log('🔄 Criando agendamento na base de dados...');
      
      const response = await this.makeRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify(appointmentData)
      });
      
      if (response.success) {
        console.log('✅ Agendamento criado na base de dados:', response.data.id);
        return response.data;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.error('❌ ERRO: Não foi possível criar na base de dados:', error.message);
      throw new Error(`Falha ao criar agendamento: ${error.message}`);
    }
  }
  
  async updateAppointment(id, appointmentData) {
    try {
      // Incluir _portalId para coordenadores/admin com múltiplos portais
      const payload = { ...appointmentData };
      if (window.activePortalId) payload._portalId = window.activePortalId;

      const response = await this.makeRequest(`/appointments/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      
      if (response.success) {
        return response.data;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.error('❌ ERRO: Não foi possível atualizar na base de dados:', error.message);
      throw new Error(`Falha ao atualizar agendamento: ${error.message}`);
    }
  }
  
  async deleteAppointment(id) {
    try {
      console.log('🔄 Eliminando agendamento da base de dados:', id);
      
      const response = await this.makeRequest(`/appointments/${id}`, {
        method: 'DELETE'
      });
      
      if (response.success) {
        console.log('✅ Agendamento eliminado da base de dados:', id);
        return true;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.error('❌ ERRO: Não foi possível eliminar da base de dados:', error.message);
      throw new Error(`Falha ao eliminar agendamento: ${error.message}`);
    }
  }
  
  // ===== LOCALIDADES =====
  
  async getLocalities() {
  try {
    if (!this.isOnline) {
      throw new Error('Sem conexão - usando dados locais');
    }

    const response = await this.makeRequest('/localities');

    // O endpoint /localities devolve um OBJETO direto.
    // Se algum dia vier em { success, data }, também tratamos.
    const data = (response && typeof response === 'object' && 'success' in response)
      ? response.data
      : response;

    if (!data || typeof data !== 'object') {
      throw new Error('Resposta inválida das localities');
    }

    localStorage.setItem('eg_localities_backup', JSON.stringify(data));
    return data;

  } catch (error) {
    console.warn('📱 Fallback para localidades padrão:', error.message);

    // Tenta backup do localStorage
    const backup = localStorage.getItem('eg_localities_backup');
    if (backup) return JSON.parse(backup);

    // Fallback padrão
    return {
      'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
      'Famalicão': '#7E22CE', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
      'Póvoa de Varzim': '#6EE7B7', "Riba D'Ave": '#FBBF24', 'Trofa': '#C084FC',
      'Vieira do Minho': '#93C5FD', 'Vila do Conde': '#1E3A8A', 'Vila Verde': '#86EFAC'
    };
  }
}

  
  // ===== FALLBACK LOCALSTORAGE =====
  
  saveToLocalStorage(appointments) {
    try {
      localStorage.setItem('eg_appointments_v31_api', JSON.stringify(appointments));
      localStorage.setItem('eg_last_sync', new Date().toISOString());
    } catch (error) {
      console.error('Erro ao guardar no localStorage:', error);
    }
  }
  
  getFromLocalStorage() {
    try {
      const data = localStorage.getItem('eg_appointments_v31_api') || 
                   localStorage.getItem('eg_appointments_v30') || 
                   localStorage.getItem('eg_appointments_v29b') || '[]';
      return JSON.parse(data);
    } catch (error) {
      console.error('Erro ao ler localStorage:', error);
      return [];
    }
  }
  
  createAppointmentOffline(appointmentData) {
    const appointments = this.getFromLocalStorage();
    const newAppointment = {
      id: Date.now() + Math.random(),
      ...appointmentData,
      _offline: true, // Marcar como criado offline
      _created: new Date().toISOString()
    };
    
    appointments.push(newAppointment);
    this.saveToLocalStorage(appointments);
    
    return newAppointment;
  }
  
  updateAppointmentOffline(id, appointmentData) {
    const appointments = this.getFromLocalStorage();
    const index = appointments.findIndex(a => a.id == id);
    
    if (index >= 0) {
      appointments[index] = { 
        ...appointments[index], 
        ...appointmentData,
        _offline: true, // Marcar como atualizado offline
        _updated: new Date().toISOString()
      };
      this.saveToLocalStorage(appointments);
      return appointments[index];
    }
    
    throw new Error('Agendamento não encontrado');
  }
  
  deleteAppointmentOffline(id) {
    const appointments = this.getFromLocalStorage();
    const filteredAppointments = appointments.filter(a => a.id != id);
    
    if (filteredAppointments.length < appointments.length) {
      this.saveToLocalStorage(filteredAppointments);
      return true;
    }
    
    throw new Error('Agendamento não encontrado');
  }
  
  // ===== SINCRONIZAÇÃO =====
  
  async syncOfflineData() {
    if (!this.isOnline) return;
    
    try {
      const localAppointments = this.getFromLocalStorage();
      const offlineAppointments = localAppointments.filter(a => a._offline);
      
      if (offlineAppointments.length === 0) return;
      
      console.log(`🔄 Sincronizando ${offlineAppointments.length} agendamentos offline...`);
      
      for (const appointment of offlineAppointments) {
        try {
          if (appointment._created) {
            // Criar no servidor
            await this.makeRequest('/appointments', {
              method: 'POST',
              body: JSON.stringify(appointment)
            });
          } else if (appointment._updated) {
            // Atualizar no servidor
            await this.makeRequest(`/appointments/${appointment.id}`, {
              method: 'PUT',
              body: JSON.stringify(appointment)
            });
          }
        } catch (error) {
          console.error('Erro ao sincronizar agendamento:', appointment.id, error);
        }
      }
      
      // Recarregar dados do servidor
      await this.getAppointments();
      console.log('✅ Sincronização concluída');
      
    } catch (error) {
      console.error('Erro na sincronização:', error);
    }
  }
  
  // ===== CACHE =====
  
  clearLocalCache() {
    console.log('🧹 Limpando cache local...');
    localStorage.removeItem('eg_appointments');
    localStorage.removeItem('eg_last_sync');
    console.log('✅ Cache local limpo');
  }
  
  // ===== STATUS =====
  
  getConnectionStatus() {
    return {
      online: this.isOnline,
      apiUrl: this.baseURL,
      lastSync: localStorage.getItem('eg_last_sync')
    };
  }
}

// Instância global do cliente API
window.apiClient = new ApiClient();

console.log('🌐 Cliente API inicializado:', window.apiClient.getConnectionStatus());

