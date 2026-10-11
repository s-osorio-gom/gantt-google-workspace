/**
 * Tareas.gs — manejo de tareas (modelo BINARIO).
 */

/** Todas las tareas (cacheadas por ejecución; se invalida al escribir en Tareas). */
function getAllTasks() {
  if (!_cacheTasks) _cacheTasks = readSheetAsObjects(SHEET_NAMES.TAREAS).rows;
  return _cacheTasks;
}

/** Tareas de un proyecto. */
function getTasksForProject(projectId) {
  if (!projectId) return [];
  return getAllTasks().filter(t => String(t.project_id).trim() === String(projectId).trim());
}

/**
 * Comparador para ordenar tareas por fecha de inicio, más próxima/reciente primero
 * (descendente). Las tareas sin fecha de inicio quedan al final.
 */
function _cmpTaskByStartDesc(a, b) {
  const av = a.fecha_inicio ? new Date(a.fecha_inicio).getTime() : NaN;
  const bv = b.fecha_inicio ? new Date(b.fecha_inicio).getTime() : NaN;
  const aNo = isNaN(av), bNo = isNaN(bv);
  if (aNo && bNo) return 0;
  if (aNo) return 1;   // sin fecha → al final
  if (bNo) return -1;
  return bv - av;      // descendente: fecha de inicio más reciente primero
}

/** Tareas de un proyecto ordenadas para mostrar (fecha de inicio más próxima primero). */
function getTasksForProjectSorted(projectId) {
  return getTasksForProject(projectId).slice().sort(_cmpTaskByStartDesc);
}

/**
 * Tareas asignadas a una persona (incluyendo tareas compartidas donde aparece su person_id).
 */
function getTasksForOwner(personId) {
  if (!personId) return [];
  return getAllTasks().filter(t => {
    const owners = String(t.owner_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    return owners.includes(personId);
  });
}

/**
 * Tareas terminadas por persona en un rango de fechas (basado en fecha_completada).
 */
function getTasksCompletedByOwnerInRange(personId, fromDate, toDate) {
  return getTasksForOwner(personId).filter(t => {
    if (!toBool(t.completada)) return false;
    const fc = t.fecha_completada ? new Date(t.fecha_completada) : null;
    if (!fc) return false;
    return fc >= fromDate && fc <= toDate;
  });
}

/**
 * Devuelve resumen de movimiento esta semana en un proyecto:
 * { closed_this_week: [tarea], total_done: N, total_tasks: N }
 */
function getProjectWeekMovement(projectId, weekStart, weekEnd) {
  const tasks = getTasksForProject(projectId);
  const closedThisWeek = tasks.filter(t => {
    if (!toBool(t.completada)) return false;
    const fc = t.fecha_completada ? new Date(t.fecha_completada) : null;
    return fc && fc >= weekStart && fc <= weekEnd;
  });
  return {
    closed_this_week: closedThisWeek,
    total_done: tasks.filter(t => toBool(t.completada)).length,
    total_tasks: tasks.length
  };
}

/**
 * Texto narrativo del movimiento semanal de un proyecto.
 * Ej: "Cerró 'Hacer rebate'", "Sin movimiento esta semana".
 */
function describeProjectWeekMovement(projectId, weekStart, weekEnd) {
  const m = getProjectWeekMovement(projectId, weekStart, weekEnd);
  if (m.closed_this_week.length === 0) return 'Sin movimiento esta semana';
  if (m.closed_this_week.length === 1) return 'Cerraste "' + m.closed_this_week[0].nombre + '"';
  return 'Cerraste ' + m.closed_this_week.length + ' tareas: ' +
         m.closed_this_week.map(t => '"' + t.nombre + '"').join(', ');
}

/**
 * Inicio y fin de la semana corriente (lunes 00:00 a domingo 23:59).
 */
function getCurrentWeekRange() {
  const d = today();
  const dow = d.getDay(); // 0=domingo, 1=lunes...
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d.getTime() + offsetToMonday * 24 * 60 * 60 * 1000);
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000 + (24*60*60*1000 - 1));
  return { start: monday, end: sunday };
}

/**
 * Inicio y fin de la semana anterior.
 */
function getLastWeekRange() {
  const cur = getCurrentWeekRange();
  const start = new Date(cur.start.getTime() - 7 * 24 * 60 * 60 * 1000);
  const end = new Date(cur.end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: start, end: end };
}

/**
 * Tarea por task_id.
 */
function getTaskById(taskId) {
  if (!taskId) return null;
  return getAllTasks().find(t => String(t.task_id).trim() === String(taskId).trim()) || null;
}

