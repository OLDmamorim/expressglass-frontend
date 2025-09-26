// ===== TEMPLATE EXPRESSGLASS COMPLETO =====
// Template baseado no ficheiro Excel fornecido pelo utilizador

// Adicionar template específico ao sistema
if (window.templateManager) {
  // Template personalizado baseado no ficheiro real
  const expressglassCompletoTemplate = {
    id: 'expressglass_completo_real',
    name: 'Expressglass Completo (Ficheiro Real)',
    description: 'Template baseado no ficheiro Excel real da Expressglass com 26 colunas',
    isSystem: true,
    headers: [
      'Bostamp', 'Nmdos', 'Obrano', 'Dataobra', 'Nome', 'Dataserviço', 'U_dtent', 
      'Status', 'Matricula', 'Obs', 'Segurado', 'Marca', 'Modelo', 'Ref', 
      'Eurocode', 'Nrfactura', 'Seriefcatura', 'Nrsinistro', 'Armazem', 'Fechado', 
      'Hora_inicio', 'Hora_fim', 'Ultima_nota', 'Detalhe_danos', 'Email', 'U_contsega'
    ],
    mapping: {
      plate: 8,        // Matricula (coluna 8)
      car: '11,12',    // Marca + Modelo (colunas 11 e 12 combinadas)
      service: 7,      // Status (coluna 7) - será convertido para códigos PB/LT/etc
      locality: null,  // Não existe no ficheiro - será definida manualmente
      notes: 9,        // Obs (coluna 9)
      address: null,   // Não existe no ficheiro
      phone: 25,       // U_contsega (coluna 25)
      extra: 10        // Segurado (coluna 10)
    },
    // Configurações específicas para este template
    config: {
      dateColumn: 5,           // Dataserviço (coluna 5)
      clientNameColumn: 4,     // Nome (coluna 4)
      emailColumn: 24,         // Email (coluna 24)
      startTimeColumn: 20,     // Hora_inicio (coluna 20)
      endTimeColumn: 21,       // Hora_fim (coluna 21)
      damageDetailsColumn: 23, // Detalhe_danos (coluna 23)
      
      // Mapeamento de status para tipos de serviço
      statusMapping: {
        'Consulta / Orçamento': 'PB',
        'Pedido Autorização': 'PB',
        'Para-brisas': 'PB',
        'Lateral': 'LT',
        'Óculo': 'OC',
        'Reparação': 'REP',
        'Polimento': 'POL'
      },
      
      // Localidades padrão (será necessário mapear manualmente ou usar lógica)
      defaultLocality: 'Braga'
    }
  };

  // Adicionar aos templates do sistema
  window.templateManager.systemTemplates.push(expressglassCompletoTemplate);
  
  console.log('✅ Template Expressglass Completo adicionado ao sistema');
}

// ===== PROCESSADOR ESPECÍFICO PARA ESTE TEMPLATE =====
class ExpressglassFileProcessor {
  
  constructor() {
    this.templateId = 'expressglass_completo_real';
  }
  
  // Processar linha específica do ficheiro Expressglass
  processRow(row, template) {
    const result = {};
    
    // Matrícula (coluna 8)
    result.plate = this.formatPlate(row[8] || '');
    
    // Carro - combinar Marca + Modelo (colunas 11 e 12)
    const marca = (row[11] || '').trim();
    const modelo = (row[12] || '').trim();
    result.car = [marca, modelo].filter(v => v).join(' ');
    
    // Tipo de serviço - converter Status (coluna 7)
    result.service = this.mapServiceType(row[7] || '');
    
    // Localidade - usar padrão ou tentar deduzir
    result.locality = template.config.defaultLocality;
    
    // Observações (coluna 9)
    result.notes = row[9] || '';
    
    // Contacto (coluna 25)
    result.phone = row[25] || '';
    
    // Extra - Segurado (coluna 10)
    result.extra = row[10] || '';
    
    // Dados adicionais específicos
    result.clientName = row[4] || '';
    result.email = row[24] || '';
    result.serviceDate = this.formatDate(row[5]);
    result.startTime = row[20] || '';
    result.endTime = row[21] || '';
    result.damageDetails = row[23] || '';
    
    return result;
  }
  
