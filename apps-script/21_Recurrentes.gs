/**
 * 21_Recurrentes.gs — Tareas recurrentes (Rebate mensual, etc.).
 *
 * Modelo:
 *  - Una hoja oculta `_Recurrentes` guarda las PLANTILLAS (definición de cada tarea repetitiva).
 *  - Un proyecto contenedor "🔁 Recurrentes" (id en config RECURRING_PROJECT_ID) recibe las
 *    INSTANCIAS generadas, para que las vistas y correos existentes las dibujen sin cambios.
 *  - Cada instancia es una fila normal de 03_Tareas con `project_id = contenedor`, su propio
 *    `owner_ids`, y un marcador `rec_source = rec_id|YYYY-MM-DD` (idempotencia + marca 🔁).
 *
 * Frecuencias soportadas:
 *  - 'semanal'   → se repite cada semana en los días de la semana elegidos (uno o varios).
 *  - 'quincenal' → cada 2 semanas en los días de la semana elegidos (semana ancla = la de fecha_inicio).
 *  - 'mensual'   → mismo día del mes que fecha_inicio.
 *  - 'fecha'     → una sola vez en fecha_inicio.
 * Cada plantilla tiene una ventana [fecha_inicio, fecha_fin]. Para semanal/quincenal, `dias_semana`
 * guarda los días elegidos como CSV de getDay() (0=domingo … 6=sábado); vacío ⇒ el día de fecha_inicio.
 *
 * Generación: `generateRecurringTasks()` rellena TODAS las instancias que caben en la ventana
 * del Gantt (ver ganttWindow() en 16_Vistas.gs) y que aún no existen. Es idempotente (por rec_source), así que
 * correrla varias veces no duplica. Se dispara el día 1 (11_Triggers) y con un botón manual.
 */

const REC_TAB = '_Recurrentes';
const REC_HEADERS = ['rec_id', 'nombre', 'owner_ids', 'frecuencia', 'fecha_inicio', 'fecha_fin',
                     'dias_semana', 'activo', 'comentario', 't_optimista', 't_probable', 't_pesimista'];
const REC_FRECUENCIAS = ['semanal', 'quincenal', 'mensual', 'fecha'];
/** Fin de serie por defecto para plantillas migradas: el fin de la ventana del Gantt. */
function _recDefaultEnd() { return fmtDateISO(ganttWindow().end); }

/** Asegura la hoja oculta de plantillas (y migra el esquema viejo si hace falta). */
function _ensureRecTab() {
  const ss = getSS();
  let sh = ss.getSheetByName(REC_TAB);
  if (!sh) {
    sh = ss.insertSheet(REC_TAB);
    sh.getRange(1, 1, 1, REC_HEADERS.length).setValues([REC_HEADERS]);
  } else {
    _migrateRecSchema(sh);
  }
  try { sh.hideSheet(); } catch (_) {}
  return sh;
}

/**
 * Migra la hoja de plantillas del esquema viejo (ancla + duracion_dias) al nuevo
 * (fecha_inicio + fecha_fin + dias_semana). Idempotente: si ya está migrada, no hace nada.
 * A las plantillas viejas les pone fecha_fin = fin de la ventana del Gantt y dias_semana vacío (⇒ día de la fecha).
 */
function _migrateRecSchema(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const needs = header.indexOf('fecha_inicio') < 0 || header.indexOf('fecha_fin') < 0 ||
                header.indexOf('dias_semana') < 0 || header.indexOf('ancla') >= 0 ||
                header.indexOf('duracion_dias') >= 0;
  if (!needs) return;
  const defEnd = _recDefaultEnd();
  const idx = {}; header.forEach((h, i) => idx[h] = i);
  const get = (row, name) => (idx[name] !== undefined ? row[idx[name]] : '');
  const lastRow = sh.getLastRow();
  const rows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, header.length).getValues() : [];
  const out = rows.filter(row => String(get(row, 'rec_id')).trim() !== '').map(row => {
    let fi = get(row, 'fecha_inicio'); if (fi === '' || fi == null) fi = get(row, 'ancla');
    let ff = get(row, 'fecha_fin');    if (ff === '' || ff == null) ff = defEnd;
    return REC_HEADERS.map(h => {
      if (h === 'fecha_inicio') return (fi !== '' && fi != null) ? _toISO(fi) : '';
      if (h === 'fecha_fin')    return (ff !== '' && ff != null) ? _toISO(ff) : defEnd;
      if (h === 'dias_semana')  return get(row, 'dias_semana') || '';
      return get(row, h);
    });
  });
  sh.clear();
  sh.getRange(1, 1, 1, REC_HEADERS.length).setValues([REC_HEADERS]);
  if (out.length) sh.getRange(2, 1, out.length, REC_HEADERS.length).setValues(out);
}

