/**
 * Utils.gs — helpers fundamentales compartidos por todo el sistema.
 *
 * Reglas duras:
 * - Acceso a hojas siempre por NOMBRE (no por index).
 * - Acceso a columnas siempre por HEADER NAME (no por letra).
 * - Cero hardcoding de personas, emails o IDs.
 */

const SHEET_NAMES = {
  INICIO:        '00_Inicio',
  CONFIG:        '00_Config',
  PERSONAS:      '01_Personas',
  PROYECTOS:     '02_Proyectos',
  TAREAS:        '03_Tareas',
  TIMELINE:      '04_Timeline',
  DASHBOARD:     '05_Dashboard',
  SNAPSHOTS:     '06_Snapshots',
  EMAIL_LOG:     '08_Email_Log',
  MOTIVACIONALES:'10_Mensajes_Motivacionales',
  VALIDACIONES:  '99_Validaciones'
};

// Sheet privado de evaluaciones (confidencial — solo el administrador y el jefe del canal).
// El ID vive en 00_Config como EVAL_SHEET_ID.
const EVAL_SHEET_TAB = 'Evaluaciones';

/**
 * Devuelve el SpreadsheetApp activo. Lanza si no hay.
 */
function getSS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No hay Spreadsheet activo. Ejecuta desde el Sheet.');
  return ss;
}

/**
 * Devuelve una hoja por nombre. Lanza si no existe (no la crea silenciosamente).
 */
function getSheet(name) {
  const sh = getSS().getSheetByName(name);
  if (!sh) throw new Error('Falta la pestaña: ' + name + '. Verifica el nombre exacto.');
  return sh;
}

/**
 * Lee todos los datos de una hoja como array de objetos {header: value}.
 * Usa fila 1 como headers. Ignora filas completamente vacías.
 */
function readSheetAsObjects(sheetName) {
  const sh = getSheet(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { headers: [], rows: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(v => v === '' || v === null)) continue;
    const obj = { _rowIndex: r + 1 }; // fila en el Sheet (1-based)
    headers.forEach((h, i) => { obj[h] = row[i]; });
    rows.push(obj);
  }
  return { headers, rows };
}

/**
 * Devuelve un mapa { headerName: columnIndex (1-based) } de una hoja.
 * Usado para escribir/leer celdas individuales por nombre de columna.
 */
function getColMap(sheetName) {
  const sh = getSheet(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { map[String(h).trim()] = i + 1; });
  return map;
}

/* ----------------------------------------------------------------------------
 *  Cache de entidades por EJECUCIÓN (tareas/proyectos/personas).
 *  Apps Script aísla el estado por invocación, así que el cache vive solo durante
 *  una ejecución (una reconstrucción / un onEdit / un clasp run). Se invalida en
 *  cada escritura a la hoja correspondiente para no servir datos viejos.
 *  Esto evita releer la hoja de Tareas decenas de veces por reconstrucción.
 * -------------------------------------------------------------------------- */
let _cacheTasks = null, _cacheProjects = null, _cachePersons = null;
function _invalidateEntityCache(sheetName) {
  if (!sheetName) { _cacheTasks = _cacheProjects = _cachePersons = null; return; }
  if (sheetName === SHEET_NAMES.TAREAS) _cacheTasks = null;
  else if (sheetName === SHEET_NAMES.PROYECTOS) _cacheProjects = null;
  else if (sheetName === SHEET_NAMES.PERSONAS) _cachePersons = null;
}

/**
 * Escribe un valor en una celda identificada por (sheet, row, headerName).
 */
function setCellByHeader(sheetName, rowIndex, headerName, value) {
  const sh = getSheet(sheetName);
  const colMap = getColMap(sheetName);
  if (!colMap[headerName]) throw new Error('Columna no encontrada: ' + headerName + ' en ' + sheetName);
  sh.getRange(rowIndex, colMap[headerName]).setValue(value);
  _invalidateEntityCache(sheetName);
}

/**
 * Append a una hoja como nueva fila usando un objeto. Usa headers existentes.
 */
function appendRowByObject(sheetName, obj) {
  const sh = getSheet(sheetName);
  const colMap = getColMap(sheetName);
  const lastCol = sh.getLastColumn();
  const row = new Array(lastCol).fill('');
  Object.keys(obj).forEach(k => {
    const c = colMap[k];
    if (c) row[c - 1] = obj[k];
  });
  sh.appendRow(row);
  _invalidateEntityCache(sheetName);
}

