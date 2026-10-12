/**
 * 20_Relevantes.gs — "Relevantes" semanales.
 *
 * Flujo:
 *  1) Cada persona (reglas del día de edición) abre el botón "Crear relevante", escoge persona + proyecto
 *     (o "Otro") y escribe un comentario. Se guarda en un STAGING oculto de la hoja principal
 *     (_Relevantes_IN) — porque el sidebar corre como el usuario, que NO tiene acceso al Sheet privado.
 *  2) Un proceso del DUEÑO (autoRefreshDirty, 1 min) sincroniza el staging → Sheet privado
 *     "Relevantes" (solo el jefe operativo) y limpia el staging. Así el destino final es privado.
 *  3) el jefe operativo escribe un comentario en la columna comentario_lider del Sheet privado.
 *  4) Un proceso del dueño (dailyDispatcherMorning) recopila los relevantes YA comentados y no
 *     enviados, y manda a cada persona un correo con sus relevantes + el comentario del jefe operativo.
 */

const STAGING_TAB = '_Relevantes_IN';
const STAGING_HEADERS = ['timestamp', 'semana', 'person_id', 'persona', 'tipo', 'project_id', 'proyecto', 'relevante', 'synced'];

/** Asegura el staging oculto en la hoja principal. */
function _ensureStagingTab() {
  const ss = getSS();
  let sh = ss.getSheetByName(STAGING_TAB);
  if (!sh) {
    sh = ss.insertSheet(STAGING_TAB);
    sh.getRange(1, 1, 1, STAGING_HEADERS.length).setValues([STAGING_HEADERS]);
  }
  try { sh.hideSheet(); } catch (_) {}
  return sh;
}

/** Datos para el formulario de relevante (personas activas + proyectos activos + yo). */
function getRelevanteFormData() {
  return {
    me: whoAmI(),
    persons: getActivePersonsForUI(),
    projects: getActiveProjectsForUI().map(p => ({ id: p.id, nombre: p.nombre, owner_name: p.owner_name }))
  };
}

/** Crea un relevante (corre como el usuario). Reglas del día de edición. Va al staging. */
function addRelevante(payload) {
  assertCanEditNow();
  if (!payload || !payload.person_id) throw new Error('Falta la persona.');
  if (!payload.relevante || !String(payload.relevante).trim()) throw new Error('Escribe el comentario del relevante.');
  const person = getPersonById(payload.person_id);
  if (!person) throw new Error('Persona inválida.');
  const tipo = payload.tipo === 'Otro' ? 'Otro' : 'Proyecto';
  let projId = '', projName = '';
  if (tipo === 'Proyecto') {
    const proj = getProjectById(payload.project_id);
    if (!proj) throw new Error('Escoge un proyecto o marca "Otro".');
    projId = proj.project_id; projName = proj.nombre;
  }
  const sh = _ensureStagingTab();
  sh.appendRow([new Date(), getWeekId(today()), person.person_id, person.nombre, tipo, projId, projName,
    String(payload.relevante).trim(), 'FALSE']);
  _markViewsDirty(); // dispara la sincronización al privado en <1 min
  return { ok: true };
}

/** DUEÑO: mueve los relevantes del staging al Sheet privado "Relevantes" y limpia el staging. */
function syncRelevantesToConfid() {
  const ss = getSS();
  const sh = ss.getSheetByName(STAGING_TAB);
  if (!sh) return { moved: 0 };
  const last = sh.getLastRow();
  if (last < 2) return { moved: 0 };
  const values = sh.getRange(2, 1, last - 1, STAGING_HEADERS.length).getValues();
  const confid = getConfidSS();
  let rel = confid.getSheetByName('Relevantes');
  if (!rel) { ensureConfidTabs(); rel = confid.getSheetByName('Relevantes'); }
  let moved = 0;
  values.forEach(r => {
    if (!r[2]) return; // sin person_id → fila vacía
    // REL_HEADERS: timestamp, semana, person_id, persona, tipo, project_id, proyecto, relevante, comentario_lider, fecha_comentario, enviado
    rel.appendRow([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], '', '', 'FALSE']);
    moved++;
  });
  // limpiar staging (deja solo encabezados)
  if (last > 1) sh.getRange(2, 1, last - 1, STAGING_HEADERS.length).clearContent();
  if (moved) logInfo('Relevantes sincronizados al privado: ' + moved);
  return { moved: moved };
}