/* ============================================================================
 *  PERT — estimación de horas por tarea: (Optimista + 4·MásProbable + Pesimista) / 6
 * ============================================================================ */

/** Normaliza a 'yyyy-mm-dd' sin corrimiento de zona horaria (acepta string ISO o Date). */
function _toISO(v) {
  if (!v) return '';
  if (typeof v === 'string') {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    if (m) return m[0];      // ya viene ISO → usar tal cual (evita shift por tz)
  }
  return fmtDateISO(v);       // Date → ISO en la zona del proyecto
}

/** Cálculo PERT en horas. Devuelve '' si no hay ningún dato. Redondea a 1 decimal. */
function pertHoras(o, m, p) {
  const O = parseFloat(o) || 0, M = parseFloat(m) || 0, P = parseFloat(p) || 0;
  if (!O && !M && !P) return '';
  return Math.round(((O + 4 * M + P) / 6) * 10) / 10;
}

/** Asegura las columnas PERT en 03_Tareas (idempotente, sin tocar datos). */
function ensurePertColumns() {
  const sh = getSheet(SHEET_NAMES.TAREAS);
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const needed = ['t_optimista', 't_probable', 't_pesimista', 'pert_horas'];
  const added = [];
  let c = lastCol;
  needed.forEach(name => {
    if (headers.indexOf(name) < 0) { c++; sh.getRange(1, c).setValue(name); added.push(name); }
  });
  return { added: added };
}

/** Asegura la columna `rec_source` en 03_Tareas (marca de instancia recurrente). Idempotente. */
function ensureRecColumn() {
  const sh = getSheet(SHEET_NAMES.TAREAS);
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  if (headers.indexOf('rec_source') < 0) { sh.getRange(1, lastCol + 1).setValue('rec_source'); return { added: ['rec_source'] }; }
  return { added: [] };
}

/** ¿Tiene 03_Tareas las columnas PERT? (chequeo rápido sin migrar). */
function _hasPertColumns() {
  const cm = getColMap(SHEET_NAMES.TAREAS);
  return !!(cm['t_optimista'] && cm['t_probable'] && cm['t_pesimista'] && cm['pert_horas']);
}

/** Horas PERT numéricas de una tarea (fila leída como objeto). */
function _taskPert(t) {
  const v = parseFloat(t.pert_horas);
  return isNaN(v) ? 0 : v;
}

/** Suma de horas PERT de un proyecto. */
function projectPertHours(projectId) {
  return getTasksForProject(projectId).reduce((s, t) => s + _taskPert(t), 0);
}

/** Suma de horas PERT de los proyectos de una persona (por propiedad del proyecto).
 *  Excluye el contenedor de recurrentes: sus horas se atribuyen por tarea (owner_ids). */
function ownerPertHours(personId) {
  const recId = String(getConfig('RECURRING_PROJECT_ID') || '').trim();
  return getProjectsForOwner(personId)
    .filter(p => (p.estado_manual || '') !== 'Archivado' && String(p.project_id).trim() !== recId)
    .reduce((s, p) => s + projectPertHours(p.project_id), 0);
}

/** Horas PERT de las tareas recurrentes de una persona (por owner_ids de la tarea). */
function recurringPertHoursForOwner(personId) {
  const recId = String(getConfig('RECURRING_PROJECT_ID') || '').trim();
  if (!recId) return 0;
  return getTasksForProject(recId).filter(t => {
    const owners = String(t.owner_ids || '').split(',').map(s => s.trim());
    return owners.indexOf(personId) >= 0;
  }).reduce((s, t) => s + _taskPert(t), 0);
}

/** Suma total de horas PERT del equipo (proyectos activos). */
function teamPertHours() {
  return getAllProjects()
    .filter(p => (p.estado_manual || '') !== 'Archivado')
    .reduce((s, p) => s + projectPertHours(p.project_id), 0);
}

/** Valida que una tarea caiga dentro del rango de fechas del proyecto. Lanza con mensaje claro.
 *  Candado desactivable: si TASK_RANGE_ENFORCED=FALSE en 00_Config, no acota (edición libre). */
function assertTaskWithinProject(project, fecha_inicio, fecha_fin) {
  if (!getConfigBool('TASK_RANGE_ENFORCED', true)) return; // candado de rango desactivado temporalmente
  const pS = _toISO(project.fecha_inicio), pE = _toISO(project.fecha_fin);
  if (!pS || !pE) return; // proyecto sin rango → no se puede acotar
  const tS = _toISO(fecha_inicio), tE = _toISO(fecha_fin);
  const pSh = fmtDateHuman(project.fecha_inicio), pEh = fmtDateHuman(project.fecha_fin);
  if (tS && tS < pS) {
    throw new Error('⛔ No se puede: la tarea empezaría antes del proyecto. El proyecto va del ' +
      pSh + ' al ' + pEh + '. Ajusta la fecha de inicio de la tarea.');
  }
  if (tE && tE > pE) {
    throw new Error('⛔ No se puede: la tarea terminaría después del proyecto. El proyecto va del ' +
      pSh + ' al ' + pEh + '. Ajusta la fecha de fin de la tarea.');
  }
}

