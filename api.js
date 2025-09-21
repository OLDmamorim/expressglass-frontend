
// 🌐 Cliente API para Portal de Agendamento Expressglass
// Comunicação com Netlify Functions + fallback para localStorage
class ApiClient {
  constructor() {
    this.baseURL = this.detectApiUrl();
    this.isOnline = navigator.onLine;
    this.retryAttempts = 3;
    this.retryDelay = 1000;

    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🌐 Conexão restaurada - sincronizando dados...');
      this.syncOfflineData().catch(console.error);
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('📱 Modo offline ativado - usando localStorage');
    });
  }

  // Detectar URL da API automaticamente
  detectApiUrl() {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8888/api';
    return 'https://expressglass-backend.netlify.app/api';
  }

  // Helper ID estável (UUID)
  makeId() {
    try { return crypto.randomUUID(); } catch { return Date.now()+'-'+Math.random().toString(16).slice(2); }
  }

  // Requisição HTTP com retry + proteção a respostas não-JSON
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const defaultOptions = {
      headers: { 'Content-Type': 'application/json', ...(options.headers||{}) },
      ...options
    };
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        console.log(`🔄 API Request (tentativa ${attempt}):`, defaultOptions.method || 'GET', url);
        const response = await fetch(url, defaultOptions);
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; }
        catch { throw new Error(`Resposta inválida da API (não-JSON). HTTP ${response.status}`); }
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        console.log('✅ API Response:', data);
        return data;
      } catch (error) {
        console.warn(`❌ API Error (tentativa ${attempt}):`, error.message);
        if (attempt === this.retryAttempts) throw error;
        await new Promise(r => setTimeout(r, this.retryDelay * attempt));
      }
    }
  }

  // ===== AGENDAMENTOS =====
  async getAppointments() {
    try {
      if (!this.isOnline) throw new Error('Sem conexão - usando dados locais');
      const response = await this.makeRequest('/appointments');
      if (response.success) {
        this.saveToLocalStorage(response.data);
        return response.data;
      }
      throw new Error(response.error || 'Erro ao obter agendamentos');
    } catch (error) {
      console.warn('📱 Fallback para localStorage:', error.message);
      return this.getFromLocalStorage();
    }
  }

  async createAppointment(appointmentData) {
    try {
      if (!this.isOnline) throw new Error('Sem conexão - guardando localmente');
      // Se cliente já tiver id, envia; senão deixa o backend gerar
      const response = await this.makeRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify(appointmentData)
      });
      if (response.success) {
        await this.getAppointments();
        return response.data;
      }
      throw new Error(response.error || 'Erro ao criar agendamento');
    } catch (error) {
      console.warn('📱 Fallback para localStorage:', error.message);
      return this.createAppointmentOffline(appointmentData);
    }
  }

  async updateAppointment(id, appointmentData) {
    try {
      if (!this.isOnline) throw new Error('Sem conexão - atualizando localmente');
      const response = await this.makeRequest(`/appointments/${id}`, {
        method: 'PUT',
        body: JSON.stringify(appointmentData)
      });
      if (response.success) {
        await this.getAppointments();
        return response.data;
      }
      throw new Error(response.error || 'Erro ao atualizar agendamento');
    } catch (error) {
      console.warn('📱 Fallback para localStorage:', error.message);
      return this.updateAppointmentOffline(id, appointmentData);
    }
  }

  async deleteAppointment(id) {
    try {
      if (!this.isOnline) throw new Error('Sem conexão - eliminando localmente');
      const response = await this.makeRequest(`/appointments/${id}`, { method: 'DELETE' });
      if (response.success) {
        await this.getAppointments();
        return true;
      }
      throw new Error(response.error || 'Erro ao eliminar agendamento');
    } catch (error) {
      console.warn('📱 Fallback para localStorage:', error.message);
      return this.deleteAppointmentOffline(id);
    }
  }

  // ===== LOCALIDADES =====
  async getLocalities() {
    try {
      if (!this.isOnline) throw new Error('Sem conexão - usando dados locais');
      const response = await this.makeRequest('/localities');
      if (response.success) {
        localStorage.setItem('eg_localities_backup', JSON.stringify(response.data));
        return response.data;
      }
      throw new Error(response.error || 'Erro ao obter localidades');
    } catch (error) {
      console.warn('📱 Fallback para localidades padrão:', error.message);
      const backup = localStorage.getItem('eg_localities_backup');
      if (backup) return JSON.parse(backup);
      return {
        'Outra': '#9CA3AF', 'Barcelos': '#F87171', 'Braga': '#34D399', 'Esposende': '#22D3EE',
        'Famalicão': '#2DD4BF', 'Guimarães': '#FACC15', 'Póvoa de Lanhoso': '#A78BFA',
        'Póvoa de Varzim': '#6EE7B7', "Riba D'Ave": '#FBBF24', 'Trofa': '#C084FC',
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
    const id = this.makeId();
    const newAppointment = { id, ...appointmentData, _offline:true, _created:new Date().toISOString() };
    appointments.push(newAppointment);
    this.saveToLocalStorage(appointments);
    return newAppointment;
    }
  updateAppointmentOffline(id, appointmentData) {
    const appointments = this.getFromLocalStorage();
    const index = appointments.findIndex(a => String(a.id) === String(id));
    if (index >= 0) {
      appointments[index] = { ...appointments[index], ...appointmentData, _offline:true, _updated:new Date().toISOString() };
      this.saveToLocalStorage(appointments);
      return appointments[index];
    }
    throw new Error('Agendamento não encontrado');
  }
  deleteAppointmentOffline(id) {
    const appointments = this.getFromLocalStorage();
    const filtered = appointments.filter(a => String(a.id) !== String(id));
    if (filtered.length < appointments.length) {
      this.saveToLocalStorage(filtered);
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
      for (const ap of offlineAppointments) {
        try {
          if (ap._created) {
            await this.makeRequest('/appointments', { method:'POST', body: JSON.stringify(ap) });
          } else if (ap._updated) {
            await this.makeRequest(`/appointments/${ap.id}`, { method:'PUT', body: JSON.stringify(ap) });
          }
        } catch (e) {
          console.error('Erro ao sincronizar agendamento:', ap.id, e);
        }
      }
      await this.getAppointments();
      console.log('✅ Sincronização concluída');
    } catch (error) {
      console.error('Erro na sincronização:', error);
    }
  }

  // Expor status
  getConnectionStatus(){ return { online: this.isOnline, baseURL: this.baseURL }; }
}
// Instância global
window.apiClient = new ApiClient();
