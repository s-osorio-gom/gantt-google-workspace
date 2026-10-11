/**
 * 16_Vistas.gs — Vistas visuales con estética de presentación (generadas, solo-lectura).
 *
 * Pestaña "Resumen": entrada ejecutiva (KPIs + distribución que SUMA el total +
 * tabla por persona). Se regenera con un botón; no toca datos.
 * También oculta las pestañas de sistema para dejar la herramienta limpia.
 *
 * Menú: 🍀 EQUIPO → 📊 Resumen ejecutivo (reconstruir).
 */

/** Diagnóstico: métricas serializables de un proyecto (para QA con clasp run). */
function _diag_projectMetrics(projectId) {
  const m = computeProjectMetrics(projectId);
  if (!m) return { found: false, project_id: projectId };
  return {
    found: true,
    project_id: m.project_id,
    nombre: m.nombre,
    status: m.status,
    total_tasks: m.total_tasks,
    done_tasks: m.done_tasks,
    effective_total: m.effective_total,
    progress_pct_display: m.progress_pct_display,
    pert_total: Math.round(projectPertHours(projectId) * 10) / 10
  };
}

/** Diagnóstico: últimos correos registrados (event_type | status | mode). */
function _diag_lastEmails() {
  const rows = readSheetAsObjects(SHEET_NAMES.EMAIL_LOG).rows;
  return rows.slice(-9).map(r => (r.event_type || r.asunto || '?') + ' | ' + (r.status || '') + ' | ' + (r.mode || ''));
}

/**
 * DEMO: asigna fechas aleatorias de este mes a todos los proyectos, con mezcla
 * de vencidos / en curso / completados, para ver el Gantt poblado.
 * (Datos de prueba — sobreescribe fechas. Cada quien las ajusta luego en el editor.)
 */
function _demoFechas() {
  return withLock(() => {
    const projects = getAllProjects().filter(p => (p.estado_manual || '') !== 'Archivado');
    const t0 = today();
    const monthStart = new Date(t0.getFullYear(), t0.getMonth(), 1);
    const monthEnd = new Date(t0.getFullYear(), t0.getMonth() + 1, 0);
    const DAY = 86400000;
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const addDays = (d, n) => new Date(d.getTime() + n * DAY);
    const daysIn = Math.max(2, Math.floor((t0 - monthStart) / DAY));
    let venc = 0, curso = 0, comp = 0;

    projects.forEach((p, i) => {
      const mod = i % 5; // 0=comp(20%), 1-2=venc(40%), 3-4=curso(40%)
      let s, e, completar = false;
      if (mod === 1 || mod === 2) {            // VENCIDO: termina antes de hoy
        s = addDays(monthStart, rnd(0, Math.max(1, daysIn - 6)));
        e = addDays(s, rnd(3, 12));
        if (e >= t0) e = addDays(t0, -rnd(1, 3));
        if (e <= s) e = addDays(s, 2);
        venc++;
      } else if (mod === 3 || mod === 4) {     // EN CURSO: termina después de hoy
        s = addDays(t0, rnd(-6, 1));
        e = addDays(t0, rnd(3, 20));
        if (e > monthEnd) e = monthEnd;
        curso++;
      } else {                                 // COMPLETADO
        s = addDays(monthStart, rnd(0, 6));
        e = addDays(s, rnd(4, 14));
        completar = true; comp++;
      }
      setCellByHeader(SHEET_NAMES.PROYECTOS, p._rowIndex, 'fecha_inicio', fmtDateISO(s));
      setCellByHeader(SHEET_NAMES.PROYECTOS, p._rowIndex, 'fecha_fin', fmtDateISO(e));
      getTasksForProject(p.project_id).forEach(t => {
        setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'fecha_inicio', fmtDateISO(s));
        setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'fecha_fin', fmtDateISO(e));
        if (completar) {
          setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'completada', true);
          setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'fecha_completada', fmtDateISO(e));
        }
      });
    });
    return { proyectos: projects.length, vencidos: venc, enCurso: curso, completados: comp };
  });
}

/**
 * DEMO: reparte fechas de proyectos y tareas a lo largo de la ventana del Cronograma
 * (para verlo poblado). ~1 de cada 6 queda completado. Sobrescribe fechas.
 * Es data de prueba — el equipo la ajusta luego en el editor.
 */
function _demoFechasJulDic() {
  return withLock(() => {
    const projects = getAllProjects().filter(p => (p.estado_manual || '') !== 'Archivado');
    const w = ganttWindow();
    const DAY = 86400000;
    const span = Math.max(1, Math.round((w.end - w.start) / DAY));
    let comp = 0, curso = 0;
    projects.forEach((p, i) => {
      const offset = Math.floor(span * ((i % 5) / 6)) + ((i * 7) % 24); // escalonado en la ventana
      const dur = 12 + (i % 5) * 8;          // 12..44 días
      const s = new Date(w.start.getFullYear(), w.start.getMonth(), w.start.getDate() + Math.min(offset, span - 1));
      let e = new Date(s.getTime() + dur * DAY);
      if (e > w.end) e = new Date(w.end);
      const completar = (i % 6 === 0);
      setCellByHeader(SHEET_NAMES.PROYECTOS, p._rowIndex, 'fecha_inicio', fmtDateISO(s));
      setCellByHeader(SHEET_NAMES.PROYECTOS, p._rowIndex, 'fecha_fin', fmtDateISO(e));
      getTasksForProject(p.project_id).forEach(t => {
        setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'fecha_inicio', fmtDateISO(s));
        setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'fecha_fin', fmtDateISO(e));
        setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'completada', completar);
        setCellByHeader(SHEET_NAMES.TAREAS, t._rowIndex, 'fecha_completada', completar ? fmtDateISO(e) : '');
      });
      if (completar) comp++; else curso++;
    });
    return { proyectos: projects.length, completados: comp, enCurso: curso };
  });
}

/** Diagnóstico: ¿la hoja (vista) contiene este texto? Para verificar auto-refresco. */
function _diag_viewContains(sheetName, text) {
  const sh = getSS().getSheetByName(sheetName);
  if (!sh) return false;
  const vals = sh.getDataRange().getValues();
  const t = String(text);
  return vals.some(row => row.some(c => String(c).indexOf(t) >= 0));
}

/** Diagnóstico: pestañas visibles (para verificar la consolidación). */
function _diag_pestanas() {
  return getSS().getSheets().filter(s => !s.isSheetHidden()).map(s => s.getName());
}

/**
 * Refresca las vistas generadas SIN saltar de pestaña (para usar tras editar).
 * Se llama en segundo plano desde el panel de edición.
 */
function refrescarVistasSilencioso() {
  const errores = [];
  try { construirResumen(); } catch (e) { errores.push('Resumen: ' + e.message); logWarn('refrescar Resumen: ' + e.message); }
  try { construirProyectosYTareas(); } catch (e) { errores.push('Proyectos y Tareas: ' + e.message); logWarn('refrescar PyT: ' + e.message); }
  try { construirCronograma(); } catch (e) { errores.push('Cronograma: ' + e.message); logWarn('refrescar Cronograma: ' + e.message); }
  try { PropertiesService.getDocumentProperties().deleteProperty('viewsDirty'); } catch (_) {}
  return { ok: errores.length === 0, errores: errores };
}

