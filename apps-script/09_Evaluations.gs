/**
 * Evaluations.gs — evaluación mensual CONFIDENCIAL.
 *
 * Las evaluaciones viven en un Sheet SEPARADO (Opción A) compartido solo con
 * el administrador y el jefe del canal. Configurado vía EVAL_SHEET_ID en 00_Config.
 *
 * Flujo:
 *  - Día 1 de cada mes (08:30): monthlyEvalJob()
 *      → pobla el Sheet privado con una fila por persona del mes anterior
 *      → envía correo al jefe del canal con insumos + link al Sheet privado
 *  - Cuando el jefe del canal llena calificacion_1_5 y comentario_jefe:
 *      → onEvalSheetEdit detecta el cambio (trigger en el Sheet privado)
 *      → envía correo a la persona evaluada con SU evaluación
 *      → marca estado=EVALUADO
 */

/** Columnas del Sheet privado de evaluación (project-centric, orden lógico). */
const EVAL_HEADERS = ['eval_id', 'year', 'month', 'person_id', 'person_name',
  'projects_count', 'avg_progress', 'projects_advanced', 'projects_overdue', 'projects_completed',
  'calificacion_1_5', 'comentario_jefe', 'estado', 'fecha_evaluacion', 'evaluador_email'];

/** Asegura el esquema del Sheet de evaluación: crea la pestaña y el encabezado si faltan. */
function _ensureEvalSchema() {
  // Un Sheet privado recién creado no tiene la pestaña: se crea aquí en vez de fallar.
  const ss = getEvalSS();
  const sh = ss.getSheetByName(EVAL_SHEET_TAB) || ss.insertSheet(EVAL_SHEET_TAB);
  const cur = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  if (cur.join('|') !== EVAL_HEADERS.join('|')) {
    // Solo se reescribe una pestaña vacía o con un encabezado distinto y sin datos:
    // borrar calificaciones ya escritas por un cambio de columnas sería irreversible.
    if (sh.getLastRow() > 1) {
      throw new Error('La pestaña "' + EVAL_SHEET_TAB + '" del Sheet privado tiene datos con columnas ' +
        'distintas a las esperadas (' + EVAL_HEADERS.join(', ') + '). Muévalos a otra pestaña primero.');
    }
    sh.clear();
    sh.getRange(1, 1, 1, EVAL_HEADERS.length).setValues([EVAL_HEADERS])
      .setBackground('#0F2D52').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
    return true;
  }
  return false;
}

/**
 * Pobla el Sheet privado con una fila por persona para el mes anterior.
 * Idempotente.
 */
function ensureMonthlyEvalRows(monthDate) {
  _ensureEvalSchema();
  if (!monthDate) {
    const d = today();
    monthDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  }
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth() + 1;
  const monthEnd = new Date(year, month, 0);

  const existing = readEvalSheetAsObjects(EVAL_SHEET_TAB).rows;
  const personas = getActivePersons().filter(p => toBool(p.recibe_reporte));

  let added = 0;
  personas.forEach(p => {
    const dup = existing.find(r => Number(r.year) === year && Number(r.month) === month && r.person_id === p.person_id);
    if (dup) return;

    const monthStart = new Date(year, month - 1, 1);
    const metrics = computePersonMonthlyMetrics(p.person_id, monthStart, monthEnd);

    appendEvalRow(EVAL_SHEET_TAB, {
      eval_id: 'EV-' + year + '-' + String(month).padStart(2, '0') + '-' + p.person_id,
      year: year,
      month: month,
      person_id: p.person_id,
      person_name: p.nombre,
      projects_count: metrics.projects_count,
      avg_progress: metrics.avg_progress,
      projects_advanced: metrics.projects_advanced,
      projects_overdue: metrics.projects_overdue,
      projects_completed: metrics.projects_completed,
      calificacion_1_5: '',
      comentario_jefe: '',
      estado: 'PENDIENTE',
      fecha_evaluacion: '',
      evaluador_email: ''
    });
    added++;
  });
  logInfo('Evaluación mensual ' + year + '-' + month + ': agregadas ' + added + ' filas al Sheet privado');
  return { added: added, total: personas.length, year: year, month: month };
}

/**
 * Métricas MENSUALES por PROYECTO (no por tarea) de una persona.
 * Las tareas cambian de fecha; los proyectos no. Por eso la evaluación mira proyectos.
 */
