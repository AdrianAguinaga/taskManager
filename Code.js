/**
 * Tablero LIDE - Versión Final y Comentada (con auto-reparación de encabezados)
 * Este archivo contiene toda la lógica del lado del servidor (backend).
 */

// --- CONFIGURACIÓN PRINCIPAL ---
const SPREADSHEET_ID = ''; // Opcional: Dejar vacío si el script está vinculado a la hoja.
const SHEET_NAME = 'Tasks'; // Nombre de la hoja donde se guardan las tareas.
const SECRET_PASSWORD = '4865'; // Contraseña para crear, editar y eliminar tareas.

// =================================================================
// SERVIDOR WEB Y UTILIDADES
// =================================================================

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Tablero LIDE')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// =================================================================
// API - FUNCIONES LLAMADAS DESDE EL FRONTEND
// =================================================================

function apiGetTasks() {
  try {
    const sh = _getSheet();
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return [];

    const dataRange = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn());
    const data = dataRange.getValues();

    const tasks = data.map((row, i) => ({
      id: row[0],
      title: row[1],
      description: row[2],
      status: row[3],
      priority: row[4],
      assignee: row[5] || '',
      createdAt: row[6] instanceof Date ? row[6].toISOString() : row[6],
      updatedAt: row[7] instanceof Date ? row[7].toISOString() : row[7],
      order: Number(row[8]) || (i + 1),
      needsReview: row[9] === true // Lee desde la columna J
    }));

    return tasks.filter(task => task.id);

  } catch (error) {
    console.error('ERROR en apiGetTasks:', error.stack);
    throw new Error('No se pudieron cargar las tareas.');
  }
}

function apiCreateTask(data) {
  try {
    if (!data || data.password !== SECRET_PASSWORD) throw new Error('Contraseña incorrecta.');
    
    const task = data.task;
    if (!task || !task.title) throw new Error('El título es obligatorio.');
    
    const sh = _getSheet();
    const newId = _getNextId(sh);
    const now = new Date();
    
    sh.appendRow([
      newId,
      task.title,
      task.description || '',
      normalizeStatus_(task.status),
      normalizePriority_(task.priority),
      task.assignee || '',
      now, // CreatedAt
      now, // UpdatedAt
      1,   // Order
      task.needsReview === true // CAMBIO: Se guarda el valor del checkbox
    ]);
    
    return { id: newId };
    
  } catch (error) {
    console.error('Error en apiCreateTask:', error);
    throw new Error(error.message);
  }
}

function apiUpdateTask(data) {
  try {
    if (!data || data.password !== SECRET_PASSWORD) throw new Error('Contraseña incorrecta.');
    
    const task = data.task;
    if (!task.id) throw new Error('ID de tarea requerido.');

    const sh = _getSheet();
    const finder = sh.getRange('A:A').createTextFinder(String(task.id)).matchEntireCell(true).findNext();
    
    if (!finder) throw new Error('Tarea no encontrada.');
    
    const row = finder.getRow();
    
    sh.getRange(row, 2, 1, 5).setValues([[
        task.title,
        task.description,
        normalizeStatus_(task.status),
        normalizePriority_(task.priority),
        task.assignee
    ]]);
    sh.getRange(row, 8).setValue(new Date()); // UpdatedAt
    // CAMBIO: Se actualiza la columna de la bandera de revisión
    sh.getRange(row, 10).setValue(task.needsReview === true); 
    
    return { ok: true };
    
  } catch (error) {
    console.error('Error en apiUpdateTask:', error);
    throw new Error(error.message);
  }
}

function apiMoveTask(id, newStatus) {
  try {
    const sh = _getSheet();
    const finder = sh.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();

    if (!finder) throw new Error('Tarea no encontrada.');
    
    const row = finder.getRow();
    sh.getRange(row, 4).setValue(normalizeStatus_(newStatus));
    sh.getRange(row, 8).setValue(new Date());
    
    return { ok: true };
    
  } catch (error) {
    console.error('Error en apiMoveTask:', error);
    throw new Error(error.message);
  }
}

