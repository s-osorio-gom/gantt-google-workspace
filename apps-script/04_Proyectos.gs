/**
 * Proyectos.gs — manejo de proyectos y cálculo de métricas.
 * Modelo binario: el avance del proyecto = tareas_terminadas / tareas_totales (excluyendo bloqueadas válidas).
 */

/** Todos los proyectos (cacheados por ejecución; se invalida al escribir en Proyectos). */
function getAllProjects() {
  if (!_cacheProjects) _cacheProjects = readSheetAsObjects(SHEET_NAMES.PROYECTOS).rows;
  return _cacheProjects;
}

/** Proyecto por project_id. */
function getProjectById(projectId) {
  if (!projectId) return null;
  return getAllProjects().find(p => String(p.project_id).trim() === String(projectId).trim()) || null;
}

/** Proyectos de un owner_id. */
function getProjectsForOwner(personId) {
  if (!personId) return [];
  return getAllProjects().filter(p => String(p.owner_id).trim() === String(personId).trim());
}

/**
 * Calcula métricas de un proyecto a partir de sus tareas.
 * Devuelve: { project_id, nombre, total_tasks, done_tasks, blocked_tasks_valid,
 *             effective_total, progress_pct, status, days_remaining, alert_type }
 */
function computeProjectMetrics(projectId, todayDate) {
  if (!todayDate) todayDate = today();
  const project = getProjectById(projectId);
  if (!project) return null;
  const tasks = getTasksForProject(projectId);

  // Regla de bloqueados: bloqueado=TRUE Y comentario no vacío
  const requireComment = getConfigBool('BLOCKED_REQUIRES_COMMENT', true);
  const blockedValid = tasks.filter(t => toBool(t.bloqueado) &&
    (!requireComment || String(t.comentario || '').trim() !== ''));
  const blockedInvalid = tasks.filter(t => toBool(t.bloqueado) &&
    requireComment && String(t.comentario || '').trim() === '');

  // Tareas efectivas para cálculo de avance: NO incluye bloqueadas válidas
  const effective = tasks.filter(t => !blockedValid.includes(t));
  const done = effective.filter(t => toBool(t.completada));
  const total = tasks.length;
  const effectiveTotal = effective.length;
  const doneCount = done.length;
  const progressPct = effectiveTotal > 0 ? doneCount / effectiveTotal : 0;

  // Días restantes / vencimiento
  const endDate = project.fecha_fin instanceof Date ? project.fecha_fin :
                  (project.fecha_fin ? new Date(project.fecha_fin) : null);
  const daysRemaining = endDate ? daysBetween(todayDate, endDate) : null;

  // Status calculado
  let status, alertType;
  if (progressPct >= 1.0) {
    status = 'Completado'; alertType = 'COMPLETADO';
  } else if (tasks.length > 0 && tasks.every(t => toBool(t.bloqueado) &&
             (!requireComment || String(t.comentario || '').trim() !== ''))) {
    status = 'Bloqueado'; alertType = 'BLOQUEADO';
  } else if (endDate && daysRemaining !== null && daysRemaining < 0) {
    status = 'Vencido'; alertType = 'VENCIDO';
  } else {
    // En riesgo si elapsed_pct - progress > umbral
    const startDate = project.fecha_inicio instanceof Date ? project.fecha_inicio :
                      (project.fecha_inicio ? new Date(project.fecha_inicio) : null);
    let inRisk = false;
    if (startDate && endDate) {
      const totalDays = Math.max(1, daysBetween(startDate, endDate));
      const elapsedDays = Math.max(0, daysBetween(startDate, todayDate));
      const elapsedPct = Math.min(1, elapsedDays / totalDays);
      const gapPts = (progressPct - elapsedPct) * 100;
      const riskThr = getConfigInt('RISK_GAP_THRESHOLD_PTS', -15);
      if (gapPts <= riskThr) inRisk = true;
    }
    const dueSoonDays = getConfigInt('DUE_SOON_DAYS', 7);
    if (inRisk || (daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= dueSoonDays && progressPct < 0.8)) {
      status = 'En riesgo'; alertType = 'EN_RIESGO';
    } else {
      status = 'En curso'; alertType = 'EN_CURSO';
    }
  }

  return {
    project_id: projectId,
    nombre: project.nombre,
    owner_id: project.owner_id,
    fecha_inicio: project.fecha_inicio,
    fecha_fin: project.fecha_fin,
    total_tasks: total,
    done_tasks: doneCount,
    blocked_valid: blockedValid.length,
    blocked_invalid: blockedInvalid.length,
    effective_total: effectiveTotal,
    progress_pct: progressPct,
    progress_pct_display: Math.round(progressPct * 100),
    status: status,
    alert_type: alertType,
    days_remaining: daysRemaining
  };
}

/**
 * Métricas de todos los proyectos.
 */
function computeAllProjectMetrics(todayDate) {
  if (!todayDate) todayDate = today();
  return getAllProjects().map(p => computeProjectMetrics(p.project_id, todayDate));
}

/**
 * Agrega un proyecto nuevo. Generado desde sidebar.
 */
