// ===== INTERFACE DE IMPORTAÇÃO EXCEL =====
// Controla a UI do modal de importação

let currentStep = 1;
let uploadedFile = null;
let processedData = null;
let detectedTemplate = null;
let currentHeaders = [];

// Abrir modal de importação
function openExcelImportModal() {
  document.getElementById('excelImportModal').style.display = 'flex';
  resetImportModal();
}

// Fechar modal de importação
function closeExcelImportModal() {
  document.getElementById('excelImportModal').style.display = 'none';
  resetImportModal();
}

// Reset do modal para estado inicial
function resetImportModal() {
  currentStep = 1;
  uploadedFile = null;
  processedData = null;
  
  // Mostrar apenas passo 1
  for (let i = 1; i <= 4; i++) {
    const step = document.getElementById(`step${i}`);
    if (step) step.style.display = i === 1 ? 'block' : 'none';
  }
  
  document.getElementById('loadingStep').style.display = 'none';
  
  // Limpar formulários
  document.getElementById('excelFile').value = '';
  document.getElementById('fileInfo').style.display = 'none';
  document.getElementById('uploadArea').classList.remove('dragover');
  
  // Limpar mapeamento
  const selects = document.querySelectorAll('.mapping-select');
  selects.forEach(select => select.selectedIndex = 0);
}

// Configurar drag & drop
function setupDragAndDrop() {
  const uploadArea = document.getElementById('uploadArea');
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  });
}

// Configurar input de ficheiro
function setupFileInput() {
  document.getElementById('excelFile').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });
}

// Processar ficheiro selecionado
async function handleFileSelect(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Por favor selecione um ficheiro Excel (.xlsx ou .xls)', 'error');
    return;
  }
  
  showLoading('Carregando ficheiro...', 'A processar dados do Excel...');
  
  try {
    uploadedFile = file;
    const result = await window.excelImporter.loadFile(file);
    
    // Guardar dados para uso posterior
    currentHeaders = result.headers;
    detectedTemplate = result.detectedTemplate;
    
    // Mostrar informações do ficheiro
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('rowCount').textContent = result.rowCount;
    document.getElementById('columnCount').textContent = result.headers.length;
    document.getElementById('fileInfo').style.display = 'block';
    
    hideLoading();
    
  } catch (error) {
    hideLoading();
    showToast(`Erro ao carregar ficheiro: ${error.message}`, 'error');
  }
}

// Ir para passo 2 (mapeamento) ou saltar se template detectado
function goToStep2() {
  if (!uploadedFile) {
    showToast('Por favor carregue um ficheiro primeiro', 'error');
    return;
  }
  
  // 🎯 VERIFICAR SE TEMPLATE FOI DETECTADO COM ALTA CONFIANÇA
  if (detectedTemplate && detectedTemplate.confidence >= 0.90) {
    console.log('🎯 Template detectado com alta confiança - saltando mapeamento manual');
    
    // Aplicar mapeamento automaticamente
    window.excelImporter.setMapping(detectedTemplate.mapping);
    
    // Saltar para passo 3 (pré-visualização)
    goToStep3();
    return;
  }
  
  // Ir para mapeamento manual se não há template ou confiança baixa
  currentStep = 2;
  showStep(2);
  
  // Preencher opções de mapeamento
  populateMappingOptions();
  
  // Carregar lista de templates
  loadTemplateSelect();
  
  // Mostrar template detectado se existir (mas com baixa confiança)
  if (detectedTemplate) {
    showDetectedTemplate(detectedTemplate);
  } else {
    // Auto-detectar colunas se não há template
    autoDetectColumns();
  }
}

