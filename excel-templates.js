// ===== SISTEMA DE TEMPLATES DE MAPEAMENTO =====
// Permite criar, guardar e aplicar automaticamente templates de mapeamento

class ExcelTemplateManager {
  constructor() {
    this.templates = [];
    this.loadTemplates();
    
    // Templates pré-definidos do sistema
    this.systemTemplates = [
      {
        id: 'expressglass_standard',
        name: 'Expressglass Padrão',
        description: 'Template padrão da Expressglass',
        isSystem: true,
        headers: ['Matrícula', 'Modelo do Carro', 'Tipo de Serviço', 'Localidade', 'Observações', 'Morada', 'Contacto', 'Outros Dados'],
        mapping: {
          plate: 0,
          car: 1,
          service: 2,
          locality: 3,
          notes: 4,
          address: 5,
          phone: 6,
          extra: 7
        }
      },
      {
        id: 'oficina_simples',
        name: 'Oficina Simples',
        description: 'Para ficheiros básicos de oficina',
        isSystem: true,
        headers: ['Matricula', 'Carro', 'Servico', 'Local'],
        mapping: {
          plate: 0,
          car: 1,
          service: 2,
          locality: 3,
          notes: null,
          address: null,
          phone: null,
          extra: null
        }
      },
      {
        id: 'cliente_completo',
        name: 'Cliente Completo',
        description: 'Com dados completos do cliente',
        isSystem: true,
        headers: ['Matrícula', 'Marca', 'Modelo', 'Serviço', 'Cidade', 'Nome', 'Telefone', 'Endereço', 'Notas'],
        mapping: {
          plate: 0,
          car: '1,2', // Combinar colunas 1 e 2
          service: 3,
          locality: 4,
          notes: 8,
          address: 7,
          phone: 6,
          extra: 5 // Nome do cliente
        }
      }
    ];
  }

  // Carregar templates guardados
  loadTemplates() {
    try {
      const saved = localStorage.getItem('excelTemplates');
      this.templates = saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Erro ao carregar templates:', error);
      this.templates = [];
    }
  }

  // Guardar templates
  saveTemplates() {
    try {
      localStorage.setItem('excelTemplates', JSON.stringify(this.templates));
    } catch (error) {
      console.error('Erro ao guardar templates:', error);
    }
  }

  // Obter todos os templates (sistema + utilizador)
  getAllTemplates() {
    return [...this.systemTemplates, ...this.templates];
  }

  // Detectar template automaticamente baseado nos cabeçalhos
  detectTemplate(headers) {
    const allTemplates = this.getAllTemplates();
    
    for (const template of allTemplates) {
      const score = this.calculateSimilarity(headers, template.headers);
      
      // Se similaridade > 80%, considerar match
      if (score > 0.8) {
        console.log(`🎯 Template detectado: ${template.name} (${Math.round(score * 100)}% similaridade)`);
        return {
          template: template,
          confidence: score,
          mapping: this.adaptMapping(headers, template)
        };
      }
    }
    
    return null;
  }

  // Calcular similaridade entre cabeçalhos
  calculateSimilarity(headers1, headers2) {
    const normalize = (str) => str.toLowerCase()
      .replace(/[áàâãä]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòôõö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9]/g, '');

    const set1 = new Set(headers1.map(normalize));
    const set2 = new Set(headers2.map(normalize));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  // Adaptar mapeamento do template aos cabeçalhos atuais
  adaptMapping(currentHeaders, template) {
    const mapping = {};
    const normalizedCurrent = currentHeaders.map(h => this.normalizeHeader(h));
    const normalizedTemplate = template.headers.map(h => this.normalizeHeader(h));
    
    Object.entries(template.mapping).forEach(([field, templateIndex]) => {
      if (templateIndex === null) {
        mapping[field] = null;
        return;
      }
      
      // Se é combinação de colunas (ex: "1,2")
      if (typeof templateIndex === 'string' && templateIndex.includes(',')) {
        mapping[field] = templateIndex; // Manter como string para processar depois
        return;
      }
      
      const templateHeader = normalizedTemplate[templateIndex];
      if (!templateHeader) {
        mapping[field] = null;
        return;
      }
      
      // Procurar correspondência nos cabeçalhos atuais
      const matchIndex = normalizedCurrent.findIndex(h => 
        this.headersMatch(h, templateHeader)
      );
      
      mapping[field] = matchIndex >= 0 ? matchIndex : null;
    });
    
    return mapping;
  }