  // Formatar matrícula para padrão XX-XX-XX
  formatPlate(plate) {
    if (!plate) return '';
    
    // Remover espaços e caracteres especiais
    const clean = String(plate).replace(/[^A-Z0-9]/gi, '').toUpperCase();
    
    if (clean.length >= 6) {
      // Formato XX-XX-XX
      return `${clean.slice(0,2)}-${clean.slice(2,4)}-${clean.slice(4,6)}`;
    }
    
    return clean;
  }
  
  // Mapear status para tipo de serviço
  mapServiceType(status) {
    const template = window.templateManager?.getTemplate(this.templateId);
    const mapping = template?.config?.statusMapping || {};
    
    // Procurar correspondência exata
    if (mapping[status]) {
      return mapping[status];
    }
    
    // Procurar correspondência parcial
    const statusLower = status.toLowerCase();
    
    if (statusLower.includes('para-brisas') || statusLower.includes('parabrisas')) {
      return 'PB';
    }
    if (statusLower.includes('lateral')) {
      return 'LT';
    }
    if (statusLower.includes('óculo') || statusLower.includes('oculo')) {
      return 'OC';
    }
    if (statusLower.includes('reparação') || statusLower.includes('reparacao')) {
      return 'REP';
    }
    if (statusLower.includes('polimento')) {
      return 'POL';
    }
    
    // Padrão
    return 'PB';
  }
  
  // Formatar data
  formatDate(dateValue) {
    if (!dateValue) return '';
    
    try {
      // Se já é uma data
      if (dateValue instanceof Date) {
        return dateValue.toISOString().split('T')[0];
      }
      
      // Se é string, tentar converter
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
      
      return '';
    } catch (error) {
      return '';
    }
  }
  
  // Validar linha do ficheiro Expressglass
  validateRow(row) {
    const errors = [];
    
    // Matrícula obrigatória
    if (!row[8] || String(row[8]).trim() === '') {
      errors.push('Matrícula é obrigatória (coluna 9)');
    }
    
    // Marca obrigatória
    if (!row[11] || String(row[11]).trim() === '') {
      errors.push('Marca é obrigatória (coluna 12)');
    }
    
    // Nome do cliente obrigatório
    if (!row[4] || String(row[4]).trim() === '') {
      errors.push('Nome do cliente é obrigatório (coluna 5)');
    }
    
    return errors;
  }
  
  // Processar ficheiro completo
  async processFile(data) {
    const results = {
      success: [],
      errors: []
    };
    
    const template = window.templateManager?.getTemplate(this.templateId);
    if (!template) {
      throw new Error('Template Expressglass Completo não encontrado');
    }
    
    data.forEach((row, index) => {
      try {
        // Validar linha
        const validationErrors = this.validateRow(row);
        if (validationErrors.length > 0) {
          results.errors.push({
            row: index + 2, // +2 porque índice começa em 0 e primeira linha são cabeçalhos
            errors: validationErrors
          });
          return;
        }
        
        // Processar linha
        const processed = this.processRow(row, template);
        results.success.push({
          row: index + 2,
          data: processed
        });
        
      } catch (error) {
        results.errors.push({
          row: index + 2,
          errors: [`Erro ao processar: ${error.message}`]
        });
      }
    });
    
    return results;
  }
}

// Instância global do processador
window.expressglassProcessor = new ExpressglassFileProcessor();

// ===== INTEGRAÇÃO COM SISTEMA DE IMPORTAÇÃO =====

// Sobrescrever função de detecção para priorizar este template
if (window.templateManager) {
  const originalDetectTemplate = window.templateManager.detectTemplate;
  
  window.templateManager.detectTemplate = function(headers) {
    // Verificar se é o formato Expressglass específico
    const expressglassHeaders = [
      'bostamp', 'nmdos', 'obrano', 'dataobra', 'nome', 'dataservico', 'matricula'
    ];
    
    const normalizedHeaders = headers.map(h => 
      String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    );
    
    // Se contém cabeçalhos específicos da Expressglass
    const matches = expressglassHeaders.filter(eh => 
      normalizedHeaders.some(nh => nh.includes(eh) || eh.includes(nh))
    );
    
    if (matches.length >= 4) {
      console.log('🎯 Ficheiro Expressglass detectado automaticamente!');
      return {
        template: this.getTemplate('expressglass_completo_real'),
        confidence: 0.95,
        mapping: this.getTemplate('expressglass_completo_real').mapping
      };
    }
    
    // Senão, usar detecção normal
    return originalDetectTemplate.call(this, headers);
  };
}

console.log('🎯 Template Expressglass Completo configurado e pronto para uso!');