// Preencher opções de mapeamento
function populateMappingOptions() {
  const headers = window.excelImporter.headers;
  const selects = document.querySelectorAll('.mapping-select');
  
  selects.forEach(select => {
    // Limpar opções existentes (exceto a primeira)
    while (select.children.length > 1) {
      select.removeChild(select.lastChild);
    }
    
    // Adicionar cabeçalhos como opções
    headers.forEach((header, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${header} (Coluna ${index + 1})`;
      select.appendChild(option);
    });
  });
}

// Auto-detectar colunas baseado nos nomes
function autoDetectColumns() {
  const headers = window.excelImporter.headers;
  
  const mappings = {
    'mapPlate': ['matricula', 'matrícula', 'plate', 'placa'],
    'mapCar': ['carro', 'modelo', 'car', 'vehicle', 'veiculo', 'veículo'],
    'mapNotes': ['observacoes', 'observações', 'notes', 'obs', 'comentarios', 'comentários'],
    'mapAddress': ['morada', 'endereco', 'endereço', 'address', 'rua'],
    'mapPhone': ['telefone', 'contacto', 'contato', 'phone', 'telemovel', 'telemóvel'],
    'mapExtra': ['extra', 'outros', 'adicional', 'dados']
  };
  
  Object.entries(mappings).forEach(([selectId, keywords]) => {
    const select = document.getElementById(selectId);
    
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].toLowerCase();
      
      if (keywords.some(keyword => header.includes(keyword))) {
        select.value = i;
        break;
      }
    }
  });
}

// Ir para passo 3 (pré-visualização)
async function goToStep3() {
  // 🎯 SE TEMPLATE DETECTADO, SALTAR VALIDAÇÃO DOS SELECTS HTML
  if (detectedTemplate && detectedTemplate.confidence >= 0.90) {
    console.log('🎯 Template detectado - saltando validação de selects HTML');
    
    // Mapeamento já foi definido automaticamente, prosseguir diretamente
    showLoading('Processando dados...', 'A processar com template personalizado...');
    
    try {
      // Processar dados com template personalizado
      const result = await window.excelImporter.processData();
      processedData = result;
      
      // Mostrar resultados
      showValidationResults(result);
      
      currentStep = 3;
      hideLoading();
      showStep(3);
      
    } catch (error) {
      hideLoading();
      showToast(`Erro ao processar dados: ${error.message}`, 'error');
    }
    
    return;
  }
  
  // VALIDAÇÃO NORMAL PARA MAPEAMENTO MANUAL
  const requiredMappings = ['mapPlate', 'mapCar'];
  const missingMappings = [];
  
  requiredMappings.forEach(id => {
    const select = document.getElementById(id);
    if (!select.value) {
      const label = select.parentElement.querySelector('label').textContent;
      missingMappings.push(label);
    }
  });
  
  if (missingMappings.length > 0) {
    showToast(`Por favor mapeie os campos obrigatórios: ${missingMappings.join(', ')}`, 'error');
    return;
  }
  
  showLoading('Processando dados...', 'A validar e processar informações...');
  
  try {
    // Definir mapeamento
    const mapping = {};
    document.querySelectorAll('.mapping-select').forEach(select => {
      const field = select.id.replace('map', '').toLowerCase();
      mapping[field] = select.value ? parseInt(select.value) : null;
    });
    
    window.excelImporter.setMapping(mapping);
    
    // Processar dados
    const result = window.excelImporter.processData();
    processedData = result;
    
    // Mostrar resultados
    showValidationResults(result);
    
    currentStep = 3;
    hideLoading();
    showStep(3);
    
  } catch (error) {
    hideLoading();
    showToast(`Erro ao processar dados: ${error.message}`, 'error');
  }
}

// Mostrar resultados da validação
function showValidationResults(result) {
  // Estatísticas
  document.getElementById('validCount').textContent = result.data.length;
  document.getElementById('errorCount').textContent = result.errors.length;
  
  // Mostrar erros se existirem
  if (result.errors.length > 0) {
    const errorsContainer = document.getElementById('errorsContainer');
    errorsContainer.innerHTML = '';
    
    result.errors.forEach(error => {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-item';
      errorDiv.innerHTML = `<strong>Linha ${error.row}:</strong> ${error.error}`;
      errorsContainer.appendChild(errorDiv);
    });
    
    document.getElementById('errorsList').style.display = 'block';
  } else {
    document.getElementById('errorsList').style.display = 'none';
  }
  
  // Pré-visualização dos dados válidos
  if (result.data.length > 0) {
    showDataPreview(result.data.slice(0, 10)); // Primeiros 10
  }
  
  // Ativar/desativar botão de importação
  const importBtn = document.getElementById('importBtn');
  importBtn.disabled = result.data.length === 0;
  
  if (result.data.length === 0) {
    importBtn.textContent = '❌ Nenhum dado válido para importar';
  } else {
    importBtn.textContent = `📥 Importar ${result.data.length} serviços`;
  }
}

// Mostrar pré-visualização dos dados
function showDataPreview(data) {
  const headers = ['Matrícula', 'Carro', 'Observações'];
  const fields = ['plate', 'car', 'notes'];
  
  // Cabeçalhos
  const headerRow = document.getElementById('previewHeaders');
  headerRow.innerHTML = '';
  headers.forEach(header => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });
  
  // Dados
  const tbody = document.getElementById('previewBody');
  tbody.innerHTML = '';
  
  data.forEach(row => {
    const tr = document.createElement('tr');
    
    fields.forEach(field => {
      const td = document.createElement('td');
      td.textContent = row[field] || '';
      tr.appendChild(td);
    });
    
    tbody.appendChild(tr);
  });
}

// Importar dados
async function importData() {
  if (!processedData || processedData.data.length === 0) {
    showToast('Nenhum dado válido para importar', 'error');
    return;
  }
  
  showLoading('Importando dados...', `A importar ${processedData.data.length} serviços...`);
  
  try {
    const results = await window.excelImporter.importData(processedData.data);
    
    // Mostrar resultados
    showImportResults(results);
    
    currentStep = 4;
    hideLoading();
    showStep(4);
    
  } catch (error) {
    hideLoading();
    showToast(`Erro na importação: ${error.message}`, 'error');
  }
}

// Mostrar resultados da importação
function showImportResults(results) {
  document.getElementById('successCount').textContent = results.success;
  document.getElementById('failCount').textContent = results.errors;
  
  // Detalhes
  const detailsContainer = document.getElementById('importDetails');
  detailsContainer.innerHTML = '';
  
  if (results.details.length > 0) {
    const successList = results.details.filter(d => d.status === 'success');
    const errorList = results.details.filter(d => d.status === 'error');
    
    if (successList.length > 0) {
      const successDiv = document.createElement('div');
      successDiv.innerHTML = `
        <h5 style="color: #28a745;">✅ Importados com Sucesso (${successList.length})</h5>
        <div style="max-height: 150px; overflow-y: auto; background: #d4edda; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
          ${successList.map(s => `<div>• ${s.plate}</div>`).join('')}
        </div>
      `;
      detailsContainer.appendChild(successDiv);
    }
    
    if (errorList.length > 0) {
      const errorDiv = document.createElement('div');
      errorDiv.innerHTML = `
        <h5 style="color: #dc3545;">❌ Erros na Importação (${errorList.length})</h5>
        <div style="max-height: 150px; overflow-y: auto; background: #f8d7da; padding: 10px; border-radius: 4px;">
          ${errorList.map(e => `<div>• ${e.plate}: ${e.error}</div>`).join('')}
        </div>
      `;
      detailsContainer.appendChild(errorDiv);
    }
  }
}

// Finalizar importação
function finishImport() {
  closeExcelImportModal();
  
  // Recarregar dados para mostrar os novos serviços
  if (typeof load === 'function') {
    load().then(() => {
      renderAll();
      showToast('Importação concluída! Os novos serviços estão na lista "Serviços por Agendar"', 'success');
    });
  }
}

// Iniciar nova importação
function startNewImport() {
  resetImportModal();
}

// Voltar para passo anterior
function goToStep1() {
  currentStep = 1;
  showStep(1);
}

function goToStep2FromStep3() {
  currentStep = 2;
  showStep(2);
}

// Mostrar passo específico
function showStep(stepNumber) {
  for (let i = 1; i <= 4; i++) {
    const step = document.getElementById(`step${i}`);
    if (step) step.style.display = i === stepNumber ? 'block' : 'none';
  }
  document.getElementById('loadingStep').style.display = 'none';
}

// Mostrar loading
function showLoading(title, subtitle) {
  document.getElementById('loadingText').textContent = title;
  document.getElementById('loadingSubtext').textContent = subtitle;
  
  for (let i = 1; i <= 4; i++) {
    const step = document.getElementById(`step${i}`);
    if (step) step.style.display = 'none';
  }
  
  document.getElementById('loadingStep').style.display = 'block';
}

// Esconder loading
function hideLoading() {
  document.getElementById('loadingStep').style.display = 'none';
  showStep(currentStep);
}

// Descarregar template
function downloadTemplate() {
  try {
    const wb = window.excelImporter.generateTemplate();
    XLSX.writeFile(wb, 'Template_Importacao_Servicos.xlsx');
    showToast('Template descarregado com sucesso!', 'success');
  } catch (error) {
    showToast(`Erro ao gerar template: ${error.message}`, 'error');
  }
}

// ===== FUNÇÕES DE GESTÃO DE TEMPLATES =====

// Carregar lista de templates no select
function loadTemplateSelect() {
  const select = document.getElementById('templateSelect');
  const templates = window.templateManager?.getAllTemplates() || [];
  
  // Limpar opções existentes (exceto a primeira)
  while (select.children.length > 1) {
    select.removeChild(select.lastChild);
  }
  
  // Adicionar templates
  templates.forEach(template => {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = `${template.name}${template.isSystem ? ' (Sistema)' : ''}`;
    select.appendChild(option);
  });
}

// Mostrar template detectado automaticamente
function showDetectedTemplate(detected) {
  const alert = document.getElementById('detectedTemplateAlert');
  const nameEl = document.getElementById('detectedTemplateName');
  const confidenceEl = document.getElementById('detectedTemplateConfidence');
  
  nameEl.textContent = `Template: ${detected.template.name}`;
  confidenceEl.textContent = `Confiança: ${Math.round(detected.confidence * 100)}%`;
  
  alert.style.display = 'block';
}

// Aceitar template detectado
function acceptDetectedTemplate() {
  if (detectedTemplate) {
    applyTemplateMapping(detectedTemplate.mapping);
    document.getElementById('detectedTemplateAlert').style.display = 'none';
    showToast(`Template "${detectedTemplate.template.name}" aplicado com sucesso!`, 'success');
  }
}

// Rejeitar template detectado
function rejectDetectedTemplate() {
  document.getElementById('detectedTemplateAlert').style.display = 'none';
  autoDetectColumns(); // Voltar à detecção automática
}

// Aplicar template selecionado
function applySelectedTemplate() {
  const select = document.getElementById('templateSelect');
  const templateId = select.value;
  
  if (!templateId) {
    showToast('Por favor selecione um template', 'error');
    return;
  }
  
  const result = window.templateManager?.applyTemplate(templateId, currentHeaders);
  if (result) {
    applyTemplateMapping(result.mapping);
    showToast(`Template "${result.template.name}" aplicado com sucesso!`, 'success');
  } else {
    showToast('Erro ao aplicar template', 'error');
  }
}

// Aplicar mapeamento de template
function applyTemplateMapping(mapping) {
  Object.entries(mapping).forEach(([field, columnIndex]) => {
    const select = document.getElementById(`map${field.charAt(0).toUpperCase() + field.slice(1)}`);
    if (select && columnIndex !== null) {
      select.value = columnIndex;
    }
  });
}

// Guardar mapeamento atual como template
function saveCurrentAsTemplate() {
  const name = prompt('Nome do template:');
  if (!name) return;
  
  const description = prompt('Descrição (opcional):') || '';
  
  // Obter mapeamento atual
  const mapping = {};
  document.querySelectorAll('.mapping-select').forEach(select => {
    const field = select.id.replace('map', '').toLowerCase();
    mapping[field] = select.value ? parseInt(select.value) : null;
  });
  
  // Criar template
  const template = window.templateManager?.createTemplate(name, description, currentHeaders, mapping);
  if (template) {
    loadTemplateSelect(); // Recarregar lista
    showToast(`Template "${name}" criado com sucesso!`, 'success');
  } else {
    showToast('Erro ao criar template', 'error');
  }
}

// Abrir gestor de templates
function openTemplateManager() {
  document.getElementById('templateManagerModal').style.display = 'flex';
  loadTemplateList();
}

// Fechar gestor de templates
function closeTemplateManager() {
  document.getElementById('templateManagerModal').style.display = 'none';
}

// Carregar lista de templates no gestor
function loadTemplateList() {
  const container = document.getElementById('templateList');
  const templates = window.templateManager?.getAllTemplates() || [];
  
  container.innerHTML = '';
  
  if (templates.length === 0) {
    container.innerHTML = '<p>Nenhum template encontrado.</p>';
    return;
  }
  
  templates.forEach(template => {
    const item = document.createElement('div');
    item.className = 'template-item';
    
    item.innerHTML = `
      <div class="template-info">
        <h4>
          ${template.name}
          ${template.isSystem ? '<span class="template-badge">Sistema</span>' : ''}
        </h4>
        <p>${template.description || 'Sem descrição'}</p>
        <small>Colunas: ${template.headers.join(', ')}</small>
      </div>
      <div class="template-actions-item">
        ${!template.isSystem ? `
          <button class="btn-small secondary" onclick="editTemplate('${template.id}')">✏️ Editar</button>
          <button class="btn-small secondary" onclick="deleteTemplate('${template.id}')">🗑️ Eliminar</button>
        ` : ''}
        <button class="btn-small primary" onclick="useTemplate('${template.id}')">📋 Usar</button>
      </div>
    `;
    
    container.appendChild(item);
  });
}

// Usar template do gestor
function useTemplate(templateId) {
  const result = window.templateManager?.applyTemplate(templateId, currentHeaders);
  if (result) {
    applyTemplateMapping(result.mapping);
    closeTemplateManager();
    showToast(`Template "${result.template.name}" aplicado!`, 'success');
  }
}

// Eliminar template
function deleteTemplate(templateId) {
  if (confirm('Tem certeza que deseja eliminar este template?')) {
    const deleted = window.templateManager?.deleteTemplate(templateId);
    if (deleted) {
      loadTemplateList();
      loadTemplateSelect();
      showToast(`Template "${deleted.name}" eliminado!`, 'success');
    }
  }
}

// Mostrar tab do gestor de templates
function showTemplateTab(tabName) {
  // Atualizar botões
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  // Mostrar tab
  document.querySelectorAll('.template-tab').forEach(tab => {
    tab.style.display = 'none';
  });
  
  if (tabName === 'list') {
    document.getElementById('templateListTab').style.display = 'block';
    loadTemplateList();
  } else if (tabName === 'create') {
    document.getElementById('templateCreateTab').style.display = 'block';
  }
}

// Cancelar formulário de template
function cancelTemplateForm() {
  document.getElementById('templateForm').reset();
  showTemplateTab('list');
}

// Configurar formulário de template
function setupTemplateForm() {
  document.getElementById('templateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = document.getElementById('templateName').value;
    const description = document.getElementById('templateDescription').value;
    const headersText = document.getElementById('templateHeaders').value;
    
    const headers = headersText.split(',').map(h => h.trim()).filter(h => h);
    
    if (headers.length === 0) {
      showToast('Por favor insira pelo menos um cabeçalho', 'error');
      return;
    }
    
    // Criar mapeamento básico (sequencial)
    const mapping = {};
    const fields = ['plate', 'car', 'notes', 'address', 'phone', 'extra'];
    fields.forEach((field, index) => {
      mapping[field] = index < headers.length ? index : null;
    });
    
    const template = window.templateManager?.createTemplate(name, description, headers, mapping);
    if (template) {
      document.getElementById('templateForm').reset();
      showTemplateTab('list');
      showToast(`Template "${name}" criado com sucesso!`, 'success');
    } else {
      showToast('Erro ao criar template', 'error');
    }
  });
}

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  setupDragAndDrop();
  setupFileInput();
  setupTemplateForm();
});