  // Normalizar cabeçalho para comparação
  normalizeHeader(header) {
    return String(header || '')
      .toLowerCase()
      .replace(/[áàâãä]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòôõö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9]/g, '');
  }

  // Verificar se dois cabeçalhos correspondem
  headersMatch(header1, header2) {
    const h1 = this.normalizeHeader(header1);
    const h2 = this.normalizeHeader(header2);
    
    // Correspondência exata
    if (h1 === h2) return true;
    
    // Correspondência parcial (contém)
    if (h1.includes(h2) || h2.includes(h1)) return true;
    
    // Sinónimos comuns
    const synonyms = {
      'matricula': ['plate', 'placa', 'registo'],
      'carro': ['veiculo', 'automovel', 'car', 'vehicle', 'modelo'],
      'servico': ['service', 'tipo', 'work'],
      'localidade': ['local', 'cidade', 'locality', 'location'],
      'observacoes': ['notes', 'obs', 'comentarios', 'remarks'],
      'morada': ['endereco', 'address', 'rua'],
      'contacto': ['telefone', 'phone', 'telemovel', 'mobile'],
      'outros': ['extra', 'adicional', 'dados']
    };
    
    for (const [key, values] of Object.entries(synonyms)) {
      if ((h1.includes(key) || values.some(v => h1.includes(v))) &&
          (h2.includes(key) || values.some(v => h2.includes(v)))) {
        return true;
      }
    }
    
    return false;
  }

  // Criar novo template
  createTemplate(name, description, headers, mapping) {
    const template = {
      id: `user_${Date.now()}`,
      name: name,
      description: description,
      isSystem: false,
      headers: [...headers],
      mapping: { ...mapping },
      createdAt: new Date().toISOString()
    };
    
    this.templates.push(template);
    this.saveTemplates();
    
    console.log('✅ Template criado:', template.name);
    return template;
  }

  // Atualizar template existente
  updateTemplate(id, updates) {
    const index = this.templates.findIndex(t => t.id === id);
    if (index >= 0) {
      this.templates[index] = { ...this.templates[index], ...updates };
      this.saveTemplates();
      return this.templates[index];
    }
    return null;
  }

  // Eliminar template
  deleteTemplate(id) {
    const index = this.templates.findIndex(t => t.id === id);
    if (index >= 0) {
      const deleted = this.templates.splice(index, 1)[0];
      this.saveTemplates();
      console.log('🗑️ Template eliminado:', deleted.name);
      return deleted;
    }
    return null;
  }

  // Obter template por ID
  getTemplate(id) {
    return this.getAllTemplates().find(t => t.id === id);
  }

  // Aplicar template ao mapeamento atual
  applyTemplate(templateId, currentHeaders) {
    const template = this.getTemplate(templateId);
    if (!template) return null;
    
    const mapping = this.adaptMapping(currentHeaders, template);
    
    console.log('🎯 Template aplicado:', template.name);
    console.log('📋 Mapeamento:', mapping);
    
    return {
      template: template,
      mapping: mapping
    };
  }

  // Sugerir nome para novo template baseado nos cabeçalhos
  suggestTemplateName(headers) {
    const keywords = headers.join(' ').toLowerCase();
    
    if (keywords.includes('cliente') || keywords.includes('nome')) {
      return 'Template com Dados do Cliente';
    }
    
    if (keywords.includes('oficina') || keywords.includes('ordem')) {
      return 'Template de Oficina';
    }
    
    if (keywords.includes('seguro') || keywords.includes('sinistro')) {
      return 'Template de Seguros';
    }
    
    return `Template ${new Date().toLocaleDateString()}`;
  }

  // Exportar templates para backup
  exportTemplates() {
    return {
      version: '1.0',
      exportDate: new Date().toISOString(),
      templates: this.templates
    };
  }

  // Importar templates de backup
  importTemplates(data) {
    try {
      if (data.templates && Array.isArray(data.templates)) {
        // Adicionar templates importados (sem duplicar)
        data.templates.forEach(template => {
          const exists = this.templates.find(t => t.name === template.name);
          if (!exists) {
            template.id = `imported_${Date.now()}_${Math.random()}`;
            this.templates.push(template);
          }
        });
        
        this.saveTemplates();
        return true;
      }
    } catch (error) {
      console.error('Erro ao importar templates:', error);
    }
    return false;
  }

  // Processar mapeamento com combinação de colunas
  processMapping(row, mapping) {
    const result = {};
    
    Object.entries(mapping).forEach(([field, columnIndex]) => {
      if (columnIndex === null || columnIndex === undefined) {
        result[field] = '';
        return;
      }
      
      // Se é combinação de colunas (ex: "1,2")
      if (typeof columnIndex === 'string' && columnIndex.includes(',')) {
        const indices = columnIndex.split(',').map(i => parseInt(i.trim()));
        const values = indices.map(i => row[i] || '').filter(v => v.trim() !== '');
        result[field] = values.join(' ');
        return;
      }
      
      // Coluna simples
      const index = parseInt(columnIndex);
      result[field] = row[index] || '';
    });
    
    return result;
  }
}

// Instância global
window.templateManager = new ExcelTemplateManager();
