/**
 * Tablero LIDE - Versión Final y Comentada
 * Este archivo contiene toda la lógica del lado del servidor (backend).
 * Gestiona la lectura y escritura de tareas en la hoja de cálculo de Google.
 */

// --- CONFIGURACIÓN PRINCIPAL ---
const SPREADSHEET_ID = ''; // Opcional: Dejar vacío si el script está vinculado a la hoja.
const SHEET_NAME = 'Tasks'; // Nombre de la hoja donde se guardan las tareas.
const SECRET_PASSWORD = 'LIDE2025'; // Contraseña para crear, editar y eliminar tareas.

// =================================================================
// SERVIDOR WEB Y UTILIDADES
// =================================================================

/**
 * Se ejecuta cuando un usuario visita la URL de la aplicación web.
 * Sirve el archivo principal HTML.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Tablero LIDE')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Permite incluir otros archivos (como CSS y JS) dentro del HTML principal.
 * Es una práctica estándar en Apps Script para organizar el código.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// =================================================================
// API - FUNCIONES LLAMADAS DESDE EL FRONTEND
// Estas funciones son los puntos de contacto entre la interfaz y la hoja de cálculo.
// =================================================================

/**
 * [API] Obtiene todas las tareas de la hoja de cálculo.
 * Es la función que se llama cada vez que la aplicación se carga o actualiza.
 * @returns {Array<Object>} Un array de objetos, donde cada objeto es una tarea.
 */
function apiGetTasks() {
  try {
    const sh = _getSheet();
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return []; // No hay tareas si solo está el encabezado.

    const dataRange = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn());
    const data = dataRange.getValues();

    // Convierte cada fila del spreadsheet en un objeto de tarea estructurado.
    const tasks = data.map((row, i) => ({
      id: row[0],
      title: row[1],
      description: row[2],
      status: row[3],
      priority: row[4],
      assignee: row[5] || '',
      // Convierte las fechas a formato ISO para enviarlas de forma segura al frontend.
      createdAt: row[6] instanceof Date ? row[6].toISOString() : row[6],
      updatedAt: row[7] instanceof Date ? row[7].toISOString() : row[7],
      order: Number(row[8]) || (i + 1)
    }));

    return tasks.filter(task => task.id); // Devuelve solo tareas con un ID válido.

  } catch (error) {
    console.error('ERROR en apiGetTasks:', error.stack);
    throw new Error('No se pudieron cargar las tareas desde la hoja de cálculo.');
  }
}

/**
 * [API] Crea una nueva tarea en la hoja de cálculo.
 * @param {Object} data - Contiene el objeto 'task' y la 'password'.
 * @returns {Object} El ID de la nueva tarea.
 */
function apiCreateTask(data) {
  try {
    if (!data || data.password !== SECRET_PASSWORD) throw new Error('Contraseña incorrecta.');
    
    const task = data.task;
    if (!task || !task.title) throw new Error('El título es un campo obligatorio.');
    
    const sh = _getSheet();
    const newId = _getNextId(sh);
    const now = new Date();
    
    // Añade la nueva fila al final de la hoja.
    sh.appendRow([
      newId,
      task.title,
      task.description || '',
      normalizeStatus_(task.status),
      normalizePriority_(task.priority),
      task.assignee || '',
      now, // CreatedAt
      now, // UpdatedAt
      1    // Order (se puede usar para ordenar en el futuro)
    ]);
    
    return { id: newId };
    
  } catch (error) {
    console.error('Error en apiCreateTask:', error);
    throw new Error(error.message);
  }
}
/**
 * [API] Asigna un usuario a una tarea de forma rápida y sin contraseña.
 * @param {number} taskId - El ID de la tarea.
 * @param {string} userName - El nombre del usuario a añadir.
 */
function apiAssignTaskToUser(taskId, userName) {
  try {
    if (!taskId || !userName) {
      throw new Error('Se requiere el ID de la tarea y el nombre de usuario.');
    }
    
    const sh = _getSheet();
    const finder = sh.getRange('A:A').createTextFinder(String(taskId)).matchEntireCell(true).findNext();

    if (!finder) {
      throw new Error(`Tarea con ID ${taskId} no encontrada.`);
    }
    
    const row = finder.getRow();
    const assigneeRange = sh.getRange(row, 6); // Columna 'F' de asignados
    let currentAssignees = assigneeRange.getValue().toString().trim();
    
    // Verifica si el nombre ya está en la lista para no duplicarlo
    const assigneesList = currentAssignees.split(',').map(name => name.trim()).filter(Boolean);
    if (assigneesList.includes(userName)) {
      return { ok: true, message: 'El usuario ya estaba asignado.' }; // Ya está asignado, no hacer nada.
    }
    
    // Añade el nuevo nombre a la lista
    const newAssignees = currentAssignees ? `${currentAssignees}, ${userName}` : userName;
    
    assigneeRange.setValue(newAssignees);
    sh.getRange(row, 8).setValue(new Date()); // Actualiza la fecha 'UpdatedAt'
    
    return { ok: true };
    
  } catch (error) {
    console.error('Error en apiAssignTaskToUser:', error);
    throw new Error(error.message);
  }
}


