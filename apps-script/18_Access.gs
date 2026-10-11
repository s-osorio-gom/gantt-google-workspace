/**
 * 18_Access.gs — Control de acceso: admins, supervisores y bloqueo de edición por día.
 *
 * Reglas:
 *  - ADMIN_EMAILS   → ven el menú admin y editan cualquier día.
 *  - SUPERVISOR_EMAILS → editan cualquier día (exentos del bloqueo), sin menú admin.
 *  - El resto del equipo solo puede editar el día EDIT_LOCK_DAY (por defecto jueves).
 *
 * Contexto de usuario:
 *  - Desde sidebar (google.script.run) y menú → Session.getActiveUser().getEmail().
 *  - Desde trigger onEdit → e.user.getEmail() (se pasa explícito).
 *  - Email vacío (Apps Script no siempre lo revela, p. ej. a cuentas de otro dominio):
 *    solo se trata como contexto de confianza si el script corre como un admin
 *    (disparadores instalados por el admin, clasp run, editor). Antes bastaba con
 *    que el email viniera vacío para ver el menú Admin y saltarse el bloqueo del día.
 *  - null = editor desconocido (onEdit sin e.user): nunca es de confianza.
 */

/** Convierte una clave de config con lista separada por comas en array de emails en minúscula. */
function _emailList(configKey, fallback) {
  const raw = getConfig(configKey);
  const val = (raw === undefined || raw === null || String(raw).trim() === '') ? (fallback || '') : raw;
  return String(val).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Emails con rol admin (menú admin + edición cualquier día). Incluye ADMIN_EMAIL histórico. */
function getAdminEmails() {
  const list = _emailList('ADMIN_EMAILS', '');
  const legacy = String(getConfig('ADMIN_EMAIL') || '').toLowerCase().trim();
  if (legacy && list.indexOf(legacy) < 0) list.push(legacy);
  return list;
}

/** Emails de supervisores (editan cualquier día, sin menú admin). */
function getSupervisorEmails() {
  return _emailList('SUPERVISOR_EMAILS', '');
}

/** Email del usuario actual (contexto de menú/sidebar). Vacío si no se puede determinar. */
function currentUserEmail() {
  try { return String(Session.getActiveUser().getEmail() || '').toLowerCase().trim(); }
  catch (e) { return ''; }
}

/** Email de la cuenta con la que corre el script (dueño del disparador, quien usa clasp run…). */
function effectiveUserEmail() {
  try { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase().trim(); }
  catch (e) { return ''; }
}

/** Sin usuario identificable: de confianza solo si el script corre como un admin. */
function _isTrustedServerContext() {
  const eff = effectiveUserEmail();
  return !!eff && getAdminEmails().indexOf(eff) >= 0;
}

/** Normaliza el email recibido: undefined → usuario actual; null → desconocido. */
function _accessEmail(email) {
  if (email === null) return null;
  return String(email === undefined ? currentUserEmail() : email).toLowerCase().trim();
}

/** ¿El email es admin? (email opcional; por defecto usuario actual). */
function isAdminUser(email) {
  const e = _accessEmail(email);
  if (e === null) return false;
  if (!e) return _isTrustedServerContext();
  return getAdminEmails().indexOf(e) >= 0;
}

/** ¿El email está exento del bloqueo de día? (admins + supervisores + contexto de servidor). */
function isExemptUser(email) {
  const e = _accessEmail(email);
  if (e === null) return false;
  if (!e) return _isTrustedServerContext();
  return getAdminEmails().indexOf(e) >= 0 || getSupervisorEmails().indexOf(e) >= 0;
}

/**
 * Lanza si quien ejecuta no es admin. Ocultar el menú Admin no basta: cualquier
 * función global se puede invocar con google.script.run desde un panel abierto.
 */
function assertAdmin(accion) {
  if (!isAdminUser()) {
    throw new Error('Solo un administrador puede ' + (accion || 'hacer esto') +
      '. Los administradores se definen en ADMIN_EMAIL / ADMIN_EMAILS de 00_Config.');
  }
}

function editLockEnabled() { return getConfigBool('EDIT_LOCK_ENABLED', true); }
function editLockDay() { return getConfigInt('EDIT_LOCK_DAY', 4); } // 0=domingo … 4=jueves

/** ¿Las fechas de proyecto están bloqueadas a solo admins/supervisores? (candado reversible por config). */
function projectDatesLocked() { return getConfigBool('PROJECT_DATES_LOCKED', true); }

/** ¿Este email puede cambiar las fechas de un proyecto ahora mismo? */
function canEditProjectDates(email) {
  if (!projectDatesLocked()) return true;
  return isExemptUser(email);
}

/** ¿Se permite editar AHORA para este email? */
function isEditAllowedNow(email) {
  if (!editLockEnabled()) return true;
  if (isExemptUser(email)) return true;
  return today().getDay() === editLockDay();
}

const _DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Lanza si el usuario no puede editar hoy. Usar al inicio de toda mutación del equipo. */
function assertCanEditNow(email) {
  if (!isEditAllowedNow(email)) {
    throw new Error('Solo puedes actualizar los ' + _DIAS_ES[editLockDay()] +
      '. Hoy la edición está bloqueada — vuelve el ' + _DIAS_ES[editLockDay()] + '.');
  }
}

/** Info del usuario actual para la UI (sidebar). */
function whoAmI() {
  const email = currentUserEmail();
  return {
    email: email,
    isAdmin: isAdminUser(email),
    isExempt: isExemptUser(email),
    editAllowedNow: isEditAllowedNow(email),
    lockEnabled: editLockEnabled(),
    lockDay: editLockDay(),
    lockDayName: _DIAS_ES[editLockDay()],
    taskRangeEnforced: getConfigBool('TASK_RANGE_ENFORCED', true),
    projectDatesLocked: projectDatesLocked(),
    canEditProjectDates: canEditProjectDates(email)
  };
}

/** Diagnóstico: evalúa el permiso para un email simulado (para QA). */
function _diag_canEdit(email) {
  return {
    email: email,
    isAdmin: isAdminUser(email),
    isExempt: isExemptUser(email),
    editAllowedNow: isEditAllowedNow(email),
    todayDow: today().getDay(),
    lockDay: editLockDay()
  };
}

/**
 * Carga/asegura las claves de configuración de acceso y bloqueo en 00_Config.
 * Idempotente: solo crea las claves que no existan (no pisa valores, tampoco los vacíos).
 */
function ensureAccessConfig() {
  // Sin correos de ejemplo: un ADMIN_EMAILS sembrado con una dirección ficticia
  // daría permisos de admin a quien la tuviera. Se crean vacías para llenarlas.
  const defaults = {
    ADMIN_EMAILS: '',
    SUPERVISOR_EMAILS: '',
    EDIT_LOCK_ENABLED: 'TRUE',
    EDIT_LOCK_DAY: '4',
    PROJECT_DATES_LOCKED: 'TRUE'
  };
  const cfg = getAllConfig();
  const added = [];
  Object.keys(defaults).forEach(k => {
    if (cfg[k] === undefined) {
      setConfigValue(k, defaults[k]);
      added.push(k);
    }
  });
  invalidateConfigCache();
  return { added: added };
}

/**
 * Setup 1 vez: config de acceso + columnas PERT + pestañas privadas + reconstruir vistas.
 * Ejecutable con clasp run o desde el menú admin.
 */
function setupMejoras2026() {
  assertAdmin('completar la configuración');
  const access = ensureAccessConfig();
  const pert = ensurePertColumns();
  let confid = 'sin CONFIDENCIAL_SHEET_ID';
  try { confid = ensureConfidTabs().detalle.join(', ') || 'ok'; } catch (e) { confid = 'error: ' + e.message; }
  // El contenedor de recurrentes escribe RECURRING_PROJECT_ID en 00_Config: mejor
  // que lo haga el admin ahora que la primera persona que cree una recurrente.
  let rec = '';
  try { rec = setupRecurrentes().container_project_id; } catch (e) { rec = 'error: ' + e.message; }
  const vistas = reconstruirTodo();
  return { accessAdded: access.added, pertAdded: pert.added, confid: confid, recurrentes: rec, vistas: vistas };
}
