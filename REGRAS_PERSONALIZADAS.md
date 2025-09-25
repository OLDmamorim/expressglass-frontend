# 🎯 Template com Regras Personalizadas - Implementado

## Regras Definidas pelo Utilizador

### Mapeamento de Colunas

| Campo Sistema | Coluna Excel | Índice | Regra |
|---------------|--------------|--------|-------|
| **Matrícula** | Coluna I | 8 | Campo obrigatório |
| **Carro** | Coluna L + M | 11 + 12 | Junção com espaço |
| **Observações** | Coluna N | 13 | Campo opcional |
| **Outros Dados** | Coluna K | 10 | Campo opcional |

### Filtro Principal - Matrícula Duplicada

**Regra Crítica:** Se a matrícula já existir na base de dados, **ignorar a linha** completamente.

**Processo:**
1. Para cada linha, extrair matrícula da coluna I
2. Verificar se já existe na base de dados (consulta API)
3. Se existir: Linha ignorada + log informativo
4. Se não existir: Processar normalmente

### Campos Não Mapeados

**Estratégia:** Deixar vazios para preenchimento posterior pelo operador

- **Tipo de Serviço:** Valor padrão "PB" (será alterado)
- **Localidade:** Valor padrão "Braga" (será alterado)
- **Morada:** Vazio
- **Contacto:** Vazio
- **Data:** Null (por agendar)

## Implementação Técnica

### Processador Personalizado

**Classe:** `ProcessadorPersonalizado`

**Funcionalidades:**
- Verificação de matrícula duplicada via API
- Normalização de matrícula (XX-XX-XX)
- Combinação de colunas (L + M)
- Validações específicas
- Relatório detalhado de processamento

### Detecção Automática

**Critérios:** Presença de 3+ campos específicos nos cabeçalhos:
- `matricula`
- `marca` 
- `modelo`
- `ref`
- `segurado`

**Confiança:** 98% quando detectado

### Fluxo de Processamento

```
1. Upload Ficheiro
   ↓
2. Detecção Automática (98% confiança)
   ↓
3. "Template Personalizado detectado!"
   ↓
4. Aceitar → Processamento Especializado
   ↓
5. Para cada linha:
   - Extrair: Matrícula (I), Marca (L), Modelo (M), Obs (N), Outros (K)
   - Verificar: Matrícula já existe?
   - Se SIM: Ignorar linha
   - Se NÃO: Criar serviço básico
   ↓
6. Relatório Final:
   - X linhas processadas
   - Y linhas ignoradas (matrícula duplicada)
   - Z erros encontrados
```

## Exemplo Prático

### Dados Excel (Entrada)
```
| ... | I (Matrícula) | ... | L (Marca) | M (Modelo) | N (Obs) | ... | K (Outros) |
|-----|---------------|-----|-----------|------------|---------|-----|------------|
| ... | AZ-01-AF      | ... | PEUGEOT   | 308        | Urgente | ... | Seguro X   |
| ... | BC-72-DR      | ... | BMW       | X3         | Normal  | ... | Cliente Y  |
```

### Processamento
```
Linha 2: AZ-01-AF
- Verificar base de dados... ❌ Não existe
- Criar: Matrícula="AZ-01-AF", Carro="PEUGEOT 308", Obs="Urgente"
- Status: ✅ Processado

Linha 3: BC-72-DR  
- Verificar base de dados... ✅ Já existe!
- Status: 🚫 Ignorado (matrícula duplicada)
```

### Resultado Final (Sistema)
```javascript
// Apenas linha 2 é importada
{
  plate: "AZ-01-AF",
  car: "PEUGEOT 308", 
  service: "PB",        // Padrão - operador altera
  locality: "Braga",    // Padrão - operador altera
  notes: "Urgente",
  extra: "Seguro X",
  address: "",          // Vazio - operador preenche
  phone: "",            // Vazio - operador preenche
  status: "NE",         // Não Executado
  date: null            // Por agendar
}
```

## Relatório de Importação

### Informações Fornecidas

**Sucessos:**
- Número de linhas processadas com sucesso
- Dados criados na tabela "Serviços por Agendar"

**Ignorados:**
- Linhas ignoradas por matrícula duplicada
- Matrícula específica que causou a duplicação
- Número da linha no Excel

**Erros:**
- Linhas com dados inválidos
- Descrição específica do erro
- Número da linha no Excel

### Exemplo de Log
```
✅ Processamento concluído:
- 15 sucessos
- 3 ignoradas (matrícula duplicada)  
- 2 erros (dados inválidos)

Detalhes:
Linha 8: Ignorado - Matrícula já existe (AZ-01-AF)
Linha 12: Erro - Marca é obrigatória (coluna L)
Linha 15: Ignorado - Matrícula já existe (BC-72-DR)
```

## Benefícios das Regras Personalizadas

### Eficiência Operacional
✅ **Prevenção de duplicados** - Evita conflitos na base de dados  
✅ **Importação seletiva** - Só processa dados novos  
✅ **Dados mínimos** - Foco no essencial para agendamento  
✅ **Flexibilidade posterior** - Operador completa conforme necessário  

### Integridade dos Dados
✅ **Validação rigorosa** - Matrícula e carro obrigatórios  
✅ **Normalização automática** - Formato consistente de matrícula  
✅ **Preservação de contexto** - Observações e dados extras mantidos  
✅ **Rastreabilidade** - Metadados de importação incluídos  

### Experiência do Utilizador
✅ **Detecção automática** - Zero configuração manual  
✅ **Feedback claro** - Relatório detalhado de processamento  
✅ **Controlo total** - Operador decide quando completar dados  
✅ **Prevenção de erros** - Duplicados automaticamente evitados  

## Configuração e Uso

### Ficheiros Implementados
- `template-personalizado.js` - Template e processador com regras específicas
- `excel-import.js` - Integração com sistema existente (atualizado)
- `index.html` - Carregamento dos scripts (atualizado)

### Como Usar
1. **Carregar ficheiro Excel** com estrutura conhecida
2. **Sistema detecta automaticamente** (98% confiança)
3. **Clicar "Aceitar"** para aplicar regras personalizadas
4. **Verificar relatório** de sucessos/ignorados/erros
5. **Importar dados** válidos para "Serviços por Agendar"
6. **Operador agenda** posteriormente com dados completos

### Compatibilidade
- **Funciona em paralelo** com outros templates
- **Não interfere** com importações manuais
- **Fallback automático** se detecção falhar
- **Integração completa** com sistema existente

## Conclusão

As regras personalizadas transformam a importação Excel numa operação inteligente e segura, focada nas necessidades específicas do fluxo de trabalho da Expressglass. O sistema agora:

1. **Detecta automaticamente** o formato específico
2. **Aplica regras personalizadas** sem configuração
3. **Previne duplicados** verificando a base de dados
4. **Cria lista básica** para agendamento posterior
5. **Fornece feedback detalhado** do processamento

**Resultado:** Importação eficiente, segura e adaptada ao processo real de trabalho.