/** Deja un mensaje de error visible en una vista para que NUNCA quede en blanco. */
function _vistaError(sh, nombre, e) {
  try {
    sh.clear();
    const f = sh.getFilter(); if (f) f.remove();
    sh.getRange(1, 1).setValue('⚠️ No se pudo actualizar la vista "' + nombre + '".\n\nDetalle: ' +
      (e && e.message ? e.message : e) + '\n\nUsa 🍀 EQUIPO › Admin › Reconstruir vistas, o avisa a soporte.')
      .setFontColor(AL.RED).setFontWeight('bold').setWrap(true).setVerticalAlignment('top');
    sh.setColumnWidth(1, 720);
    sh.setRowHeight(1, 90);
  } catch (_) { /* nada que hacer */ }
}

/**
 * Ordena las pestañas visibles: Resumen, Proyectos y Tareas, Cronograma.
 */
function ordenarPestanas() {
  const ss = getSS();
  const orden = ['Resumen', 'Proyectos y Tareas', 'Cronograma', 'EQUIPO — Logros'];
  let pos = 1;
  orden.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(pos); pos++; }
  });
}

/* Paleta de las vistas */
var AL = {
  NAVY:'#0F2D52', NAVY2:'#0A2140', BLUE:'#1F4E8C', LBLUE:'#5A8AB8', TINT:'#E6EEF7',
  AMBER:'#E0A82E', CLOUD:'#F4F6F8', LINE:'#D6DBE0', INK:'#243244', STEEL:'#6B7280',
  GREEN:'#3F8C5C', RED:'#C0392B', WHITE:'#FFFFFF'
};

/** Colapsa los 5 estados internos a 3 de cara al usuario. */
function mapStatus3(status) {
  if (status === 'Completado') return 'Completados';
  if (status === 'Vencido') return 'Vencidos';
  return 'En curso'; // En curso, En riesgo, Bloqueado
}

/* ============================================================================
 *  MENÚ
 * ============================================================================ */
/**
 * Reconstruye TODAS las vistas (sin UI) — testeable con clasp run.
 */
function reconstruirTodo() {
  const pasos = [];
  function paso(nombre, fn) { try { fn(); pasos.push('✅ ' + nombre); } catch (e) { pasos.push('❌ ' + nombre + ': ' + e.message); } }
  paso('Resumen', construirResumen);
  paso('Proyectos y Tareas', construirProyectosYTareas);
  paso('Cronograma', construirCronograma);
  paso('Logros', construirLogros);
  paso('Ordenar pestañas', ordenarPestanas);
  paso('Ocultar pestañas de sistema', ocultarPestanasSistema);
  return pasos;
}

