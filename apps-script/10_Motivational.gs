/**
 * Motivational.gs — correo motivacional el último día de cada mes.
 *
 * - Lee el mensaje del mes desde la pestaña 10_Mensajes_Motivacionales.
 * - Va para TODAS las personas activas (incluidos los jefes) con recibe_motivacional=TRUE.
 * - Solo mensaje, sin métricas ni datos.
 */

/**
 * Devuelve el mensaje motivacional del mes corriente (1-12).
 */
function getMotivationalMessage(monthNumber) {
  if (!monthNumber) monthNumber = today().getMonth() + 1;
  const rows = readSheetAsObjects(SHEET_NAMES.MOTIVACIONALES).rows;
  const msg = rows.find(r => Number(r.mes_numero) === Number(monthNumber));
  if (msg) {
    return {
      frase_principal: msg.frase_principal,
      mensaje_corto: msg.mensaje_corto,
      autor: msg.autor_o_origen || 'Equipo EQUIPO'
    };
  }
  // Fallback
  return {
    frase_principal: 'Gracias por tu trabajo este mes.',
    mensaje_corto: 'Que el próximo mes te encuentre con energía.',
    autor: 'Equipo EQUIPO'
  };
}

/**
 * Envía el correo motivacional a una persona.
 */
function sendMotivationalEmail(personId, monthDate) {
  if (!monthDate) monthDate = today();
  const person = getPersonById(personId);
  if (!person) throw new Error('Persona no encontrada: ' + personId);

  const monthNumber = monthDate.getMonth() + 1;
  const year = monthDate.getFullYear();
  const monthName = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][monthNumber - 1];
  const msg = getMotivationalMessage(monthNumber);

  const ctx = {
    nombre_corto: person.nombre.split(' ')[0],
    nombre: person.nombre,
    month_label: monthName + ' de ' + year,
    today_display: fmtDateHuman(monthDate),
    frase_principal: msg.frase_principal,
    mensaje_corto: msg.mensaje_corto,
    autor: msg.autor,
    support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com'
  };

  const html = renderTemplate('email_motivacional', ctx);
  return sendEmailGTM({
    eventType: 'monthly_motivational',
    period: year + '-' + String(monthNumber).padStart(2, '0'),
    realToEmail: person.email,
    realToName: person.nombre,
    subject: 'Gracias por tu trabajo este mes',
    htmlBody: html
  });
}

/**
 * Trigger del último día del mes (ejecutado por un cron diario que valida si es el último).
 */
function motivationalJob() {
  return withErrorAlert(() => {
    if (!getConfigBool('MOTIVATIONAL_ENABLED', true)) {
      logInfo('motivationalJob: deshabilitado por config');
      return;
    }
    // Solo ejecutar si HOY es el último día del mes
    const d = today();
    const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    if (tomorrow.getMonth() === d.getMonth()) {
      logInfo('motivationalJob: hoy no es último día del mes, salgo');
      return;
    }
    const personas = getActivePersons().filter(p => toBool(p.recibe_motivacional));
    let sent = 0;
    personas.forEach(p => {
      const r = sendMotivationalEmail(p.person_id, d);
      if (r && r.ok) sent++;
    });
    logInfo('motivationalJob: ' + sent + ' enviados de ' + personas.length);
  }, 'motivationalJob');
}
