// 🌐 Cliente API para Portal de Agendamento Expressglass
// Comunicação com Netlify Functions + fallback para localStorage

class ApiClient {
  constructor() {
    // URL base da API (será configurada automaticamente)
    this.baseURL = this.detectApiUrl();
    this.isOnline = navigator.onLine;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    
    // Escutar mudanças de conectividade
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🌐 Conexão restaurada - sincronizando dados...');
      this.syncOfflineData();
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('📱 Modo offline ativado - usando localStorage');
    });
  }
  
  // Detectar URL da API automaticamente
  detectApiUrl( ) {
  const hostname = window.location.hostname;
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8888/api';
  } else {
    // ✅ CORREÇÃO: usar backend específico
    return 'https://expressglass-backend.netlify.app/api';
  }
}

  
  // Fazer requisição HTTP com retry automático
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
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
      if (!this.isOnline) {
        throw new Error('Sem conexão - usando dados locais');
      }
      
      const response = await this.makeRequest('/appointments');
      
      if (response.success) {
        // Guardar no localStorage como backup
        this.saveToLocalStorage(response.data);
        return response.data;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.warn('📱 Fallback para localStorage:', error.message);
      return this.getFromLocalStorage();
    }
  }
  
  async createAppointment(appointmentData) {
    try {
      if (!this.isOnline) {
        throw new Error('Sem conexão - guardando localmente');
      }
      
      const response = await this.makeRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify(appointmentData)
      });
      
      if (response.success) {
        // Atualizar localStorage
        const appointments = await this.getAppointments();
        return response.data;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.warn('📱 Fallback para localStorage:', error.message);
      return this.createAppointmentOffline(appointmentData);
    }
  }
  
  async updateAppointment(id, appointmentData) {
    try {
      if (!this.isOnline) {
        throw new Error('Sem conexão - atualizando localmente');
      }
      
      const response = await this.makeRequest(`/appointments/${id}`, {
        method: 'PUT',
        body: JSON.stringify(appointmentData)
      });
      
      if (response.success) {
        // Atualizar localStorage
        const appointments = await this.getAppointments();
        return response.data;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.warn('📱 Fallback para localStorage:', error.message);
      return this.updateAppointmentOffline(id, appointmentData);
    }
  }
  
  async deleteAppointment(id) {
    try {
      if (!this.isOnline) {
        throw new Error('Sem conexão - eliminando localmente');
      }
      
      const response = await this.makeRequest(`/appointments/${id}`, {
        method: 'DELETE'
      });
      
      if (response.success) {
        // Atualizar localStorage
        const appointments = await this.getAppointments();
        return true;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.warn('📱 Fallback para localStorage:', error.message);
      return this.deleteAppointmentOffline(id);
    }
  }
  
  // ===== LOCALIDADES =====
  
  async getLocalities() {
    try {
      if (!this.isOnline) {
        throw new Error('Sem conexão - usando dados locais');
      }
      
      const response = await this.makeRequest('/localities');
      
      if (response.success) {
        // Guardar no localStorage como backup
        localStorage.setItem('eg_localities_backup', JSON.stringify(response.data));
        return response.data;
      } else {
        throw new Error(response.error);
      }
      
    } catch (error) {
      console.warn('📱 Fallback para localidades padrão:', error.message);
      
      // Tentar backup do localStorage
      const backup = localStorage.getItem('eg_localities_backup');
      if (backup) {
        return JSON.parse(backup);
      }
      
      // Fallback para localidades padrão
      return {
        'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
        'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
        'Póvoa de Varzim': '#6EE7B7', 'Riba D\'Ave': '#FBBF24', 'Trofa': '#C084FC',
        'Vieira do Minho': '#93C5FD', 'Vila do Conde': '#FCD34D', 'Vila Verde': '#86EFAC'
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