function apiDeleteTask(data) {
  try {
    if (!data || data.password !== SECRET_PASSWORD) throw new Error('Contraseña incorrecta.');
    
    const id = data.id;
    const sh = _getSheet();
    const finder = sh.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();

    if (!finder) throw new Error('Tarea no encontrada.');
    
    sh.deleteRow(finder.getRow());
    return { ok: true };
    
  } catch (error) {
    console.error('Error en apiDeleteTask:', error);
    throw new Error(error.message);
  }
}

function apiAssignTaskToUser(taskId, userName) {
  try {
    if (!taskId || !userName) throw new Error('Se requiere ID y nombre.');
    
    const sh = _getSheet();
    const finder = sh.getRange('A:A').createTextFinder(String(taskId)).matchEntireCell(true).findNext();

    if (!finder) throw new Error('Tarea no encontrada.');
    
    const row = finder.getRow();
    const assigneeRange = sh.getRange(row, 6);
    let currentAssignees = assigneeRange.getValue().toString().trim();
    
    const assigneesList = currentAssignees.split(',').map(name => name.trim()).filter(Boolean);
    if (assigneesList.includes(userName)) return { ok: true };
    
    const newAssignees = currentAssignees ? `${currentAssignees}, ${userName}` : userName;
    
    assigneeRange.setValue(newAssignees);
    sh.getRange(row, 8).setValue(new Date());
    
    return { ok: true };
    
  } catch (error) {
    console.error('Error en apiAssignTaskToUser:', error);
    throw new Error(error.message);
  }
}

function apiToggleReviewFlag(taskId) {
  try {
    const sh = _getSheet();
    const finder = sh.getRange('A:A').createTextFinder(String(taskId)).matchEntireCell(true).findNext();

    if (!finder) throw new Error('Tarea no encontrada.');
    
    const row = finder.getRow();
    const flagRange = sh.getRange(row, 10);
    const currentValue = flagRange.getValue();
    
    flagRange.setValue(!currentValue);
    sh.getRange(row, 8).setValue(new Date());
    
    return { ok: true, newState: !currentValue };
    
  } catch (error) {
    console.error('Error en apiToggleReviewFlag:', error);
    throw new Error(error.message);
  }
}

// =================================================================
// FUNCIONES AUXILIARES INTERNAS (Helpers)
// =================================================================

function _getSpreadsheet() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function _getSheet() {
  const ss = _getSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);

  const requiredHeaders = [
    'ID', 'Title', 'Description', 'Status', 'Priority', 
    'Assignee', 'CreatedAt', 'UpdatedAt', 'Order', 'NeedsReview'
  ];

  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders])
      .setFontWeight('bold').setBackground('#f0f0f0');
    sh.setFrozenRows(1);
  } else {
    const currentHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    requiredHeaders.forEach((header, i) => {
      if (currentHeaders[i] !== header) {
        sh.getRange(1, i + 1).setValue(header);
      }
    });
  }
  
  return sh;
}

function _getNextId(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return 1;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const maxId = Math.max(0, ...ids.map(id => Number(id) || 0));
  return maxId + 1;
}

function normalizeStatus_(s) {
  const key = String(s || '').toLowerCase().trim();
  const map = {'backlog': 'Backlog', 'in progress': 'In Progress', 'in-progress': 'In Progress', 'review': 'Review', 'done': 'Done'};
  return map[key] || 'Backlog';
}

function normalizePriority_(p) {
  const key = String(p || '').toLowerCase().trim();
  const map = {'high': 'High', 'low': 'Low'};
  return map[key] || 'Medium';
}

// =================================================================
// MENÚ DE LA HOJA DE CÁLCULO
// =================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tablero LIDE')
    .addItem('Verificar/Crear Hoja "Tasks"', '_getSheet')
    .addToUi();
}