function reconstruirVistasDesdeMenu() {
  assertAdmin('reconstruir las vistas');
  const pasos = reconstruirTodo();
  const ss = getSS();
  const sh = ss.getSheetByName('Resumen');
  if (sh) ss.setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('Vistas reconstruidas', pasos.join('\n') +
    '\n\nSi algo salió con ❌, el mensaje dice qué falló. Revise 99_Validaciones si los números no cuadran.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ============================================================================
 *  RESUMEN EJECUTIVO
 * ============================================================================ */
function construirResumen() {
  return withLock(() => {
    const ss = getSS();
    let sh = ss.getSheetByName('Resumen');
    if (!sh) sh = ss.insertSheet('Resumen');
    try {
      return _construirResumenBody(sh);
    } catch (e) {
      _vistaError(sh, 'Resumen', e);
      throw e;
    }
  });
}

function _construirResumenBody(sh) {
  sh.clear();
  const f0 = sh.getFilter(); if (f0) f0.remove();
  sh.setHiddenGridlines(true);

  const NC = 8;
  const W = [175,150,80,80,100,100,60,60];
  for (let c = 0; c < NC; c++) sh.setColumnWidth(c + 1, W[c]);

  // --- Datos ---
  const recId = getRecurringProjectId(); // el contenedor no cuenta como "proyecto"
  const projects = getAllProjects().filter(p => (p.estado_manual || '') !== 'Archivado'
                                                && String(p.project_id).trim() !== recId);
  const metrics = projects.map(p => computeProjectMetrics(p.project_id)).filter(Boolean);
  const nProj = metrics.length;
  let nComp = 0, nVenc = 0, nCurso = 0;
  metrics.forEach(m => {
    const s = mapStatus3(m.status);
    if (s === 'Completados') nComp++; else if (s === 'Vencidos') nVenc++; else nCurso++;
  });
  const personasActivas = getActivePersons();
  const nPers = personasActivas.length;
  const horasEquipo = Math.round(teamPertHours());

  // --- 1) Color-bar (fila 1) ---
  const bar = [AL.NAVY, AL.BLUE, AL.LBLUE, AL.AMBER, AL.GREEN, AL.RED, AL.NAVY2, AL.BLUE];
  sh.getRange(1, 1, 1, NC).setBackgrounds([bar]);
  sh.setRowHeight(1, 8);

  // --- 2) Título navy (filas 2-4), SIN merge para evitar conflictos ---
  sh.getRange(2, 1, 3, NC).setBackground(AL.NAVY);
  sh.getRange(2, 1).setValue('  Estado del equipo')
    .setFontColor(AL.WHITE).setFontSize(20).setFontWeight('bold').setVerticalAlignment('middle');
  sh.getRange(4, 1).setValue('  Resumen ejecutivo · actualizado ' + fmtDateHuman(today()))
    .setFontColor('#CFE0F5').setFontSize(11).setVerticalAlignment('middle');
  sh.setRowHeight(2, 30); sh.setRowHeight(3, 6); sh.setRowHeight(4, 22);

  // --- 3) Tarjetas KPI (fila 6 etiqueta, 7 número) ---
  const kpis = [
    ['Proyectos', nProj, AL.NAVY, AL.AMBER],
    ['Personas', nPers, AL.NAVY, AL.NAVY],
    ['● En curso', nCurso, AL.BLUE, AL.BLUE],
    ['● Vencidos', nVenc, AL.RED, AL.RED],
    ['● Completados', nComp, AL.GREEN, AL.GREEN],
    ['Horas equipo', horasEquipo + ' h', AL.NAVY, AL.AMBER]
  ];
  sh.setRowHeight(5, 6);
  const kLabels = [kpis.map(k => k[0])];
  const kNums = [kpis.map(k => k[1])];
  sh.getRange(6, 1, 1, kpis.length).setValues(kLabels).setFontColor(AL.STEEL).setFontSize(10)
    .setHorizontalAlignment('center').setBackground(AL.CLOUD);
  const numRange = sh.getRange(7, 1, 1, kpis.length);
  numRange.setValues(kNums).setFontSize(24).setFontWeight('bold')
    .setHorizontalAlignment('center').setBackground(AL.CLOUD);
  numRange.setFontColors([kpis.map(k => k[2])]);
  kpis.forEach((k, i) => {
    const col = i + 1;
    sh.getRange(6, col).setBorder(true, null, null, null, null, null, k[3], SpreadsheetApp.BorderStyle.SOLID_THICK);
    sh.getRange(6, col, 2, 1).setBorder(null, true, true, true, null, null, AL.LINE, SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.setRowHeight(7, 40);

  // --- 4) Barra de distribución (fila 9-10) que prueba la suma ---
  sh.getRange(9, 1).setValue('  Distribución por estado — la suma cuadra con el total')
    .setFontColor(AL.NAVY).setFontWeight('bold').setFontSize(12);
  const dist = [['En curso', nCurso, AL.BLUE], ['Vencidos', nVenc, AL.RED], ['Completados', nComp, AL.GREEN]];
  dist.forEach((d, i) => {
    sh.getRange(10, i + 1).setValue(d[0] + ': ' + d[1]).setBackground(d[2]).setFontColor(AL.WHITE)
      .setFontWeight('bold').setHorizontalAlignment('center').setFontSize(11);
  });
  sh.getRange(10, 4).setNumberFormat('@').setValue('Total: ' + (nCurso + nVenc + nComp) + ' ✓')
    .setFontColor(AL.NAVY).setFontWeight('bold').setVerticalAlignment('middle');
  sh.setRowHeight(10, 24);

  // --- 5) Tabla por persona (desde fila 12), 6 columnas ---
  const TN = 6;
  const head = ['Persona', 'Zona / Rol', 'Proyectos', 'Avance', 'Horas (PERT)', 'Alertas'];
  sh.getRange(12, 1, 1, TN).setValues([head])
    .setBackground(AL.NAVY).setFontColor(AL.WHITE).setFontWeight('bold').setFontSize(11);

  const byOwner = {};
  metrics.forEach(m => { (byOwner[m.owner_id] = byOwner[m.owner_id] || []).push(m); });

  const rows = [];
  personasActivas.forEach(p => {
    const ms = byOwner[p.person_id] || [];
    const recH = Math.round(recurringPertHoursForOwner(p.person_id));
    const nRec = getTasksForProject(recId).filter(t =>
      String(t.owner_ids || '').split(',').map(s => s.trim()).indexOf(p.person_id) >= 0).length;
    if (ms.length === 0 && nRec === 0) return; // sin proyectos ni recurrentes → no aparece
    const avg = ms.length ? Math.round(ms.reduce((a, m) => a + (m.progress_pct_display || 0), 0) / ms.length) : 0;
    const alert = ms.filter(m => mapStatus3(m.status) === 'Vencidos').length;
    const horas = Math.round(ownerPertHours(p.person_id)) + recH;
    const proyCell = ms.length + (nRec > 0 ? ' +' + nRec + '🔁' : '');
    rows.push([p.nombre, p.zona || p.rol || '', proyCell, avg + '%', horas + ' h',
               alert > 0 ? (alert + ' vencido' + (alert === 1 ? '' : 's')) : '—']);
  });
  if (rows.length) {
    sh.getRange(13, 1, rows.length, TN).setValues(rows).setFontSize(11);
    const bgs = rows.map((_, i) => new Array(TN).fill(i % 2 === 1 ? AL.CLOUD : AL.WHITE));
    sh.getRange(13, 1, rows.length, TN).setBackgrounds(bgs);
    sh.getRange(13, 1, rows.length, TN).setBorder(true, true, true, true, true, true, AL.LINE, SpreadsheetApp.BorderStyle.SOLID);
  }
  const totalRow = 13 + rows.length;
  sh.getRange(totalRow, 1, 1, TN).setValues([['TOTAL', '', nProj, '', horasEquipo + ' h', '']])
    .setFontWeight('bold').setBackground(AL.TINT);

  sh.setFrozenRows(1);
  const maxC = sh.getMaxColumns();
  if (maxC > NC) sh.deleteColumns(NC + 1, maxC - NC);

  logInfo('Resumen reconstruido: ' + nProj + ' proyectos, ' + nPers + ' personas, ' + horasEquipo + ' h');
  return { proyectos: nProj, personas: nPers, curso: nCurso, vencidos: nVenc, completados: nComp, horas: horasEquipo };
}

/* ============================================================================
 *  PROYECTOS Y TAREAS — vista AGRUPADA (proyecto primero, tareas desglosadas)
 * ============================================================================ */
function _estadoColor(s) {
  if (s === 'Completada' || s === 'Completados' || s === 'Completado') return AL.GREEN;
  if (s === 'Vencida' || s === 'Vencidos' || s === 'Vencido') return AL.RED;
  if (s === 'Bloqueada' || s === 'Bloqueado') return AL.STEEL;
  return AL.BLUE; // En curso / En riesgo
}

/**
 * Construye la pestaña "Proyectos y Tareas": cada proyecto como encabezado y,
 * debajo, sus tareas desglosadas. Generada (solo-lectura) con la estética de la casa.
 */
function construirProyectosYTareas() {
  return withLock(() => {
    const ss = getSS();
    let sh = ss.getSheetByName('Proyectos y Tareas');
    if (!sh) sh = ss.insertSheet('Proyectos y Tareas');
    try { return _construirPyTBody(sh); }
    catch (e) { _vistaError(sh, 'Proyectos y Tareas', e); throw e; }
  });
}

function _construirPyTBody(sh) {
  sh.clear();
  const fexist = sh.getFilter(); if (fexist) fexist.remove();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.setHiddenGridlines(true);

  // A=✔ | B=nombre | C=resp | D=ini | E=fin | F=estado | G=avance | H=horas | I=task_id(oculto)
  const NC = 9;
  const have0 = sh.getMaxColumns();
  if (have0 < NC) sh.insertColumnsAfter(have0, NC - have0);
  const W = [40, 330, 150, 90, 90, 110, 70, 95, 90];
  for (let c = 0; c < NC; c++) sh.setColumnWidth(c + 1, W[c]);

  const bar = [AL.NAVY, AL.BLUE, AL.LBLUE, AL.AMBER, AL.GREEN, AL.RED, AL.NAVY2, AL.BLUE, AL.NAVY];
  sh.getRange(1, 1, 1, NC).setBackgrounds([bar]);
  sh.setRowHeight(1, 8);
  sh.getRange(2, 1, 1, NC).setBackground(AL.NAVY);
  sh.getRange(2, 1).setValue('  Proyectos y Tareas   ·   marca la casilla ✔ para completar una tarea')
    .setFontColor(AL.WHITE).setFontSize(16).setFontWeight('bold').setVerticalAlignment('middle');
  sh.setRowHeight(2, 32);

  const HEAD = ['✔', 'Proyecto / Tarea', 'Responsable', 'Inicio', 'Fin', 'Estado', 'Avance', 'Horas (PERT)', 'task_id'];
  sh.getRange(4, 1, 1, NC).setValues([HEAD]).setBackground(AL.NAVY).setFontColor(AL.WHITE)
    .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');
  sh.getRange(4, 2).setHorizontalAlignment('left');
  sh.setFrozenRows(4);

  const projects = getAllProjects()
    .filter(p => (p.estado_manual || '') !== 'Archivado')
    .map(p => ({ p: p, owner: ownerIdsToNames(p.owner_id) || '(sin responsable)' }))
    .sort((a, b) => (a.owner + a.p.nombre).localeCompare(b.owner + b.p.nombre));

  const today_ = today();
  const values = [], meta = [];
  projects.forEach(item => {
    const p = item.p;
    const m = computeProjectMetrics(p.project_id);
    const est3 = m ? mapStatus3(m.status) : 'En curso';
    const ph = Math.round(projectPertHours(p.project_id));
    values.push(['', '▸ ' + p.nombre, item.owner, fmtDateHuman(p.fecha_inicio), fmtDateHuman(p.fecha_fin),
                 est3, (m ? m.progress_pct_display : 0) + '%', ph + ' h', '']);
    meta.push({ tipo: 'proj', color: _estadoColor(est3) });
    getTasksForProjectSorted(p.project_id).forEach(t => {
      let est = 'En curso';
      if (toBool(t.completada)) est = 'Completada';
      else if (t.fecha_fin && new Date(t.fecha_fin) < today_) est = 'Vencida';
      const ph2 = (t.pert_horas === '' || t.pert_horas === undefined || t.pert_horas === null) ? '' : (t.pert_horas + ' h');
      values.push([toBool(t.completada), '     ' + t.nombre, ownerIdsToNames(t.owner_ids) || item.owner,
                   fmtDateHuman(t.fecha_inicio), fmtDateHuman(t.fecha_fin), est, '', ph2, t.task_id]);
      meta.push({ tipo: 'task', color: _estadoColor(est) });
    });
  });

  const startRow = 5, n = values.length;
  if (n) {
    const rng = sh.getRange(startRow, 1, n, NC);
    rng.setValues(values).setFontSize(11).setVerticalAlignment('middle');

    const bgs = [], fcs = [], fws = [];
    for (let i = 0; i < n; i++) {
      const isP = meta[i].tipo === 'proj';
      const rowBg = isP ? AL.TINT : (i % 2 === 1 ? AL.CLOUD : AL.WHITE);
      const bgRow = new Array(NC).fill(rowBg);
      if (isP) bgRow[5] = meta[i].color + '22';
      bgs.push(bgRow);
      const fcRow = new Array(NC).fill(AL.INK);
      fcRow[1] = isP ? AL.NAVY : AL.INK;
      fcRow[5] = meta[i].color;
      fcs.push(fcRow);
      const fwRow = new Array(NC).fill('normal');
      fwRow[5] = 'bold';
      if (isP) { fwRow[1] = 'bold'; fwRow[6] = 'bold'; fwRow[7] = 'bold'; }
      fws.push(fwRow);
    }
    rng.setBackgrounds(bgs); rng.setFontColors(fcs); rng.setFontWeights(fws);

    // checkboxes SOLO en filas-tarea (col A)
    const cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    const dvs = [];
    for (let i = 0; i < n; i++) dvs.push([meta[i].tipo === 'task' ? cb : null]);
    sh.getRange(startRow, 1, n, 1).setDataValidations(dvs);
    sh.getRange(startRow, 1, n, 1).setHorizontalAlignment('center');
    sh.getRange(startRow, 7, n, 2).setHorizontalAlignment('center');
    rng.setBorder(true, true, true, true, true, true, '#E8EBEF', SpreadsheetApp.BorderStyle.SOLID);

    // filtro por Responsable — columnas visibles A..H (task_id queda fuera)
    sh.getRange(4, 1, n + 1, 8).createFilter();
  }

  sh.hideColumns(9);
  const maxC = sh.getMaxColumns();
  if (maxC > NC) sh.deleteColumns(NC + 1, maxC - NC);
  logInfo('Proyectos y Tareas: ' + projects.length + ' proyectos, ' + n + ' filas');
  return { proyectos: projects.length, filas: n };
}

/**
 * Handler de edición de la hoja "Proyectos y Tareas": casilla ✔ funcional.
 * Actualiza SOLO las celdas afectadas (respeta el filtro/scroll del usuario) y
 * refresca Resumen + Cronograma en segundo plano.
 */
function onPyTEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const col = e.range.getColumn(), row = e.range.getRow();
  if (col !== 1 || row < 5) return;                 // solo la casilla, solo datos
  // Editor desconocido (Apps Script no revela el email) → null: no queda exento del bloqueo.
  const editor = (e.user && e.user.getEmail) ? (String(e.user.getEmail() || '') || null) : null;

  // bloqueo por día (equipo solo jueves; admins/supervisores cualquier día)
  if (!isEditAllowedNow(editor)) {
    e.range.setValue(e.oldValue === undefined ? false : e.oldValue);
    _toastActive('🔒 Solo puedes actualizar los ' + _DIAS_ES[editLockDay()] + '. Hoy está bloqueado.');
    return;
  }
  const taskId = String(sh.getRange(row, 9).getValue()).trim();
  if (!taskId) {                                    // fila de proyecto: no se marca aquí
    e.range.setValue('');
    _toastActive('Marca las TAREAS (no el proyecto). El proyecto se completa solo cuando todas sus tareas están listas.');
    return;
  }
  const val = toBool(e.range.getValue());
  try {
    setTaskCompleted(taskId, val);                  // escribe (invalida cache de tareas)
    const t = getTaskById(taskId);                  // relee fresco
    _pytUpdateAfterCheck(sh, row, t);               // actualiza tarea + proyecto en la MISMA hoja (instantáneo)
    if (t) { try { _cronogramaUpdateProject(t.project_id); } catch (_) {} } // barra del proyecto en el Cronograma (rápido)
    _markViewsDirty();                              // el Resumen se refresca solo (disparador 1 min) — el check queda instantáneo
    _toastActive(val ? '✅ Tarea completada.' : 'Tarea reabierta.');
  } catch (err) {
    e.range.setValue(!val);
    _toastActive('No se pudo: ' + err.message);
  }
}

/** Actualiza en sitio la fila de la tarea y el encabezado de su proyecto (estado + avance). */
function _pytUpdateAfterCheck(sh, taskRow, t) {
  if (!t) t = getTaskById(String(sh.getRange(taskRow, 9).getValue()).trim());
  if (!t) return;
  let est = 'En curso';
  if (toBool(t.completada)) est = 'Completada';
  else if (t.fecha_fin && new Date(t.fecha_fin) < today()) est = 'Vencida';
  sh.getRange(taskRow, 6).setValue(est).setFontColor(_estadoColor(est)).setFontWeight('bold');

  // subir hasta el encabezado del proyecto (fila-tarea tiene task_id; proyecto no)
  let r = taskRow - 1;
  while (r >= 5 && String(sh.getRange(r, 9).getValue()).trim() !== '') r--;
  if (r >= 5) {
    const m = computeProjectMetrics(t.project_id);
    if (m) {
      const est3 = mapStatus3(m.status);
      sh.getRange(r, 6).setValue(est3).setFontColor(_estadoColor(est3)).setFontWeight('bold').setBackground(_estadoColor(est3) + '22');
      sh.getRange(r, 7).setValue(m.progress_pct_display + '%');
    }
  }
}

/** Arreglo de fondos (finde/festivo) de una fila del Gantt, con la barra pintada del color dado. */
function _ganttRowBgArray(g, start, end, color) {
  const ND = g.ndays;
  const row = new Array(ND);
  for (let d = 0; d < ND; d++) {
    const gd = g.days[d];
    row[d] = gd.holiday ? '#F3E1D5' : gd.weekend ? '#ECEEF2' : AL.WHITE;
  }
  if (start && end) {
    let sIdx = _dayIndex(g, start), eIdx = _dayIndex(g, end);
    if (sIdx === null) sIdx = (_toISO(start) < g.days[0].iso) ? 0 : ND;
    if (eIdx === null) eIdx = (_toISO(end) > g.days[ND - 1].iso) ? ND - 1 : -1;
    sIdx = Math.max(0, sIdx); eIdx = Math.min(ND - 1, eIdx);
    if (eIdx >= sIdx && sIdx < ND && eIdx >= 0) for (let d = sIdx; d <= eIdx; d++) row[d] = color;
  }
  return row;
}

/** Repinta en sitio la barra de UN proyecto en el Cronograma (sin reconstruir toda la hoja). */
function _cronogramaUpdateProject(projectId) {
  const sh = getSS().getSheetByName('Cronograma');
  if (!sh) return;
  const p = getProjectById(projectId);
  if (!p) return;
  const last = sh.getLastRow();
  if (last < 5) return;
  const names = sh.getRange(5, 1, last - 4, 1).getValues();
  const target = ('▸ ' + p.nombre).trim();
  let rowIdx = -1;
  for (let i = 0; i < names.length; i++) { if (String(names[i][0]).trim() === target) { rowIdx = 5 + i; break; } }
  if (rowIdx < 0) return;
  const g = _ganttGrid();
  const D0 = 3, ND = g.ndays;
  const sp = _spanProyecto(p);
  const m = computeProjectMetrics(projectId);
  const color = _estadoColor(m ? mapStatus3(m.status) : 'En curso');
  const bg = _ganttRowBgArray(g, sp.s, sp.e, color);
  const vals = new Array(ND).fill('');
  let sIdx = _dayIndex(g, sp.s);
  if (sIdx === null && sp.s && _toISO(sp.s) < g.days[0].iso) sIdx = 0;
  if (sIdx !== null && sIdx >= 0 && sIdx < ND && sp.s && sp.e) vals[sIdx] = (m ? m.progress_pct_display : 0) + '%';
  const rng = sh.getRange(rowIdx, D0, 1, ND);
  rng.setBackgrounds([bg]);
  rng.setValues([vals]).setFontColor(AL.WHITE).setFontSize(8).setFontWeight('bold');
}

/** Toast breve en el Sheet activo. */
function _toastActive(msg) { try { getSS().toast(msg, 'EQUIPO', 5); } catch (_) {} }

/** Marca que el Resumen quedó desactualizado (lo refresca el disparador de 1 min). */
function _markViewsDirty() {
  try { PropertiesService.getDocumentProperties().setProperty('viewsDirty', '1'); } catch (_) {}
}

/** Disparador cada 1 min: si hay cambios pendientes, refresca el Resumen (sin bloquear al usuario). */
function autoRefreshDirty() {
  try {
    const props = PropertiesService.getDocumentProperties();
    if (props.getProperty('viewsDirty') === '1') {
      props.deleteProperty('viewsDirty');
      try { construirResumen(); } catch (e) { logWarn('autoRefresh Resumen: ' + e.message); }
      try { construirLogros(); } catch (e) { logWarn('autoRefresh Logros: ' + e.message); }
      try { syncRelevantesToConfid(); } catch (e) { logWarn('autoRefresh Relevantes: ' + e.message); }
    }
  } catch (_) {}
}

/**
 * Elimina pestañas innecesarias: 05_Dashboard, 10_Mensajes_Motivacionales y los respaldos *_bak_*.
 * Conserva Config/Personas/Proyectos/Tareas/Email_Log/Validaciones/Snapshots y las vistas.
 */
function eliminarPestanasInnecesarias() {
  const ss = getSS();
  const borrarExactos = [SHEET_NAMES.DASHBOARD, SHEET_NAMES.MOTIVACIONALES];
  const borrados = [];
  const safe = ss.getSheetByName('Resumen') || ss.getSheets()[0];
  if (safe) ss.setActiveSheet(safe);
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if (borrarExactos.indexOf(name) >= 0 || /_bak_/.test(name)) {
      try { ss.deleteSheet(sh); borrados.push(name); } catch (e) { logWarn('No se pudo borrar ' + name + ': ' + e.message); }
    }
  });
  logInfo('Pestañas eliminadas: ' + borrados.join(', '));
  return { borrados: borrados };
}

/* ============================================================================
 *  CRONOGRAMA — Gantt dibujado (barras por estado)
 * ============================================================================ */
// _mondayOf() vive en 01_Utils.gs: en Apps Script todos los archivos
// comparten un único ámbito global y definirla aquí la duplicaba.

/** Span de un proyecto: usa sus fechas o las deriva de sus tareas. {s,e} o {null,null}. */
function _spanProyecto(p) {
  let s = p.fecha_inicio ? new Date(p.fecha_inicio) : null;
  let e = p.fecha_fin ? new Date(p.fecha_fin) : null;
  if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) {
    const ts = getTasksForProject(p.project_id).filter(t => t.fecha_inicio && t.fecha_fin);
    if (ts.length) {
      const st = ts.map(t => new Date(t.fecha_inicio).getTime());
      const en = ts.map(t => new Date(t.fecha_fin).getTime());
      if (!s || isNaN(s.getTime())) s = new Date(Math.min.apply(null, st));
      if (!e || isNaN(e.getTime())) e = new Date(Math.max.apply(null, en));
    }
  }
  if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return { s: null, e: null };
  return { s: s, e: e };
}

var _MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/**
 * Festivos que se sombrean en el Cronograma, como { 'yyyy-mm-dd': true }.
 * Vienen de la clave FESTIVOS de 00_Config (fechas separadas por coma).
 * Antes era una lista fija de festivos de un país para jul–dic 2026.
 */
function _festivos() {
  return _parseFestivos().fechas;
}

/**
 * Lee FESTIVOS: fechas yyyy-mm-dd separadas por coma, punto y coma o espacio.
 * Una sola fecha en la celda llega como Date (Sheets la convierte). Cualquier
 * otro fragmento se ignora y se informa: antes «2026» suelto se interpretaba
 * como 1-ene UTC y sombreaba el 31-dic del año anterior.
 */
function _parseFestivos() {
  const fechas = {}, ignorados = [];
  const raw = getConfig('FESTIVOS');
  const partes = raw instanceof Date ? [raw] : String(raw || '').split(/[,;\s]+/);
  partes.forEach(s => {
    if (s === '' || s === null || s === undefined) return;
    const iso = _fechaConfigISO(s);
    if (iso) fechas[iso] = true; else ignorados.push(String(s));
  });
  return { fechas: fechas, ignorados: ignorados };
}

/** Aviso para 99_Validaciones si FESTIVOS tiene fragmentos que no son fechas (o null). */
function avisoFestivos() {
  let ign = [];
  try { ign = _parseFestivos().ignorados; } catch (e) { return null; }
  if (!ign.length) return null;
  return {nivel: 'WARNING', hoja: SHEET_NAMES.CONFIG, fila: 0,
    problema: 'FESTIVOS tiene fragmentos que no son fechas yyyy-mm-dd y se ignoran: ' + ign.join(', '),
    sugerencia: 'Deje solo fechas yyyy-mm-dd separadas por coma (ej. 2026-12-08, 2026-12-25).'};
}

/**
 * Fecha de 00_Config como 'yyyy-mm-dd', o '' si no es una fecha completa que
 * exista. Acepta Date (Sheets convierte lo que parece fecha) o texto
 * yyyy-mm-dd exacto; nunca interpreta un año suelto ni texto libre.
 */
function _fechaConfigISO(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : fmtDateISO(v);
  const s = String(v === null || v === undefined ? '' : v).trim();
  return _isoValida(s) ? s : '';
}

/** ¿Es 'yyyy-mm-dd' una fecha que existe? (rechaza 2026-02-30 o 2027-02-29). */
function _isoValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const p = s.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}