/** DUEÑO: envía a cada persona sus relevantes YA comentados por el jefe operativo y no enviados. */
function enviarRelevantesComentados_() {
  let confid;
  try { confid = getConfidSS(); } catch (e) { return { sent: 0, error: e.message }; }
  const rows = readSheetObjectsFrom(confid, 'Relevantes')
    .filter(r => String(r.comentario_lider || '').trim() !== '' && _relevantePendiente(r.enviado));
  if (!rows.length) return { sent: 0 };
  // agrupar por persona
  const byPerson = {};
  rows.forEach(r => { (byPerson[r.person_id] = byPerson[r.person_id] || []).push(r); });
  const rel = confid.getSheetByName('Relevantes');
  const colMap = {}; REL_HEADERS.forEach((h, i) => colMap[h] = i + 1);
  // En SANDBOX el correo va al admin y la fila queda enviado='SANDBOX': no se le
  // reenvía al admin cada sábado ni le llega a la persona al pasar a PROD (lo
  // comentado durante las pruebas no es para ella). PROD marca TRUE.
  const sandbox = isSandboxMode();
  let sent = 0;
  Object.keys(byPerson).forEach(pid => {
    const person = getPersonById(pid);
    if (!person) return;
    const items = byPerson[pid].map(r => ({
      tipo: r.tipo, proyecto: r.proyecto || 'General',
      relevante: r.relevante, comentario: r.comentario_lider, semana: r.semana
    }));
    const ctx = {
      nombre_corto: person.nombre.split(' ')[0], nombre: person.nombre,
      items: items, today_display: fmtDateHuman(today()),
      support_email: getConfig('SUPPORT_EMAIL') || 'admin@example.com'
    };
    const html = renderTemplate('email_relevantes', ctx);
    const res = sendEmailGTM_({
      // Huella del lote (filas y comentarios): si el correo sale pero falla la marca
      // de las filas, el reintento lo detiene el log; un lote nuevo sí sale.
      eventType: 'relevantes_feedback',
      period: getWeekId(today()) + '-' + pid + '#' + _huella(byPerson[pid].map(r =>
        [r._rowIndex, r.timestamp, r.relevante, r.comentario_lider].join('|')).join('§')),
      realToEmail: person.email, realToName: person.nombre,
      subject: 'Comentarios a tus relevantes de la semana', htmlBody: html
    });
    if (res.ok) {
      try {
        byPerson[pid].forEach(r => {
          rel.getRange(r._rowIndex, colMap['enviado']).setValue(sandbox ? 'SANDBOX' : 'TRUE');
          rel.getRange(r._rowIndex, colMap['fecha_comentario']).setValue(fmtDateHuman(today()));
        });
      } catch (e) { logError('relevantes: no se pudo marcar enviado de ' + pid + ': ' + e.message); }
      sent++;
    }
  });
  logInfo('Relevantes comentados enviados a ' + sent + ' personas');
  return { sent: sent };
}

/** Pendiente de envío: `enviado` vacío o FALSE. TRUE (PROD) y SANDBOX ya se trataron. */
function _relevantePendiente(enviado) {
  const m = String(enviado === null || enviado === undefined ? '' : enviado).trim().toUpperCase();
  return m === '' || m === 'FALSE';
}

/**
 * PRUEBA end-to-end del ciclo de relevantes: crea uno para el admin, lo sincroniza al privado,
 * simula el comentario del jefe operativo y lo envía. Devuelve el resultado del envío.
 */
function _diag_pruebaRelevanteCompleto() {
  assertAdmin('usar la función de diagnóstico _diag_pruebaRelevanteCompleto');
  const admin = getActivePersons().find(p => String(p.email).toLowerCase() === String(getConfig('ADMIN_EMAIL') || '').toLowerCase())
             || getPersonById('P006') || getActivePersons()[0];
  const proj = getActiveProjectsForUI()[0];
  addRelevante({ person_id: admin.person_id, tipo: proj ? 'Proyecto' : 'Otro',
    project_id: proj ? proj.id : '', relevante: 'PRUEBA: esta semana avancé con la definición del alcance.' });
  syncRelevantesToConfid();
  const confid = getConfidSS();
  const rel = confid.getSheetByName('Relevantes');
  const pend = readSheetObjectsFrom(confid, 'Relevantes').filter(r => !String(r.comentario_lider || '').trim());
  if (pend.length) {
    const colMap = {}; REL_HEADERS.forEach((h, i) => colMap[h] = i + 1);
    rel.getRange(pend[pend.length - 1]._rowIndex, colMap['comentario_lider'])
       .setValue('Excelente avance. Coordina la firma para el viernes. — el jefe operativo');
  }
  return enviarRelevantesComentados_();
}

/** Atajo admin/el jefe operativo desde menú. */
function enviarRelevantesDesdeMenu() {
  assertAdmin('enviar los relevantes comentados');
  const r = enviarRelevantesComentados_();
  SpreadsheetApp.getUi().alert('Relevantes comentados',
    'Enviados a ' + (r.sent || 0) + ' persona(s)' + (r.error ? ('\n\n' + r.error) : '') +
    (isSandboxMode() ? '\n\n(SANDBOX: van al admin y quedan marcados enviado=SANDBOX; no se reenvían en PROD)' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}
