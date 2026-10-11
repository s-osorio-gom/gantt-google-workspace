/**
 * Validations.gs — health check del sistema. Pobla 99_Validaciones.
 * Bloquea envíos si hay errores CRÍTICOS.
 */

/**
 * Corre todas las validaciones y rellena 99_Validaciones.
 * Devuelve: { critical: N, warnings: N, issues: [{nivel, hoja, fila, problema, sugerencia, link}] }
 */
function runValidations() {
  const issues = [];

  // Headers contract
  const REQUIRED_HEADERS = {
    '00_Config': ['clave', 'valor'],
    '01_Personas': ['person_id', 'nombre', 'email', 'rol', 'activo', 'recibe_reporte'],
    '02_Proyectos': ['project_id', 'nombre', 'owner_id', 'fecha_inicio', 'fecha_fin'],
    '03_Tareas': ['task_id', 'project_id', 'nombre', 'owner_ids', 'fecha_inicio', 'fecha_fin', 'completada', 'bloqueado']
  };
  Object.keys(REQUIRED_HEADERS).forEach(sheetName => {
    try {
      const cm = getColMap(sheetName);
      REQUIRED_HEADERS[sheetName].forEach(h => {
        if (!cm[h]) {
          issues.push({nivel: 'CRITICO', hoja: sheetName, fila: 1,
            problema: 'Falta columna oficial: ' + h,
            sugerencia: 'Restaurar la columna ' + h + ' en la fila 1.'});
        }
      });
    } catch (e) {
      issues.push({nivel: 'CRITICO', hoja: sheetName, fila: 0,
        problema: 'Pestaña inexistente o inaccesible',
        sugerencia: 'Verificar nombre exacto: ' + sheetName});
    }
  });

  // Si hay críticos de estructura, no sigas validando datos
  const structuralCritical = issues.some(i => i.nivel === 'CRITICO');

  if (!structuralCritical) {
    // Personas
    const personas = getAllPersons();
    const personIds = new Set();
    const personEmails = new Set();
    personas.forEach(p => {
      if (toBool(p.activo)) {
        if (!p.email) {
          issues.push({nivel: 'CRITICO', hoja: '01_Personas', fila: p._rowIndex,
            problema: 'Persona activa sin email: ' + p.nombre,
            sugerencia: 'Agregar email @' + getEmailDomain() + ' a la columna email.'});
        } else if (!isEmailDelDominio(p.email)) {
          issues.push({nivel: 'CRITICO', hoja: '01_Personas', fila: p._rowIndex,
            problema: 'Email inválido o dominio incorrecto: ' + p.email,
            sugerencia: 'Corregir a formato persona@' + getEmailDomain()});
        }
      }
      if (p.person_id) {
        if (personIds.has(p.person_id)) {
          issues.push({nivel: 'CRITICO', hoja: '01_Personas', fila: p._rowIndex,
            problema: 'person_id duplicado: ' + p.person_id,
            sugerencia: 'Cada persona debe tener person_id único.'});
        }
        personIds.add(p.person_id);
      }
      if (p.email) {
        const e = String(p.email).toLowerCase().trim();
        if (personEmails.has(e)) {
          issues.push({nivel: 'WARNING', hoja: '01_Personas', fila: p._rowIndex,
            problema: 'Email duplicado: ' + p.email,
            sugerencia: 'Verificar si hay dos filas para la misma persona.'});
        }
        personEmails.add(e);
      }
    });

    const avisoJefe = avisoJefeCanal(personas);
    if (avisoJefe) issues.push(avisoJefe);
    const avisoFest = avisoFestivos();
    if (avisoFest) issues.push(avisoFest);

    // Proyectos
    const projects = getAllProjects();
    const projIds = new Set();
    projects.forEach(p => {
      if (!p.owner_id) {
        issues.push({nivel: 'CRITICO', hoja: '02_Proyectos', fila: p._rowIndex,
          problema: 'Proyecto sin responsable: ' + p.nombre,
          sugerencia: 'Asignar owner_id de 01_Personas.'});
      } else {
        const owner = getPersonById(p.owner_id);
        if (!owner) {
          issues.push({nivel: 'CRITICO', hoja: '02_Proyectos', fila: p._rowIndex,
            problema: 'owner_id no existe en 01_Personas: ' + p.owner_id,
            sugerencia: 'Corregir referencia.'});
        } else if (!toBool(owner.activo)) {
          issues.push({nivel: 'WARNING', hoja: '02_Proyectos', fila: p._rowIndex,
            problema: 'Responsable inactivo asignado a proyecto: ' + owner.nombre,
            sugerencia: 'Reasignar a persona activa.'});
        }
      }
      if (p.fecha_inicio && p.fecha_fin) {
        const fi = new Date(p.fecha_inicio);
        const ff = new Date(p.fecha_fin);
        if (ff < fi) {
          issues.push({nivel: 'CRITICO', hoja: '02_Proyectos', fila: p._rowIndex,
            problema: 'fecha_fin < fecha_inicio en proyecto: ' + p.nombre,
            sugerencia: 'Intercambiar fechas o corregir.'});
        }
      }
      if (p.project_id) {
        if (projIds.has(p.project_id)) {
          issues.push({nivel: 'CRITICO', hoja: '02_Proyectos', fila: p._rowIndex,
            problema: 'project_id duplicado: ' + p.project_id,
            sugerencia: 'Cada proyecto debe tener ID único.'});
        }
        projIds.add(p.project_id);
      }
      // Proyecto abierto sin tareas
      const tasks = getTasksForProject(p.project_id);
      const metrics = computeProjectMetrics(p.project_id);
      if (tasks.length === 0 && metrics && metrics.status !== 'Completado') {
        issues.push({nivel: 'WARNING', hoja: '02_Proyectos', fila: p._rowIndex,
          problema: 'Proyecto abierto sin tareas: ' + p.nombre,
          sugerencia: 'Crear tareas en 03_Tareas o cerrar el proyecto.'});
      }
    });

    // Tareas
    const tasks = getAllTasks();
    const taskIds = new Set();
    tasks.forEach(t => {
      if (!t.project_id) {
        issues.push({nivel: 'CRITICO', hoja: '03_Tareas', fila: t._rowIndex,
          problema: 'Tarea sin project_id: ' + t.nombre,
          sugerencia: 'Asignar project_id de 02_Proyectos.'});
      } else if (!projIds.has(t.project_id)) {
        issues.push({nivel: 'CRITICO', hoja: '03_Tareas', fila: t._rowIndex,
          problema: 'project_id de la tarea no existe: ' + t.project_id,
          sugerencia: 'Corregir referencia.'});
      }
      if (t.task_id) {
        if (taskIds.has(t.task_id)) {
          issues.push({nivel: 'CRITICO', hoja: '03_Tareas', fila: t._rowIndex,
            problema: 'task_id duplicado: ' + t.task_id,
            sugerencia: 'Cada tarea debe tener ID único.'});
        }
        taskIds.add(t.task_id);
      }
      if (t.fecha_inicio && t.fecha_fin) {
        const fi = new Date(t.fecha_inicio);
        const ff = new Date(t.fecha_fin);
        if (ff < fi) {
          issues.push({nivel: 'CRITICO', hoja: '03_Tareas', fila: t._rowIndex,
            problema: 'fecha_fin < fecha_inicio en tarea: ' + t.nombre,
            sugerencia: 'Intercambiar fechas.'});
        }
      }
      // Bloqueada sin comentario
      if (toBool(t.bloqueado) && getConfigBool('BLOCKED_REQUIRES_COMMENT', true)) {
        if (!t.comentario || String(t.comentario).trim() === '') {
          issues.push({nivel: 'WARNING', hoja: '03_Tareas', fila: t._rowIndex,
            problema: 'Tarea bloqueada sin comentario: ' + t.nombre,
            sugerencia: 'Escribir motivo del bloqueo en columna comentario, o desbloquear.'});
        }
      }
      // owner_ids inválido
      if (t.owner_ids) {
        const ids = String(t.owner_ids).split(',').map(s => s.trim()).filter(Boolean);
        ids.forEach(id => {
          if (!personIds.has(id)) {
            issues.push({nivel: 'CRITICO', hoja: '03_Tareas', fila: t._rowIndex,
              problema: 'owner_id no existe en 01_Personas: ' + id + ' (tarea ' + t.nombre + ')',
              sugerencia: 'Corregir referencia o eliminar.'});
          }
        });
      }
    });
  }

  // Escribir resultado en 99_Validaciones
  writeValidations(issues);

  const critical = issues.filter(i => i.nivel === 'CRITICO').length;
  const warnings = issues.filter(i => i.nivel === 'WARNING').length;
  logInfo('Validaciones: ' + critical + ' críticos, ' + warnings + ' warnings');
  return { critical: critical, warnings: warnings, issues: issues };
}