/**
 * Agrega una tarea nueva. Llamado desde sidebar.
 */
function addTask(payload) {
  return withLock(() => {
    assertCanEditNow();
    if (!_hasPertColumns()) ensurePertColumns();
    if (!payload.project_id) throw new Error('Falta proyecto');
    if (!payload.nombre) throw new Error('Falta nombre de la tarea');
    if (!payload.owner_ids) throw new Error('Falta al menos un responsable');

    const project = getProjectById(payload.project_id);
    if (!project) throw new Error('Proyecto no existe: ' + payload.project_id);

    // Validar owner_ids
    const ids = String(payload.owner_ids).split(',').map(s => s.trim()).filter(Boolean);
    ids.forEach(id => {
      const p = getPersonById(id);
      if (!p) throw new Error('Persona no existe: ' + id);
      if (!toBool(p.activo)) throw new Error('Persona inactiva: ' + p.nombre);
    });

    // Validar fechas
    if (payload.fecha_inicio && payload.fecha_fin) {
      if (new Date(payload.fecha_fin) < new Date(payload.fecha_inicio)) {
        throw new Error('Fecha fin no puede ser anterior a fecha inicio');
      }
    }
    // Tarea debe caber dentro del rango del proyecto
    assertTaskWithinProject(project, payload.fecha_inicio, payload.fecha_fin);

    const taskId = nextId(SHEET_NAMES.TAREAS, 'task_id', 'T', 4);
    appendRowByObject(SHEET_NAMES.TAREAS, {
      task_id: taskId,
      project_id: payload.project_id,
      nombre: payload.nombre,
      owner_ids: ids.join(','),
      fecha_inicio: payload.fecha_inicio || '',
      fecha_fin: payload.fecha_fin || '',
      completada: 'FALSE',
      fecha_completada: '',
      peso: payload.peso || 1,
      bloqueado: 'FALSE',
      comentario: payload.comentario || '',
      t_optimista: payload.t_optimista || '',
      t_probable: payload.t_probable || '',
      t_pesimista: payload.t_pesimista || '',
      pert_horas: pertHoras(payload.t_optimista, payload.t_probable, payload.t_pesimista)
    });

    logEvent('admin_change', getMonthId(), '', '',
             'Tarea agregada: ' + taskId + ' al proyecto ' + payload.project_id,
             'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', '');

    return { ok: true, task_id: taskId };
  });
}

/**
 * Actualiza una tarea existente. Llamado desde sidebar editar.
 * Solo cambia los campos provistos (no toca completada/bloqueado para preservar el flujo binario).
 */
function updateTask(payload) {
  return withLock(() => {
    assertCanEditNow();
    if (!_hasPertColumns()) ensurePertColumns();
    if (!payload.task_id) throw new Error('Falta task_id');
    const task = getTaskById(payload.task_id);
    if (!task) throw new Error('Tarea no existe: ' + payload.task_id);

    if (payload.fecha_inicio && payload.fecha_fin) {
      if (new Date(payload.fecha_fin) < new Date(payload.fecha_inicio)) {
        throw new Error('Fecha fin no puede ser anterior a fecha inicio');
      }
    }
    if (payload.owner_ids) {
      const ids = String(payload.owner_ids).split(',').map(s => s.trim()).filter(Boolean);
      ids.forEach(id => {
        if (!getPersonById(id)) throw new Error('Persona no existe: ' + id);
      });
    }
    // Tarea debe caber dentro del rango del proyecto (usa el proyecto destino o el actual)
    const projId = payload.project_id || task.project_id;
    const project = getProjectById(projId);
    if (project && (payload.fecha_inicio !== undefined || payload.fecha_fin !== undefined)) {
      const fi = payload.fecha_inicio !== undefined ? payload.fecha_inicio : task.fecha_inicio;
      const ff = payload.fecha_fin !== undefined ? payload.fecha_fin : task.fecha_fin;
      assertTaskWithinProject(project, fi, ff);
    }

    const updatable = ['nombre','project_id','owner_ids','fecha_inicio','fecha_fin','peso','comentario',
                       't_optimista','t_probable','t_pesimista'];
    updatable.forEach(field => {
      if (payload[field] !== undefined && payload[field] !== null) {
        setCellByHeader(SHEET_NAMES.TAREAS, task._rowIndex, field, payload[field]);
      }
    });
    // Recalcular PERT si vino algún tiempo
    if (payload.t_optimista !== undefined || payload.t_probable !== undefined || payload.t_pesimista !== undefined) {
      const o = payload.t_optimista !== undefined ? payload.t_optimista : task.t_optimista;
      const m = payload.t_probable !== undefined ? payload.t_probable : task.t_probable;
      const p = payload.t_pesimista !== undefined ? payload.t_pesimista : task.t_pesimista;
      setCellByHeader(SHEET_NAMES.TAREAS, task._rowIndex, 'pert_horas', pertHoras(o, m, p));
    }

    logEvent('admin_change', getMonthId(), '', '',
             'Tarea editada: ' + payload.task_id, 'OK',
             isSandboxMode() ? 'SANDBOX' : 'PROD', '');

    return { ok: true };
  });
}

