/**
 * MyComment.gs — gestión del comentario semanal del usuario activo.
 *
 * Usado por el sidebar "💬 Mi comentario semanal".
 * Detecta automáticamente al usuario por su email de Google.
 */

/**
 * Devuelve el comentario semanal actual del usuario que ejecuta el script.
 * También devuelve el nombre para mostrarlo en el sidebar.
 */
function getMyWeeklyComment() {
  const email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('No se pudo detectar tu email. Reabre el Sheet.');
  const person = getPersonByEmail(email);
  if (!person) {
    return {
      found: false,
      email: email,
      message: 'Tu email (' + email + ') no está en 01_Personas. Habla con el admin.'
    };
  }
  return {
    found: true,
    person_id: person.person_id,
    nombre: person.nombre,
    nombre_corto: person.nombre.split(' ')[0],
    comentario: person.comentario_semanal || '',
    last_updated_hint: person.comentario_semanal ? 'Editaste este comentario antes. Lo puedes cambiar las veces que quieras.' : ''
  };
}

/**
 * Actualiza el comentario semanal del usuario activo.
 */
function updateMyWeeklyComment(text) {
  return withLock(() => {
    const email = Session.getActiveUser().getEmail();
    if (!email) throw new Error('No se pudo detectar tu email');
    const person = getPersonByEmail(email);
    if (!person) throw new Error('Tu email no está en 01_Personas: ' + email);

    const cleanText = (text || '').toString().trim().slice(0, 1000); // máximo 1000 chars
    setCellByHeader(SHEET_NAMES.PERSONAS, person._rowIndex, 'comentario_semanal', cleanText);

    logEvent('comment_update', getWeekId(), person.email, person.nombre,
             'Comentario semanal actualizado', 'OK',
             isSandboxMode() ? 'SANDBOX' : 'PROD',
             cleanText.length + ' chars');

    return { ok: true, length: cleanText.length };
  });
}

/**
 * Limpia comentarios semanales de TODOS los activos.
 * Llamado después de enviar los correos del lunes (para que la próxima semana empiece vacío).
 * Antes de borrar, guarda el comentario en el snapshot del día.
 */
function clearWeeklyComments() {
  const personas = getActivePersons();
  let cleared = 0;
  personas.forEach(p => {
    if (p.comentario_semanal && String(p.comentario_semanal).trim()) {
      setCellByHeader(SHEET_NAMES.PERSONAS, p._rowIndex, 'comentario_semanal', '');
      cleared++;
    }
  });
  logInfo('Comentarios semanales limpiados: ' + cleared);
  return { cleared: cleared };
}