/**
 * Ventana del Cronograma: GANTT_DESDE / GANTT_HASTA de 00_Config (yyyy-mm-dd).
 * Sin ellas, el semestre en curso (ene–jun o jul–dic). Antes estaba fija en
 * jul–dic 2026: desde enero de 2027 todas las barras quedaban fuera de rango.
 * Devuelve { start, end } como fechas locales a las 00:00.
 */
function ganttWindow(hoy) {
  const ref = hoy || today();
  const desde = _fechaConfigISO(getConfig('GANTT_DESDE'));
  const hasta = _fechaConfigISO(getConfig('GANTT_HASTA'));
  const okIso = _isoValida;
  const local = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  if (okIso(desde) && okIso(hasta) && desde <= hasta) {
    const ini = local(desde), fin = local(hasta);
    // tope de ~2 años: una columna por día, y Sheets tiene límite de columnas
    if ((fin - ini) / 86400000 <= 731) return { start: ini, end: fin };
    logWarn('GANTT_DESDE/GANTT_HASTA abarcan más de 2 años; se usa el semestre en curso.');
  }
  const y = ref.getFullYear();
  return ref.getMonth() < 6
    ? { start: new Date(y, 0, 1), end: new Date(y, 5, 30) }
    : { start: new Date(y, 6, 1), end: new Date(y, 11, 31) };
}

