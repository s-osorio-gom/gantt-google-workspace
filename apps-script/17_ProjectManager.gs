/**
 * 17_ProjectManager.gs — soporte para el panel "Editar proyecto → tareas".
 * Reusa addProject/updateProject/archiveProject (04) y addTask/updateTask (05).
 */

/**
 * Limpia validaciones de datos viejas (desalineadas) en Proyectos y Tareas,
 * y re-aplica las correctas (prioridad en Proyectos; checkboxes en Tareas).
 * Arreglo puntual para el Sheet actual sin reorganizar de nuevo.
 */
function limpiarValidaciones() {
  return withLock(() => {
    // 02_Proyectos: limpiar todo y poner dropdown de prioridad en la columna correcta
    const shP = getSheet(SHEET_NAMES.PROYECTOS);
    shP.getRange(1, 1, shP.getMaxRows(), shP.getMaxColumns()).clearDataValidations();
    const cmP = getColMap(SHEET_NAMES.PROYECTOS);
    if (cmP['prioridad'] && shP.getLastRow() > 1) {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(['Alta', 'Media', 'Baja'], true).build();
      shP.getRange(2, cmP['prioridad'], shP.getLastRow() - 1, 1).setDataValidation(rule);
    }
    // 03_Tareas: limpiar todo y re-poner checkboxes en completada/bloqueado
    const shT = getSheet(SHEET_NAMES.TAREAS);
    shT.getRange(1, 1, shT.getMaxRows(), shT.getMaxColumns()).clearDataValidations();
    const cmT = getColMap(SHEET_NAMES.TAREAS);
    const nT = Math.max(0, shT.getLastRow() - 1);
    if (nT > 0) {
      const chk = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      if (cmT['completada']) shT.getRange(2, cmT['completada'], nT, 1).setDataValidation(chk);
      if (cmT['bloqueado']) shT.getRange(2, cmT['bloqueado'], nT, 1).setDataValidation(chk);
    }
    return { ok: true };
  });
}

/**
 * Detalle de un proyecto + sus tareas (con nombres) para el panel.
 */
function getProjectDetail(projectId) {
  const p = getProjectById(projectId);
  if (!p) throw new Error('El proyecto no existe: ' + projectId);
  const owner = getPersonById(p.owner_id);
  const tasks = getTasksForProjectSorted(projectId).map(t => ({
    id: t.task_id,
    nombre: t.nombre,
    owner_ids: t.owner_ids,
    owner_names: ownerIdsToNames(t.owner_ids),
    fecha_inicio: fmtDateISO(t.fecha_inicio),
    fecha_fin: fmtDateISO(t.fecha_fin),
    completada: toBool(t.completada),
    bloqueado: toBool(t.bloqueado),
    comentario: t.comentario || '',
    t_optimista: t.t_optimista || '',
    t_probable: t.t_probable || '',
    t_pesimista: t.t_pesimista || '',
    pert_horas: (t.pert_horas === '' || t.pert_horas === undefined || t.pert_horas === null) ? '' : t.pert_horas
  }));
  return {
    id: p.project_id,
    nombre: p.nombre,
    owner_id: p.owner_id,
    owner_name: owner ? owner.nombre : '(sin responsable)',
    prioridad: p.prioridad || 'Media',
    frente: p.frente || 'EQUIPO',
    fecha_inicio: fmtDateISO(p.fecha_inicio),
    fecha_fin: fmtDateISO(p.fecha_fin),
    objetivo: p.objetivo || '',
    link_drive: p.link_drive || '',
    pert_total: projectPertHours(projectId),
    tasks: tasks
  };
}

/**
 * Marca TODAS las tareas de un proyecto como completadas (terminó antes).
 */
function markProjectComplete(projectId) {
  return withLock(() => {
    assertCanEditNow();
    const tasks = getTasksForProject(projectId);
    const todayIso = fmtDateISO(today());
    let n = 0;
    tasks.forEach(t => {
      if (!toBool(t.completada)) {
        setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'completada', true);
        if (!t.fecha_completada) setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'fecha_completada', todayIso);
        n++;
      }
    });
    logEvent('admin_change', getMonthId(), '', '', 'Proyecto marcado completo: ' + projectId,
             'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', '');
    return { ok: true, completadas: n, total: tasks.length };
  });
}

/**
 * Marca/desmarca una tarea como completada.
 */
function setTaskCompleted(taskId, completed) {
  return withLock(() => {
    assertCanEditNow();
    const t = getTaskById(taskId);
    if (!t) throw new Error('La tarea no existe: ' + taskId);
    setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'completada', completed ? true : false);
    setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'fecha_completada', completed ? fmtDateISO(today()) : '');
    return { ok: true };
  });
}

/**
 * Elimina una tarea (con confirmación en el panel). Borrado de fila.
 */
function deleteTask(taskId) {
  return withLock(() => {
    assertCanEditNow();
    const t = getTaskById(taskId);
    if (!t) throw new Error('La tarea no existe: ' + taskId);
    const shT = getSheet(SHEET_NAMES.TAREAS);
    // Un filtro básico activo en la hoja hace que deleteRow de filas del medio sea un no-op
    // silencioso (vía API). Lo quitamos para garantizar el borrado.
    try { const f = shT.getFilter(); if (f) f.remove(); } catch (_) {}
    shT.deleteRow(t._rowIndex);
    _invalidateEntityCache(SHEET_NAMES.TAREAS);
    logEvent('admin_change', getMonthId(), '', '', 'Tarea eliminada: ' + taskId,
             'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', '');
    return { ok: true };
  });
}