function addProject(payload) {
  return withLock(() => {
    assertCanEditNow();
    if (!payload || !payload.nombre) throw new Error('Falta nombre del proyecto');
    if (!payload.owner_id) throw new Error('Falta responsable');
    const owner = getPersonById(payload.owner_id);
    if (!owner || !toBool(owner.activo)) throw new Error('Responsable inválido o inactivo');
    // updateProject ya lo validaba; al crear solo lo revisaba el panel.
    if (payload.fecha_inicio && payload.fecha_fin && _toISO(payload.fecha_fin) < _toISO(payload.fecha_inicio)) {
      throw new Error('Fecha fin no puede ser anterior a fecha inicio');
    }

    const projectId = nextId(SHEET_NAMES.PROYECTOS, 'project_id', 'PR', 3);

    appendRowByObject(SHEET_NAMES.PROYECTOS, {
      project_id: projectId,
      nombre: payload.nombre,
      owner_id: payload.owner_id,
      frente: payload.frente || 'EQUIPO',
      prioridad: payload.prioridad || 'Media',
      fecha_inicio: payload.fecha_inicio || '',
      fecha_fin: payload.fecha_fin || '',
      objetivo: payload.objetivo || '',
      link_drive: payload.link_drive || '',
      peso: payload.peso || 1,
      estado_manual: ''
    });

    // Tareas iniciales si se pidieron
    if (payload.add_initial_tasks) {
      for (let i = 1; i <= 3; i++) {
        appendRowByObject(SHEET_NAMES.TAREAS, {
          task_id: nextId(SHEET_NAMES.TAREAS, 'task_id', 'T', 4),
          project_id: projectId,
          nombre: 'Tarea inicial ' + i + ' (renombrar)',
          owner_ids: payload.owner_id,
          fecha_inicio: payload.fecha_inicio || '',
          fecha_fin: payload.fecha_fin || '',
          completada: 'FALSE',
          fecha_completada: '',
          peso: 1,
          bloqueado: 'FALSE',
          comentario: ''
        });
      }
    }

    logEvent('admin_change', getMonthId(), owner.email, owner.nombre,
             'Proyecto agregado: ' + projectId + ' — ' + payload.nombre,
             'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', '');

    return { ok: true, project_id: projectId };
  });
}

/**
 * Actualiza un proyecto existente.
 */
function updateProject(payload) {
  return withLock(() => {
    assertCanEditNow();
    if (!payload.project_id) throw new Error('Falta project_id');
    const project = getProjectById(payload.project_id);
    if (!project) throw new Error('Proyecto no existe: ' + payload.project_id);

    if (payload.owner_id) {
      const owner = getPersonById(payload.owner_id);
      if (!owner || !toBool(owner.activo)) throw new Error('Responsable inválido o inactivo');
    }
    if (payload.fecha_inicio && payload.fecha_fin) {
      if (new Date(payload.fecha_fin) < new Date(payload.fecha_inicio)) {
        throw new Error('Fecha fin no puede ser anterior a fecha inicio');
      }
    }

    // Fechas del proyecto: bloqueadas a admins/supervisores solo si PROJECT_DATES_LOCKED=TRUE (candado reversible).
    const cambiaInicio = payload.fecha_inicio !== undefined && _toISO(payload.fecha_inicio) !== _toISO(project.fecha_inicio);
    const cambiaFin    = payload.fecha_fin    !== undefined && _toISO(payload.fecha_fin)    !== _toISO(project.fecha_fin);
    if ((cambiaInicio || cambiaFin) && !canEditProjectDates()) {
      throw new Error('⛔ Solo un administrador puede cambiar las fechas del proyecto. Puedes editar lo demás.');
    }

    const updatable = ['nombre','owner_id','frente','prioridad','fecha_inicio','fecha_fin','objetivo','link_drive','peso','estado_manual'];
    updatable.forEach(field => {
      if (payload[field] !== undefined && payload[field] !== null) {
        setCellByHeader(SHEET_NAMES.PROYECTOS, project._rowIndex, field, payload[field]);
      }
    });

    logEvent('admin_change', getMonthId(), '', '',
             'Proyecto editado: ' + payload.project_id, 'OK',
             isSandboxMode() ? 'SANDBOX' : 'PROD', '');

    return { ok: true };
  });
}

/**
 * Archiva un proyecto (soft-delete). Marca estado_manual=Archivado.
 * El proyecto sigue en la base pero queda fuera de reportes activos.
 */
function archiveProject(projectId) {
  return withLock(() => {
    assertCanEditNow();
    const project = getProjectById(projectId);
    if (!project) throw new Error('Proyecto no existe: ' + projectId);

    setCellByHeader(SHEET_NAMES.PROYECTOS, project._rowIndex, 'estado_manual', 'Archivado');

    logEvent('admin_change', getMonthId(), '', '',
             'Proyecto archivado: ' + projectId + ' — ' + project.nombre,
             'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', '');

    return { ok: true };
  });
}

/**
 * Lista de proyectos activos (no archivados) para sidebars.
 */
function getActiveProjectsForUI() {
  return getAllProjects()
    .filter(p => (p.estado_manual || '') !== 'Archivado')
    .map(p => {
      const owner = getPersonById(p.owner_id);
      return {
        id: p.project_id,
        nombre: p.nombre,
        owner_id: p.owner_id,
        owner_name: owner ? owner.nombre : '?',
        frente: p.frente,
        prioridad: p.prioridad,
        fecha_inicio: fmtDateISO(p.fecha_inicio),
        fecha_fin: fmtDateISO(p.fecha_fin),
        objetivo: p.objetivo || '',
        link_drive: p.link_drive || '',
        peso: p.peso || 1
      };
    });
}