function computePersonMonthlyMetrics(personId, fromDate, toDate) {
  const projects = getProjectsForOwner(personId).filter(p => (p.estado_manual || '') !== 'Archivado');
  const pm = projects.map(p => ({ p: p, m: computeProjectMetrics(p.project_id, toDate) })).filter(x => x.m);
  const count = pm.length;
  const avg = count ? Math.round(pm.reduce((a, x) => a + (x.m.progress_pct_display || 0), 0) / count) : 0;
  const overdue = pm.filter(x => mapStatus3(x.m.status) === 'Vencidos').length;
  const completed = pm.filter(x => mapStatus3(x.m.status) === 'Completados').length;
  // Avanzaron en el mes = algún avance (tarea cerrada) dentro del rango del mes
  const advanced = pm.filter(x => getTasksForProject(x.p.project_id).some(t => {
    if (!toBool(t.completada) || !t.fecha_completada) return false;
    const fc = new Date(t.fecha_completada);
    return fc >= fromDate && fc <= toDate;
  })).length;

  return {
    projects_count: count,
    avg_progress: avg,
    projects_advanced: advanced,
    projects_overdue: overdue,
    projects_completed: completed,
    al_dia: overdue === 0,
    estado_label: overdue === 0 ? 'Al día' : ('Atrasado en ' + overdue + ' proyecto' + (overdue === 1 ? '' : 's'))
  };
}

/**
 * Trigger del día 1 del mes: pobla evaluaciones + envía correo al jefe del canal.
 */
function monthlyEvalJob() {
  _assertDisparador('monthlyEvalJob');
  return withErrorAlert(() => {
    const d = today();
    const evalMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    ensureMonthlyEvalRows(evalMonth);
    sendMonthlyEvalEmailToBoss_(evalMonth);
  }, 'monthlyEvalJob');
}

function sendMonthlyEvalEmailToBoss_(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth() + 1;
  const monthName = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][month - 1];

  const jefe = getActivePersons().find(p => toBool(p.recibe_reporte_jefe) && esJefeCanal(p));
  if (!jefe) {
    // Antes solo quedaba en el registro de ejecución: nadie se enteraba de que la evaluación no salió.
    throw new Error('No se encontró jefe del canal para la evaluación mensual: defina JEFE_CANAL_ID en ' +
      '00_Config (o P001 / rol con «canal») entre quienes tienen recibe_reporte_jefe=TRUE.');
  }

  const personas = getActivePersons().filter(p => toBool(p.recibe_reporte));
  const monthEnd = new Date(year, month, 0);
  const monthStart = new Date(year, month - 1, 1);

  const personasEval = personas.map(p => {
    const m = computePersonMonthlyMetrics(p.person_id, monthStart, monthEnd);
    return Object.assign({}, m, {
      person_id: p.person_id,
      nombre: p.nombre,
      rol: p.rol
    });
  });

  const ctx = {
    nombre_corto: jefe.nombre.split(' ')[0],
    month_label: monthName + ' ' + year,
    today_display: fmtDateHuman(today()),
    personas: personasEval,
    link_eval_sheet: getConfig('EVAL_SHEET_URL') || '#',  // link al Sheet PRIVADO
    support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com'
  };
  const html = renderTemplate('email_eval_jefe', ctx);
  return sendEmailGTM_({
    eventType: 'monthly_eval',
    period: year + '-' + String(month).padStart(2, '0'),
    realToEmail: jefe.email,
    realToName: jefe.nombre,
    subject: 'Evaluación mensual del equipo · ' + monthName + ' ' + year,
    htmlBody: html
  });
}

/**
 * onEdit del Sheet PRIVADO: cuando el jefe del canal completa calificación + comentario, marca la fila
 * como LISTO (pero NO envía). El envío a cada persona se hace en lote el DÍA 4 (sendPersonalEvalsDay4_).
 */
function onEvalSheetEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== EVAL_SHEET_TAB) return;
  const colMap = getEvalColMap(EVAL_SHEET_TAB);
  const editedCol = e.range.getColumn();
  if (editedCol !== colMap['calificacion_1_5'] && editedCol !== colMap['comentario_jefe']) return;

  const row = e.range.getRow();
  if (row < 2) return;
  const fila = readEvalRowFromPrivate(row);
  if (!fila) return;
  if (!fila.calificacion_1_5 || !String(fila.comentario_jefe || '').trim()) return;
  if (fila.estado === 'ENVIADO' || fila.estado === 'LISTO') return;

  // Marca lista para envío (el día 4), sin enviar todavía.
  setEvalCell(EVAL_SHEET_TAB, row, 'estado', 'LISTO');
  setEvalCell(EVAL_SHEET_TAB, row, 'fecha_evaluacion', new Date());
  setEvalCell(EVAL_SHEET_TAB, row, 'evaluador_email', Session.getActiveUser().getEmail());
}

