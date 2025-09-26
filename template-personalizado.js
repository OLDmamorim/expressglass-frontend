// ===== TEMPLATE PERSONALIZADO - REGRAS DO UTILIZADOR =====

// Template baseado nas regras específicas definidas pelo utilizador
const templatePersonalizado = {
  id: 'expressglass_personalizado',
  name: 'Expressglass Personalizado',
  description: 'Template com regras específicas: Matrícula (I), Carro (L+M), Obs (N), Outros (K)',
  isSystem: true,
  headers: [
    'Bostamp', 'Nmdos', 'Obrano', 'Dataobra', 'Nome', 'Dataserviço', 'U_dtent', 
    'Status', 'Matricula', 'Obs', 'Segurado', 'Marca', 'Modelo', 'Ref', 
    'Eurocode', 'Nrfactura', 'Seriefcatura', 'Nrsinistro', 'Armazem', 'Fechado', 
    'Hora_inicio', 'Hora_fim', 'Ultima_nota', 'Detalhe_danos', 'Email', 'U_contsega'
  ],
  mapping: {
    plate: 8,        // Coluna I (Matricula)
    car: '11,12',    // Coluna L + Coluna M (Marca + Modelo)
    service: null,   // NÃO IMPORTAR - Operador define
    locality: null,  // NÃO IMPORTAR - Operador define
    notes: 13,       // Coluna N (Observações)
    address: null,   // NÃO IMPORTAR - Operador define
    phone: null,     // NÃO IMPORTAR - Operador define
    extra: 10        // Coluna K (Outros dados)
  }
};

// ===== PROCESSADOR PERSONALIZADO =====
class ProcessadorPersonalizado {
  
  constructor() {
    this.templateId = 'expressglass_personalizado';
  }
  
  // Verificar se matrícula já existe na base de dados
  async matriculaJaExiste(matricula) {
    try {
      console.log(`🔍 Verificando se matrícula ${matricula} já existe...`);
      
      // Carregar agendamentos existentes
      const response = await fetch('/.netlify/functions/appointments');
      if (!response.ok) {
        console.warn('Não foi possível verificar agendamentos existentes - permitindo importação');
        return false; // Em caso de erro, permitir importação
      }
      
      const responseData = await response.json();
      console.log('📊 Resposta da API:', responseData);
      
      // Verificar se a resposta é um array ou tem propriedade data
      let appointments = [];
      if (Array.isArray(responseData)) {
        appointments = responseData;
      } else if (responseData && Array.isArray(responseData.data)) {
        appointments = responseData.data;
      } else if (responseData && Array.isArray(responseData.appointments)) {
        appointments = responseData.appointments;
      } else {
        console.warn('Formato de resposta inesperado da API - permitindo importação');
        return false;
      }
      
      console.log(`📋 ${appointments.length} agendamentos carregados para verificação`);
      
      // Normalizar matrícula para comparação
      const matriculaNormalizada = this.normalizarMatricula(matricula);
      
      // Verificar se já existe
      const existe = appointments.some(apt => 
        this.normalizarMatricula(apt.plate || '') === matriculaNormalizada
      );
      
      if (existe) {
        console.log(`🚫 Matrícula ${matricula} já existe na base de dados - linha ignorada`);
      } else {
        console.log(`✅ Matrícula ${matricula} não existe - pode importar`);
      }
      
      return existe;
      
    } catch (error) {
      console.error('Erro ao verificar matrícula existente:', error);
      return false; // Em caso de erro, permitir importação
    }
  }
  
  // Normalizar matrícula para comparação
  normalizarMatricula(matricula) {
    if (!matricula) return '';
    return String(matricula)
      .replace(/[^A-Z0-9]/gi, '')
      .toUpperCase();
  }
  
  // Formatar matrícula para padrão XX-XX-XX
  formatarMatricula(matricula) {
    if (!matricula) return '';
    
    const clean = this.normalizarMatricula(matricula);
    
    if (clean.length >= 6) {
      return `${clean.slice(0,2)}-${clean.slice(2,4)}-${clean.slice(4,6)}`;
    }
    
    return clean;
  }
  
