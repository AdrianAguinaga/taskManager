/**
 * Tablero LIDE - Backend (Google Apps Script)
 * Incluye archivado de tareas “Done/Hecho” -> “Historico”.
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
/* API - FUNCIONES LLAMADAS DESDE EL FRONTEND */
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

/**
 * Cambia el Status de una tarea (solo Status + UpdatedAt).
 * Pensado para drag & drop.
 */
function apiMoveTaskStatus(taskId, newStatus) {
  try {
    if (!taskId) throw new Error('ID requerido.');

    const sh = _getSheet();
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) throw new Error('No hay tareas.');

    // Buscar fila por ID
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    let rowIndex = -1;
    for (let i = 0; i < ids.length; i++) {
      if (Number(ids[i][0]) === Number(taskId)) { rowIndex = i + 2; break; }
    }
    if (rowIndex === -1) throw new Error('Tarea no encontrada.');

    const statusNorm = normalizeStatus_(newStatus);
    sh.getRange(rowIndex, 4).setValue(statusNorm); // Columna D: Status
    sh.getRange(rowIndex, 8).setValue(new Date()); // Columna H: UpdatedAt

    return { ok: true, status: statusNorm };
  } catch (e) {
    console.error('apiMoveTaskStatus:', e);
    throw new Error(e.message || String(e));
  }
}

