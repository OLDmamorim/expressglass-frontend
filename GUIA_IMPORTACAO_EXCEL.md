# 📊 Sistema de Importação Excel - Guia Completo

## 🎯 Visão Geral

O sistema de importação Excel permite carregar ficheiros Excel (.xlsx/.xls) e criar automaticamente serviços por agendar no portal Expressglass. Esta funcionalidade é ideal para importar listas de clientes, ordens de trabalho ou dados de sistemas externos.

## 🚀 Como Usar

### 1️⃣ Aceder à Funcionalidade
- Na secção **"SERVIÇOS POR AGENDAR"**
- Clicar no botão **"📊 Importar Excel"**

### 2️⃣ Carregar Ficheiro Excel
- **Arrastar e largar** o ficheiro na área indicada
- **OU** clicar em "Escolher Ficheiro"
- Formatos suportados: `.xlsx` e `.xls`

### 3️⃣ Mapear Colunas
Associar as colunas do Excel aos campos do sistema:

**Campos Obrigatórios:**
- **Matrícula** - Identificação do veículo (formato: XX-XX-XX)
- **Modelo do Carro** - Marca e modelo (ex: BMW X3, Audi A4)
- **Tipo de Serviço** - PB, LT, OC, REP, POL
- **Localidade** - Uma das localidades válidas do sistema

**Campos Opcionais:**
- **Observações** - Notas sobre o serviço
- **Morada** - Endereço do cliente
- **Contacto** - Telefone do cliente
- **Outros Dados** - Informações adicionais

### 4️⃣ Pré-visualizar e Validar
- Verificar dados válidos vs erros
- Corrigir problemas se necessário
- Confirmar importação

### 5️⃣ Importar Dados
- Os serviços são criados como "Serviços por Agendar"
- Status inicial: **N/E** (Não Executado)
- Podem ser agendados posteriormente

## 📋 Template Excel

### Descarregar Template
- No passo 1, clicar em **"Descarregar Template"**
- Ficheiro exemplo com estrutura correta

### Estrutura Recomendada
```
| Matrícula | Modelo do Carro | Tipo de Serviço | Localidade | Observações | Morada | Contacto | Outros Dados |
|-----------|-----------------|-----------------|------------|-------------|--------|----------|--------------|
| AB-12-CD  | BMW X3          | PB              | Braga      | Urgente     | Rua... | 912...   | Cliente VIP  |
```

## ⚙️ Validações Automáticas

### Matrícula
- **Formato:** XX-XX-XX (automático)
- **Exemplo:** AB1234 → AB-12-34
- **Obrigatório:** Sim

### Tipo de Serviço
**Valores aceites:**
- `PB`, `PARA-BRISAS`, `PARABRISAS` → **PB - Para-brisas**
- `LT`, `LATERAL` → **LT - Lateral**
- `OC`, `OCULO`, `ÓCULO` → **OC - Óculo**
- `REP`, `REPARACAO`, `REPARAÇÃO` → **REP - Reparação**
- `POL`, `POLIMENTO` → **POL - Polimento**

### Localidades Válidas
- Outra, Barcelos, Braga, Esposende, Famalicão
- Guimarães, Póvoa de Lanhoso, Póvoa de Varzim
- Riba D'Ave, Trofa, Vieira do Minho, Vila do Conde, Vila Verde

## 🔧 Funcionalidades Avançadas

### Auto-Detecção de Colunas
O sistema tenta detectar automaticamente as colunas baseado nos nomes:
- **Matrícula:** matricula, matrícula, plate
- **Carro:** carro, modelo, car, vehicle
- **Serviço:** servico, serviço, service, tipo
- **Localidade:** localidade, locality, local, cidade

### Normalização Automática
- **Matrículas:** Formatação automática XX-XX-XX
- **Tipos de Serviço:** Conversão para códigos padrão
- **Localidades:** Correspondência case-insensitive

### Relatório de Erros
- **Linha específica** onde ocorreu o erro
- **Descrição detalhada** do problema
- **Importação parcial** - só registos válidos são importados

## 📊 Resultados da Importação

### Estatísticas
- **Importados com Sucesso:** Número de serviços criados
- **Erros:** Número de registos que falharam
- **Detalhes:** Lista completa de sucessos e erros

### Após Importação
- **Recarregamento automático** da lista de serviços
- **Notificação** de conclusão
- **Serviços visíveis** na secção "Serviços por Agendar"

## 🛠️ Resolução de Problemas

### Erros Comuns

**"Matrícula é obrigatória"**
- Verificar se a coluna está mapeada corretamente
- Confirmar que as células não estão vazias

**"Tipo de serviço inválido"**
- Usar apenas os códigos aceites (PB, LT, OC, REP, POL)
- Verificar ortografia

**"Localidade inválida"**
- Usar apenas localidades da lista válida
- Verificar acentos e capitalização

### Dicas de Preparação

1. **Limpar dados** antes da importação
2. **Usar template** como referência
3. **Testar com poucos registos** primeiro
4. **Verificar formatos** de matrícula e serviços

## 🔄 Integração com Sistema

### Base de Dados
- **Persistência:** PostgreSQL via Netlify Functions
- **Sincronização:** Automática entre dispositivos
- **Backup:** Incluído no sistema de backup existente

### Compatibilidade
- **Desktop e Mobile:** Interface responsiva
- **Navegadores:** Chrome, Firefox, Safari, Edge
- **Ficheiros:** Excel 2007+ (.xlsx) e Excel 97-2003 (.xls)

## 📈 Casos de Uso

### Importação de Ordens de Trabalho
- Receber lista de clientes por email
- Importar diretamente para o sistema
- Agendar conforme disponibilidade

### Migração de Dados
- Transferir dados de sistema antigo
- Converter formato Excel
- Importar em lote

### Planeamento Semanal
- Preparar lista de serviços
- Importar no início da semana
- Organizar por localidade e prioridade

---

## 🎯 Resumo dos Benefícios

✅ **Eficiência:** Importação em lote vs criação manual  
✅ **Precisão:** Validação automática de dados  
✅ **Flexibilidade:** Mapeamento personalizado de colunas  
✅ **Integração:** Funciona com sistema existente  
✅ **Usabilidade:** Interface intuitiva passo-a-passo  

**Resultado:** Redução significativa do tempo de entrada de dados e eliminação de erros manuais.
