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
    notes: 13,       // Coluna N (Ref)
    address: null,   // Será preenchido pelo operador
    phone: 25,       // Coluna Z (U_contsega)
    extra: 10        // Coluna K (Segurado)
  }
};

// ===== PROCESSADOR PERSONALIZADO =====
class ProcessadorPersonalizado {
  
  constructor() {
    this.templateId = 'expressglass_personalizado';
  }
  
  // Verificar se matrícula já existe
  matriculaJaExiste(matricula) {
    const matriculaNormalizada = this.normalizarMatricula(matricula);
    if (!matriculaNormalizada) return false;

    const existing = window.appointments || [];
    const existe = existing.some(apt =>
      this.normalizarMatricula(apt.plate || '') === matriculaNormalizada
    );

    if (existe) {
      console.log(`🚫 Matrícula ${matricula} já existe — ignorando`);
    } else {
      console.log(`✅ Matrícula ${matricula} não existe — importar`);
    }
    return existe;
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

  // Converter data Excel (número serial) para Date
  _excelNumToDate(excelDate) {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + Math.floor(excelDate) * 86400000);
  }

  // Parsear data de string (DD/MM/YYYY ou DD.MM.YYYY)
  _parseDataStr(str) {
    const cleanStr = String(str).trim().split(' ')[0];
    const match = cleanStr.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    const parsed = new Date(cleanStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // Processar linha individual
  async processarLinha(row, numeroLinha) {
    const matricula = row[8] || '';
    const marca = (row[11] || '').trim();
    const modelo = (row[12] || '').trim();
    const observacoes = row[13] || '';
    const outrosDados = row[10] || '';

    if (!matricula || matricula.trim() === '') {
      throw new Error('Matrícula é obrigatória (coluna I)');
    }

    const carro = [marca, modelo].filter(v => v).join(' ');
    if (!carro) {
      throw new Error('Marca e Modelo são obrigatórios (colunas L e M)');
    }

    // 📅 DATA DE CRIAÇÃO (col D, índice 3)
    let dataCriacao = null;
    if (row[3]) {
      try {
        const excelDate = row[3];
        console.log(`📅 [Personalizado] Data criação col D (linha ${numeroLinha}):`, excelDate, typeof excelDate);
        if (typeof excelDate === 'number') {
          dataCriacao = this._excelNumToDate(excelDate).toISOString();
        } else if (typeof excelDate === 'string' && excelDate.trim()) {
          const d = this._parseDataStr(excelDate);
          if (d) dataCriacao = d.toISOString();
        }
        if (dataCriacao) console.log(`✅ [Personalizado] Data criação:`, dataCriacao);
      } catch (e) {
        console.warn(`⚠️ [Personalizado] Erro data criação:`, e);
      }
    }
    if (!dataCriacao) {
      dataCriacao = new Date().toISOString();
      console.log(`⏰ [Personalizado] Usando data atual (linha ${numeroLinha})`);
    }

    // 📅 DATA DE SERVIÇO (col F, índice 5) — dataserviço
    let dataServico = null;
    if (row[5]) {
      try {
        const excelDate = row[5];
        console.log(`📅 [Personalizado] Dataserviço col F (linha ${numeroLinha}):`, excelDate, typeof excelDate);
        if (typeof excelDate === 'number') {
          dataServico = this._excelNumToDate(excelDate);
        } else if (typeof excelDate === 'string' && excelDate.trim()) {
          dataServico = this._parseDataStr(excelDate);
        }
        if (dataServico) console.log(`✅ [Personalizado] Data serviço:`, dataServico.toISOString());
      } catch (e) {
        console.warn(`⚠️ [Personalizado] Erro dataserviço:`, e);
      }
    }

    // 🕐 HORA INÍCIO (col U, índice 20) → determinar Manhã/Tarde
    let period = null;
    if (dataServico && row[20]) {
      const horaStr = String(row[20]).trim();
      const m = horaStr.match(/^(\d{1,2}):(\d{2})/);
      if (m) {
        const hora = parseInt(m[1]);
        if (hora >= 9 && hora < 18) {
          period = hora < 14 ? 'Manhã' : 'Tarde';
          console.log(`🕐 [Personalizado] Hora ${horaStr} → ${period}`);
        }
      }
    }

    // Formatar date para YYYY-MM-DD
    const dateISO = dataServico
      ? `${dataServico.getFullYear()}-${String(dataServico.getMonth()+1).padStart(2,'0')}-${String(dataServico.getDate()).padStart(2,'0')}`
      : null;

    const contacto = (row[25] || '').toString().trim();

    const servico = {
      plate: this.formatarMatricula(matricula),
      car: carro,
      service: 'PB',
      locality: null,
      notes: observacoes,
      address: '',
      phone: contacto,
      extra: outrosDados,
      status: 'NE',
      date: dateISO,           // ← dataserviço (col F)
      period: period,          // ← Manhã ou Tarde (col U)
      auto_imported: !!dateISO,
      confirmed: false,
      km: null,
      sortIndex: 1,
      createdAt: dataCriacao,
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
      ignored: []
    };
    
    console.log('🎯 Iniciando processamento com regras personalizadas...');
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const numeroLinha = i + 2;
      
      try {
        const servico = await this.processarLinha(row, numeroLinha);
        
        if (servico === null) {
          resultados.ignored.push({
            row: numeroLinha,
            plate: this.formatarMatricula(row[8] || ''),
            reason: 'Matrícula já existe na base de dados'
          });
        } else {
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

function configurarDeteccaoPersonalizada() {
  if (window.templateManager) {
    window.templateManager.systemTemplates.push(templatePersonalizado);
    console.log('✅ Template personalizado adicionado ao sistema');
    
    const originalDetectTemplate = window.templateManager.detectTemplate;
    
    window.templateManager.detectTemplate = function(headers) {
      console.log('🔍 Verificando cabeçalhos:', headers);
      
      const headerStr = headers.join('|').toLowerCase().replace(/\s+/g, '');
      
      const criteriosEspecificos = [
        'matricula', 'marca', 'modelo', 'ref', 'segurado',
        'bostamp', 'dataobra', 'dataservico'
      ];
      
      const correspondencias = criteriosEspecificos.filter(criterio => 
        headerStr.includes(criterio)
      );
      
      console.log('🔍 Correspondências encontradas:', correspondencias);
      
      if (correspondencias.length >= 4) {
        console.log('🎯 Ficheiro Expressglass personalizado detectado!');
        return {
          template: this.getTemplate('expressglass_personalizado'),
          confidence: 0.98,
          mapping: templatePersonalizado.mapping
        };
      }
      
      return originalDetectTemplate ? originalDetectTemplate.call(this, headers) : null;
    };
    
    console.log('✅ Detecção personalizada configurada');
  }
  
  window.processadorPersonalizado = new ProcessadorPersonalizado();
  console.log('✅ Processador personalizado inicializado');
}

if (typeof window !== 'undefined') {
  configurarDeteccaoPersonalizada();
  
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(configurarDeteccaoPersonalizada, 500);
  });
  
  window.addEventListener('load', function() {
    setTimeout(configurarDeteccaoPersonalizada, 1000);
  });
}

console.log('🎯 Template personalizado configurado com regras específicas do utilizador!');