/** id del proyecto contenedor (o ''). */
function getRecurringProjectId() { return String(getConfig('RECURRING_PROJECT_ID') || '').trim(); }

/** ¿Es el proyecto contenedor de recurrentes? */
function isRecurringProject(projectId) {
  const rid = getRecurringProjectId();
  return !!rid && String(projectId).trim() === rid;
}

/**
 * Asegura el proyecto contenedor "🔁 Recurrentes" y devuelve su project_id.
 * Idempotente: reusa el de config o uno existente por nombre; si no, lo crea.
 */
function _ensureRecurringContainer() {
  let pid = getRecurringProjectId();
  const actual = (pid && getProjectById(pid)) ||
    getAllProjects().find(p => String(p.nombre || '').indexOf('Recurrentes') >= 0);
  if (actual) {
    if (String(actual.project_id) !== pid) setConfigValue('RECURRING_PROJECT_ID', actual.project_id);
    // Un contenedor sin responsable es un error CRÍTICO en 99_Validaciones (bloquea el
    // viernes y el paso a PROD). Pasaba al correr «Completar configuración» antes de
    // cargar personas; se repara en cuanto haya alguien.
    if (!String(actual.owner_id || '').trim()) {
      const dueno = _recContainerOwner();
      if (dueno) setCellByHeader(SHEET_NAMES.PROYECTOS, actual._rowIndex, 'owner_id', dueno.person_id);
    }
    return actual.project_id;
  }
  const admin = _recContainerOwner();
  if (!admin) {
    throw new Error('Cargue al menos una persona (Admin → Agregar persona) antes de crear el proyecto ' +
      'de recurrentes: necesita un responsable.');
  }
  pid = nextId(SHEET_NAMES.PROYECTOS, 'project_id', 'PR', 3);
  const w = ganttWindow();
  appendRowByObject(SHEET_NAMES.PROYECTOS, {
    project_id: pid, nombre: '🔁 Recurrentes', owner_id: admin.person_id,
    frente: 'EQUIPO', prioridad: 'Media', fecha_inicio: fmtDateISO(w.start), fecha_fin: fmtDateISO(w.end),
    objetivo: 'Contenedor de tareas recurrentes mensuales/semanales (Rebate, etc.)',
    link_drive: '', peso: 1, estado_manual: ''
  });
  _invalidateEntityCache(SHEET_NAMES.PROYECTOS);
  setConfigValue('RECURRING_PROJECT_ID', pid);
  return pid;
}

/** Responsable del contenedor: la persona del admin principal o, si no está en 01_Personas, la primera activa. */
function _recContainerOwner() {
  const adminEmail = String(getAdminEmails()[0] || '').toLowerCase();
  const activas = getActivePersons();
  return activas.find(p => String(p.email || '').toLowerCase() === adminEmail) || activas[0] || null;
}

/** Setup 1-vez: contenedor + hoja de plantillas + columna rec_source + config. */
function setupRecurrentes() {
  _ensureRecTab();
  const rec = ensureRecColumn();
  const container = _ensureRecurringContainer();
  if (getConfig('RECURRING_TASKS_DAY') === undefined || String(getConfig('RECURRING_TASKS_DAY')).trim() === '') {
    setConfigValue('RECURRING_TASKS_DAY', '1');
  }
  return { container_project_id: container, rec_source_col: rec.added, tab: REC_TAB };
}

/* ============================================================================
 *  CRUD de plantillas (corre como el usuario; reglas de edición del jueves)
 * ============================================================================ */