/**
 * Aviso si hay jefes (recibe_reporte_jefe) pero ninguno es el jefe del canal: el
 * ejecutivo con detalle no le llegaría a nadie y la evaluación mensual no saldría.
 */
function avisoJefeCanal(personas) {
  const jefes = personas.filter(p => toBool(p.activo) && toBool(p.recibe_reporte_jefe));
  if (!jefes.length || jefes.some(esJefeCanal)) return null;
  return {nivel: 'WARNING', hoja: '01_Personas', fila: 0,
    problema: 'Ningún jefe activo con recibe_reporte_jefe=TRUE es el jefe del canal.',
    sugerencia: 'Ponga su person_id en JEFE_CANAL_ID de 00_Config (o use P001 / un rol con «canal»).'};
}

/**
 * Escribe la hoja 99_Validaciones (la limpia y la rellena).
 */
function writeValidations(issues) {
  const sh = getSheet(SHEET_NAMES.VALIDACIONES);
  // Limpiar todo menos fila 1 (headers)
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
  if (issues.length === 0) return;

  const sheetUrl = buildSheetUrl();
  const rows = issues.map(i => {
    const link = i.fila > 0 ? sheetUrl + '#gid=' + getSheetIdByName(i.hoja) + '&range=A' + i.fila : '';
    return [i.nivel, i.hoja, i.fila, i.problema, i.sugerencia, link];
  });
  sh.getRange(2, 1, rows.length, 6).setValues(rows);
}

function getSheetIdByName(name) {
  try { return getSheet(name).getSheetId(); }
  catch (e) { return ''; }
}

/**
 * Atajo desde menú: corre validaciones y muestra alerta.
 */
function runValidationsAndAlert() {
  assertAdmin('validar los datos desde el menú Admin');
  const result = runValidations();
  SpreadsheetApp.getUi().alert(
    'Validaciones completadas',
    'Errores críticos: ' + result.critical + '\nWarnings: ' + result.warnings +
    '\n\nVer detalle en pestaña 99_Validaciones.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Bloquea operación si hay errores críticos. Lanza error con detalle.
 */
function assertNoCriticalIssues(contextName) {
  const result = runValidations();
  if (result.critical > 0) {
    throw new Error('No se puede ejecutar ' + contextName + ': hay ' + result.critical +
                    ' errores críticos. Ver 99_Validaciones.');
  }
}
