/**
 * Tablero LIDE — Versión Debug Simplificada
 */

const SPREADSHEET_ID = '';
const SHEET_NAME = 'Tasks';
const STATUSES = ['Backlog', 'In Progress', 'Review', 'Done'];

function normalizeStatus_(s) {
  const statusMap = {
    'backlog': 'Backlog',
    'in progress': 'In Progress', 
    'in-progress': 'In Progress',
    'review': 'Review',
    'done': 'Done'
  };
  const key = String(s || '').toLowerCase().trim();
  return statusMap[key] || 'Backlog';
}

function normalizePriority_(p) {
  const priorityMap = {
    'high': 'High',
    'medium': 'Medium',
    'low': 'Low'
  };
  const key = String(p || '').toLowerCase().trim();
  return priorityMap[key] || 'Medium';
}

/* ====== WebApp ====== */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Tablero LIDE')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LIDE')
    .addItem('Crear hoja Tasks', 'setup')
    .addToUi();
}

function setup() { 
  _getSheet(); 
  return 'OK'; 
}

/* ====== API ====== */
function apiPing() { 
  return 'pong'; 
}

function apiGetTasks() {
  try {
    console.log('=== INICIO apiGetTasks ===');
    
    // 1. Obtener la hoja
    const sh = _getSheet();
    console.log('Hoja obtenida:', sh.getName());
    
    // 2. Obtener datos básicos
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    console.log('Última fila:', lastRow, 'Última columna:', lastCol);
    
    if (lastRow <= 1) {
      console.log('No hay datos más allá de los encabezados');
      return [];
    }
    
    // 3. Obtener todos los datos
    const allData = sh.getRange(1, 1, lastRow, lastCol).getValues();
    console.log('Datos obtenidos - Total filas:', allData.length);
    console.log('Encabezados:', allData[0]);
    
    // 4. Procesar cada fila de datos
    const tasks = [];
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      console.log(`Fila ${i}:`, row);
      
      // Crear tarea usando índices fijos (más confiable)
      const task = {
        id: row[0],              // ID
        title: row[1],           // Title  
        description: row[2],     // Description
        status: normalizeStatus_(row[3]),     // Status
        priority: normalizePriority_(row[4]), // Priority
        assignee: row[5] || '',  // Assignee
        // --- INICIO DE LA CORRECCIÓN ---
        createdAt: row[6] instanceof Date ? row[6].toISOString() : row[6],
        updatedAt: row[7] instanceof Date ? row[7].toISOString() : row[7],
        // --- FIN DE LA CORRECCIÓN ---
        order: Number(row[8]) || i // Order
      };
      
      console.log('Tarea creada:', task);
      
      // Solo agregar si tiene ID válido
      if (task.id) {
        tasks.push(task);
      }
    }
    
    console.log('Total tareas válidas:', tasks.length);
    console.log('=== FIN apiGetTasks ===');
    
    return tasks;
    
  } catch (error) {
    console.error('ERROR en apiGetTasks:', error);
    console.error('Stack trace:', error.stack);
    return [];
  }
}

function apiCreateTask(data) {
  try {
    // 1. Definir y verificar la contraseña
    const SECRET_PASSWORD = 'LIDE2025'; // <-- ¡IMPORTANTE! Cambia esta contraseña por una segura.
    
    if (!data || data.password !== SECRET_PASSWORD) {
      throw new Error('Contraseña incorrecta.');
    }

    // 2. Extraer el objeto de la tarea del objeto 'data'
    const task = data.task;
    console.log('=== CREANDO TAREA (CONTRASEÑA VÁLIDA) ===', task);
    
    if (!task || !task.title) {
      throw new Error('Título requerido');
    }
    
    const sh = _getSheet();
    const newId = _getNextId(sh);
    const now = new Date();
    
    const newRow = [
      newId,                              // ID
      task.title,                        // Title
      task.description || '',            // Description
      normalizeStatus_(task.status),     // Status
      normalizePriority_(task.priority), // Priority
      task.assignee || '',               // Assignee
      now,                               // CreatedAt
      now,                               // UpdatedAt
      1                                  // Order
    ];
    
    console.log('Agregando fila:', newRow);
    sh.appendRow(newRow);
    
    console.log('Tarea creada con ID:', newId);
    return { id: newId };
    
  } catch (error) {
    console.error('Error en apiCreateTask:', error);
    // Devuelve un mensaje de error claro, ya sea por contraseña o por otra causa.
    throw new Error(error.message);
  }
}