/**
 * DÍA 4 del mes: envía a cada persona su evaluación (solo las que el jefe del canal ya calificó + comentó).
 * Las que no tengan calificación/comentario no se envían.
 */
function sendPersonalEvalsDay4_() {
  const d = today();
  const evalMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const year = evalMonth.getFullYear(), month = evalMonth.getMonth() + 1;
  const rows = readEvalSheetAsObjects(EVAL_SHEET_TAB).rows.filter(r =>
    Number(r.year) === year && Number(r.month) === month &&
    String(r.calificacion_1_5) !== '' && String(r.comentario_jefe || '').trim() !== '' &&
    r.estado !== 'ENVIADO');
  // En SANDBOX el correo va al admin, no a la persona: marcar la fila ENVIADO haría
  // que, ya en PROD, nunca le llegara. El log (separado por modo) evita repetirlo.
  const sandbox = isSandboxMode();
  let sent = 0, yaEnviadas = 0;
  rows.forEach(fila => {
    try {
      const res = sendPersonalEvaluationEmail_(fila);
      if (res && res.ok) {
        if (!sandbox) {
          setEvalCell(EVAL_SHEET_TAB, fila._rowIndex, 'estado', 'ENVIADO');
          if (!fila.fecha_evaluacion) setEvalCell(EVAL_SHEET_TAB, fila._rowIndex, 'fecha_evaluacion', new Date());
        }
        sent++;
      } else if (res && res.skipped && !sandbox) {
        // El log ya tiene esta evaluación con el mismo contenido: o falló la marca
        // tras enviarla, o el admin la devolvió a LISTO sin cambiarla. No se
        // reenvía (sería un duplicado); para reenviar, cambie el comentario o la
        // calificación. Se marca ENVIADO para que la fila diga la verdad.
        setEvalCell(EVAL_SHEET_TAB, fila._rowIndex, 'estado', 'ENVIADO');
        yaEnviadas++;
      }
    } catch (err) { logError('eval día 4: ' + err.message); }
  });
  logInfo('Evaluaciones personales enviadas (día 4): ' + sent + ' de ' + rows.length +
          (yaEnviadas ? ' (' + yaEnviadas + ' ya enviadas antes, sin cambios)' : ''));
  return { sent: sent, candidatas: rows.length, ya_enviadas: yaEnviadas };
}

/** MUESTRA: envía a admin el correo de evaluación del jefe del canal (KPIs de todos) del mes anterior. */
function _diag_evalSampleJefe() {
  assertAdmin('usar la función de diagnóstico _diag_evalSampleJefe');
  const d = today();
  const evalMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  ensureMonthlyEvalRows(evalMonth);
  const year = evalMonth.getFullYear(), month = evalMonth.getMonth() + 1;
  const monthName = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][month - 1];
  const personas = getActivePersons().filter(p => toBool(p.recibe_reporte));
  const monthEnd = new Date(year, month, 0), monthStart = new Date(year, month - 1, 1);
  const personasEval = personas.map(p => Object.assign({}, computePersonMonthlyMetrics(p.person_id, monthStart, monthEnd),
    { person_id: p.person_id, nombre: p.nombre, rol: p.rol }));
  const ctx = { nombre_corto: 'Jefe', month_label: monthName + ' ' + year, today_display: fmtDateHuman(today()),
    personas: personasEval, link_eval_sheet: getConfig('EVAL_SHEET_URL') || '#',
    support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com' };
  return sendEmailGTM_({ eventType: 'sample_eval_jefe', period: 'sample-' + Date.now(),
    realToEmail: getConfig('ADMIN_EMAIL'), realToName: 'Admin', subject: '[MUESTRA] Evaluación mensual — jefe del canal',
    htmlBody: renderTemplate('email_eval_jefe', ctx), allowDuplicate: true });
}

