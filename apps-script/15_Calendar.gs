/**
 * 15_Calendar.gs — Sincroniza las tareas del Gantt con el calendario de cada persona.
 *
 * Cómo funciona:
 *  - Crea un evento por cada tarea que tenga fecha_inicio y fecha_fin (no completada,
 *    proyecto no archivado), e INVITA a su(s) responsable(s) como invitado.
 *    El evento aparece en el calendario personal de cada quien (vía invitación).
 *  - Idempotente: cada corrida BORRA los eventos EQUIPO anteriores en el horizonte y
 *    los vuelve a crear, así nunca quedan duplicados ni desactualizados.
 *  - Respeta SANDBOX: en modo SANDBOX invita solo al admin (no molesta al equipo).
 *
 * Para correr: menú 🍀 EQUIPO → 📅 Enviar tareas a los calendarios.
 * Se puede automatizar luego con un trigger semanal.
 */

var GTM_CAL_TAG = 'gtm_task_id';        // marca para reconocer/borrar nuestros eventos
var GTM_CAL_PREFIX = 'EQUIPO · ';          // prefijo del título
var GTM_CAL_HORIZON_BACK_DAYS = 7;      // limpia desde hace 1 semana
var GTM_CAL_HORIZON_FWD_DAYS = 240;     // hasta ~8 meses adelante

/**
 * Punto de entrada desde el menú (confirmación + resumen).
 */
function enviarCalendarioDesdeMenu() {
  assertAdmin('enviar tareas a los calendarios');
  const ui = SpreadsheetApp.getUi();
  const sandbox = isSandboxMode();
  const aviso = sandbox
    ? 'Estás en SANDBOX: los eventos se crearán SOLO en tu calendario (admin), no en el del equipo.'
    : 'Modo PROD: cada persona recibirá en SU calendario los eventos de sus tareas.';
  const r = ui.alert('📅 Enviar tareas a los calendarios',
    aviso + '\n\n' +
    '• Se crea un evento por cada tarea con fechas.\n' +
    '• Se re-sincroniza: borra los eventos EQUIPO anteriores y los vuelve a crear (sin duplicados).\n\n' +
    '¿Continuar?',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;

  const res = withErrorAlert(() => sincronizarCalendario(), 'sincronizarCalendario');
  ui.alert('✅ Calendarios actualizados',
    'Eventos creados: ' + res.creados + '\n' +
    'Eventos viejos borrados: ' + res.borrados + '\n' +
    'Tareas sin fecha (omitidas): ' + res.sinFecha + '\n' +
    'Modo: ' + res.modo,
    ui.ButtonSet.OK);
}

/**
 * Re-sincroniza el calendario. Devuelve un resumen.
 */
function sincronizarCalendario() {
  return withLock(() => {
    const cal = CalendarApp.getDefaultCalendar();
    const sandbox = isSandboxMode();
    const adminEmail = getConfig('ADMIN_EMAIL') || Session.getActiveUser().getEmail();

    const t0 = today();
    const horizonStart = new Date(t0.getTime() - GTM_CAL_HORIZON_BACK_DAYS * 86400000);
    const horizonEnd = new Date(t0.getTime() + GTM_CAL_HORIZON_FWD_DAYS * 86400000);

    // 1) Borrar eventos EQUIPO anteriores en el horizonte (idempotencia)
    let borrados = 0;
    const existentes = cal.getEvents(horizonStart, horizonEnd);
    existentes.forEach(ev => {
      try {
        if (ev.getTag(GTM_CAL_TAG) || ev.getTitle().indexOf(GTM_CAL_PREFIX) === 0) {
          ev.deleteEvent();
          borrados++;
        }
      } catch (e) { /* ignorar eventos no borrables */ }
    });

    // 2) Crear eventos por tarea con fechas
    const projects = getAllProjects();
    const projById = {};
    projects.forEach(p => { projById[String(p.project_id).trim()] = p; });

    const tasks = getAllTasks();
    let creados = 0, sinFecha = 0;

    tasks.forEach(t => {
      if (toBool(t.completada)) return;
      if (!t.fecha_inicio || !t.fecha_fin) { sinFecha++; return; }
      const proj = projById[String(t.project_id).trim()];
      if (!proj) return;
      if ((proj.estado_manual || '') === 'Archivado') return;

      const start = t.fecha_inicio instanceof Date ? new Date(t.fecha_inicio) : new Date(t.fecha_inicio);
      const end = t.fecha_fin instanceof Date ? new Date(t.fecha_fin) : new Date(t.fecha_fin);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) { sinFecha++; return; }

      // Evento de día completo; endDate exclusivo → +1 día
      const endExcl = new Date(end.getTime() + 86400000);
      const title = GTM_CAL_PREFIX + proj.nombre + ' · ' + t.nombre;

      const ev = cal.createAllDayEvent(title, start, endExcl);
      ev.setTag(GTM_CAL_TAG, String(t.task_id));
      const owners = ownerIdsToNames(t.owner_ids);
      ev.setDescription(
        'Proyecto: ' + proj.nombre + '\n' +
        'Responsable(s): ' + owners + '\n' +
        (t.comentario ? 'Nota: ' + t.comentario + '\n' : '') +
        'Generado por el Sistema de Proyectos.'
      );

      // Invitar a los responsables (SANDBOX → solo admin)
      const emails = sandbox ? [adminEmail] : ownerIdsToEmails(t.owner_ids);
      emails.forEach(em => { try { if (em) ev.addGuest(em); } catch (e) {} });

      creados++;
    });

    logEvent('admin_change', getMonthId(), '', '',
             'Sync calendario: ' + creados + ' eventos creados, ' + borrados + ' borrados',
             'OK', sandbox ? 'SANDBOX' : 'PROD', '');

    return { creados: creados, borrados: borrados, sinFecha: sinFecha, modo: sandbox ? 'SANDBOX' : 'PROD' };
  });
}
