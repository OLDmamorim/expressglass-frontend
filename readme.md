# 🌐 Portal de Agendamento Expressglass - Versão API

Portal de agendamento modernizado com sincronização em tempo real via API backend.

## ✨ **Funcionalidades**

### **🔄 Sincronização Multi-Dispositivo**
- **Dados em tempo real** entre computador, tablet e telemóvel
- **Backup automático** na cloud (PostgreSQL/Neon)
- **Modo offline** com sincronização automática quando volta online
- **Indicador de status** de conexão no header

### **📱 Interface Híbrida**
- **API-first** - Dados sincronizados via Netlify Functions
- **Fallback inteligente** - localStorage como backup offline
- **Loading states** - Feedback visual durante operações
- **Error handling** - Tratamento robusto de erros de rede

### **🎯 Funcionalidades Preservadas**
- ✅ **Calendário semanal** com navegação
- ✅ **Drag & drop** entre dias/períodos
- ✅ **Estados dos vidros** (N/E, V/E, ST)
- ✅ **Localidades com cores** específicas
- ✅ **Tipos de serviço** (PB, LT, OC, REP, POL)
- ✅ **Campos opcionais** (Data/Período) - permite criar serviços sem agendar
- ✅ **Impressão completa** - Calendário + Serviços por agendar
- ✅ **Interface moderna** com gradiente azul
- ✅ **Responsividade mobile** otimizada

## 🛠️ **Arquitetura**

### **Frontend (Este projeto)**
- **HTML/CSS/JavaScript** puro
- **Cliente API** (`api.js`) - Comunicação com backend
- **Fallback localStorage** - Funciona offline
- **Status de conexão** - Indicador visual online/offline

### **Backend (Separado)**
- **Netlify Functions** - API serverless
- **PostgreSQL (Neon)** - Base de dados na cloud
- **CORS configurado** - Comunicação cross-origin
- **Validação robusta** - Integridade de dados

## 📊 **Fluxo de Dados**

```
Frontend → API Client → Netlify Functions → PostgreSQL (Neon)
    ↓         ↓              ↓                    ↓
localStorage ← Fallback ← Error Handler ← Connection Pool
```

### **Modo Online:**
1. **Operação** (criar/editar/eliminar)
2. **API Request** via fetch()
3. **Base de dados** atualizada
4. **localStorage** sincronizado como backup
5. **Interface** atualizada

### **Modo Offline:**
1. **Operação** (criar/editar/eliminar)
2. **localStorage** atualizado diretamente
3. **Marcação** como "_offline"
4. **Sincronização** automática quando volta online

## 🔧 **Configuração**

### **1. Backend (Obrigatório)**
Este frontend requer o backend API para funcionar completamente:
- Deploy do `expressglass-backend` no Netlify
- Configuração da variável `DATABASE_URL` no Netlify
- Base de dados PostgreSQL configurada no Neon

### **2. URL da API**
O cliente API detecta automaticamente a URL:
- **Desenvolvimento**: `http://localhost:8888/api`
- **Produção**: `https://seu-site.netlify.app/api`

### **3. Deploy**
1. **Upload** dos ficheiros para repositório GitHub
2. **Connect** repositório no Netlify
3. **Deploy** automático
4. **Configurar** domínio personalizado (opcional)

## 🌐 **Endpoints da API**

### **Agendamentos**
- `GET /api/appointments` - Listar todos
- `POST /api/appointments` - Criar novo
- `PUT /api/appointments/{id}` - Atualizar
- `DELETE /api/appointments/{id}` - Eliminar

### **Localidades**
- `GET /api/localities` - Listar com cores
- `POST /api/localities` - Criar nova

## 🔍 **Indicadores Visuais**

### **Status de Conexão (Header)**
- 🌐 **Online** - Conectado à API
- 📱 **Offline** - Usando dados locais

### **Toast Notifications**
- ✅ **Verde** - Operação bem-sucedida
- ⚠️ **Amarelo** - Aviso (modo offline)
- ❌ **Vermelho** - Erro de operação
- ℹ️ **Azul** - Informação (carregando)

## 🚀 **Vantagens da Versão API**

### **Para Utilizadores:**
- 🌐 **Acesso em qualquer dispositivo**
- 🔄 **Dados sempre atualizados**
- 👥 **Trabalho em equipa** simultâneo
- 💾 **Backup automático** na cloud
- 📱 **Funciona offline** quando necessário

### **Para Administradores:**
- 📊 **Relatórios avançados** via SQL
- 🔒 **Dados seguros** na cloud
- 📈 **Escalabilidade** automática
- 🛠️ **Manutenção** simplificada
- 🔍 **Auditoria** completa de operações

## 🔄 **Compatibilidade**

### **Migração Automática:**
- **Dados existentes** no localStorage são preservados
- **Sincronização** automática na primeira conexão
- **Rollback** possível para versão localStorage

### **Browsers Suportados:**
- ✅ **Chrome/Edge** 80+
- ✅ **Firefox** 75+
- ✅ **Safari** 13+
- ✅ **Mobile** browsers

## 🎯 **Próximos Passos**

1. **Deploy** do backend no Netlify
2. **Configurar** variáveis de ambiente
3. **Testar** sincronização entre dispositivos
4. **Migrar** dados existentes (se necessário)
5. **Treinar** utilizadores nas novas funcionalidades

---

**Desenvolvido para Expressglass** 🚗💎  
**Versão API com sincronização multi-dispositivo** 🌐

