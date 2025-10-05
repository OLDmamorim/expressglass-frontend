# Guia de Implementação - Sistema Multi-Tenant

## ✅ O Que Foi Implementado

### 1. **Base de Dados**
- Tabelas `portals`, `users` e modificação de `appointments`
- Isolamento completo de dados por portal
- Segurança com bcrypt e JWT

### 2. **Sistema de Autenticação**
- Login com username e password
- Tokens JWT com validade de 7 dias
- Verificação automática de sessão

### 3. **Página de Login**
- Design moderno com gradiente azul/roxo
- Logo da Expressglass
- Validação de credenciais
- Redirecionamento automático (admin → painel / user → portal)

### 4. **Painel Administrativo**
- Gestão completa de portais (criar, editar, eliminar)
- Gestão completa de utilizadores (criar, editar, eliminar)
- Interface moderna e responsiva
- Validações e notificações

### 5. **Portal Multi-Tenant**
- Filtro automático por portal
- Configurações dinâmicas (localidades, morada de partida)
- Botão de logout
- Título personalizado por portal

## 📋 Passos para Deploy

### Passo 1: Aplicar Schema da Base de Dados

Aceda ao dashboard do Neon (https://console.neon.tech) e execute o SQL:

```bash
# Abrir o ficheiro database-schema.sql e copiar todo o conteúdo
# Colar no SQL Editor do Neon e executar
```

**Importante:** Isto irá criar:
- Portal "SM Braga" com as localidades atuais
- Utilizador admin (username: `admin`, password: `admin123`)
- Associar agendamentos existentes ao SM Braga

### Passo 2: Configurar Variáveis de Ambiente no Netlify

No dashboard do Netlify, vá a **Site settings → Environment variables** e adicione:

```
JWT_SECRET=sua-chave-secreta-aqui-mude-isto
```

**Importante:** Gere uma chave secreta forte. Exemplo:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Passo 3: Deploy no Netlify

```bash
# Fazer commit das alterações
git add .
git commit -m "Implementar sistema multi-tenant com autenticação"
git push origin main
```

O Netlify irá fazer deploy automaticamente.

### Passo 4: Primeiro Acesso

1. Aceda ao seu site: `https://seu-site.netlify.app`
2. Será redirecionado para `/login.html`
3. Faça login com:
   - **Username:** `admin`
   - **Password:** `admin123`
4. **IMPORTANTE:** Altere a password do admin imediatamente!

### Passo 5: Criar Portais e Utilizadores

1. No painel administrativo, crie os portais (SM Famalicão, SM Guimarães, etc.)
2. Para cada portal, configure:
   - Nome (ex: "SM Famalicão")
   - Morada de partida (para cálculo de rotas)
   - Localidades com cores (formato JSON)
3. Crie utilizadores e atribua-os aos portais

## 🔐 Credenciais Iniciais

**Admin Master:**
- Username: `admin`
- Password: `admin123`
- **⚠️ ALTERE ESTA PASSWORD APÓS PRIMEIRO LOGIN!**

## 📊 Estrutura de Ficheiros Novos

```
expressglass-frontend/
├── database-schema.sql          # Schema da base de dados
├── DATABASE.md                  # Documentação da BD
├── IMPLEMENTACAO.md             # Este ficheiro
├── login.html                   # Página de login
├── admin.html                   # Painel administrativo
├── admin-style.css              # Estilos do painel
├── admin-script.js              # Lógica do painel
├── auth-client.js               # Cliente de autenticação
├── portal-init.js               # Inicialização do portal
├── expressglass-logo.png        # Logo
├── netlify/functions/
│   ├── auth-login.js           # Login
│   ├── auth-verify.js          # Verificar token
│   ├── portals.js              # Gestão de portais
│   ├── users.js                # Gestão de utilizadores
│   └── appointments.js         # Modificado com filtro por portal
└── package.json                 # Dependências atualizadas
```

## 🔄 Ficheiros Modificados

- `index.html` - Adicionados scripts de autenticação
- `api.js` - Adicionado token JWT nas requisições
- `appointments.js` - Adicionado filtro por portal
- `package.json` - Adicionadas dependências (bcryptjs, jsonwebtoken)

## 🧪 Testar Localmente (Opcional)

```bash
# Instalar dependências
npm install

# Instalar Netlify CLI
npm install -g netlify-cli

# Configurar variáveis de ambiente
# Criar ficheiro .env com:
# DATABASE_URL=sua-connection-string
# JWT_SECRET=sua-chave-secreta

# Executar localmente
netlify dev
```

## ⚠️ Importante

1. **Altere a password do admin** após primeiro login
2. **Configure JWT_SECRET** no Netlify (não use o valor padrão)
3. **Faça backup** da base de dados regularmente
4. **Teste** criar um portal e utilizador antes de usar em produção

## 🆘 Resolução de Problemas

### Erro: "Não autenticado"
- Verifique se JWT_SECRET está configurado no Netlify
- Limpe o localStorage do navegador e faça login novamente

### Erro: "Portal não encontrado"
- Execute o schema SQL no Neon
- Verifique se o portal SM Braga foi criado

### Erro: "Credenciais inválidas"
- Verifique se o utilizador admin foi criado
- Tente resetar a password no painel do Neon

### Agendamentos não aparecem
- Verifique se os agendamentos existentes têm `portal_id` atribuído
- Execute: `UPDATE appointments SET portal_id = 1 WHERE portal_id IS NULL;`

## 📞 Suporte

Para questões técnicas, consulte:
- `DATABASE.md` - Documentação da base de dados
- `README.md` - Documentação do projeto original

---

**Desenvolvido para Expressglass** 🚗💎  
**Sistema Multi-Tenant com Autenticação** 🔐