/** Rejilla diaria del Gantt (ventana de ganttWindow()). */
function _ganttGrid() {
  const w = ganttWindow();
  const festivos = _festivos();
  const t0iso = fmtDateISO(today());
  const days = [];
  // Se avanza por fecha de calendario (no sumando 24 h) para no saltarse días en cambios de horario.
  for (let d = new Date(w.start); d.getTime() <= w.end.getTime();
       d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const iso = Utilities.formatDate(d, tz(), 'yyyy-MM-dd');
    const dow = d.getDay();
    days.push({ iso: iso, dayNum: d.getDate(), month: d.getMonth(),
                weekend: (dow === 0 || dow === 6), holiday: !!festivos[iso],
                today: (iso === t0iso) });
  }
  return { start: w.start, end: w.end, days: days, ndays: days.length };
}

/** Etiqueta del rango del Gantt (ej. "julio 2026 – diciembre 2026"). */
function _ganttRangeLabel() {
  const w = ganttWindow();
  const m = d => _MESES[d.getMonth()].toLowerCase() + ' ' + d.getFullYear();
  return m(w.start) + ' – ' + m(w.end);
}

/** Índice de columna (0-based) del día que corresponde a una fecha, o null si fuera de rango. */
function _dayIndex(g, date) {
  if (!date) return null;
  const iso = _toISO(date);
  if (!iso) return null;
  for (let i = 0; i < g.days.length; i++) if (g.days[i].iso === iso) return i;
  return null;
}

