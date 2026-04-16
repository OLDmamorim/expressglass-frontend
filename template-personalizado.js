// ===== TEMPLATE PERSONALIZADO - REGRAS DO UTILIZADOR =====

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
    service: null,
    locality: null,
    notes: 10,       // Coluna K (Segurado) → Observações
    address: null,
    phone: 25,       // Coluna Z (U_contsega)
    extra: 9,        // Coluna J (Obs) → Eurocode (contém código de vidro)
    client_name: 4   // Coluna E (Nome)
  }
};

// ===== PROCESSADOR PERSONALIZADO =====
class ProcessadorPersonalizado {

  constructor() {
    this.templateId = 'expressglass_personalizado';
  }

  matriculaJaExiste(matricula) {
    const matriculaNormalizada = this.normalizarMatricula(matricula);
    if (!matriculaNormalizada) return false;
    const existing = window.appointments || [];
    const existe = existing.some(apt =>
      this.normalizarMatricula(apt.plate || '') === matriculaNormalizada
    );
    if (existe) console.log(`🚫 Matrícula ${matricula} já existe — ignorando`);
    else        console.log(`✅ Matrícula ${matricula} não existe — importar`);
    return existe;
  }

  normalizarMatricula(matricula) {
    if (!matricula) return '';
    return String(matricula).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  }

  formatarMatricula(matricula) {
    if (!matricula) return '';
    const clean = this.normalizarMatricula(matricula);
    if (clean.length >= 6) {
      return `${clean.slice(0,2)}-${clean.slice(2,4)}-${clean.slice(4,6)}`;
    }
    return clean;
  }

  _excelNumToDate(excelDate) {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + Math.floor(excelDate) * 86400000);
  }

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

  async processarLinha(row, numeroLinha) {
    const matricula   = row[8]  || '';
    const marca       = (row[11] || '').trim();
    const modelo      = (row[12] || '').trim();
    // ✅ CORRECÇÃO: Obs (col J, índice 9) → Eurocode; Segurado (col K, índice 10) → Observações
    const codigoVidro = (row[9]  || '').toString().trim();   // Obs → Eurocode
    const segurado    = (row[10] || '').toString().trim();   // Segurado → Observações
    const nomeCliente = (row[4]  || '').toString().trim();

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
        if (typeof excelDate === 'number') {
          dataCriacao = this._excelNumToDate(excelDate).toISOString();
        } else if (typeof excelDate === 'string' && excelDate.trim()) {
          const d = this._parseDataStr(excelDate);
          if (d) dataCriacao = d.toISOString();
        }
      } catch (e) {
        console.warn(`⚠️ [Personalizado] Erro data criação:`, e);
      }
    }
    if (!dataCriacao) dataCriacao = new Date().toISOString();

    // 📅 DATA DE SERVIÇO (col F, índice 5)
    let dataServico = null;
    if (row[5]) {
      try {
        const excelDate = row[5];
        if (typeof excelDate === 'number') {
          dataServico = this._excelNumToDate(excelDate);
        } else if (typeof excelDate === 'string' && excelDate.trim()) {
          dataServico = this._parseDataStr(excelDate);
        }
      } catch (e) {
        console.warn(`⚠️ [Personalizado] Erro dataserviço:`, e);
      }
    }

    // 🕐 HORA INÍCIO (col U, índice 20)
    let period = null;
    if (dataServico && row[20]) {
      const horaStr = String(row[20]).trim();
      const m = horaStr.match(/^(\d{1,2}):(\d{2})/);
      if (m) {
        const hora = parseInt(m[1]);
        if (hora >= 9 && hora < 18) {
          period = hora < 14 ? 'Manhã' : 'Tarde';
        }
      }
    }

    const dateISO = dataServico
      ? `${dataServico.getFullYear()}-${String(dataServico.getMonth()+1).padStart(2,'0')}-${String(dataServico.getDate()).padStart(2,'0')}`
      : null;

    const contacto     = (row[25] || '').toString().trim();
    const detalheDanos = (row[23] || '').toString().trim();

    return {
      plate:         this.formatarMatricula(matricula),
      car:           carro,
      service:       'PB',
      locality:      null,
      notes:         segurado,     // Segurado (col K) → Observações
      address:       '',
      phone:         contacto,
      extra:         codigoVidro,  // Obs (col J) → Eurocode
      client_name:   nomeCliente,
      damage_details: detalheDanos || null,
      status:        'NE',
      date:          dateISO,
      period:        period,
      auto_imported: !!dateISO,
      confirmed:     false,
      km:            null,
      sortIndex:     1,
      createdAt:     dataCriacao,
      importedAt:    new Date().toISOString(),
      importedFrom:  'excel_personalizado'
    };
  }

  async processarFicheiro(data) {
    const resultados = { success: [], errors: [], ignored: [] };
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
          resultados.success.push({ row: numeroLinha, data: servico });
        }
      } catch (error) {
        resultados.errors.push({ row: numeroLinha, errors: [error.message] });
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
      const headerStr = headers.join('|').toLowerCase().replace(/\s+/g, '');
      const criterios = ['matricula', 'marca', 'modelo', 'ref', 'segurado', 'bostamp', 'dataobra', 'dataservico'];
      const correspondencias = criterios.filter(c => headerStr.includes(c));

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
  document.addEventListener('DOMContentLoaded', () => setTimeout(configurarDeteccaoPersonalizada, 500));
  window.addEventListener('load', () => setTimeout(configurarDeteccaoPersonalizada, 1000));
}

console.log('🎯 Template personalizado configurado com regras específicas do utilizador!');
