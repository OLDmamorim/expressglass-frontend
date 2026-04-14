// ===== SISTEMA DE IMPORTAÇÃO EXCEL =====
// Biblioteca para importar dados de ficheiros Excel e criar serviços por agendar

class ExcelImporter {
  constructor() {
    this.data = [];
    this.headers = [];
    this.mapping = {};
    this.validationErrors = [];
    
    // Mapeamento de tipos de serviço
    this.serviceTypes = {
      'PB': 'PB - Para-brisas',
      'PARA-BRISAS': 'PB - Para-brisas',
      'PARABRISAS': 'PB - Para-brisas',
      'LT': 'LT - Lateral',
      'LATERAL': 'LT - Lateral',
      'OC': 'OC - Óculo',
      'OCULO': 'OC - Óculo',
      'ÓCULO': 'OC - Óculo',
      'REP': 'REP - Reparação',
      'REPARACAO': 'REP - Reparação',
      'REPARAÇÃO': 'REP - Reparação',
      'POL': 'POL - Polimento',
      'POLIMENTO': 'POL - Polimento'
    };
    
    // Localidades válidas
    this.localities = [
      'Outra', 'Barcelos', 'Braga', 'Esposende', 'Famalicão', 
      'Guimarães', 'Póvoa de Lanhoso', 'Póvoa de Varzim', 
      'Riba D\'Ave', 'Trofa', 'Vieira do Minho', 'Vila do Conde', 'Vila Verde'
    ];
  }

  // Carregar e processar ficheiro Excel
  async loadFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // Usar a primeira folha
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // Converter para JSON
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          if (jsonData.length === 0) {
            reject(new Error('Ficheiro Excel vazio'));
            return;
          }
          
          // Primeira linha são os cabeçalhos
          this.headers = jsonData[0].map(h => String(h || '').trim());
          
          // Resto são os dados
          this.data = jsonData.slice(1).filter(row => 
            row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')
          );
          
          console.log('📊 Excel carregado:', {
            headers: this.headers,
            rows: this.data.length
          });
          
          // 🎯 DETECÇÃO AUTOMÁTICA DE TEMPLATE
          const detectedTemplate = window.templateManager?.detectTemplate(this.headers);
          
