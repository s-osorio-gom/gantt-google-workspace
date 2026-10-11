/**
 * Personas.gs — CRUD de personas (la fuente de verdad ÚNICA del equipo).
 * Cero hardcoding de personas o emails en el resto del sistema.
 */

/**
 * Devuelve todas las personas activas (activo=TRUE).
 */
function getActivePersons() {
  return readSheetAsObjects(SHEET_NAMES.PERSONAS).rows
    .filter(p => toBool(p.activo));
}

/**
 * Devuelve TODAS las personas (incluyendo inactivas). Cacheado por ejecución.
 */
function getAllPersons() {
  if (!_cachePersons) _cachePersons = readSheetAsObjects(SHEET_NAMES.PERSONAS).rows;
  return _cachePersons;
}

/**
 * Persona por person_id.
 */
function getPersonById(personId) {
  if (!personId) return null;
  const all = getAllPersons();
  return all.find(p => String(p.person_id).trim() === String(personId).trim()) || null;
}

/**
 * Persona por email (case-insensitive).
 */
function getPersonByEmail(email) {
  if (!email) return null;
  const e = String(email).toLowerCase().trim();
  return getAllPersons().find(p => String(p.email).toLowerCase().trim() === e) || null;
}

/**
 * Devuelve nombres de display de una lista de person_ids separados por coma.
 * "P003,P004" → "Ana Torres, Luis Marín"
 */
function ownerIdsToNames(ownerIdsStr) {
  if (!ownerIdsStr) return '';
  const ids = String(ownerIdsStr).split(',').map(s => s.trim()).filter(Boolean);
  return ids.map(id => {
    const p = getPersonById(id);
    return p ? p.nombre : id;
  }).join(', ');
}

/**
 * Devuelve emails reales de una lista de person_ids.
 */
function ownerIdsToEmails(ownerIdsStr) {
  if (!ownerIdsStr) return [];
  const ids = String(ownerIdsStr).split(',').map(s => s.trim()).filter(Boolean);
  return ids.map(id => {
    const p = getPersonById(id);
    return p ? p.email : null;
  }).filter(Boolean);
}

/**
 * ¿Es el «jefe del canal»? (recibe el ejecutivo con detalle por persona y califica
 * la evaluación mensual). JEFE_CANAL_ID en 00_Config lo fija por person_id; vacía,
 * se usa la convención heredada: P001 o un rol que contenga «canal».
 */
function esJefeCanal(p) {
  if (!p) return false;
  const id = String(getConfig('JEFE_CANAL_ID') || '').trim();
  if (id) return String(p.person_id || '').trim() === id;
  return String(p.person_id || '').trim() === 'P001' || String(p.rol || '').toLowerCase().indexOf('canal') >= 0;
}

/**
 * Agrega una persona nueva. Genera person_id, envía correo de bienvenida.
 * Llamado desde sidebar.
 */
function addPerson(payload) {
  assertAdmin('agregar personas');
  return withLock(() => {
    // Validaciones mínimas
    if (!payload || !payload.nombre) throw new Error('Falta nombre');
    if (!payload.email) throw new Error('Falta email');
    if (!isEmailDelDominio(payload.email)) {
      throw new Error('Email inválido. Debe ser @' + getEmailDomain());
    }
    // Duplicados
    if (getPersonByEmail(payload.email)) {
      throw new Error('Ya existe persona con ese email');
    }
    const personId = nextId(SHEET_NAMES.PERSONAS, 'person_id', 'P', 3);
    const isBoss = payload.es_jefe === true || payload.es_jefe === 'TRUE';

    appendRowByObject(SHEET_NAMES.PERSONAS, {
      person_id: personId,
      nombre: payload.nombre,
      email: payload.email,
      rol: payload.rol || 'Analista',
      jefe_directo_id: payload.jefe_directo_id || '',
      frente: payload.frente || 'EQUIPO',
      zona: payload.zona || '',
      activo: 'TRUE',
      recibe_reporte: isBoss ? 'FALSE' : 'TRUE',
      recibe_reporte_jefe: isBoss ? 'TRUE' : 'FALSE',
      recibe_recordatorio_domingo: isBoss ? 'FALSE' : 'TRUE',
      recibe_motivacional: 'TRUE',
      fecha_ingreso: fmtDateISO(today()),
      fecha_salida: '',
      comentario_semanal: '',
      observaciones: payload.observaciones || ''
    });

    logEvent('admin_change', getMonthId(), payload.email, payload.nombre,
             'Persona agregada: ' + personId, 'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', '');

    // Enviar correo de bienvenida (respeta modo SANDBOX)
    if (!isBoss && getConfigBool('SEND_WELCOME_EMAIL', true)) {
      try { sendWelcomeEmail(personId); }
      catch (e) { logWarn('No se pudo enviar bienvenida: ' + e.message); }
    }

    return { ok: true, person_id: personId };
  });
}

/**
 * Marca persona como inactiva (soft-delete). NUNCA borra fila.
 */
function inactivatePerson(personId) {
  assertAdmin('inactivar personas');
  return withLock(() => {
    const person = getPersonById(personId);
    if (!person) throw new Error('No existe persona: ' + personId);
    if (!toBool(person.activo)) return { ok: true, msg: 'Ya estaba inactiva' };

    setCellByHeader(SHEET_NAMES.PERSONAS, person._rowIndex, 'activo', 'FALSE');
    setCellByHeader(SHEET_NAMES.PERSONAS, person._rowIndex, 'fecha_salida', fmtDateISO(today()));

    logEvent('admin_change', getMonthId(), person.email, person.nombre,
             'Persona inactivada: ' + personId, 'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', '');

    // runValidations marcará warnings de proyectos huérfanos
    return { ok: true };
  });
}

/**
 * Lista de personas activas como opciones para sidebars.
 */
function getActivePersonsForUI() {
  return getActivePersons().map(p => ({
    id: p.person_id,
    nombre: p.nombre,
    email: p.email,
    rol: p.rol
  }));
}
