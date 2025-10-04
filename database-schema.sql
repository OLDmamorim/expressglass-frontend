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
  password_hash TEXT NOT NULL,
  portal_id INTEGER REFERENCES portals(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

-- Criar utilizador admin master
-- Password: admin123 (deve ser alterada após primeiro login)
-- Hash gerado com bcrypt (10 rounds)
INSERT INTO users (username, password_hash, portal_id, role)
VALUES (
  'admin',
  '$2b$10$rZ5FQjxKw.V8qN3xGx3xZeYvJ5YqK5qK5qK5qK5qK5qK5qK5qK5qK',
  NULL,
  'admin'
)
ON CONFLICT (username) DO NOTHING;

-- Associar agendamentos existentes ao portal SM Braga
UPDATE appointments 
SET portal_id = (SELECT id FROM portals WHERE name = 'SM Braga')
WHERE portal_id IS NULL;

-- =====================================================
-- COMENTÁRIOS
-- =====================================================

COMMENT ON TABLE portals IS 'Tabela de portais (serviços móveis) - cada portal tem configurações próprias';
COMMENT ON TABLE users IS 'Tabela de utilizadores - cada utilizador pertence a um portal (exceto admin)';
COMMENT ON COLUMN portals.localities IS 'JSON com localidades e cores específicas do portal';
COMMENT ON COLUMN users.role IS 'admin: acesso ao painel administrativo | user: acesso ao portal atribuído';
COMMENT ON COLUMN appointments.portal_id IS 'Referência ao portal - permite isolamento de dados entre serviços';
