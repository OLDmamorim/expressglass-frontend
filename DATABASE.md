# Estrutura da Base de Dados - Sistema Multi-Tenant

## Visão Geral

O sistema foi redesenhado para suportar múltiplos portais (serviços móveis) com isolamento completo de dados e configurações personalizadas.

## Tabelas

### 1. `portals`

Armazena as configurações de cada portal (serviço móvel).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL | Identificador único do portal |
| `name` | VARCHAR(100) | Nome do portal (ex: "SM Braga", "SM Famalicão") |
| `departure_address` | TEXT | Morada de partida para cálculo de rotas |
| `localities` | JSONB | JSON com localidades e cores específicas |
| `created_at` | TIMESTAMP | Data de criação |
| `updated_at` | TIMESTAMP | Data da última atualização |

**Exemplo de `localities`:**
```json
{
  "Braga": "#34D399",
  "Barcelos": "#F87171",
  "Guimarães": "#FACC15"
}
```

### 2. `users`

Armazena os utilizadores do sistema.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | SERIAL | Identificador único do utilizador |
| `username` | VARCHAR(50) | Nome de utilizador (único) |
| `password_hash` | TEXT | Hash da password (bcrypt) |
| `portal_id` | INTEGER | ID do portal atribuído (NULL para admin) |
| `role` | VARCHAR(20) | Papel: 'admin' ou 'user' |
| `created_at` | TIMESTAMP | Data de criação |
| `updated_at` | TIMESTAMP | Data da última atualização |

**Roles:**
- `admin`: Acesso ao painel administrativo (não tem portal atribuído)
- `user`: Acesso ao portal atribuído

### 3. `appointments` (modificada)

Tabela existente com nova coluna para isolamento de dados.

| Nova Coluna | Tipo | Descrição |
|-------------|------|-----------|
| `portal_id` | INTEGER | ID do portal (chave estrangeira) |

Todas as outras colunas mantêm-se inalteradas.

## Relacionamentos

```
portals (1) ──── (N) users
portals (1) ──── (N) appointments
```

- Um portal pode ter múltiplos utilizadores
- Um portal pode ter múltiplos agendamentos
- Um utilizador pertence a um portal (exceto admin)
- Um agendamento pertence a um portal

## Segurança

### Isolamento de Dados

Cada consulta aos agendamentos deve incluir filtro por `portal_id`:

```sql
SELECT * FROM appointments 
WHERE portal_id = $1 
ORDER BY date ASC;
```

### Autenticação

As passwords são armazenadas usando **bcrypt** com 10 rounds de hashing.

```javascript
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash(password, 10);
const isValid = await bcrypt.compare(password, hash);
```

### Sessões

As sessões são geridas usando **JWT (JSON Web Tokens)** com as seguintes claims:

```json
{
  "userId": 123,
  "username": "joao",
  "portalId": 1,
  "role": "user",
  "iat": 1234567890,
  "exp": 1234567890
}
```

## Migração de Dados Existentes

O script SQL inclui:

1. Criação do portal "SM Braga" com as localidades atuais
2. Criação do utilizador admin master (username: `admin`, password: `admin123`)
3. Associação de todos os agendamentos existentes ao portal SM Braga

**⚠️ IMPORTANTE:** Alterar a password do admin após primeiro login!

## Aplicação do Schema

### Opção 1: Via Neon Console

1. Aceder ao dashboard do Neon
2. Abrir o SQL Editor
3. Copiar e executar o conteúdo de `database-schema.sql`

### Opção 2: Via psql

```bash
psql $DATABASE_URL -f database-schema.sql
```

### Opção 3: Via Netlify Function (automático)

Criar uma função de migração que executa o schema na primeira execução.

## Próximos Passos

Após aplicar o schema:

1. ✅ Estrutura da base de dados criada
2. ⏳ Implementar sistema de autenticação
3. ⏳ Criar página de login
4. ⏳ Desenvolver painel administrativo
5. ⏳ Adaptar portal existente