          resolve({
            headers: this.headers,
            rowCount: this.data.length,
            preview: this.data.slice(0, 5), // Primeiras 5 linhas para preview
            detectedTemplate: detectedTemplate // Template detectado automaticamente
          });
          
        } catch (error) {
          reject(new Error(`Erro ao processar Excel: ${error.message}`));
        }
      };
      
      reader.onerror = () => reject(new Error('Erro ao ler ficheiro'));
      reader.readAsArrayBuffer(file);
    });
  }

  // Definir mapeamento de colunas
  setMapping(mapping) {
    this.mapping = mapping;
    console.log('🗺️ Mapeamento definido:', mapping);
  }

  // Validar e processar dados
  async processData() {
    // 🎯 VERIFICAR SE É TEMPLATE PERSONALIZADO
    if (window.processadorPersonalizado && this.isTemplatePersonalizado()) {
      console.log('🎯 Usando processador personalizado com regras específicas');
      
      try {
        return await this.processarComTemplatePersonalizado();
      } catch (error) {
        console.error('Erro no processador personalizado:', error);
        // Fallback para processamento padrão
      }
    }
    
    // 🎯 VERIFICAR SE É TEMPLATE EXPRESSGLASS ESPECÍFICO
    if (window.expressglassProcessor && this.isExpressglassTemplate()) {
      console.log('🎯 Usando processador específico Expressglass');
      
      try {
        const results = window.expressglassProcessor.processFile(this.data);
        
        // Converter para formato esperado
        this.validationErrors = results.errors.map(err => ({
          row: err.row,
          error: err.errors.join(', ')
        }));
        
        const processedData = results.success.map(item => item.data);
        
        console.log('✅ Dados processados (Expressglass):', {
          valid: processedData.length,
          errors: this.validationErrors.length
        });
        
        return {
          data: processedData,
          errors: this.validationErrors
        };
        
      } catch (error) {
        console.error('Erro no processador Expressglass:', error);
        // Fallback para processamento padrão
      }
    }
    
    // Processamento padrão
    this.validationErrors = [];
    const processedData = [];
    
    for (let i = 0; i < this.data.length; i++) {
      const row = this.data[i];
      const rowNumber = i + 2; // +2 porque linha 1 são headers e arrays começam em 0
      
      try {
        const service = this.processRow(row, rowNumber);
        if (service) {
          processedData.push(service);
        }
      } catch (error) {
        this.validationErrors.push({
          row: rowNumber,
          error: error.message
        });
      }
    }
    
    console.log('✅ Dados processados:', {
      valid: processedData.length,
      errors: this.validationErrors.length
    });
    
    return {
      data: processedData,
      errors: this.validationErrors
    };
  }
  
  // Processar com template personalizado
  async processarComTemplatePersonalizado() {
    const results = await window.processadorPersonalizado.processarFicheiro(this.data);
    
    // Converter para formato esperado
    this.validationErrors = results.errors.map(err => ({
      row: err.row,
      error: err.errors.join(', ')
    }));
    
    // Adicionar linhas ignoradas aos erros (para informação)
    results.ignored.forEach(ignored => {
      this.validationErrors.push({
        row: ignored.row,
        error: `Ignorado: ${ignored.reason} (${ignored.plate})`
      });
    });
    
    const processedData = results.success.map(item => item.data);
    
    console.log('✅ Dados processados (Personalizado):', {
      válidos: processedData.length,
      erros: results.errors.length,
      ignorados: results.ignored.length
    });
    
    return {
      data: processedData,
      errors: this.validationErrors
    };
  }
  
  // Verificar se está usando template personalizado
  isTemplatePersonalizado() {
    const headerStr = this.headers.join('|').toLowerCase();
    const camposPersonalizados = ['matricula', 'marca', 'modelo', 'ref', 'segurado'];
    return camposPersonalizados.filter(campo => headerStr.includes(campo)).length >= 3;
  }
  
  // Verificar se está usando template Expressglass específico
  isExpressglassTemplate() {
    // Verificar se os cabeçalhos contêm campos específicos da Expressglass
    const expressglassFields = ['bostamp', 'nmdos', 'dataobra', 'matricula', 'dataservico'];
    const headerStr = this.headers.join('|').toLowerCase();
    
    return expressglassFields.some(field => headerStr.includes(field));
  }

  // Processar uma linha individual
  processRow(row, rowNumber) {
    const service = {};
    
    // Extrair dados baseado no mapeamento
    for (const [field, columnIndex] of Object.entries(this.mapping)) {
      if (columnIndex !== null && columnIndex !== undefined && columnIndex >= 0) {
        const value = row[columnIndex];
        service[field] = value ? String(value).trim() : '';
      }
    }
    
    // Validações obrigatórias
    if (!service.plate || service.plate === '') {
      throw new Error('Matrícula é obrigatória');
    }
    
    if (!service.car || service.car === '') {
      throw new Error('Modelo do carro é obrigatório');
    }
    
    // Normalizar matrícula (formato XX-XX-XX)
    service.plate = this.normalizeplate(service.plate);
    
    // Definir valores padrão para campos que serão preenchidos pelo operador
    service.service = service.service ? this.normalizeServiceType(service.service) : 'PB';
    service.locality = service.locality ? this.normalizeLocality(service.locality) : 'Braga';
    
    // Campos opcionais
    service.notes = service.notes || '';
    service.address = service.address || '';
    service.phone = service.phone || '';
    service.extra = service.extra || '';
    
    // Campos padrão
    service.status = 'NE'; // Não Executado
    service.date = null; // Sem data (por agendar)
    service.period = null;
    service.km = null;
    service.sortIndex = 1;
    
    // 📅 CAPTURAR DATA DE CRIAÇÃO
    // Tentar múltiplas fontes: mapeamento, coluna D, ou data atual
    let capturedDate = null;
    
    // 1. Tentar pelo mapeamento (se houver campo 'createdAt' ou 'date' mapeado)
    if (service.createdAt && service.createdAt !== '') {
      capturedDate = service.createdAt;
      console.log(`📅 Data capturada via mapeamento (linha ${rowNumber}):`, capturedDate);
    }
    
    // 2. Tentar coluna D (índice 3) como fallback
    if (!capturedDate && row[3]) {
      try {
        const excelDate = row[3];
        console.log(`📅 Tentando capturar data da coluna D (linha ${rowNumber}):`, excelDate, typeof excelDate);
        
        // Se for número (data do Excel), converter
        if (typeof excelDate === 'number') {
          const date = this.excelDateToJSDate(excelDate);
          capturedDate = date.toISOString();
          console.log(`✅ Data convertida de número Excel:`, capturedDate);
        } 
        // Se for string, tentar parsear
        else if (typeof excelDate === 'string' && excelDate.trim() !== '') {
          const parsed = this.parseExcelDateString(excelDate);
          if (parsed) {
            capturedDate = parsed.toISOString();
            console.log(`✅ Data parseada de string:`, capturedDate);
          }
        }
      } catch (error) {
        console.warn(`⚠️ Erro ao parsear data na linha ${rowNumber}:`, error);
      }
    }
    
    // 3. Se não conseguiu capturar, usar data atual
    if (!capturedDate) {
      capturedDate = new Date().toISOString();
      console.log(`⏰ Usando data atual (linha ${rowNumber}):`, capturedDate);
    }
    
    service.createdAt = capturedDate;
    
    return service;
  }

  // Normalizar matrícula para formato XX-XX-XX
  normalizeplate(plate) {
    if (!plate) return '';
    
    // Remover espaços e converter para maiúsculas
    let normalized = String(plate).replace(/\s+/g, '').toUpperCase();
    
    // Se já tem hífens, manter
    if (normalized.includes('-')) {
      return normalized;
    }
    
    // Se tem 6 caracteres, adicionar hífens
    if (normalized.length === 6) {
      return `${normalized.slice(0, 2)}-${normalized.slice(2, 4)}-${normalized.slice(4, 6)}`;
    }
    
    // Se tem 8 caracteres (formato novo), adicionar hífens
    if (normalized.length === 8) {
      return `${normalized.slice(0, 2)}-${normalized.slice(2, 4)}-${normalized.slice(4, 6)}`;
    }
    
    return normalized; // Retornar como está se não conseguir normalizar
  }

  // Normalizar tipo de serviço
  normalizeServiceType(service) {
    if (!service) return null;
    
    const normalized = String(service).toUpperCase().trim();
    return this.serviceTypes[normalized] || null;
  }

  // Normalizar localidade
  normalizeLocality(locality) {
    if (!locality) return null;
    
    const normalized = String(locality).trim();
    
    // Procurar correspondência exata (case-insensitive)
    const match = this.localities.find(loc => 
      loc.toLowerCase() === normalized.toLowerCase()
    );
    
    return match || null;
  }

  // Gerar template Excel para download
  generateTemplate() {
    const templateData = [
      ['Matrícula', 'Modelo do Carro', 'Tipo de Serviço', 'Localidade', 'Observações', 'Morada', 'Contacto', 'Outros Dados'],
      ['AB-12-CD', 'BMW X3', 'PB', 'Braga', 'Substituição urgente', 'Rua da Liberdade 123', '912345678', 'Cliente VIP'],
      ['EF-34-GH', 'Audi A4', 'LT', 'Guimarães', 'Vidro partido', 'Av. Central 456', '923456789', ''],
      ['IJ-56-KL', 'Mercedes C200', 'REP', 'Famalicão', 'Pequena fissura', '', '934567890', 'Garantia']
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Serviços');
    
    // Definir larguras das colunas
    ws['!cols'] = [
      { width: 12 }, // Matrícula
      { width: 20 }, // Modelo do Carro
      { width: 15 }, // Tipo de Serviço
      { width: 15 }, // Localidade
      { width: 25 }, // Observações
      { width: 25 }, // Morada
      { width: 12 }, // Contacto
      { width: 15 }  // Outros Dados
    ];
    
    return wb;
  }

  // Converter data do Excel (número serial) para JavaScript Date
  excelDateToJSDate(excelDate) {
    // Excel armazena datas como número de dias desde 1900-01-01
    // Mas tem um bug: considera 1900 como ano bissexto (não é)
    const excelEpoch = new Date(1899, 11, 30); // 30 de dezembro de 1899
    const days = Math.floor(excelDate);
    const milliseconds = days * 24 * 60 * 60 * 1000;
    return new Date(excelEpoch.getTime() + milliseconds);
  }

  // Parsear string de data em vários formatos
  parseExcelDateString(dateStr) {
    // Remover espaços e partes de hora
    const cleanStr = dateStr.trim().split(' ')[0];
    
    // Tentar formatos comuns
    const formats = [
      /^(\d{2})\.(\d{2})\.(\d{4})$/,  // DD.MM.YYYY
      /^(\d{2})\/(\d{2})\/(\d{4})$/,  // DD/MM/YYYY
      /^(\d{4})-(\d{2})-(\d{2})$/,    // YYYY-MM-DD
      /^(\d{2})-(\d{2})-(\d{4})$/     // DD-MM-YYYY
    ];
    
    for (const format of formats) {
      const match = cleanStr.match(format);
      if (match) {
        let day, month, year;
        
        if (format.source.startsWith('^\\(\\d{4}')) {
          // YYYY-MM-DD
          [, year, month, day] = match;
        } else {
          // DD.MM.YYYY ou DD/MM/YYYY ou DD-MM-YYYY
          [, day, month, year] = match;
        }
        
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      }
    }
    
    return null;
  }

  // Importar dados para o sistema
  async importData(processedData) {
    const results = {
      success: 0,
      errors: 0,
      skipped: 0,
      details: []
    };
    
    // Obter lista de matrículas já existentes (serviços pendentes)
    const existingAppointments = window.appointments || [];
    const existingPlates = new Set(
      existingAppointments
        .filter(a => !a.date || a.status !== 'ST') // Apenas pendentes ou não finalizados
        .map(a => String(a.plate).toUpperCase().trim())
    );
    
    console.log('📋 Matrículas já existentes:', existingPlates.size);
    
    for (const service of processedData) {
      try {
        const plateNormalized = String(service.plate).toUpperCase().trim();

        // Verificar duplicado no mesmo lote (evita chamadas duplas ao backend)
        if (existingPlates.has(plateNormalized)) {
          // Se tem damage_details, tentar atualizar registo existente
          if (service.damage_details) {
            const existing = existingAppointments.find(a =>
              String(a.plate).toUpperCase().trim() === plateNormalized
            );
            if (existing?.id) {
              try {
                await window.apiClient.updateAppointment(existing.id, {
                  ...existing,
                  damage_details: service.damage_details
                });
                results.details.push({ plate: service.plate, status: 'updated', reason: 'damage_details atualizado' });
              } catch (e) {
                results.skipped++;
                results.details.push({ plate: service.plate, status: 'skipped', reason: 'Duplicado no lote' });
              }
            } else {
              results.skipped++;
              results.details.push({ plate: service.plate, status: 'skipped', reason: 'Duplicado no lote' });
            }
          } else {
            results.skipped++;
            results.details.push({ plate: service.plate, status: 'skipped', reason: 'Duplicado no lote' });
          }
          continue;
        }

        // O backend decide: cria, actualiza (sem data→com data) ou rejeita
        const result = await window.apiClient.createAppointment(service);

        existingPlates.add(plateNormalized);

        if (result.action === 'updated') {
          results.updated = (results.updated || 0) + 1;
          results.details.push({ plate: service.plate, status: 'updated', reason: 'Passou para agenda' });
        } else {
          results.success++;
          results.details.push({ plate: service.plate, status: 'success', id: result.data?.id || result.id });
        }

      } catch (error) {
        if (error.message && error.message.includes('já existe')) {
          // Tentar atualizar damage_details se existir
          if (service.damage_details) {
            const plateNorm = String(service.plate).toUpperCase().trim();
            const existing = (window.appointments || []).find(a =>
              String(a.plate).toUpperCase().trim() === plateNorm
            );
            if (existing?.id) {
              try {
                await window.apiClient.updateAppointment(existing.id, {
                  ...existing,
                  damage_details: service.damage_details
                });
                results.details.push({ plate: service.plate, status: 'updated', reason: 'damage_details atualizado' });
              } catch (e) {
                results.skipped++;
                results.details.push({ plate: service.plate, status: 'skipped', reason: 'Já existe' });
              }
            } else {
              results.skipped++;
              results.details.push({ plate: service.plate, status: 'skipped', reason: 'Já existe' });
            }
          } else {
            results.skipped++;
            results.details.push({ plate: service.plate, status: 'skipped', reason: 'Já existe' });
          }
        } else {
          results.errors++;
          results.details.push({ plate: service.plate, status: 'error', error: error.message });
        }
      }
    }
    
    return results;
  }
}

// Instância global
window.excelImporter = new ExcelImporter();
