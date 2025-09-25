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
    service: null,   // Será preenchido pelo operador
    locality: null,  // Será preenchido pelo operador
    notes: 13,       // Coluna N (Ref - assumindo que é a coluna N)
    address: null,   // Será preenchido pelo operador
    phone: null,     // Será preenchido pelo operador
    extra: 10        // Coluna K (Segurado)
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
      // Carregar agendamentos existentes
      const response = await fetch('/.netlify/functions/appointments');
      if (!response.ok) {
        console.warn('Não foi possível verificar agendamentos existentes');
        return false; // Em caso de erro, permitir importação
      }
      
      const appointments = await response.json();
      
      // Normalizar matrícula para comparação
      const matriculaNormalizada = this.normalizarMatricula(matricula);
      
      // Verificar se já existe
      const existe = appointments.some(apt => 
        this.normalizarMatricula(apt.plate || '') === matriculaNormalizada
      );
      
      if (existe) {
        console.log(`🚫 Matrícula ${matricula} já existe na base de dados - linha ignorada`);
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
      service: 'PB', // Valor padrão - será alterado pelo operador
      locality: 'Braga', // Valor padrão - será alterado pelo operador
      notes: observacoes,
      address: '', // Vazio - será preenchido pelo operador
      phone: '', // Vazio - será preenchido pelo operador
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

// Adicionar template ao sistema quando carregado
document.addEventListener('DOMContentLoaded', function() {
  // Aguardar carregamento do sistema de templates
  setTimeout(() => {
    if (window.templateManager) {
      // Adicionar template personalizado
      window.templateManager.systemTemplates.push(templatePersonalizado);
      console.log('✅ Template personalizado adicionado ao sistema');
    }
    
    // Criar instância do processador
    window.processadorPersonalizado = new ProcessadorPersonalizado();
    console.log('✅ Processador personalizado inicializado');
    
  }, 1000);
});

// Sobrescrever detecção para priorizar template personalizado
if (typeof window !== 'undefined') {
  window.addEventListener('load', function() {
    if (window.templateManager) {
      const originalDetectTemplate = window.templateManager.detectTemplate;
      
      window.templateManager.detectTemplate = function(headers) {
        // Verificar se é o formato específico (presença de colunas I, L, M, N, K)
        const headerStr = headers.join('|').toLowerCase();
        
        // Procurar por padrões específicos do ficheiro
        const temCamposEspecificos = [
          'matricula', 'marca', 'modelo', 'ref', 'segurado'
        ].filter(campo => headerStr.includes(campo)).length >= 3;
        
        if (temCamposEspecificos) {
          console.log('🎯 Ficheiro com formato personalizado detectado!');
          return {
            template: this.getTemplate('expressglass_personalizado'),
            confidence: 0.98,
            mapping: templatePersonalizado.mapping
          };
        }
        
        // Senão, usar detecção normal
        return originalDetectTemplate.call(this, headers);
      };
    }
  });
}

console.log('🎯 Template personalizado configurado com regras específicas do utilizador!');
