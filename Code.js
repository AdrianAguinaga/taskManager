/**
 * Tablero LIDE - Backend (Google Apps Script)
 * Incluye archivado de tareas “Done” -> “Historico”.
 */

// --- CONFIGURACIÓN PRINCIPAL ---
const SPREADSHEET_ID = '';          // Dejar vacío si el script está vinculado
const SHEET_NAME     = 'Tasks';      // Hoja con datos
const SECRET_PASSWORD = '4865';      // Contraseña

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
      needsReview: row[9] === true
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
      task.needsReview === true
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
    if (!task || !task.id) throw new Error('ID requerido.');

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

/**
 * NUEVO: Archiva todas las tareas con estado "Done".
 * Las mueve a estado "Historico" (o al valor recibido en newStatus).
 * Requiere contraseña. Devuelve { count }.
 */
function apiArchiveDone(data) {
  try {
    if (!data || data.password !== SECRET_PASSWORD) throw new Error('Contraseña incorrecta.');
    const target = normalizeStatus_(data.newStatus || 'Historico'); // normaliza por si mandan “almacen”
    const sh = _getSheet();
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return { count: 0 };

    const range = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn());
    const values = range.getValues();
    let count = 0, now = new Date();

    for (let i = 0; i < values.length; i++) {
      const status = String(values[i][3] || '').toLowerCase();
      if (status === 'done') {
        values[i][3] = target; // Status -> Historico
        values[i][7] = now;    // UpdatedAt
        count++;
      }
    }

    range.setValues(values);
    return { count };
  } catch (error) {
    console.error('Error en apiArchiveDone:', error);
    throw new Error(error.message);
  }
}

// =================================================================
// HOJA Y UTILIDADES
// =================================================================
function _getSpreadsheet() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActive();
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
    // Auto-reparación de encabezados
    if (currentHeaders.length < requiredHeaders.length ||
        requiredHeaders.some((h, i) => currentHeaders[i] !== h)) {
      sh.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders])
        .setFontWeight('bold').setBackground('#f0f0f0');
      sh.setFrozenRows(1);
    }
  }
  // Asegura al menos 10 columnas
  if (sh.getLastColumn() < requiredHeaders.length) {
    sh.insertColumnsAfter(sh.getLastColumn(), requiredHeaders.length - sh.getLastColumn());
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
  const map = {
    'backlog': 'Backlog',
    'in progress': 'In Progress',
    'in-progress': 'In Progress',
    'review': 'Review',
    'done': 'Done',
    // Nuevos sinónimos de archivo/almacén
    'historico': 'Historico',
    'histórico': 'Historico',
    'almacen': 'Historico',
    'almacén': 'Historico',
    'archive': 'Historico',
    'archived': 'Historico'
  };
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
