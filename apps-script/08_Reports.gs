/**
 * Reports.gs — generación y envío de los correos del sistema.
 *
 * Correos cubiertos:
 *   1. Recordatorio del jueves (thursdayReminderJob, jueves 8:30)
 *   2. Ejecutivo jefe operativo / jefe del canal (fridayExecJob, viernes 8:30)
 *   3. Bienvenida (al dar de alta una persona, o a todos desde el menú)
 *   4. Individual semanal y recordatorio dominical (weeklyJob / sundayReminderJob):
 *      siguen disponibles, pero installAllTriggers ya no los programa.
 *
 * Evaluación mensual y Motivacional viven en sus propios archivos.
 */

/** Logo de la organización como BlobSource para inline embed en correos. */
function getLogoBlob() {
  // El logo puede vivir en Drive (publico o privado del owner) — ID en 00_Config
  const fileId = getConfig('LOGO_FILE_ID');
  if (fileId) {
    try { return DriveApp.getFileById(fileId).getBlob(); }
    catch (e) { logWarn('No se pudo leer LOGO_FILE_ID: ' + e.message); }
  }
  return null;
}

/**
 * Renderiza una plantilla HTML con variables.
 */
function renderTemplate(templateName, vars) {
  const tpl = HtmlService.createTemplateFromFile(templateName);
  Object.keys(vars).forEach(k => { tpl[k] = vars[k]; });
  return tpl.evaluate().getContent();
}

/**
 * Envía un correo respetando modo SANDBOX, registra en log, evita duplicados.
 */