/**
 * Dibuja un Gantt DIARIO (una columna por día del mes) en la hoja dada.
 * filas: [{label, owner, start(Date|null), end(Date|null), color, prog, esTarea}]
 */
function _dibujarGanttDiario(sh, filas, titulo) {
  sh.clear();
  const ff = sh.getFilter(); if (ff) ff.remove();
  sh.setHiddenGridlines(true);
  const g = _ganttGrid();
  const NAME = 1, RESP = 2, D0 = 3, ND = g.ndays, NC = D0 + ND - 1;

  const have = sh.getMaxColumns();
  if (have < NC) sh.insertColumnsAfter(have, NC - have);
  sh.setColumnWidth(NAME, 240); sh.setColumnWidth(RESP, 120);
  sh.setColumnWidths(D0, ND, 34); // una sola llamada (rápido) — ancho para "dd/mm"

  // fila 1: color-bar
  const barColors = [AL.NAVY, AL.BLUE, AL.LBLUE, AL.AMBER, AL.GREEN, AL.RED, AL.NAVY2];
  const bar1 = []; for (let c = 0; c < NC; c++) bar1.push(barColors[c % barColors.length]);
  sh.getRange(1, 1, 1, NC).setBackgrounds([bar1]);
  sh.setRowHeight(1, 6);

  // fila 2: título (sin merge)
  sh.getRange(2, 1, 1, NC).setBackground(AL.NAVY);
  sh.getRange(2, NAME).setValue('  ' + titulo).setFontColor(AL.WHITE).setFontSize(15).setFontWeight('bold').setVerticalAlignment('middle');
  sh.setRowHeight(2, 26);

  // fila 3: banda de meses (una celda combinada por mes, dentro de las columnas de día)
  sh.getRange(3, 1, 1, NC).setBackground(AL.NAVY2);
  let i = 0;
  while (i < ND) {
    const mth = g.days[i].month;
    let j = i; while (j < ND && g.days[j].month === mth) j++;
    const cell = sh.getRange(3, D0 + i, 1, j - i);
    try { cell.merge(); } catch (_) {}
    cell.setValue(_MESES[mth].toUpperCase()).setFontColor(AL.WHITE).setFontSize(9).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    i = j;
  }
  sh.setRowHeight(3, 16);

  // fila 4: encabezados de día
  sh.getRange(4, NAME).setValue('Proyecto / Tarea').setBackground(AL.NAVY).setFontColor(AL.WHITE).setFontWeight('bold');
  sh.getRange(4, RESP).setValue('Responsable').setBackground(AL.NAVY).setFontColor(AL.WHITE).setFontWeight('bold');
  const dayHdr = [], dayBg = [];
  for (let d = 0; d < ND; d++) {
    const gd = g.days[d];
    dayHdr.push(gd.iso.slice(8, 10) + '/' + gd.iso.slice(5, 7)); // dd/mm
    dayBg.push(gd.today ? AL.AMBER : gd.holiday ? '#B0641E' : gd.weekend ? '#8A93A8' : AL.NAVY);
  }
  const hr = sh.getRange(4, D0, 1, ND);
  hr.setNumberFormat('@'); // texto: evita que "01/07" se convierta en fecha
  hr.setValues([dayHdr]).setFontColor(AL.WHITE).setFontSize(7).setHorizontalAlignment('center').setFontWeight('bold');
  hr.setBackgrounds([dayBg]);
  sh.setRowHeight(4, 16);
  sh.setFrozenRows(4); sh.setFrozenColumns(2);

  const startRow = 5, n = filas.length;
  if (n) {
    // columnas NAME + RESP
    const nameVals = [], respVals = [], nameFc = [], nameFw = [], nrBg = [];
    filas.forEach((f, k) => {
      nameVals.push([(f.esTarea ? '     ' : '▸ ') + f.label]);
      respVals.push([f.owner]);
      nameFc.push([f.esTarea ? AL.INK : AL.NAVY]);
      nameFw.push([f.esTarea ? 'normal' : 'bold']);
      const z = (k % 2 === 1) ? AL.CLOUD : AL.WHITE;
      nrBg.push([z, z]);
    });
    sh.getRange(startRow, NAME, n, 1).setValues(nameVals).setFontSize(9).setVerticalAlignment('middle').setFontColors(nameFc).setFontWeights(nameFw);
    sh.getRange(startRow, RESP, n, 1).setValues(respVals).setFontSize(9).setVerticalAlignment('middle');
    sh.getRange(startRow, NAME, n, 2).setBackgrounds(nrBg);

    // rejilla de días: fondo base (finde/festivo) + barras (por lotes)
    const grid = [], gridVals = [];
    for (let k = 0; k < n; k++) {
      const row = new Array(ND), rowV = new Array(ND).fill('');
      for (let d = 0; d < ND; d++) {
        const gd = g.days[d];
        row[d] = gd.holiday ? '#F3E1D5' : gd.weekend ? '#ECEEF2' : AL.WHITE;
      }
      grid.push(row); gridVals.push(rowV);
    }
    filas.forEach((f, k) => {
      if (!f.start || !f.end) return;
      let sIdx = _dayIndex(g, f.start), eIdx = _dayIndex(g, f.end);
      if (sIdx === null) sIdx = (_toISO(f.start) < g.days[0].iso) ? 0 : ND;      // antes del rango → 0; después → fuera
      if (eIdx === null) eIdx = (_toISO(f.end) > g.days[ND - 1].iso) ? ND - 1 : -1; // después → fin; antes → fuera
      sIdx = Math.max(0, sIdx); eIdx = Math.min(ND - 1, eIdx);
      if (eIdx >= sIdx && sIdx < ND && eIdx >= 0) {
        for (let d = sIdx; d <= eIdx; d++) grid[k][d] = f.color;
        if (!f.esTarea) gridVals[k][sIdx] = f.prog + '%';
      }
    });
    // marcas puntuales (repeticiones de tareas recurrentes): una celda pintada por ocurrencia
    filas.forEach((f, k) => {
      if (!f.marks || !f.marks.length) return;
      f.marks.forEach(md => { const mi = _dayIndex(g, md); if (mi !== null && mi >= 0 && mi < ND) grid[k][mi] = f.color; });
    });
    const dayRange = sh.getRange(startRow, D0, n, ND);
    dayRange.setBackgrounds(grid);
    dayRange.setValues(gridVals).setFontColor(AL.WHITE).setFontSize(8).setFontWeight('bold');
    for (let k = 0; k < n; k++) sh.setRowHeight(startRow + k, 18);

    // filtro SOLO en Proyecto + Responsable (así los números de día quedan visibles)
    sh.getRange(4, 1, n + 1, 2).createFilter();
  }

  const maxC = sh.getMaxColumns(); if (maxC > NC) sh.deleteColumns(NC + 1, maxC - NC);
  return { filas: n, dias: ND };
}