  // Processar linha individual
  async processarLinha(row, numeroLinha) {
    // Extrair dados conforme regras
    const matricula = row[8] || ''; // Coluna I
    const marca = (row[11] || '').trim(); // Coluna L
    const modelo = (row[12] || '').trim(); // Coluna M
    const observacoes = row[13] || ''; // Coluna N
    const outrosDados = row[10] || ''; // Coluna K
    
    // Validações básicas
    if (!matricula || matricula.trim() === '') {
      throw new Error('Matrícula é obrigatória (coluna I)');
    }
    
    // 🚫 FILTRO PRINCIPAL: Verificar se matrícula já existe
    const jaExiste = await this.matriculaJaExiste(matricula);
    if (jaExiste) {
      return null; // Retorna null para indicar que deve ser ignorada
    }
    
    // Construir carro (Marca + Modelo)
    const carro = [marca, modelo].filter(v => v).join(' ');
    if (!carro) {
      throw new Error('Marca e Modelo são obrigatórios (colunas L e M)');
    }
    
    // Criar objeto do serviço
    const servico = {
      plate: this.formatarMatricula(matricula),
      car: carro,
      service: '', // VAZIO - Operador deve definir
      locality: '', // VAZIO - Operador deve definir
      notes: observacoes,
      address: '', // VAZIO - Operador deve definir
      phone: '', // VAZIO - Operador deve definir
      extra: outrosDados,
      
      // Campos padrão do sistema
      status: 'NE', // Não Executado
      date: null, // Sem data (por agendar)
      period: null,
      km: null,
      sortIndex: 1,
      
      // Metadados da importação
      importedAt: new Date().toISOString(),
      importedFrom: 'excel_personalizado'
    };
    
    return servico;
  }
  
  // Processar ficheiro completo
  async processarFicheiro(data) {
    const resultados = {
      success: [],
      errors: [],
      ignored: [] // Linhas ignoradas por matrícula duplicada
    };
    
    console.log('🎯 Iniciando processamento com regras personalizadas...');
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const numeroLinha = i + 2; // +2 porque índice começa em 0 e primeira linha são cabeçalhos
      
      try {
        const servico = await this.processarLinha(row, numeroLinha);
        
        if (servico === null) {
          // Linha ignorada por matrícula duplicada
          resultados.ignored.push({
            row: numeroLinha,
            plate: this.formatarMatricula(row[8] || ''),
            reason: 'Matrícula já existe na base de dados'
          });
        } else {
          // Linha processada com sucesso
          resultados.success.push({
            row: numeroLinha,
            data: servico
          });
        }
        
      } catch (error) {
        resultados.errors.push({
          row: numeroLinha,
          errors: [error.message]
        });
      }
    }
    
    console.log('✅ Processamento concluído:', {
      sucessos: resultados.success.length,
      erros: resultados.errors.length,
      ignoradas: resultados.ignored.length
    });
    
    return resultados;
  }
}

// ===== INTEGRAÇÃO COM SISTEMA =====

// ===== INICIALIZAÇÃO IMEDIATA =====

// Função para configurar detecção personalizada
function configurarDeteccaoPersonalizada() {
  if (window.templateManager) {
    // Adicionar template personalizado
    window.templateManager.systemTemplates.push(templatePersonalizado);
    console.log('✅ Template personalizado adicionado ao sistema');
    
    // Sobrescrever detecção para priorizar template personalizado
    const originalDetectTemplate = window.templateManager.detectTemplate;
    
    window.templateManager.detectTemplate = function(headers) {
      console.log('🔍 Verificando cabeçalhos:', headers);
      
      // Verificar se é o formato específico do ficheiro Expressglass
      const headerStr = headers.join('|').toLowerCase().replace(/\s+/g, '');
      
      // Critérios específicos baseados no ficheiro real
      const criteriosEspecificos = [
        'matricula',    // Coluna I
        'marca',        // Coluna L  
        'modelo',       // Coluna M
        'ref',          // Coluna N (observações)
        'segurado',     // Coluna K (outros dados)
        'bostamp',      // Campo único Expressglass
        'dataobra',     // Campo único Expressglass
        'dataservico'   // Campo único Expressglass
      ];
      
      const correspondencias = criteriosEspecificos.filter(criterio => 
        headerStr.includes(criterio)
      );
      
      console.log('🔍 Correspondências encontradas:', correspondencias);
      
      // Se encontrar 4+ campos específicos, é o formato personalizado
      if (correspondencias.length >= 4) {
        console.log('🎯 Ficheiro Expressglass personalizado detectado!');
        return {
          template: this.getTemplate('expressglass_personalizado'),
          confidence: 0.98,
          mapping: templatePersonalizado.mapping
        };
      }
      
      // Senão, usar detecção normal
      return originalDetectTemplate ? originalDetectTemplate.call(this, headers) : null;
    };
    
    console.log('✅ Detecção personalizada configurada');
  }
  
  // Criar instância do processador
  window.processadorPersonalizado = new ProcessadorPersonalizado();
  console.log('✅ Processador personalizado inicializado');
}

// Tentar configurar imediatamente
if (typeof window !== 'undefined') {
  // Tentar configurar agora
  configurarDeteccaoPersonalizada();
  
  // Tentar novamente quando DOM carregar
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(configurarDeteccaoPersonalizada, 500);
  });
  
  // Tentar novamente quando página carregar completamente
  window.addEventListener('load', function() {
    setTimeout(configurarDeteccaoPersonalizada, 1000);
  });
}

console.log('🎯 Template personalizado configurado com regras específicas do utilizador!');