/** Lista de plantillas (para la UI). */
function getRecurrentes() {
  _ensureRecTab();
  return readSheetAsObjects(REC_TAB).rows.map(r => ({
    rec_id: r.rec_id, nombre: r.nombre, owner_ids: r.owner_ids,
    owner_names: ownerIdsToNames(r.owner_ids), frecuencia: r.frecuencia || 'mensual',
    fecha_inicio: r.fecha_inicio ? _toISO(r.fecha_inicio) : '',
    fecha_fin: r.fecha_fin ? _toISO(r.fecha_fin) : '',
    dias_semana: String(r.dias_semana || ''),
    dias_texto: _recDiasTexto(r),
    activo: toBool(r.activo), comentario: r.comentario || ''
  }));
}

/** Texto legible de los días de la semana de una plantilla (ej. "martes, miércoles"). */
function _recDiasTexto(r) {
  const freq = String(r.frecuencia || 'mensual').toLowerCase();
  if (freq !== 'semanal' && freq !== 'quincenal') return '';
  const sISO = r.fecha_inicio ? _toISO(r.fecha_inicio) : '';
  const S = sISO ? new Date(sISO + 'T00:00:00') : null;
  return _recDias(r, S).map(n => _DIAS_SEM[n]).join(', ');
}

/** Datos para el formulario del sidebar. */
function getRecurrenteFormData() {
  return { me: whoAmI(), persons: getActivePersonsForUI(), recurrentes: getRecurrentes(),
           frecuencias: REC_FRECUENCIAS };
}

/**
 * Valida y normaliza el bloque de recurrencia de un payload.
 * Devuelve { freq, fi, ff, dias } listos para guardar. Lanza con mensaje claro si algo falta.
 */
function _recValidateRecurrence(payload) {
  const freq = REC_FRECUENCIAS.indexOf(String(payload.frecuencia)) >= 0 ? payload.frecuencia : 'mensual';
  const fi = payload.fecha_inicio ? _toISO(payload.fecha_inicio) : '';
  const ff = payload.fecha_fin ? _toISO(payload.fecha_fin) : '';
  if (!fi) throw new Error('Falta la fecha de inicio.');
  if (!ff) throw new Error('Falta la fecha de fin.');
  if (ff < fi) throw new Error('La fecha de fin no puede ser anterior a la de inicio.');
  let dias = '';
  if (freq === 'semanal' || freq === 'quincenal') {
    const arr = String(payload.dias_semana || '').split(',')
      .map(s => parseInt(String(s).trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n <= 6);
    // sin días elegidos ⇒ el día de la fecha de inicio
    dias = (arr.length ? arr : [new Date(fi + 'T00:00:00').getDay()])
      .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).join(',');
  }
  return { freq: freq, fi: fi, ff: ff, dias: dias };
}

/** Crea una plantilla recurrente. */
function addRecurrente(payload) {
  assertCanEditNow();
  _ensureRecTab();
  if (!payload || !payload.nombre || !String(payload.nombre).trim()) throw new Error('Escribe el nombre de la tarea.');
  if (!payload.owner_ids) throw new Error('Falta el responsable.');
  const ids = String(payload.owner_ids).split(',').map(s => s.trim()).filter(Boolean);
  ids.forEach(id => { if (!getPersonById(id)) throw new Error('Persona inválida: ' + id); });
  const rec = _recValidateRecurrence(payload);
  const recId = nextId(REC_TAB, 'rec_id', 'R', 4);
  appendRowByObject(REC_TAB, {
    rec_id: recId, nombre: String(payload.nombre).trim(), owner_ids: ids.join(','),
    frecuencia: rec.freq, fecha_inicio: rec.fi, fecha_fin: rec.ff, dias_semana: rec.dias,
    activo: 'TRUE', comentario: payload.comentario || '',
    t_optimista: payload.t_optimista || '', t_probable: payload.t_probable || '', t_pesimista: payload.t_pesimista || ''
  });
  // Genera de una las instancias y actualiza las vistas (aparece al instante en el Gantt).
  const gen = generateRecurringTasks();
  return { ok: true, rec_id: recId, generadas: gen.created };
}