/** MUESTRA/PRUEBA: califica la 1ra fila del mes anterior y dispara el envío del día 4 (a admin en SANDBOX). */
function _diag_pruebaEvalPersonal() {
  assertAdmin('usar la función de diagnóstico _diag_pruebaEvalPersonal');
  const d = today();
  const evalMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  ensureMonthlyEvalRows(evalMonth);
  const year = evalMonth.getFullYear(), month = evalMonth.getMonth() + 1;
  const rows = readEvalSheetAsObjects(EVAL_SHEET_TAB).rows.filter(r => Number(r.year) === year && Number(r.month) === month);
  if (!rows.length) return { error: 'sin filas del mes' };
  const fila = rows[0];
  setEvalCell(EVAL_SHEET_TAB, fila._rowIndex, 'calificacion_1_5', 4);
  setEvalCell(EVAL_SHEET_TAB, fila._rowIndex, 'comentario_jefe', 'PRUEBA: buen mes, cerraste bien tus proyectos. Sigue así.');
  setEvalCell(EVAL_SHEET_TAB, fila._rowIndex, 'estado', 'LISTO');
  return sendPersonalEvalsDay4_();
}

/** Atajo admin desde menú para enviar las evaluaciones ya calificadas (además del día 4 automático). */
function enviarEvaluacionesDesdeMenu() {
  assertAdmin('enviar las evaluaciones');
  const r = sendPersonalEvalsDay4_();
  SpreadsheetApp.getUi().alert('Evaluaciones enviadas',
    'Enviadas: ' + r.sent + ' de ' + r.candidatas + ' calificadas' +
    (r.ya_enviadas ? '\n' + r.ya_enviadas + ' ya se habían enviado con el mismo contenido: no se reenvían. ' +
      'Para reenviar una, cambie su comentario o calificación.' : '') +
    (isSandboxMode() ? '\n\n(SANDBOX: van al admin y no se marcan como enviadas; en PROD saldrán a cada persona)' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function readEvalRowFromPrivate(rowIndex) {
  const sh = getEvalSheet(EVAL_SHEET_TAB);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = sh.getRange(rowIndex, 1, 1, sh.getLastColumn()).getValues()[0];
  const obj = { _rowIndex: rowIndex };
  headers.forEach((h, i) => { obj[String(h).trim()] = row[i]; });
  return obj;
}

/**
 * Envía a la persona evaluada su correo confidencial.
 */
function sendPersonalEvaluationEmail_(fila) {
  const person = getPersonById(fila.person_id);
  if (!person) throw new Error('Persona no encontrada: ' + fila.person_id);
  const evaluator = getPersonByEmail(fila.evaluador_email) ||
                    getActivePersons().find(p => esJefeCanal(p));
  const evaluatorName = evaluator ? evaluator.nombre : (fila.evaluador_email || 'Jefe del canal');

  const monthName = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][Number(fila.month) - 1];

  const calNames = {1:'Crítico',2:'Por mejorar',3:'Cumple',4:'Sobresale',5:'Excepcional'};
  const cal = Number(fila.calificacion_1_5);

  const overdue = Number(fila.projects_overdue) || 0;
  const ctx = {
    nombre_corto: person.nombre.split(' ')[0],
    nombre: person.nombre,
    evaluator_name: evaluatorName,
    month_label: monthName + ' ' + fila.year,
    projects_count: fila.projects_count,
    avg_progress: fila.avg_progress,
    projects_advanced: fila.projects_advanced,
    projects_overdue: overdue,
    projects_completed: fila.projects_completed,
    al_dia: overdue === 0,
    estado_label: overdue === 0 ? 'Al día' : ('Atrasado en ' + overdue + ' proyecto' + (overdue === 1 ? '' : 's')),
    calificacion: cal,
    calificacion_label: calNames[cal] || '',
    comentario: fila.comentario_jefe,
    support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com'
  };
  const html = renderTemplate('email_eval_personal', ctx);
  return sendEmailGTM_({
    eventType: 'personal_eval',
    // Mes + huella de calificación y comentario: si el correo sale pero falla la marca
    // ENVIADO, el reintento lo detiene el log; si el jefe corrige la evaluación, la
    // huella cambia y la corrección sí sale. Devolver la fila a LISTO sin cambiarla
    // NO la reenvía (no se distingue de un reintento). (Antes, allowDuplicate:true.)
    period: fila.year + '-' + String(fila.month).padStart(2, '0') + '#' +
            _huella(fila.calificacion_1_5 + '|' + String(fila.comentario_jefe || '').trim()),
    realToEmail: person.email,
    realToName: person.nombre,
    subject: 'Tu evaluación de ' + monthName + ' ' + fila.year,
    htmlBody: html
  });
}