/** 👉 Alias para el frontend actual (AppJs llama a apiMoveTask). */
function apiMoveTask(taskId, newStatus) {
  return apiMoveTaskStatus(taskId, newStatus);
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
 * Archiva todas las tareas "Done/Hecho" -> "Historico" y apaga NeedsReview.
 * - Busca columnas por NOMBRE de encabezado (Status/UpdatedAt/NeedsReview)
 * - Quita validación de datos en la celda Status (si impide escribir "Historico")
 * - Cuenta fila por fila (sin setValues masivo)
 */
function apiArchiveDone(data) {
  try {
    // Usa tu mecanismo de password actual (getSecret_ o constante)
    var passwordCfg = (typeof getSecret_ === 'function')
      ? getSecret_()
      : (typeof SECRET_PASSWORD !== 'undefined' ? SECRET_PASSWORD : '');
    if (!data || data.password !== passwordCfg) throw new Error('Contraseña incorrecta.');

    var sh = _getSheet();
    var lastRow = sh.getLastRow();
    if (lastRow <= 1) return { count: 0 };

    // Columnas por encabezado (robusto si moviste columnas)
    var statusCol      = _findCol_(sh, 'Status');
    var updatedAtCol   = _findCol_(sh, 'UpdatedAt');
    var needsReviewCol = _findCol_(sh, 'NeedsReview');

    var n   = lastRow - 1;
    var now = new Date();
    var target = (typeof normalizeStatus_ === 'function') ? normalizeStatus_('Historico') : 'Historico';

    // Lee estados actuales
    var statuses = sh.getRange(2, statusCol, n, 1).getValues();
    var count = 0;

    for (var i = 0; i < n; i++) {
      var rowIndex = i + 2;
      var raw = statuses[i][0];

      if (_isDoneStatusSoft_(raw)) {
        // Si hay validación que no permite "Historico", la quitamos
        try {
          var cell = sh.getRange(rowIndex, statusCol);
          var rule = cell.getDataValidation();
          if (rule) {
            var ruleStr = String(rule);
            if (!/Historico/i.test(ruleStr)) cell.setDataValidation(null);
          }
        } catch (e) {/* no bloqueamos */}

        // Escribir valores individuales
        sh.getRange(rowIndex, statusCol).setValue(target);     // Status -> Historico
        sh.getRange(rowIndex, updatedAtCol).setValue(now);     // UpdatedAt -> ahora
        if (needsReviewCol) {
          sh.getRange(rowIndex, needsReviewCol).setValue(false); // NeedsReview -> off
        }
        count++;
      }
    }

    SpreadsheetApp.flush();
    return { count: count };
  } catch (error) {
    console.error('apiArchiveDone:', error);
    throw new Error(error.message || String(error));
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

/** Normaliza estados en EN/ES (incluye sinónimos) */
function normalizeStatus_(s) {
  const key = String(s || '').toLowerCase().trim();
  const map = {
    // EN visibles
    'backlog': 'Backlog',
    'in progress': 'In Progress', 'in-progress': 'In Progress',
    'review': 'Review',
    'done': 'Done',
    // ES visibles / sinónimos
    'pendiente': 'Backlog',
    'en progreso': 'In Progress', 'progreso': 'In Progress',
    'revisión': 'Review', 'revision': 'Review',
    'hecho': 'Done', 'finalizado': 'Done', 'terminado': 'Done',
    'completo': 'Done', 'completado': 'Done',
    // Archivo / histórico
    'historico': 'Historico', 'histórico': 'Historico',
    'almacen': 'Historico', 'almacén': 'Historico',
    'archive': 'Historico', 'archived': 'Historico'
  };
  return map[key] || 'Backlog';
}

/** ¿Es estado equivalente a Done? (EN/ES) */
function _isDoneStatus_(s) {
  const k = String(s || '').toLowerCase().trim();
  return (
    k === 'done' || k === 'hecho' || k === 'finalizado' ||
    k === 'terminado' || k === 'completo' || k === 'completado'
  );
}

function normalizePriority_(p) {
  const key = String(p || '').toLowerCase().trim();
  const map = {'high': 'High', 'low': 'Low'};
  return map[key] || 'Medium';
}

/**
 * Devuelve el número de columna (1-based) cuyo encabezado coincide EXACTO con headerName.
 * Busca en la fila 1 de la hoja; tolera mayúsculas/minúsculas y espacios alrededor.
 * Lanza error si no encuentra el encabezado.
 */
function _findCol_(sh, headerName) {
  var maxCols = Math.max( sh.getLastColumn(), 10 );
  var headers = sh.getRange(1, 1, 1, maxCols).getValues()[0];
  var target = String(headerName).trim().toLowerCase();

  for (var c = 0; c < headers.length; c++) {
    var name = String(headers[c] || '').trim().toLowerCase();
    if (name === target) return c + 1; // 1-based
  }
  throw new Error('No se encontró la columna "' + headerName + '". Revisa los encabezados de la fila 1.');
}

/**
 * Considera "Done" si:
 *  - normalizando (si existe normalizeStatus_) da "Done"
 *  - o si el texto contiene equivalentes comunes en EN/ES (hecho/finalizado/terminado/completado)
 */
function _isDoneStatusSoft_(val) {
  var s = String(val || '').trim();
  if (!s) return false;

  // Si tienes normalizeStatus_, úsalo como primera heurística
  try {
    if (typeof normalizeStatus_ === 'function') {
      var norm = normalizeStatus_(s);
      if (String(norm).toLowerCase() === 'done') return true;
    }
  } catch (e) {}

  var k = s.toLowerCase();
  if (k === 'done' || k === 'hecho' || k === 'finalizado' ||
      k === 'terminado' || k === 'completo' || k === 'completado') return true;

  // tolera variantes con extras (p.ej. "Hecho ✅", "done (ok)")
  if (/\bdone\b/i.test(s)) return true;
  if (/\bhecho\b/i.test(s)) return true;

  return false;
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

/** Asigna una tarea a un usuario (solo campo Assignee) */
function apiAssignTaskToUser(taskId, assignee) {
  try {
    if (!taskId) throw new Error('ID requerido.');
    const sh = _getSheet();
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) throw new Error('No hay tareas.');

    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    let rowIndex = -1;
    for (let i = 0; i < ids.length; i++) {
      if (Number(ids[i][0]) === Number(taskId)) { rowIndex = i + 2; break; }
    }
    if (rowIndex === -1) throw new Error('Tarea no encontrada.');

    sh.getRange(rowIndex, 6).setValue(assignee || '');
    sh.getRange(rowIndex, 8).setValue(new Date()); // UpdatedAt
    return { ok: true };
  } catch (e) {
    console.error('apiAssignTaskToUser:', e);
    throw new Error(e.message || String(e));
  }
}