/** Actualiza campos de una plantilla. */
function updateRecurrente(payload) {
  assertCanEditNow();
  _ensureRecTab();
  if (!payload || !payload.rec_id) throw new Error('Falta rec_id.');
  const row = readSheetAsObjects(REC_TAB).rows.find(r => String(r.rec_id).trim() === String(payload.rec_id).trim());
  if (!row) throw new Error('Plantilla no existe: ' + payload.rec_id);
  // Si viene información de recurrencia, validarla y normalizarla como bloque (merge con lo actual).
  const touchesRec = ['frecuencia', 'fecha_inicio', 'fecha_fin', 'dias_semana'].some(f => payload[f] !== undefined);
  if (touchesRec) {
    const rec = _recValidateRecurrence({
      frecuencia:   payload.frecuencia   !== undefined ? payload.frecuencia   : row.frecuencia,
      fecha_inicio: payload.fecha_inicio !== undefined ? payload.fecha_inicio : row.fecha_inicio,
      fecha_fin:    payload.fecha_fin    !== undefined ? payload.fecha_fin    : row.fecha_fin,
      dias_semana:  payload.dias_semana  !== undefined ? payload.dias_semana  : row.dias_semana
    });
    setCellByHeader(REC_TAB, row._rowIndex, 'frecuencia', rec.freq);
    setCellByHeader(REC_TAB, row._rowIndex, 'fecha_inicio', rec.fi);
    setCellByHeader(REC_TAB, row._rowIndex, 'fecha_fin', rec.ff);
    setCellByHeader(REC_TAB, row._rowIndex, 'dias_semana', rec.dias);
  }
  ['nombre', 'owner_ids', 'comentario', 't_optimista', 't_probable', 't_pesimista'].forEach(f => {
    if (payload[f] !== undefined && payload[f] !== null) setCellByHeader(REC_TAB, row._rowIndex, f, payload[f]);
  });
  const gen = generateRecurringTasks(); // regenera lo que falte y refresca vistas
  return { ok: true, generadas: gen.created };
}

/** Activa/desactiva una plantilla (no borra sus instancias ya creadas). */
function toggleRecurrente(recId, activo) {
  assertCanEditNow();
  _ensureRecTab();
  const row = readSheetAsObjects(REC_TAB).rows.find(r => String(r.rec_id).trim() === String(recId).trim());
  if (!row) throw new Error('Plantilla no existe: ' + recId);
  setCellByHeader(REC_TAB, row._rowIndex, 'activo', activo ? 'TRUE' : 'FALSE');
  let generadas = 0;
  if (activo) { try { generadas = generateRecurringTasks().created; } catch (_) {} }
  return { ok: true, activo: !!activo, generadas: generadas };
}

/** Elimina una plantilla (las instancias ya generadas quedan; se borran aparte si se quiere). */
function deleteRecurrente(recId) {
  assertCanEditNow();
  const sh = _ensureRecTab();
  const row = readSheetAsObjects(REC_TAB).rows.find(r => String(r.rec_id).trim() === String(recId).trim());
  if (!row) throw new Error('Plantilla no existe: ' + recId);
  const f = sh.getFilter(); if (f) f.remove();
  sh.deleteRow(row._rowIndex);
  return { ok: true };
}

/* ============================================================================
 *  Motor de generación
 * ============================================================================ */

var _DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Lunes de la semana de una fecha (semana ISO: lunes→domingo). */
// _mondayOf() vive en 01_Utils.gs: en Apps Script todos los archivos
// comparten un único ámbito global y definirla aquí la duplicaba.

/** Días de la semana elegidos de una plantilla (array 0..6). Vacío ⇒ el día de la fecha de inicio. */
function _recDias(r, start) {
  const raw = String(r.dias_semana || '').trim();
  if (raw) {
    return raw.split(',').map(s => parseInt(String(s).trim(), 10))
      .filter(n => !isNaN(n) && n >= 0 && n <= 6);
  }
  return start ? [start.getDay()] : [];
}

/**
 * Fechas de cada repetición de una plantilla dentro de la ventana efectiva
 * [max(fecha_inicio, winStart), min(fecha_fin, winEnd)]. Itera día a día (ventana acotada).
 *   - fecha:     solo fecha_inicio.
 *   - mensual:   mismo día del mes que fecha_inicio (con tope de fin de mes).
 *   - semanal:   los días de la semana elegidos, cada semana.
 *   - quincenal: los días de la semana elegidos, en semanas alternas (ancla = semana de fecha_inicio).
 */