/**
 * Convierte un valor a boolean robustamente (TRUE/true/1/"TRUE" → true).
 */
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'SI' || s === 'YES' || s === '1';
}

/**
 * Zona horaria del proyecto (la de `timeZone` en appsscript.json).
 *
 * Estaba escrita a mano como 'America/Bogota' en una docena de sitios: cambiar
 * appsscript.json no movía ni las fechas ni la hora de los disparadores.
 */
function tz() {
  try { return Session.getScriptTimeZone() || 'UTC'; } catch (e) { return 'UTC'; }
}

/**
 * Formatea Date a YYYY-MM-DD en la zona horaria del proyecto.
 */
function fmtDateISO(date) {
  if (!date) return '';
  if (!(date instanceof Date)) date = new Date(date);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, tz(), 'yyyy-MM-dd');
}

/**
 * Formatea Date a DD/MM/YYYY para mostrar al usuario.
 */
function fmtDateHuman(date) {
  if (!date) return '';
  if (!(date instanceof Date)) date = new Date(date);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, tz(), 'dd/MM/yyyy');
}

/**
 * Devuelve la fecha de hoy en la zona del proyecto (a las 00:00).
 */
function today() {
  const now = new Date();
  const s = Utilities.formatDate(now, tz(), 'yyyy-MM-dd');
  return new Date(s + 'T00:00:00');
}

/**
 * Diferencia en días enteros entre dos fechas.
 */
function daysBetween(d1, d2) {
  if (!(d1 instanceof Date)) d1 = new Date(d1);
  if (!(d2 instanceof Date)) d2 = new Date(d2);
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round((d2.getTime() - d1.getTime()) / MS_PER_DAY);
}

/**
 * Identificador de semana ISO: 2026-W22
 */