/**
 * Cronograma principal: Gantt diario del mes, una barra por proyecto.
 * Filtra arriba por Responsable para ver una persona.
 */
function construirCronograma() {
  return withLock(() => {
    const ss = getSS();
    let sh = ss.getSheetByName('Cronograma');
    if (!sh) sh = ss.insertSheet('Cronograma');
    const projects = getAllProjects().filter(p => (p.estado_manual || '') !== 'Archivado');
    const recId = getRecurringProjectId();
    const arr = [];
    projects.forEach(p => {
      const sp = _spanProyecto(p);
      const m = computeProjectMetrics(p.project_id);
      arr.push({ p: p, owner: ownerIdsToNames(p.owner_id) || '—', s: sp.s, e: sp.e,
                 est: m ? mapStatus3(m.status) : 'En curso', prog: m ? m.progress_pct_display : 0 });
    });
    arr.sort((a, b) => a.owner.localeCompare(b.owner) || ((a.s && b.s) ? (a.s - b.s) : 0));
    const t0 = today();
    const filas = [];
    arr.forEach(o => {
      // El contenedor "🔁 Recurrentes" se expande en una barra por tarea (para verlas en el Gantt);
      // si no tiene tareas, no se muestra (evita una barra vacía).
      if (recId && String(o.p.project_id).trim() === recId) {
        const recTasks = getTasksForProjectSorted(o.p.project_id);
        if (!recTasks.length) return;
        filas.push({ label: o.p.nombre, owner: o.owner, start: o.s, end: o.e,
                     color: _estadoColor(o.est), prog: o.prog, esTarea: false });
        recTasks.forEach(t => {
          const occ = t.rec_source ? recurrenceOccurrencesFor(t.rec_source) : [];
          if (occ.length) {
            // una sola fila con una MARCA por repetición (no barra continua)
            filas.push({ label: t.nombre, owner: ownerIdsToNames(t.owner_ids) || '—',
                         start: null, end: null, marks: occ,
                         color: _estadoColor('En curso'), prog: 0, esTarea: true });
          } else {
            filas.push({ label: t.nombre, owner: ownerIdsToNames(t.owner_ids) || '—',
                         start: t.fecha_inicio ? new Date(t.fecha_inicio) : null,
                         end: t.fecha_fin ? new Date(t.fecha_fin) : null,
                         color: _estadoColor('En curso'), prog: 0, esTarea: true });
          }
        });
        return;
      }
      filas.push({ label: o.p.nombre, owner: o.owner, start: o.s, end: o.e,
                   color: _estadoColor(o.est), prog: o.prog, esTarea: false });
    });
    const r = _dibujarGanttDiario(sh, filas, 'Cronograma — ' + _ganttRangeLabel());
    logInfo('Cronograma diario: ' + filas.length + ' proyectos');
    return { proyectos: filas.length, dias: r.dias };
  });
}

/**
 * Gantt FILTRADO por persona o proyecto, mostrando proyectos + sus tareas.
 * tipo: 'persona' | 'proyecto'. Genera la pestaña "Gantt filtrado".
 */