function _recInstanceStarts(freq, start, end, dias, winStart, winEnd) {
  const out = [];
  const S = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const E = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const lo = new Date(Math.max(S.getTime(), winStart.getTime()));
  const hi = new Date(Math.min(E.getTime(), winEnd.getTime()));
  if (hi.getTime() < lo.getTime()) return out;

  if (freq === 'fecha') {
    if (S.getTime() >= lo.getTime() && S.getTime() <= hi.getTime()) out.push(new Date(S));
    return out;
  }
  const dom = S.getDate();
  const startMonday = _mondayOf(S);
  let d = new Date(lo);
  let guard = 0;
  while (d.getTime() <= hi.getTime() && guard < 400) {
    let hit = false;
    if (freq === 'mensual') {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      hit = d.getDate() === Math.min(dom, last);
    } else if (freq === 'semanal') {
      hit = dias.indexOf(d.getDay()) >= 0;
    } else if (freq === 'quincenal') {
      if (dias.indexOf(d.getDay()) >= 0) {
        const wk = Math.round((_mondayOf(d).getTime() - startMonday.getTime()) / (7 * 86400000));
        hit = (wk % 2 === 0);
      }
    }
    if (hit) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    guard++;
  }
  return out;
}

/** Sufijo que describe la cadencia para el nombre de la tarea (ej. " 🔁 mensual (día 10)"). */
function _recCadenceSuffix(r) {
  const freq = String(r.frecuencia || 'mensual').toLowerCase();
  const sISO = r.fecha_inicio ? _toISO(r.fecha_inicio) : '';
  const S = sISO ? new Date(sISO + 'T00:00:00') : null;
  if (freq === 'mensual') return ' 🔁 mensual' + (S ? ' (día ' + S.getDate() + ')' : '');
  if (freq === 'fecha') return ''; // fecha única → sin marca de recurrencia
  const nombres = _recDias(r, S).map(n => _DIAS_SEM[n]).join(', ');
  if (freq === 'semanal') return ' 🔁 semanal' + (nombres ? ' (' + nombres + ')' : '');
  if (freq === 'quincenal') return ' 🔁 quincenal' + (nombres ? ' (' + nombres + ')' : '');
  return '';
}

/** Fechas (Date) de cada repetición de una plantilla dentro de la ventana del Gantt. */
function recurrenceOccurrencesFor(recId) {
  const r = readSheetAsObjects(REC_TAB).rows.find(x => String(x.rec_id).trim() === String(recId).trim());
  if (!r) return [];
  const g = _ganttGrid();
  const freq = String(r.frecuencia || 'mensual').toLowerCase();
  const sISO = r.fecha_inicio ? _toISO(r.fecha_inicio) : '';
  const start = sISO ? new Date(sISO + 'T00:00:00') : g.start;
  const eISO = r.fecha_fin ? _toISO(r.fecha_fin) : '';
  const end = eISO ? new Date(eISO + 'T00:00:00') : g.end;
  return _recInstanceStarts(freq, start, end, _recDias(r, start), g.start, g.end);
}

/**
 * Mantiene UNA sola tarea por plantilla activa (no una por repetición). El nombre indica la
 * cadencia y el Cronograma marca los días de cada repetición. Idempotente (upsert por rec_id):
 * actualiza la existente o la crea, y limpia instancias viejas / de plantillas eliminadas.
 * Se corre al guardar, el día 1 (automático) y con el botón "Re-sincronizar".
 */
