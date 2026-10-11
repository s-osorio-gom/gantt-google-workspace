/**
 * Triggers.gs — instalación / desinstalación de triggers automáticos.
 *
 * installAllTriggers() deja ocho (siete si no hay Sheet de evaluaciones):
 *   1. thursdayReminderJob      → jueves 8:30   (recordatorio al equipo)
 *   2. fridayExecJob            → viernes 8:30  (foto semanal + ejecutivos)
 *   3. satRelevantesJob         → sábado 8:00   (relevantes comentados)
 *   4. dailyDispatcherMorning   → diario 8:30   (día 1: rollover + evaluación; día 1: recurrentes;
 *                                                 día 4: evaluaciones personales)
 *   5. dailyDispatcherAfternoon → diario 16:00  (último día del mes: motivacional)
 *   6. autoRefreshDirty         → cada minuto   (refresca el Resumen si hubo cambios)
 *   7. onSheetEdit              → onEdit del Sheet del equipo
 *   8. onEvalSheetEdit          → onEdit del Sheet privado de evaluaciones
 *
 * Apps Script no permite especificar minuto exacto para clock triggers más que dentro de un rango horario.
 * Por eso usamos triggers diarios + guards internos que verifican día/hora con getConfig.
 */

const TRIGGER_HANDLERS = [
  'weeklyJob',
  'sundayReminderJob',
  'thursdayReminderJob',
  'fridayExecJob',
  'satRelevantesJob',
  'weeklySnapshotPre',
  'monthlyEvalJob',
  'motivationalJob',
  'onTaskEdit',
  'onEvaluationEdit',
  'dailyDispatcher',
  'autoRefreshDirty'
];

/**
 * Instala todos los triggers. Idempotente: borra los previos primero.
 * Ver la lista al inicio del archivo. Los horarios usan la zona de appsscript.json.
 */
function installAllTriggers() {
  assertAdmin('instalar los disparadores');
  uninstallAllTriggers();
  let n = 0;

  // 1. Jueves 8:30 — recordatorio al equipo (plazo hoy 11:59 pm)
  ScriptApp.newTrigger('thursdayReminderJob')
    .timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(8).nearMinute(30)
    .inTimezone(tz()).create(); n++;

  // 2. Viernes 8:30 — ejecutivos al jefe operativo y el jefe del canal
  ScriptApp.newTrigger('fridayExecJob')
    .timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(8).nearMinute(30)
    .inTimezone(tz()).create(); n++;

  // 3. Sábado 8:00 — relevantes comentados por el jefe operativo (solo los que tengan comentario)
  ScriptApp.newTrigger('satRelevantesJob')
    .timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(8)
    .inTimezone(tz()).create(); n++;

  // 4. Diario 8:30 — dispatcher (eval mensual el día 1, recurrentes, evaluaciones el día 4)
  ScriptApp.newTrigger('dailyDispatcherMorning')
    .timeBased().everyDays(1).atHour(8).nearMinute(30)
    .inTimezone(tz()).create(); n++;

  // 5. Diario 16:00 — motivacional (solo actúa el último día del mes).
  //    Faltaba: dailyDispatcherAfternoon existía y se desinstalaba, pero nunca se
  //    instalaba, así que el mensaje de cierre de mes no salía.
  ScriptApp.newTrigger('dailyDispatcherAfternoon')
    .timeBased().everyDays(1).atHour(16)
    .inTimezone(tz()).create(); n++;

  // 6. Cada 1 min — refresca el Resumen si hubo cambios (marca "sucio"); mantiene el check instantáneo
  ScriptApp.newTrigger('autoRefreshDirty')
    .timeBased().everyMinutes(1).create(); n++;

  // 7. onEdit del Sheet PUBLICO — instalable (no simple)
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(getSS())
    .onEdit()
    .create(); n++;

  // 8. onEdit del Sheet PRIVADO de evaluaciones — confidencialidad real
  try {
    const evalSS = getEvalSS();
    ScriptApp.newTrigger('onEvalSheetEdit')
      .forSpreadsheet(evalSS)
      .onEdit()
      .create(); n++;
    logInfo('Trigger onEvalSheetEdit instalado en Sheet privado');
  } catch (e) {
    logWarn('No se pudo instalar trigger en Sheet privado de evaluaciones: ' + e.message +
            '. Verifica que EVAL_SHEET_ID en 00_Config esté correcto.');
  }

  logInfo('Triggers instalados: ' + n);
  return { installed: n };
}

/**
 * Desinstala todos los triggers manejados por el sistema.
 */
function uninstallAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    const handler = t.getHandlerFunction();
    if (TRIGGER_HANDLERS.indexOf(handler) >= 0 ||
        handler === 'onSheetEdit' ||
        handler === 'onEvalSheetEdit' ||
        handler === 'dailyDispatcherMorning' ||
        handler === 'dailyDispatcherAfternoon' ||
        handler === 'mondayRelevantesJob') { // legacy: renombrado a satRelevantesJob (limpieza única)
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  logInfo('Triggers eliminados: ' + removed);
  return { removed: removed };
}

/**
 * Snapshot pre-lunes (domingo 22:00). Solo genera snapshot, no envía.
 */
function weeklySnapshotPre() {
  return withErrorAlert(() => generateSnapshot(), 'weeklySnapshotPre');
}

/**
 * Dispatcher diario (mañana 8:30): decide si es día 1 (eval mensual).
 */
function dailyDispatcherMorning() {
  return withErrorAlert(() => {
    const d = today();
    const esDia = (clave, defecto) => _esDiaConfigurado(d, getConfigInt(clave, defecto));
    // Día 1 del mes → archivar completados del mes anterior + eval mensual
    if (esDia('MONTHLY_EVAL_DAY', 1)) {
      try { monthlyRollover(); } catch (e) { logWarn('monthlyRollover: ' + e.message); }
      monthlyEvalJob();
    }
    // Día 1 (config RECURRING_TASKS_DAY): genera las tareas recurrentes del período. Idempotente.
    if (esDia('RECURRING_TASKS_DAY', 1)) {
      try { generateRecurringTasks(); } catch (e) { logWarn('generateRecurringTasks: ' + e.message); }
    }
    // Día 4: envía a cada persona su evaluación (solo las que el jefe del canal ya calificó).
    if (esDia('PERSONAL_EVAL_SEND_DAY', 4)) {
      try { sendPersonalEvalsDay4(); } catch (e) { logWarn('sendPersonalEvalsDay4: ' + e.message); }
    }
  }, 'dailyDispatcherMorning');
}

/**
 * ¿Es `fecha` el día `dia` de su mes? Un día mayor que los del mes (29–31 en
 * febrero, 31 en abril…) cae el último día; uno menor que 1 cae el día 1. Antes
 * MONTHLY_EVAL_DAY=31 no disparaba nunca en los meses cortos.
 */
function _esDiaConfigurado(fecha, dia) {
  const ultimo = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate();
  return fecha.getDate() === Math.min(Math.max(1, dia), ultimo);
}

/**
 * Dispatcher diario (tarde 16:00): motivacional.
 */
function dailyDispatcherAfternoon() {
  return withErrorAlert(() => motivationalJob(), 'dailyDispatcherAfternoon');
}

/**
 * Jueves 8:30 — recordatorio personalizado al equipo (plazo hoy 11:59 pm).
 */
function thursdayReminderJob() {
  return withErrorAlert(() => sendThursdayReminders(), 'thursdayReminderJob');
}

/**
 * Sábado 8:00 — envía a cada persona sus relevantes YA comentados por el jefe operativo (los que no tengan
 * comentario no se envían).
 */
function satRelevantesJob() {
  return withErrorAlert(() => enviarRelevantesComentados(), 'satRelevantesJob');
}

/**
 * Viernes 8:30 — snapshot del cierre + correos ejecutivos al jefe operativo y el jefe del canal.
 */
function fridayExecJob() {
  return withErrorAlert(() => withLock(() => {
    const valid = runValidations();
    if (valid.critical > 0) throw new Error('Bloqueado: ' + valid.critical + ' errores críticos. Ver 99_Validaciones.');
    try { generateSnapshot(); } catch (e) { logWarn('snapshot viernes: ' + e.message); }
    const exec = sendExecutiveReports();
    try { clearWeeklyComments(); } catch (e) { logWarn('clearWeeklyComments: ' + e.message); }
    logInfo('=== fridayExecJob OK ejecutivos=' + exec.sent + ' ===');
    return { ejecutivos: exec.sent };
  }), 'fridayExecJob');
}

/**
 * onEdit unificado: ruta a los handlers según hoja.
 */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sheetName = e.range.getSheet().getName();
  try {
    if (sheetName === 'Proyectos y Tareas') onPyTEdit(e);
    if (sheetName === SHEET_NAMES.TAREAS) onTaskEdit(e);
    if (sheetName === SHEET_NAMES.CONFIG) invalidateConfigCache();
  } catch (err) {
    logError('onSheetEdit: ' + err.message);
  }
}

/**
 * Atajo desde menú para reinstalar triggers.
 */
function reinstallTriggersFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Reinstalar triggers', 'Esto borrará y volverá a crear los triggers automáticos. ¿Confirmas?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  const res = installAllTriggers();
  ui.alert('Listo. ' + res.installed + ' disparadores activos. Verifica en Apps Script → Activadores (reloj).');
}