function construirGanttFiltrado(tipo, valor) {
  return withLock(() => {
    const ss = getSS();
    let sh = ss.getSheetByName('Gantt filtrado');
    if (!sh) sh = ss.insertSheet('Gantt filtrado');
    let projects = getAllProjects().filter(p => (p.estado_manual || '') !== 'Archivado');
    let titulo = 'Gantt';
    if (tipo === 'persona' && valor) {
      projects = projects.filter(p => String(p.owner_id).trim() === String(valor).trim());
      const per = getPersonById(valor); titulo = 'Gantt — ' + (per ? per.nombre : valor);
    } else if (tipo === 'proyecto' && valor) {
      projects = projects.filter(p => String(p.project_id).trim() === String(valor).trim());
      const pr = getProjectById(valor); titulo = 'Gantt — ' + (pr ? pr.nombre : valor);
    }
    const t0 = today();
    const filas = [];
    projects.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))).forEach(p => {
      const sp = _spanProyecto(p);
      const m = computeProjectMetrics(p.project_id);
      filas.push({ label: p.nombre, owner: ownerIdsToNames(p.owner_id) || '—', start: sp.s, end: sp.e,
                   color: _estadoColor(m ? mapStatus3(m.status) : 'En curso'), prog: m ? m.progress_pct_display : 0, esTarea: false });
      getTasksForProjectSorted(p.project_id).forEach(t => {
        let te = 'En curso';
        if (toBool(t.completada)) te = 'Completada';
        else if (t.fecha_fin && new Date(t.fecha_fin) < t0) te = 'Vencida';
        filas.push({ label: t.nombre, owner: ownerIdsToNames(t.owner_ids) || '—',
                     start: t.fecha_inicio ? new Date(t.fecha_inicio) : null,
                     end: t.fecha_fin ? new Date(t.fecha_fin) : null,
                     color: _estadoColor(te), prog: 0, esTarea: true });
      });
    });
    const r = _dibujarGanttDiario(sh, filas, titulo + ' — ' + _ganttRangeLabel());
    sh.showSheet();
    ss.setActiveSheet(sh);
    return { proyectos: projects.length, filas: r.filas };
  });
}

/* ============================================================================
 *  (legacy) Formato plano en sitio — ya no se usa, reemplazado por la vista agrupada
 * ============================================================================ */
function _colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/**
 * Da formato a la pestaña de tareas (03_Tareas): agrega columnas de NOMBRE
 * (Proyecto, Responsable) y un semáforo de Estado por tarea, oculta los códigos,
 * pinta encabezado, pone checkboxes y un filtro. No borra datos.
 */
function formatearProyectosYTareas() {
  return withLock(() => {
    const sh = getSheet(SHEET_NAMES.TAREAS);
    const lastRow = sh.getLastRow();
    const nData = Math.max(0, lastRow - 1);

    // columnas clave actuales
    let cmap = getColMap(SHEET_NAMES.TAREAS);
    const Lpid = _colLetter(cmap['project_id']);
    const Lff = _colLetter(cmap['fecha_fin']);
    const Lcomp = _colLetter(cmap['completada']);

    // asegurar columnas de display (al final, sin tocar las de datos)
    function ensureCol(name) {
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const idx = headers.indexOf(name);
      if (idx >= 0) return idx + 1;
      const c = sh.getLastColumn() + 1;
      sh.getRange(1, c).setValue(name);
      return c;
    }
    const colProy = ensureCol('Proyecto');
    const colResp = ensureCol('Responsable');
    const colEst = ensureCol('Estado');

    if (nData > 0) {
      const proy = [], resp = [], est = [];
      for (let r = 2; r <= lastRow; r++) {
        proy.push(["=IFERROR(VLOOKUP($" + Lpid + r + ",'" + SHEET_NAMES.PROYECTOS + "'!$A:$B,2,FALSE),\"\")"]);
        resp.push(["=IFERROR(VLOOKUP(VLOOKUP($" + Lpid + r + ",'" + SHEET_NAMES.PROYECTOS + "'!$A:$C,3,FALSE),'" + SHEET_NAMES.PERSONAS + "'!$A:$B,2,FALSE),\"\")"]);
        est.push(["=IF($" + Lcomp + r + "=TRUE,\"Completada\",IF(AND($" + Lff + r + "<>\"\",$" + Lff + r + "<TODAY()),\"Vencida\",\"En curso\"))"]);
      }
      sh.getRange(2, colProy, nData, 1).setFormulas(proy);
      sh.getRange(2, colResp, nData, 1).setFormulas(resp);
      sh.getRange(2, colEst, nData, 1).setFormulas(est);
    }

    // encabezado navy + congelar
    sh.getRange(1, 1, 1, sh.getLastColumn()).setBackground(AL.NAVY).setFontColor(AL.WHITE).setFontWeight('bold');
    sh.setFrozenRows(1);

    // ocultar columnas técnicas (IDs y auxiliares)
    cmap = getColMap(SHEET_NAMES.TAREAS);
    ['task_id', 'project_id', 'owner_ids', 'fecha_completada', 'peso', 'bloqueado'].forEach(h => {
      if (cmap[h]) sh.hideColumns(cmap[h]);
    });

    // semáforo en Estado (pinta la celda)
    const estRange = sh.getRange(2, colEst, Math.max(1, nData), 1);
    const rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Completada').setBackground('#E3F0E8').setFontColor(AL.GREEN).setBold(true).setRanges([estRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Vencida').setBackground('#F7E4E1').setFontColor(AL.RED).setBold(true).setRanges([estRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('En curso').setBackground(AL.TINT).setFontColor(AL.BLUE).setBold(true).setRanges([estRange]).build()
    ];
    sh.setConditionalFormatRules(rules);

    // checkboxes en completada
    if (nData > 0 && cmap['completada']) {
      sh.getRange(2, cmap['completada'], nData, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    }

    // filtro para que cada quien filtre por su nombre (columna Responsable)
    const f = sh.getFilter();
    if (f) f.remove();
    sh.getRange(1, 1, Math.max(2, lastRow), sh.getLastColumn()).createFilter();

    logInfo('Proyectos y Tareas formateado: ' + nData + ' tareas');
    return { tareas: nData };
  });
}

/* ============================================================================
 *  OCULTAR PESTAÑAS DE SISTEMA
 * ============================================================================ */
function ocultarPestanasSistema() {
  const ss = getSS();
  // Visibles: Resumen, 02_Proyectos, 03_Tareas, Cronología 1, Cronograma (cuando exista)
  const ocultar = [
    SHEET_NAMES.INICIO, SHEET_NAMES.CONFIG, SHEET_NAMES.PERSONAS, SHEET_NAMES.PROYECTOS, SHEET_NAMES.TAREAS,
    SHEET_NAMES.TIMELINE, SHEET_NAMES.DASHBOARD, SHEET_NAMES.SNAPSHOTS, SHEET_NAMES.EMAIL_LOG,
    SHEET_NAMES.MOTIVACIONALES, SHEET_NAMES.VALIDACIONES, 'Cronología 1'
  ];
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    const esBackup = /_bak_/.test(name);
    if ((ocultar.indexOf(name) >= 0 || esBackup)) {
      try { sh.hideSheet(); } catch (e) { /* no ocultar si es la única visible */ }
    }
  });
}
