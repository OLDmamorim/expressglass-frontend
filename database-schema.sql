-- =====================================================
-- EXPRESSGLASS - ESTRUTURA DA BASE DE DADOS MULTI-TENANT
-- =====================================================

-- Tabela de Portais (Serviços Móveis)
CREATE TABLE IF NOT EXISTS portals (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  departure_address TEXT NOT NULL,
  localities JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Utilizadores
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  password_set_at TIMESTAMPTZ,
  portal_id INTEGER REFERENCES portals(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'coordenador', 'comercial')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
ON users (LOWER(email))
WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS account_invites (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Relação entre coordenadores/comerciais e os seus Serviços Móveis
CREATE TABLE IF NOT EXISTS coordinator_portals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, portal_id)
);

-- Serviços Móveis adicionais que um coordenador pode apenas consultar
CREATE TABLE IF NOT EXISTS consultable_portals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portal_id INTEGER NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, portal_id)
);

-- Modificar tabela de agendamentos para incluir portal_id
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS portal_id INTEGER REFERENCES portals(id) ON DELETE CASCADE;

-- Índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_portal_id ON users(portal_id);
CREATE INDEX IF NOT EXISTS idx_appointments_portal_id ON appointments(portal_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);

-- =====================================================
-- DADOS INICIAIS
-- =====================================================

-- Criar portal SM Braga (migração dos dados existentes)
INSERT INTO portals (name, departure_address, localities) 
VALUES (
  'SM Braga',
  'Avenida Robert Smith 59, 4715-249 Braga',
  '{
    "Outra": "#9CA3AF",
    "Barcelos": "#F87171",
    "Braga": "#34D399",
    "Esposende": "#22D3EE",
    "Famalicão": "#7E22CE",
    "Guimarães": "#FACC15",
    "Póvoa de Lanhoso": "#A78BFA",
    "Póvoa de Varzim": "#6EE7B7",
    "Riba D''Ave": "#FBBF24",
    "Trofa": "#C084FC",
    "Vieira do Minho": "#93C5FD",
    "Vila do Conde": "#1E3A8A",
    "Vila Verde": "#86EFAC"
  }'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- Por segurança, não são criadas credenciais de administrador predefinidas.
-- O primeiro administrador deve ser provisionado por um processo seguro.

-- Associar agendamentos existentes ao portal SM Braga
UPDATE appointments 
SET portal_id = (SELECT id FROM portals WHERE name = 'SM Braga')
WHERE portal_id IS NULL;

-- =====================================================
-- MYCAR CENTER - TABELA DE SERVIÇOS POR MATRÍCULA
-- =====================================================

CREATE TABLE IF NOT EXISTS mycar_services (
  id                SERIAL PRIMARY KEY,
  matricula         VARCHAR(20) NOT NULL,
  data_servico      DATE,
  descricao         TEXT,
  valor             DECIMAL(10,2),
  eurocode          VARCHAR(100),
  status            VARCHAR(20) DEFAULT 'pendente'
                      CHECK (status IN ('pendente', 'tratado', 'rejeitado')),
  email_from        VARCHAR(255),
  email_subject     VARCHAR(500),
  email_received_at TIMESTAMP,
  portal_id         INTEGER REFERENCES portals(id) ON DELETE SET NULL,
  notas             TEXT,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mycar_matricula ON mycar_services(matricula);
CREATE INDEX IF NOT EXISTS idx_mycar_status    ON mycar_services(status);
CREATE INDEX IF NOT EXISTS idx_mycar_portal    ON mycar_services(portal_id);

-- =====================================================
-- COMENTÁRIOS
-- =====================================================

COMMENT ON TABLE portals IS 'Tabela de portais (serviços móveis) - cada portal tem configurações próprias';
COMMENT ON TABLE users IS 'Tabela de utilizadores - cada utilizador pertence a um portal (exceto admin)';
COMMENT ON COLUMN portals.localities IS 'JSON com localidades e cores específicas do portal';
COMMENT ON COLUMN users.role IS 'admin: acesso ao painel administrativo | user: acesso ao portal atribuído';
COMMENT ON COLUMN appointments.portal_id IS 'Referência ao portal - permite isolamento de dados entre serviços';