/**
 * Regenera la pestaña 04_Timeline desde 03_Tareas con los NOMBRES de los responsables
 * (no los IDs). Se llama desde el menú o automáticamente al editar tareas.
 *
 * Formato: card_title | start_date | end_date | duration_days | owner_name | project_name |
 *          status | progress_pct | comentario | link | color_category
 */
function rebuildTimeline() {
  return withLock(() => {
    const sh = getSheet(SHEET_NAMES.TIMELINE);
    const tasks = getAllTasks();
    const projects = getAllProjects();
    const today_ = today();

    // Limpiar todo menos fila 1 (headers)
    const lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();

    const rows = [];
    tasks.forEach(t => {
      if (!t.fecha_inicio || !t.fecha_fin) return;  // saltar tareas sin fechas
      const proj = projects.find(p => p.project_id === t.project_id);
      if (!proj) return;
      if ((proj.estado_manual || '') === 'Archivado') return;  // saltar archivados

      // Convertir owner_ids → nombres
      const ownerNames = ownerIdsToNames(t.owner_ids) || '(sin responsable)';

      const startDate = t.fecha_inicio instanceof Date ? t.fecha_inicio : new Date(t.fecha_inicio);
      const endDate = t.fecha_fin instanceof Date ? t.fecha_fin : new Date(t.fecha_fin);
      const durationDays = Math.max(1, Math.round((endDate - startDate) / (1000*60*60*24)) + 1);

      // Status: completada / vencida / en curso
      let status = 'En curso';
      if (toBool(t.completada)) status = 'Terminada';
      else if (toBool(t.bloqueado)) status = 'Bloqueada';
      else if (endDate < today_) status = 'Vencida';

      rows.push([
        t.nombre,                                          // card_title
        fmtDateISO(startDate),                             // start_date
        fmtDateISO(endDate),                               // end_date
        durationDays,                                      // duration_days
        ownerNames,                                        // owner_name (nombre real, no ID)
        proj.nombre,                                       // project_name
        status,                                            // status
        toBool(t.completada) ? 1 : 0,                      // progress_pct (binario)
        t.comentario || '',                                // comentario
        '',                                                // link
        proj.frente || 'EQUIPO'                               // color_category
      ]);
    });

    if (rows.length > 0) {
      sh.getRange(2, 1, rows.length, 11).setValues(rows);
    }
    logInfo('Timeline regenerada: ' + rows.length + ' filas');
    return { rows: rows.length };
  });
}

/**
 * Atajo desde menú con feedback al usuario.
 */
function rebuildTimelineFromMenu() {
  const result = withErrorAlert(() => rebuildTimeline(), 'rebuildTimeline');
  SpreadsheetApp.getUi().alert('Timeline regenerada con ' + result.rows + ' tareas. Los nombres ahora se ven en vez de los IDs.');
}

/**
 * Detecta cambios en el avance: cuando una tarea pasa a completada,
 * setea fecha_completada automáticamente. Llamado por trigger onEdit.
 */
function onTaskEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NAMES.TAREAS) return;
  const colMap = getColMap(SHEET_NAMES.TAREAS);
  const editedCol = e.range.getColumn();
  if (editedCol !== colMap['completada']) return;

  const row = e.range.getRow();
  if (row < 2) return;
  const newVal = toBool(e.range.getValue());
  if (newVal) {
    // Si pasa a TRUE y no tiene fecha_completada, setearla hoy
    const fcCol = colMap['fecha_completada'];
    const fcCell = sh.getRange(row, fcCol);
    if (!fcCell.getValue()) fcCell.setValue(fmtDateISO(today()));
  } else {
    // Si pasa a FALSE, limpiar fecha_completada
    sh.getRange(row, colMap['fecha_completada']).setValue('');
  }
}