/**
 * [API] Actualiza una tarea existente. Usa TextFinder para ser muy rápido.
 * @param {Object} data - Contiene el objeto 'task' a actualizar y la 'password'.
 */
function apiUpdateTask(data) {
  try {
    if (!data || data.password !== SECRET_PASSWORD) throw new Error('Contraseña incorrecta.');
    
    const task = data.task;
    if (!task.id) throw new Error('ID de tarea requerido para actualizar.');

    const sh = _getSheet();
    // TextFinder es mucho más rápido que iterar por todas las filas.
    const finder = sh.getRange('A:A').createTextFinder(String(task.id)).matchEntireCell(true).findNext();
    
    if (!finder) throw new Error(`Tarea con ID ${task.id} no encontrada.`);
    
    const row = finder.getRow();
    
    // Actualiza múltiples celdas a la vez para mayor eficiencia.
    sh.getRange(row, 2, 1, 5).setValues([[
        task.title,
        task.description,
        normalizeStatus_(task.status),
        normalizePriority_(task.priority),
        task.assignee
    ]]);
    sh.getRange(row, 8).setValue(new Date()); // Actualiza la fecha 'UpdatedAt'.
    
    return { ok: true };
    
  } catch (error) {
    console.error('Error en apiUpdateTask:', error);
    throw new Error(error.message);
  }
}

/**
 * [API] Mueve una tarea a un nuevo estado (ej. cuando se arrastra a otra columna).
 * Esta función no pide contraseña para una experiencia de usuario fluida.
 * @param {number} id - El ID de la tarea a mover.
 * @param {string} newStatus - El nuevo estado de la tarea.
 */
function apiMoveTask(id, newStatus) {
  try {
    const sh = _getSheet();
    const finder = sh.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();

    if (!finder) throw new Error(`Tarea con ID ${id} no encontrada para mover.`);
    
    const row = finder.getRow();
    sh.getRange(row, 4).setValue(normalizeStatus_(newStatus)); // Actualiza el estado.
    sh.getRange(row, 8).setValue(new Date()); // Actualiza la fecha 'UpdatedAt'.
    
    return { ok: true };
    
  } catch (error) {
    console.error('Error en apiMoveTask:', error);
    throw new Error(error.message);
  }
}

/**
 * [API] Elimina una tarea de la hoja de cálculo.
 * @param {Object} data - Contiene el 'id' de la tarea y la 'password'.
 */
function apiDeleteTask(data) {
  try {
    if (!data || data.password !== SECRET_PASSWORD) throw new Error('Contraseña incorrecta.');
    
    const id = data.id;
    const sh = _getSheet();
    const finder = sh.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();

    if (!finder) throw new Error(`Tarea con ID ${id} no encontrada para eliminar.`);
    
    sh.deleteRow(finder.getRow());
    return { ok: true };
    
  } catch (error) {
    console.error('Error en apiDeleteTask:', error);
    throw new Error(error.message);
  }
}


// =================================================================
// FUNCIONES AUXILIARES INTERNAS (Helpers)
// =================================================================

/**
 * Obtiene la hoja de cálculo. Si se proveyó un ID, la abre. Si no, usa la activa.
 */
function _getSpreadsheet() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Obtiene la hoja llamada 'Tasks'. Si no existe, la crea con los encabezados correctos.
 * Esta función hace que el script sea auto-configurable.
 * @returns {Sheet} El objeto de la hoja.
 */
function _getSheet() {
  const ss = _getSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    const headers = [
      'ID', 'Title', 'Description', 'Status', 'Priority', 
      'Assignee', 'CreatedAt', 'UpdatedAt', 'Order'
    ];
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#f0f0f0');
    sh.setFrozenRows(1);
    SpreadsheetApp.flush(); // Asegura que los cambios se guarden.
  }
  
  return sh;
}

/**
 * Calcula el siguiente ID disponible basándose en el ID más alto existente.
 * @param {Sheet} sh - La hoja de la que se leerán los IDs.
 * @returns {number} El siguiente ID numérico.
 */
function _getNextId(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return 1;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const maxId = Math.max(0, ...ids.map(id => Number(id) || 0));
  return maxId + 1;
}

// Funciones para estandarizar los valores de estado y prioridad.
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

/**
 * Se ejecuta cuando se abre la hoja de cálculo.
 * Añade un menú personalizado para configurar la hoja fácilmente.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tablero LIDE')
    .addItem('Crear hoja "Tasks"', '_getSheet')
    .addToUi();
}