function sendEmailGTM(opts) {
  // opts: { eventType, period, realToEmail, realToName, subject, htmlBody, allowDuplicate }
  const mode = isSandboxMode() ? 'SANDBOX' : 'PROD';
  const finalTo = resolveRecipient(opts.realToEmail);
  const subject = subjectPrefix() + opts.subject;

  // Evitar duplicados
  if (!opts.allowDuplicate) {
    const log = readSheetAsObjects(SHEET_NAMES.EMAIL_LOG).rows;
    const dup = log.find(r => r.event_type === opts.eventType &&
                              logPeriodKey(r.period) === String(opts.period) &&
                              r.destinatario_email === opts.realToEmail &&
                              r.status === 'OK' &&
                              r.mode === mode);
    if (dup) {
      logInfo('Skip duplicado: ' + opts.eventType + ' ' + opts.realToEmail + ' ' + opts.period);
      return { ok: false, skipped: true };
    }
  }

  const mailOpts = {
    htmlBody: opts.htmlBody,
    name: getConfig('SENDER_NAME') || 'Sistema de Proyectos'
  };
  // Logo inline: solo si la plantilla lo usa (<img src="cid:logo">). Adjuntarlo
  // sin referencia hace que el cliente de correo lo muestre como adjunto suelto.
  if (String(opts.htmlBody || '').indexOf('cid:logo') >= 0) {
    const logo = getLogoBlob();
    if (logo) mailOpts.inlineImages = { logo: logo };
  }

  try {
    MailApp.sendEmail(finalTo, subject, '', mailOpts);
    logEvent(opts.eventType, opts.period, opts.realToEmail, opts.realToName, subject, 'OK', mode, '');
    return { ok: true };
  } catch (e) {
    logEvent(opts.eventType, opts.period, opts.realToEmail, opts.realToName, subject, 'FAIL', mode, e.message);
    logError('sendEmail FAIL: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Clave de periodo tal como se escribió en 08_Email_Log.
 *
 * Sheets convierte '2026-06' (periodo mensual) en una fecha al guardarlo, y
 * al releerlo la comparación con el texto fallaba: el anti-duplicado de los
 * correos mensuales nunca encontraba el envío anterior.
 */
function logPeriodKey(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), 'yyyy-MM');
  return String(v === undefined || v === null ? '' : v).trim();
}

/* ============================================================================
 *  CORREO 1 — Individual semanal
 * ============================================================================ */

/**
 * Arma el contexto del correo individual de una persona.
 */
function buildIndividualContext(personId, todayDate) {
  if (!todayDate) todayDate = today();
  const person = getPersonById(personId);
  if (!person) throw new Error('No existe persona: ' + personId);

  const projects = getProjectsForOwner(personId);
  const metrics = projects.map(p => computeProjectMetrics(p.project_id, todayDate));

  const week = getCurrentWeekRange();
  const lastWeek = getLastWeekRange();

  // KPIs
  const activos = metrics.filter(m => m.status !== 'Completado').length;
  const al_dia  = metrics.filter(m => m.status === 'En curso').length;
  const en_riesgo = metrics.filter(m => m.status === 'En riesgo' || m.status === 'Bloqueado').length;
  const vencidos = metrics.filter(m => m.status === 'Vencido').length;

  // Ordenar por prioridad de atención
  const order = { 'Vencido': 1, 'En riesgo': 2, 'Bloqueado': 3, 'En curso': 4, 'Completado': 5 };
  metrics.sort((a, b) => (order[a.status] || 9) - (order[b.status] || 9));

  // Agrupar para template
  const vencidos_list = metrics.filter(m => m.status === 'Vencido');
  const riesgo_list = metrics.filter(m => m.status === 'En riesgo' || m.status === 'Bloqueado');
  const curso_list = metrics.filter(m => m.status === 'En curso');
  const cerrados_list = metrics.filter(m => m.status === 'Completado');

  // Cards detalladas con movimiento semanal
  const cards = metrics.filter(m => m.status !== 'Completado').map(m => {
    const movement = describeProjectWeekMovement(m.project_id, week.start, week.end);
    return Object.assign({}, m, {
      movement: movement,
      end_date_display: m.fecha_fin ? fmtDateHuman(m.fecha_fin) : '',
      days_overdue: m.days_remaining < 0 ? Math.abs(m.days_remaining) : 0
    });
  });

  // Tareas cerradas esta semana en total
  const closed_this_week = getTasksCompletedByOwnerInRange(personId, week.start, week.end);

  // Metricas que cuadran con las KPIs (activos = no completados)
  const n_active_projects = activos;
  const n_completed_projects = metrics.filter(m => m.status === 'Completado').length;
  const allTasks = getTasksForOwner(personId);
  const n_open_tasks = allTasks.filter(t => !toBool(t.completada)).length;

  return {
    nombre_corto: person.nombre.split(' ')[0],
    nombre: person.nombre,
    period_label: 'Lunes ' + fmtDateHuman(todayDate) + ' · semana ' + getWeekId(todayDate).split('-W')[1],
    n_projects: projects.length,
    n_active_projects: n_active_projects,
    n_completed_projects: n_completed_projects,
    n_tasks: allTasks.length,
    n_open_tasks: n_open_tasks,
    n_closed_this_week: closed_this_week.length,
    kpi_activos: activos,
    kpi_al_dia: al_dia,
    kpi_riesgo: en_riesgo,
    kpi_vencidos: vencidos,
    vencidos_list: vencidos_list,
    riesgo_list: riesgo_list,
    curso_list: curso_list,
    cerrados_list: cerrados_list,
    cards: cards,
    comentario_semanal: person.comentario_semanal || '',
    link_tasks: urlToMyTasks(personId),
    support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com',
    today_display: fmtDateHuman(todayDate),
    today_time: '08:30'
  };
}

/**
 * Envía correo individual a una persona.
 */
function sendIndividualReport(personId, todayDate) {
  const person = getPersonById(personId);
  if (!person || !toBool(person.activo) || !toBool(person.recibe_reporte)) return { ok: false, skipped: true };

  const ctx = buildIndividualContext(personId, todayDate);
  const html = renderTemplate('email_individual', ctx);
  const result = sendEmailGTM({
    eventType: 'weekly_individual',
    period: getWeekId(todayDate),
    realToEmail: person.email,
    realToName: person.nombre,
    subject: 'Tu resumen semanal · ' + ctx.today_display,
    htmlBody: html
  });
  return result;
}

/* ============================================================================
 *  CORREO 2 y 3 — Ejecutivos (jefe operativo, jefe del canal)
 * ============================================================================ */

/**
 * Contexto del correo ejecutivo (común a los dos jefes).
 * Si includeRanking=true incluye sección de ranking (solo el jefe del canal).
 */
function buildExecutiveContext(todayDate, includeRanking) {
  if (!todayDate) todayDate = today();
  const projects = getAllProjects().filter(p => (p.estado_manual || '') !== 'Archivado');
  const metrics = projects.map(p => computeProjectMetrics(p.project_id, todayDate));

  const activos = metrics.filter(m => m.status !== 'Completado').length;
  const al_dia  = metrics.filter(m => m.status === 'En curso').length;
  const en_riesgo = metrics.filter(m => m.status === 'En riesgo' || m.status === 'Bloqueado').length;
  const vencidos = metrics.filter(m => m.status === 'Vencido').length;

  // 3 estados de cara a dirección (cuadran con el Resumen: suma = total de proyectos)
  let n_en_curso = 0, n_completados = 0, n_vencidos = 0;
  metrics.forEach(m => {
    const s = mapStatus3(m.status);
    if (s === 'Completados') n_completados++; else if (s === 'Vencidos') n_vencidos++; else n_en_curso++;
  });

  // Por persona — solo personas que reciben reporte individual (no jefes)
  const week = getCurrentWeekRange();
  const personas = getActivePersons().filter(p => toBool(p.recibe_reporte));
  const totalTasksEquipo = personas.reduce((sum, p) => sum + getTasksForOwner(p.person_id).length, 0);

  const personasData = personas.map(p => {
    const tasks = getTasksForOwner(p.person_id);
    const projs = getProjectsForOwner(p.person_id);
    const projMetrics = projs.map(pp => computeProjectMetrics(pp.project_id, todayDate));
    const closedThisWeek = getTasksCompletedByOwnerInRange(p.person_id, week.start, week.end);
    const totalDone = tasks.filter(t => toBool(t.completada)).length;
    const overdueProj = projMetrics.filter(m => m.status === 'Vencido').length;
    const stuckProj = projMetrics.filter(m => m.status === 'En riesgo' || m.status === 'Bloqueado').length;
    const loadPct = totalTasksEquipo > 0 ? Math.round((tasks.length / totalTasksEquipo) * 100) : 0;

    // Avance atribuido al RESPONSABLE DE LA TAREA (no al dueño del proyecto): se agrupan
    // las tareas que ESTA persona cerró esta semana, por proyecto. Solo afecta el correo;
    // el proyecto (dueño, % global) sigue igual.
    const byProj = {};
    closedThisWeek.forEach(t => { (byProj[t.project_id] = byProj[t.project_id] || []).push(t); });
    const proyectos_avance = Object.keys(byProj).map(pid => {
      const proj = getProjectById(pid);
      const mm = computeProjectMetrics(pid, todayDate);
      const cerradas = byProj[pid].length;
      return {
        nombre: proj ? proj.nombre : '?',
        cerradas: cerradas,
        avance_semana: (mm && mm.effective_total > 0) ? Math.round((cerradas / mm.effective_total) * 100) : 0
      };
    }).sort((a, b) => b.avance_semana - a.avance_semana);

    // Semáforo simple para dirección: verde = avanzó esta semana; gris = sin avance
    const avanzo = closedThisWeek.length > 0;

    return {
      person_id: p.person_id,
      nombre: p.nombre,
      n_projects: projs.length,
      n_tasks: tasks.length,
      total_done: totalDone,
      closed_this_week: closedThisWeek.length,
      overdue_proj: overdueProj,
      stuck_proj: stuckProj,
      load_pct: loadPct,
      proyectos_avance: proyectos_avance,
      avanzo: avanzo,
      status_class: avanzo ? 'ok' : 'warn',
      comentario: p.comentario_semanal || ''
    };
  });

  // Proyectos que requieren atención
  const attention = metrics.filter(m =>
    m.status === 'Vencido' || m.status === 'En riesgo' || m.status === 'Bloqueado'
  ).map(m => {
    const owner = getPersonById(m.owner_id);
    return Object.assign({}, m, {
      owner_name: owner ? owner.nombre : '?',
      reason: buildAttentionReason(m)
    });
  });

  // Cerrados esta semana
  const closedProjectsThisWeek = metrics.filter(m => {
    if (m.status !== 'Completado') return false;
    // Verificar si el último cambio fue esta semana — simple: contar tareas cerradas en la semana
    const tasks = getTasksForProject(m.project_id);
    return tasks.some(t => {
      if (!toBool(t.completada) || !t.fecha_completada) return false;
      const fc = new Date(t.fecha_completada);
      return fc >= week.start && fc <= week.end;
    });
  });

  const totalClosedTasksWeek = getActivePersons().reduce((sum, p) =>
    sum + getTasksCompletedByOwnerInRange(p.person_id, week.start, week.end).length, 0);

  // Detalle por PROYECTO con avance de la semana (para los dos jefes).
  // avance_semana = tareas cerradas esta semana / tareas efectivas del proyecto.
  const proyectos = metrics.map(m => {
    const mv = getProjectWeekMovement(m.project_id, week.start, week.end);
    const closed = mv.closed_this_week.length;
    const avanceSemana = m.effective_total > 0 ? Math.round((closed / m.effective_total) * 100) : 0;
    const owner = getPersonById(m.owner_id);
    const st3 = mapStatus3(m.status); // 'En curso' | 'Vencidos' | 'Completados'
    const stLabel = st3 === 'Completados' ? 'Completado' : (st3 === 'Vencidos' ? 'Vencido' : 'En curso');
    // Fecha de cierre del proyecto = última fecha_completada de sus tareas (si está completado)
    let fecha_cierre = '';
    if (stLabel === 'Completado') {
      const fcs = getTasksForProject(m.project_id)
        .map(t => t.fecha_completada ? new Date(t.fecha_completada).getTime() : 0)
        .filter(Boolean);
      if (fcs.length) fecha_cierre = fmtDateHuman(new Date(Math.max.apply(null, fcs)));
    }
    return {
      project_id: m.project_id,
      nombre: m.nombre,
      owner_name: owner ? owner.nombre : '?',
      avance: m.progress_pct_display,
      status_label: stLabel,
      status_color: _estadoColor(st3),
      closed_week: closed,
      avance_semana: avanceSemana,
      hubo: closed > 0,
      fecha_cierre: fecha_cierre,
      cerradas_nombres: mv.closed_this_week.map(t => t.nombre)
    };
  });
  const con_avance = proyectos.filter(p => p.hubo);
  const sin_avance = proyectos.filter(p => !p.hubo && p.status_label !== 'Completado');
  // Paral jefe del canal: TODOS los proyectos activos (en curso, vencidos y completados del mes con su
  // fecha de cierre), ordenados: primero los abiertos, luego los completados. El total cuadra con la lista.
  const _ordEstado = { 'Vencido': 0, 'En curso': 1, 'Completado': 2 };
  const proyectos_jefe = proyectos.slice().sort((a, b) =>
    (_ordEstado[a.status_label] - _ordEstado[b.status_label]) || (b.avance - a.avance));

  // Lectura ejecutiva narrativa
  let lectura = 'Esta semana el equipo cerró ' + totalClosedTasksWeek + ' tareas';
  if (closedProjectsThisWeek.length > 0) lectura += ' y entregó ' + closedProjectsThisWeek.length + ' proyectos';
  lectura += '. ';
  if (con_avance.length > 0) lectura += 'Se registró avance en ' + con_avance.length + ' proyecto(s). ';
  if (vencidos > 0) lectura += 'Hay ' + vencidos + ' proyecto(s) vencido(s) que requieren decisión. ';
  const masCargada = personasData.slice().sort((a,b) => b.load_pct - a.load_pct)[0];
  if (masCargada && masCargada.load_pct > 35) {
    lectura += masCargada.nombre.split(' ')[0] + ' concentra el ' + masCargada.load_pct + '% de la carga del equipo — vale la pena revisar redistribución.';
  }

  return {
    proyectos: proyectos,
    proyectos_jefe: proyectos_jefe,
    con_avance: con_avance,
    sin_avance: sin_avance,
    n_en_curso: n_en_curso,
    n_completados: n_completados,
    n_vencidos: n_vencidos,
    n_total: metrics.length,
    period_label: 'Viernes ' + fmtDateHuman(todayDate) + ' · semana ' + getWeekId(todayDate).split('-W')[1],
    today_display: fmtDateHuman(todayDate),
    today_time: '08:30',
    kpi_activos: activos,
    kpi_al_dia: al_dia,
    kpi_riesgo: en_riesgo,
    kpi_vencidos: vencidos,
    total_closed_tasks_week: totalClosedTasksWeek,
    total_closed_projects_week: closedProjectsThisWeek.length,
    closed_projects_names: closedProjectsThisWeek.map(p => p.nombre),
    lectura: lectura,
    personas: personasData,
    attention: attention,
    include_ranking: !!includeRanking,
    link_dashboard: urlToSheet('Resumen'),
    support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com'
  };
}

function buildAttentionReason(m) {
  if (m.status === 'Vencido') {
    const days = Math.abs(m.days_remaining || 0);
    return 'Superó la fecha fin hace ' + days + ' días. Faltan ' +
           (m.effective_total - m.done_tasks) + ' tareas por cerrar.';
  }
  if (m.status === 'Bloqueado') {
    return 'Todas las tareas pendientes están bloqueadas esperando a terceros.';
  }
  if (m.done_tasks === 0) return 'Aún no arrancan tareas. Fecha fin: ' + (m.fecha_fin ? fmtDateHuman(m.fecha_fin) : '?');
  return 'Atrasado vs cronograma. ' + m.done_tasks + ' de ' + m.effective_total + ' tareas terminadas.';
}

/**
 * Envía correo ejecutivo a quienes tengan recibe_reporte_jefe=TRUE.
 * includeRanking=true paral jefe del canal (jefe del canal).
 */
function sendExecutiveReports(todayDate) {
  if (!todayDate) todayDate = today();
  const jefes = getActivePersons().filter(p => toBool(p.recibe_reporte_jefe));
  const period = getWeekId(todayDate);
  let sent = 0;
  jefes.forEach(jefe => {
    const isTopBoss = jefe.person_id === 'P001' || (jefe.rol || '').toLowerCase().indexOf('canal') >= 0;
    const ctx = buildExecutiveContext(todayDate, isTopBoss);
    ctx.nombre_corto = jefe.nombre.split(' ')[0];
    ctx.is_jefe = isTopBoss;
    const tplName = isTopBoss ? 'email_exec_jefe' : 'email_exec_lider';
    const html = renderTemplate(tplName, ctx);
    const result = sendEmailGTM({
      eventType: isTopBoss ? 'weekly_exec_jefe' : 'weekly_exec_lider',
      period: period,
      realToEmail: jefe.email,
      realToName: jefe.nombre,
      subject: 'Resumen ejecutivo EQUIPO · ' + ctx.today_display,
      htmlBody: html
    });
    if (result.ok) sent++;
  });
  return { sent: sent, total: jefes.length };
}

/* ============================================================================
 *  CORREO 4 — Bienvenida
 * ============================================================================ */
function sendWelcomeEmail(personId) {
  const person = getPersonById(personId);
  if (!person) throw new Error('No existe persona ' + personId);

  const ctx = {
    nombre_corto: person.nombre.split(' ')[0],
    nombre: person.nombre,
    rol: person.rol,
    link_sheet: urlToSheet(SHEET_NAMES.INICIO),
    link_manual: getConfig('MANUAL_USER_URL') || urlToSheet(SHEET_NAMES.INICIO),
    support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com'
  };
  const html = renderTemplate('email_bienvenida', ctx);
  return sendEmailGTM({
    eventType: 'welcome',
    period: getMonthId(),
    realToEmail: person.email,
    realToName: person.nombre,
    subject: 'Bienvenida al Sistema de Proyectos',
    htmlBody: html,
    allowDuplicate: true
  });
}

/**
 * Envía correo de bienvenida a TODAS las personas activas.
 * Útil para activar el sistema con el equipo el primer día.
 * Respeta modo SANDBOX/PROD.
 */
function sendWelcomeToAll() {
  assertAdmin('enviar la bienvenida a todo el equipo');
  return withLock(() => {
    const personas = getActivePersons();
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const details = [];

    personas.forEach(p => {
      try {
        const result = sendWelcomeEmail(p.person_id);
        if (result && result.ok) {
          sent++;
          details.push('OK  → ' + p.nombre + ' (' + p.email + ')');
        } else if (result && result.skipped) {
          skipped++;
          details.push('SKIP → ' + p.nombre + ' (ya recibido este mes)');
        } else {
          failed++;
          details.push('FAIL → ' + p.nombre + ': ' + (result ? result.error : 'unknown'));
        }
      } catch (e) {
        failed++;
        details.push('ERR  → ' + p.nombre + ': ' + e.message);
      }
    });

    logInfo('sendWelcomeToAll: ' + sent + ' enviados, ' + skipped + ' skipped, ' + failed + ' fallaron');
    return { sent: sent, skipped: skipped, failed: failed, total: personas.length, details: details };
  });
}

/**
 * Atajo desde menu: envía bienvenida a todos con confirmación y reporte.
 */
function sendWelcomeToAllFromMenu() {
  assertAdmin('enviar la bienvenida a todo el equipo');
  const ui = SpreadsheetApp.getUi();
  const personas = getActivePersons();
  const mode = isSandboxMode() ? 'SANDBOX (correos van al admin)' : 'PROD (correos van a destinatarios REALES)';
  const r = ui.alert('Enviar bienvenida a todos',
    'Vas a enviar el correo de bienvenida a las ' + personas.length + ' personas activas.\n\n' +
    'Modo actual: ' + mode + '\n\n' +
    '¿Confirmas?',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;

  const result = sendWelcomeToAll();
  const summary = 'Bienvenida enviada\n\n' +
    'OK:      ' + result.sent + '\n' +
    'Skipped: ' + result.skipped + '\n' +
    'Falló:   ' + result.failed + '\n' +
    'Total:   ' + result.total + '\n\n' +
    'Ver detalle en Apps Script → Registro de ejecución.';
  ui.alert(summary);
  // Log detail to Apps Script console
  result.details.forEach(d => Logger.log(d));
}

/* ============================================================================
 *  CORREO 6 — Recordatorio dominical
 * ============================================================================ */
function sendRecordatorios(todayDate) {
  if (!todayDate) todayDate = today();
  const personas = getActivePersons().filter(p =>
    toBool(p.recibe_recordatorio_domingo) &&
    (getProjectsForOwner(p.person_id).length > 0 ||
     getTasksForOwner(p.person_id).some(t => !toBool(t.completada)))); // incluye a quien solo tiene recurrentes
  const period = getWeekId(todayDate);
  let sent = 0;
  personas.forEach(p => {
    // email_recordatorio es la plantilla del jueves: usa n_pendientes, atrasadas y
    // proximas, que solo arma buildThursdayContext. Con el contexto dominical
    // la plantilla lanzaba ReferenceError y no salía ningún recordatorio.
    const ctx = buildThursdayContext(p.person_id, todayDate);
    const html = renderTemplate('email_recordatorio', ctx);
    const result = sendEmailGTM({
      eventType: 'sunday_reminder',
      period: period,
      realToEmail: p.email,
      realToName: p.nombre,
      subject: 'Recordatorio · actualiza tus tareas antes del lunes',
      htmlBody: html
    });
    if (result.ok) sent++;
  });
  return { sent: sent, total: personas.length };
}

/* ============================================================================
 *  Job semanal completo
 * ============================================================================ */
function weeklyJob() {
  return withErrorAlert(() => withLock(() => {
    logInfo('=== weeklyJob START ===');

    // Validar antes de hacer cualquier cosa
    const valid = runValidations();
    if (valid.critical > 0) {
      throw new Error('Bloqueado: ' + valid.critical + ' errores críticos. Ver 99_Validaciones.');
    }

    // Generar snapshot del cierre (esto fija "esta semana" para deltas)
    generateSnapshot();

    // Enviar individuales
    let indivSent = 0;
    getActivePersons().filter(p => toBool(p.recibe_reporte)).forEach(p => {
      const r = sendIndividualReport(p.person_id);
      if (r.ok) indivSent++;
    });

    // Enviar ejecutivos
    const exec = sendExecutiveReports();

    // Limpiar comentarios semanales para que la siguiente semana arranque vacío
    try { clearWeeklyComments(); } catch (e) { logWarn('clearWeeklyComments fail: ' + e.message); }

    logInfo('=== weeklyJob OK individuales=' + indivSent + ' ejecutivos=' + exec.sent + ' ===');
    return { individuales: indivSent, ejecutivos: exec.sent };
  }), 'weeklyJob');
}

function sundayReminderJob() {
  return withErrorAlert(() => sendRecordatorios(), 'sundayReminderJob');
}

/* ============================================================================
 *  CORREO — Recordatorio del JUEVES (personalizado con tareas) — reemplaza al dominical
 * ============================================================================ */
function buildThursdayContext(personId, todayDate) {
  if (!todayDate) todayDate = today();
  const person = getPersonById(personId);
  const projects = getProjectsForOwner(personId).filter(p => (p.estado_manual || '') !== 'Archivado');
  const allTasks = getTasksForOwner(personId);
  const t0 = todayDate;

  const pend = allTasks.filter(t => !toBool(t.completada)).map(t => {
    const proj = getProjectById(t.project_id);
    const ff = t.fecha_fin ? new Date(t.fecha_fin) : null;
    return {
      nombre: t.nombre,
      proyecto: proj ? proj.nombre : '—',
      fin: t.fecha_fin ? fmtDateHuman(t.fecha_fin) : 'sin fecha',
      vencida: !!(ff && ff < t0),
      _sort: ff ? ff.getTime() : 8.64e15
    };
  }).sort((a, b) => a._sort - b._sort);

  return {
    nombre_corto: person.nombre.split(' ')[0],
    nombre: person.nombre,
    today_display: fmtDateHuman(todayDate),
    n_projects: projects.length,
    n_pendientes: pend.length,
    n_atrasadas: pend.filter(t => t.vencida).length,
    atrasadas: pend.filter(t => t.vencida),
    proximas: pend.filter(t => !t.vencida),
    link_tasks: urlToSheet('Proyectos y Tareas'),
    support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com'
  };
}

/** Envía el recordatorio del jueves a cada persona del equipo con proyectos abiertos. */
function sendThursdayReminders(todayDate) {
  if (!todayDate) todayDate = today();
  const personas = getActivePersons().filter(p =>
    toBool(p.recibe_recordatorio_domingo) &&
    (getProjectsForOwner(p.person_id).length > 0 ||
     getTasksForOwner(p.person_id).some(t => !toBool(t.completada)))); // incluye a quien solo tiene recurrentes
  const period = getWeekId(todayDate);
  let sent = 0;
  personas.forEach(p => {
    const ctx = buildThursdayContext(p.person_id, todayDate);
    const html = renderTemplate('email_recordatorio', ctx);
    const r = sendEmailGTM({
      eventType: 'thursday_reminder',
      period: period,
      realToEmail: p.email,
      realToName: p.nombre,
      subject: 'Actualiza tus proyectos hoy — plazo jueves 11:59 pm',
      htmlBody: html
    });
    if (r.ok) sent++;
  });
  logInfo('Recordatorios jueves: ' + sent + '/' + personas.length);
  return { sent: sent, total: personas.length };
}

/* ============================================================================
 *  Atajos desde menú UI
 * ============================================================================ */
function sendTestIndividualToAdmin() {
  assertAdmin('enviar el correo de prueba');
  // Envía el recordatorio del jueves de una persona de muestra, redirigido al admin.
  const admin = getConfig('ADMIN_EMAIL');
  const sample = getActivePersons().find(p => toBool(p.recibe_recordatorio_domingo) && getProjectsForOwner(p.person_id).length > 0)
              || getActivePersons().find(p => toBool(p.recibe_reporte));
  if (!sample) { SpreadsheetApp.getUi().alert('No hay persona de muestra con proyectos.'); return; }
  const ctx = buildThursdayContext(sample.person_id);
  const html = renderTemplate('email_recordatorio', ctx);
  sendEmailGTM({
    eventType: 'test_reminder',
    period: 'test-' + new Date().getTime(),
    realToEmail: admin,
    realToName: 'Admin',
    subject: '[PRUEBA] Recordatorio del jueves · ' + sample.nombre,
    htmlBody: html,
    allowDuplicate: true
  });
  SpreadsheetApp.getUi().alert('Correo de prueba enviado a ' + admin);
}

/** Envía muestras de los 3 correos al admin (SANDBOX), evitando el anti-duplicado. */
function _diag_sendSamplesToAdmin() {
  const admin = getConfig('ADMIN_EMAIL') || 'admin@example.com';
  const person = getActivePersons().find(p => toBool(p.recibe_recordatorio_domingo) && getProjectsForOwner(p.person_id).length > 0)
              || getActivePersons()[0];
  const stamp = Date.now();
  sendEmailGTM({ eventType: 'sample_thursday', period: 'sample-' + stamp, realToEmail: admin, realToName: 'Admin',
    subject: '[MUESTRA] Recordatorio del jueves', htmlBody: renderTemplate('email_recordatorio', buildThursdayContext(person.person_id)), allowDuplicate: true });
  const ctxG = buildExecutiveContext(today(), false); ctxG.nombre_corto = 'el jefe operativo'; ctxG.is_jefe = false;
  sendEmailGTM({ eventType: 'sample_lider', period: 'sample-' + stamp, realToEmail: admin, realToName: 'Admin',
    subject: '[MUESTRA] Ejecutivo — el jefe operativo', htmlBody: renderTemplate('email_exec_lider', ctxG), allowDuplicate: true });
  const ctxN = buildExecutiveContext(today(), true); ctxN.nombre_corto = 'Jefe'; ctxN.is_jefe = true;
  sendEmailGTM({ eventType: 'sample_jefe', period: 'sample-' + stamp, realToEmail: admin, realToName: 'Admin',
    subject: '[MUESTRA] Ejecutivo — jefe del canal', htmlBody: renderTemplate('email_exec_jefe', ctxN), allowDuplicate: true });
  return { sent: 3, to: admin };
}

/** Diagnóstico: renderiza todas las plantillas clave SIN enviar (detecta variables faltantes). */
function _diag_renderEmails() {
  const out = {};
  const person = getActivePersons().find(p => toBool(p.recibe_recordatorio_domingo) && getProjectsForOwner(p.person_id).length > 0)
              || getActivePersons()[0];
  const ctxN = buildExecutiveContext(today(), true); ctxN.nombre_corto = 'Jefe'; ctxN.is_jefe = true;
  out.jefe = renderTemplate('email_exec_jefe', ctxN).length;
  const ctxG = buildExecutiveContext(today(), false); ctxG.nombre_corto = 'el jefe operativo'; ctxG.is_jefe = false;
  out.lider = renderTemplate('email_exec_lider', ctxG).length;
  out.jueves = renderTemplate('email_recordatorio', buildThursdayContext(person.person_id)).length;
  out.bienvenida = renderTemplate('email_bienvenida', {
    nombre_corto: 'X', nombre: 'X', rol: 'Analista', link_sheet: '#', link_manual: '#',
    support_email: 'persona@example.com'
  }).length;
  out.relevantes = renderTemplate('email_relevantes', {
    nombre_corto: 'X', nombre: 'X', today_display: fmtDateHuman(today()), support_email: 'persona@example.com',
    items: [{ tipo: 'Proyecto', proyecto: 'Proyecto de ejemplo', relevante: 'Se avanzó con la definición del alcance.', comentario: 'Buen trabajo, sigue así.' }]
  }).length;
  return out;
}