function generateRecurringTasks() {
  return withLock(() => {
    _ensureRecTab();
    const container = _ensureRecurringContainer();
    ensureRecColumn();
    if (!_hasPertColumns()) ensurePertColumns();

    const g = _ganttGrid();
    // El contenedor sigue la ventana del Gantt: si no, al cambiar de semestre
    // quedaría "Vencido" con fechas del periodo anterior.
    const cp = getProjectById(container);
    if (cp) {
      const gi = fmtDateISO(g.start), gf = fmtDateISO(g.end);
      if (_toISO(cp.fecha_inicio) !== gi) setCellByHeader(SHEET_NAMES.PROYECTOS, cp._rowIndex, 'fecha_inicio', gi);
      if (_toISO(cp.fecha_fin) !== gf) setCellByHeader(SHEET_NAMES.PROYECTOS, cp._rowIndex, 'fecha_fin', gf);
    }
    const sh = getSheet(SHEET_NAMES.TAREAS);
    const f = sh.getFilter(); if (f) f.remove(); // un filtro bloquea deleteRow de filas del medio
    const tmpls = readSheetAsObjects(REC_TAB).rows.filter(r => r.rec_id && toBool(r.activo));
    const activos = {}; tmpls.forEach(r => activos[String(r.rec_id).trim()] = true);

    // 1) limpiar: instancias del modelo viejo (rec_source con '|') y recurrentes cuya plantilla
    //    ya no está activa (eliminada o pausada).
    const borrar = getAllTasks().filter(t => {
      const rs = String(t.rec_source || '').trim();
      if (!rs) return false;
      return rs.indexOf('|') >= 0 || !activos[rs];
    }).map(t => t.task_id);
    borrar.forEach(id => { const t = getTaskById(id); if (t) { sh.deleteRow(t._rowIndex); _invalidateEntityCache(SHEET_NAMES.TAREAS); } });

    // 2) upsert una tarea por plantilla activa
    let seed = parseInt(nextId(SHEET_NAMES.TAREAS, 'task_id', 'T', 4).substring(1), 10);
    let creadas = 0, actualizadas = 0;
    tmpls.forEach(r => {
      const occ = recurrenceOccurrencesFor(r.rec_id);
      const sISO = r.fecha_inicio ? _toISO(r.fecha_inicio) : '';
      const first = occ.length ? fmtDateISO(occ[0]) : (sISO || fmtDateISO(g.start));
      const last = occ.length ? fmtDateISO(occ[occ.length - 1]) : first;
      const nombre = r.nombre + _recCadenceSuffix(r);
      const existing = getAllTasks().find(t => String(t.rec_source || '').trim() === String(r.rec_id).trim());
      if (existing) {
        setCellByHeader(SHEET_NAMES.TAREAS, existing._rowIndex, 'nombre', nombre);
        setCellByHeader(SHEET_NAMES.TAREAS, existing._rowIndex, 'owner_ids', r.owner_ids);
        setCellByHeader(SHEET_NAMES.TAREAS, existing._rowIndex, 'fecha_inicio', first);
        setCellByHeader(SHEET_NAMES.TAREAS, existing._rowIndex, 'fecha_fin', last);
        actualizadas++;
      } else {
        const taskId = 'T' + String(seed++).padStart(4, '0');
        appendRowByObject(SHEET_NAMES.TAREAS, {
          task_id: taskId, project_id: container, nombre: nombre, owner_ids: r.owner_ids,
          fecha_inicio: first, fecha_fin: last, completada: 'FALSE', fecha_completada: '',
          peso: 1, bloqueado: 'FALSE', comentario: r.comentario || '',
          t_optimista: r.t_optimista || '', t_probable: r.t_probable || '', t_pesimista: r.t_pesimista || '',
          pert_horas: pertHoras(r.t_optimista, r.t_probable, r.t_pesimista), rec_source: r.rec_id
        });
        creadas++;
      }
    });

    _invalidateEntityCache(SHEET_NAMES.TAREAS);
    try { refrescarVistasSilencioso(); } catch (_) {}
    logInfo('Recurrentes: ' + creadas + ' creadas, ' + actualizadas + ' actualizadas');
    return { created: creadas, updated: actualizadas, plantillas: tmpls.length };
  });
}

/** Botón manual del sidebar / menú. */
function generateRecurringNow() { return generateRecurringTasks(); }

/** Diagnóstico: fechas de repetición de una plantilla como texto (para clasp run / QA). */
function _diag_recDates(recId) {
  const occ = recurrenceOccurrencesFor(recId);
  return { n: occ.length, fechas: occ.map(d => fmtDateISO(d) + ' (' + _DIAS_SEM[d.getDay()] + ')').join(' · ') };
}