function getWeekId(date) {
  if (!date) date = today();
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

/**
 * Identificador de mes: 2026-06
 */
function getMonthId(date) {
  if (!date) date = today();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

/**
 * Genera el siguiente ID en una hoja, con prefijo. Ej: nextId('01_Personas', 'person_id', 'P', 3) -> 'P007'
 */
function nextId(sheetName, headerName, prefix, padLen) {
  const data = readSheetAsObjects(sheetName);
  let maxNum = 0;
  data.rows.forEach(r => {
    const v = String(r[headerName] || '');
    if (v.startsWith(prefix)) {
      const num = parseInt(v.substring(prefix.length), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });
  return prefix + String(maxNum + 1).padStart(padLen, '0');
}

/**
 * Log centralizado: escribe en consola Y en 08_Email_Log si es evento de correo.
 */
function logInfo(msg) { console.log('[EQUIPO] ' + msg); }
function logWarn(msg) { console.warn('[EQUIPO][WARN] ' + msg); }
function logError(msg) { console.error('[EQUIPO][ERROR] ' + msg); }

/**
 * Append a 08_Email_Log
 */
function logEvent(eventType, period, destinatarioEmail, destinatarioNombre, asunto, status, mode, detalle) {
  // El registro de auditoría NUNCA debe romper la operación que lo invoca.
  // Si 08_Email_Log está protegido para el usuario (p. ej. un miembro del equipo desde el
  // sidebar), degradamos a consola en vez de lanzar y abortar la mutación.
  try {
    appendRowByObject(SHEET_NAMES.EMAIL_LOG, {
      timestamp: new Date(),
      event_type: eventType,
      period: period,
      destinatario_email: destinatarioEmail,
      destinatario_nombre: destinatarioNombre,
      asunto: asunto,
      status: status,
      mode: mode,
      detalle: detalle || ''
    });
  } catch (e) {
    console.warn('[EQUIPO][WARN] logEvent no pudo escribir en Email_Log (' + eventType + '): ' + e.message);
  }
}

/**
 * Huella corta de un texto (djb2, base 36). Se usa en el periodo del log de
 * correos: mismo contenido → mismo periodo → el anti-duplicado lo detiene; un
 * contenido corregido cambia la huella y sí sale.
 */
function _huella(texto) {
  let h = 5381;
  const s = String(texto);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Lock simple para evitar ejecuciones concurrentes.
 *
 * Reentrante: muchas operaciones con lock llaman a otras que también lo toman
 * (fridayExecJob → generateSnapshot, generateRecurringTasks → construirResumen…).
 * Antes, el releaseLock() de la llamada interna soltaba el lock de la externa y
 * el resto de la operación corría sin protección. Ahora solo lo suelta quien lo
 * tomó.
 */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (lock.hasLock()) return fn();
  if (!lock.tryLock(30000)) {
    throw new Error('No se pudo adquirir el lock. Otra ejecución en curso.');
  }
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/* ============================================================================
 *  SHEET PRIVADO DE EVALUACIONES — helpers (Opción A: confidencialidad real)
 * ============================================================================ */

let _evalSSCache = null;

/**
 * Abre el Sheet privado de evaluaciones por su ID.
 * Falla si EVAL_SHEET_ID no está configurado o el Sheet no es accesible.
 */
function getEvalSS() {
  if (_evalSSCache) return _evalSSCache;
  const id = getConfig('EVAL_SHEET_ID');
  if (!id) throw new Error('Falta EVAL_SHEET_ID en 00_Config. Crear el Sheet privado de evaluaciones primero.');
  try {
    _evalSSCache = SpreadsheetApp.openById(String(id).trim());
    return _evalSSCache;
  } catch (e) {
    throw new Error('No se pudo abrir el Sheet de evaluaciones (ID: ' + id + '). Verifica el ID y permisos. ' + e.message);
  }
}

function getEvalSheet(name) {
  const ss = getEvalSS();
  const sh = ss.getSheetByName(name || EVAL_SHEET_TAB);
  if (!sh) throw new Error('Falta la pestaña "' + (name || EVAL_SHEET_TAB) + '" en el Sheet privado de evaluaciones.');
  return sh;
}

function readEvalSheetAsObjects(sheetName) {
  const sh = getEvalSheet(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { headers: [], rows: [] };
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(v => v === '' || v === null)) continue;
    const obj = { _rowIndex: r + 1 };
    headers.forEach((h, i) => { obj[h] = row[i]; });
    rows.push(obj);
  }
  return { headers, rows };
}

function getEvalColMap(sheetName) {
  const sh = getEvalSheet(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { map[String(h).trim()] = i + 1; });
  return map;
}

function setEvalCell(sheetName, rowIndex, headerName, value) {
  const sh = getEvalSheet(sheetName);
  const colMap = getEvalColMap(sheetName);
  if (!colMap[headerName]) throw new Error('Columna no encontrada: ' + headerName + ' en eval ' + sheetName);
  sh.getRange(rowIndex, colMap[headerName]).setValue(value);
}

function appendEvalRow(sheetName, obj) {
  const sh = getEvalSheet(sheetName);
  const colMap = getEvalColMap(sheetName);
  const lastCol = sh.getLastColumn();
  const row = new Array(lastCol).fill('');
  Object.keys(obj).forEach(k => {
    const c = colMap[k];
    if (c) row[c - 1] = obj[k];
  });
  sh.appendRow(row);
}

/**
 * Wrapper try/catch global: si falla, envía email al admin.
 */
function withErrorAlert(fn, contextName) {
  try { return fn(); }
  catch (e) {
    const admin = getConfig('ADMIN_EMAIL') || 'admin@example.com';
    const subject = '[EQUIPO ERROR] ' + contextName;
    const body = 'Falló: ' + contextName + '\n\nError: ' + (e.message || e) + '\n\nStack:\n' + (e.stack || '(no stack)');
    try { MailApp.sendEmail(admin, subject, body); } catch (_) {}
    logError(contextName + ': ' + e.message);
    throw e;
  }
}


/**
 * Lunes de la semana a la que pertenece una fecha. El domingo cuenta como fin
 * de la semana previa, no como inicio de la siguiente.
 *
 * Vive aquí porque la usan varios módulos. Estaba definida dos veces, en
 * `16_Vistas.gs` y en `21_Recurrentes.gs`: en Apps Script todos los archivos
 * comparten un único ámbito global, así que no era un error — simplemente
 * ganaba la del archivo que se cargara de último, en silencio.
 */
function _mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();                    // 0=domingo … 6=sábado
  const diff = (dow === 0) ? -6 : (1 - dow);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate() + diff);
}