function apiUpdateTask(task) {
  try {
    console.log('=== ACTUALIZANDO TAREA ===', task);
    
    if (!task.id) throw new Error('ID requerido');
    
    const sh = _getSheet();
    const data = sh.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (Number(data[i][0]) === Number(task.id)) {
        console.log(`Actualizando fila ${i + 1}`);
        
        if (task.title !== undefined) sh.getRange(i + 1, 2).setValue(task.title);
        if (task.description !== undefined) sh.getRange(i + 1, 3).setValue(task.description);
        if (task.status !== undefined) sh.getRange(i + 1, 4).setValue(normalizeStatus_(task.status));
        if (task.priority !== undefined) sh.getRange(i + 1, 5).setValue(normalizePriority_(task.priority));
        if (task.assignee !== undefined) sh.getRange(i + 1, 6).setValue(task.assignee);
        
        sh.getRange(i + 1, 8).setValue(new Date()); // UpdatedAt
        
        return { ok: true };
      }
    }
    
    throw new Error('Tarea no encontrada');
    
  } catch (error) {
    console.error('Error en apiUpdateTask:', error);
    throw new Error('Error al actualizar: ' + error.message);
  }
}

function apiMoveTask(id, newStatus) {
  try {
    console.log('=== MOVIENDO TAREA ===', id, 'a', newStatus);
    
    const sh = _getSheet();
    const data = sh.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (Number(data[i][0]) === Number(id)) {
        sh.getRange(i + 1, 4).setValue(normalizeStatus_(newStatus)); // Status
        sh.getRange(i + 1, 8).setValue(new Date()); // UpdatedAt
        return { ok: true };
      }
    }
    
    throw new Error('Tarea no encontrada');
    
  } catch (error) {
    console.error('Error en apiMoveTask:', error);
    throw new Error('Error al mover: ' + error.message);
  }
}

function apiDeleteTask(id) {
  try {
    console.log('=== ELIMINANDO TAREA ===', id);
    
    const sh = _getSheet();
    const data = sh.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (Number(data[i][0]) === Number(id)) {
        sh.deleteRow(i + 1);
        return { ok: true };
      }
    }
    
    throw new Error('Tarea no encontrada');
    
  } catch (error) {
    console.error('Error en apiDeleteTask:', error);
    throw new Error('Error al eliminar: ' + error.message);
  }
}

/* ====== Helpers ====== */
function _getSpreadsheet() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function _getSheet() {
  const ss = _getSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  
  if (!sh) {
    console.log('Creando hoja nueva');
    sh = ss.insertSheet(SHEET_NAME);
    
    // Crear encabezados
    sh.getRange(1, 1, 1, 9).setValues([[
      'ID', 'Title', 'Description', 'Status', 'Priority', 
      'Assignee', 'CreatedAt', 'UpdatedAt', 'Order'
    ]]);
    
    // Formatear encabezados
    const headerRange = sh.getRange(1, 1, 1, 9);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f0f0f0');
    sh.setFrozenRows(1);
  }
  
  return sh;
}

function _getNextId(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return 1;
  
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const maxId = Math.max(...ids.map(id => Number(id) || 0));
  return maxId + 1;
}

// Función de test para ejecutar manualmente
function testGetTasks() {
  const result = apiGetTasks();
  console.log('RESULTADO FINAL:', result);
  return result;
}