/**
 * UI.gs — menú custom, sidebars y diálogos.
 * Se carga al abrir el Sheet vía onOpen().
 *
 * Estructura del menú:
 *   🍀 EQUIPO
 *   ├── 🏠 Ir al panel de control
 *   ├── 💬 Mi comentario semanal           (todos los usuarios)
 *   ├── 📁 Proyectos                       (submenú)
 *   ├── ✅ Tareas                          (submenú)
 *   ├── 👥 Personas                        (submenú)
 *   ├── ✅ Validar datos
 *   ├── 📸 Snapshot ahora
 *   ├── ❓ Ver errores
 *   ├── 📧 Enviar prueba
 *   ├── 📧 Enviar producción
 *   ├── ⚙️ Admin                          (submenú)
 *   └── 📖 Abrir manual
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('🍀 EQUIPO');

  // Sheet recién creado: sin 00_Config no hay a quién reconocer como admin, así
  // que el único paso posible es crear la estructura.
  if (!getSS().getSheetByName(SHEET_NAMES.CONFIG)) {
    menu.addItem('🧱 Crear pestañas base', 'crearPestanasBaseDesdeMenu');
    menu.addToUi();
    return;
  }

  // --- Para TODO el equipo (lo esencial) ---
  menu.addItem('✏️ Editar proyectos y tareas', 'openProjectManagerSidebar');
  menu.addItem('📝 Crear relevante', 'openRelevanteSidebar');
  menu.addItem('🔁 Tareas recurrentes', 'openRecurrentesSidebar');
  menu.addItem('📅 Ver Gantt por persona/proyecto', 'openGanttFiltroSidebar');
  menu.addItem('📊 Ir al Resumen', 'goToResumen');
  menu.addItem('💬 Mi comentario semanal', 'openMyCommentSidebar');

  // --- Solo administradores ---
  let esAdmin = false;
  try { esAdmin = isAdminUser(); } catch (e) { esAdmin = false; }
  if (esAdmin) {
    menu.addSeparator();
    const adminMenu = ui.createMenu('⚙️ Admin');
    adminMenu.addItem('➕ Crear proyecto', 'openAddProjectSidebar');
    adminMenu.addItem('🔄 Reconstruir vistas', 'reconstruirVistasDesdeMenu');
    adminMenu.addItem('👥 Agregar persona', 'openAddPersonSidebar');
    adminMenu.addItem('🚫 Inactivar persona', 'openInactivatePersonDialog');
    adminMenu.addItem('📅 Enviar tareas a los calendarios', 'enviarCalendarioDesdeMenu');
    adminMenu.addItem('✅ Validar datos', 'runValidationsAndAlert');
    adminMenu.addSeparator();
    adminMenu.addItem('📨 Enviar relevantes comentados', 'enviarRelevantesDesdeMenu');
    adminMenu.addItem('📋 Enviar evaluaciones calificadas', 'enviarEvaluacionesDesdeMenu');
    adminMenu.addItem('📧 Enviar prueba (a mí)', 'sendTestIndividualToAdmin');
    adminMenu.addItem('📧 Recordatorio del día de edición (ahora)', 'sendThursdayNowFromMenu');
    adminMenu.addItem('📧 Ejecutivos del viernes (ahora)', 'sendExecNowFromMenu');
    adminMenu.addItem('📧 Enviar bienvenida a TODO el equipo', 'sendWelcomeToAllFromMenu');
    adminMenu.addSeparator();
    adminMenu.addItem('Modo SANDBOX', 'switchToSandbox');
    adminMenu.addItem('Modo PROD', 'switchToProd');
    adminMenu.addItem('Ver estado del sistema', 'showSystemStatus');
    adminMenu.addItem('🔄 Reorganizar equipo y proyectos', 'reorganizarDesdeMenu');
    adminMenu.addItem('🧱 Crear pestañas base (las que falten)', 'crearPestanasBaseDesdeMenu');
    adminMenu.addItem('⚙️ Completar configuración (1 vez)', 'setupMejoras2026FromMenu');
    adminMenu.addItem('⏰ Instalar / reinstalar disparadores', 'reinstallTriggersFromMenu');
    adminMenu.addItem('🔁 Generar recurrentes del período', 'generateRecurringFromMenu');
    menu.addSubMenu(adminMenu);
  }

  menu.addSeparator();
  menu.addItem('📖 Abrir manual de usuario', 'openUserManual');
  menu.addToUi();
}

/** Navega a la pestaña Resumen. */
function goToResumen() {
  const sh = getSS().getSheetByName('Resumen');
  if (sh) getSS().setActiveSheet(sh);
}

/** Envía el recordatorio del día de edición ahora (admin, respeta SANDBOX). */
function sendThursdayNowFromMenu() {
  assertAdmin('enviar el recordatorio');
  const r = sendThursdayReminders();
  SpreadsheetApp.getUi().alert('Recordatorio enviado',
    'Enviados: ' + r.sent + ' de ' + r.total + (isSandboxMode() ? '\n\n(SANDBOX: los correos van al admin)' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Envía los ejecutivos del viernes ahora (admin, respeta SANDBOX). */
function sendExecNowFromMenu() {
  assertAdmin('enviar los ejecutivos');
  try { generateSnapshot(); } catch (e) {}
  const r = sendExecutiveReports();
  SpreadsheetApp.getUi().alert('Ejecutivos enviados',
    'Enviados: ' + r.sent + ' de ' + r.total + (isSandboxMode() ? '\n\n(SANDBOX: los correos van al admin)' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Setup 1 vez: config de acceso + columnas PERT + pestañas privadas + reconstruir vistas. */
function setupMejoras2026FromMenu() {
  assertAdmin('completar la configuración');
  const res = setupMejoras2026();
  SpreadsheetApp.getUi().alert('Configuración completada',
    'Config acceso: ' + (res.accessAdded.join(', ') || '(ya estaban)') +
    '\nPERT columnas: ' + (res.pertAdded.join(', ') || '(ya estaban)') +
    '\nPestañas privadas: ' + res.confid +
    '\nProyecto de recurrentes: ' + res.recurrentes +
    '\nVistas: ' + res.vistas.join(' | '),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ============================================================================
 *  INSTALACIÓN — pestañas base
 * ============================================================================ */

/**
 * Encabezados de las pestañas que el sistema lee y escribe. Son los que usan
 * los módulos (las columnas se leen por nombre, así que el orden no importa).
 */
const BASE_TABS = {
  '00_Inicio': ['Panel del equipo'],
  '00_Config': ['clave', 'valor', 'descripcion'],
  '01_Personas': ['person_id', 'nombre', 'email', 'rol', 'jefe_directo_id', 'frente', 'zona',
    'activo', 'recibe_reporte', 'recibe_reporte_jefe', 'recibe_recordatorio_domingo',
    'recibe_motivacional', 'fecha_ingreso', 'fecha_salida', 'comentario_semanal', 'observaciones',
    'vista_filtrada_id'],
  '02_Proyectos': ['project_id', 'nombre', 'owner_id', 'frente', 'prioridad', 'fecha_inicio',
    'fecha_fin', 'objetivo', 'link_drive', 'peso', 'estado_manual'],
  '03_Tareas': ['task_id', 'project_id', 'nombre', 'owner_ids', 'fecha_inicio', 'fecha_fin',
    'completada', 'fecha_completada', 'peso', 'bloqueado', 'comentario',
    't_optimista', 't_probable', 't_pesimista', 'pert_horas', 'rec_source'],
  '04_Timeline': ['card_title', 'start_date', 'end_date', 'duration_days', 'owner_name',
    'project_name', 'status', 'progress_pct', 'comentario', 'link', 'color_category'],
  '06_Snapshots': ['snapshot_date', 'snapshot_week', 'project_id', 'project_name', 'owner_id',
    'progress_pct', 'status', 'days_remaining', 'alert_type'],
  '08_Email_Log': ['timestamp', 'event_type', 'period', 'destinatario_email', 'destinatario_nombre',
    'asunto', 'status', 'mode', 'detalle'],
  '10_Mensajes_Motivacionales': ['mes_numero', 'frase_principal', 'mensaje_corto', 'autor_o_origen'],
  '99_Validaciones': ['nivel', 'hoja', 'fila', 'problema', 'sugerencia', 'link']
};

/** Claves de 00_Config que se siembran vacías (o con su valor por defecto) para llenarlas a mano. */
const BASE_CONFIG = [
  ['SYSTEM_MODE', 'SANDBOX', 'SANDBOX: todos los correos van al admin. PROD: a los destinatarios reales.'],
  ['SANDBOX_REDIRECT_TO', '', 'Opcional: a quién van los correos en SANDBOX. Vacío: a ADMIN_EMAIL.'],
  ['ADMIN_EMAIL', '', 'Administrador: recibe errores y muestras. Debe ser quien instala los disparadores.'],
  ['ADMIN_EMAILS', '', 'Otros administradores, separados por coma (opcional).'],
  ['SUPERVISOR_EMAILS', '', 'Editan cualquier día, sin menú Admin. Separados por coma.'],
  ['SUPPORT_EMAIL', '', 'Correo de soporte que aparece en el pie de los correos.'],
  ['EMAIL_DOMAIN', '', 'Dominio admitido al dar de alta una persona (ej. example.org).'],
  ['SENDER_NAME', 'Sistema de Proyectos', 'Remitente visible de los correos.'],
  ['JEFE_CANAL_ID', '', 'Opcional: person_id del jefe del canal (ejecutivo con detalle y evaluación). Vacío: P001 o rol con «canal».'],
  ['EVAL_SHEET_ID', '', 'ID del Sheet privado de evaluaciones.'],
  ['EVAL_SHEET_URL', '', 'URL del Sheet privado de evaluaciones (para el correo al jefe).'],
  ['CONFIDENCIAL_SHEET_ID', '', 'ID del Sheet privado de jefes (histórico y relevantes).'],
  ['LOGO_FILE_ID', '', 'Opcional: ID en Drive del logo (se usa si _brand_bar.html tiene <img src="cid:logo">).'],
  ['MANUAL_USER_URL', '', 'Opcional: URL del manual de usuario.'],
  ['SHEET_URL', '', 'Opcional: base de los enlaces de los correos. Vacío: la URL de este Sheet.'],
  ['EDIT_LOCK_ENABLED', 'TRUE', 'TRUE: el equipo solo edita el día EDIT_LOCK_DAY.'],
  ['EDIT_LOCK_DAY', '4', 'Día de edición del equipo: 0=domingo … 4=jueves … 6=sábado.'],
  ['PROJECT_DATES_LOCKED', 'TRUE', 'TRUE: solo admins y supervisores cambian fechas de proyecto.'],
  ['TASK_RANGE_ENFORCED', 'TRUE', 'TRUE: las tareas deben caer dentro de las fechas de su proyecto.'],
  ['BLOCKED_REQUIRES_COMMENT', 'TRUE', 'TRUE: una tarea bloqueada solo deja de contar si tiene comentario.'],
  ['RISK_GAP_THRESHOLD_PTS', '-15', 'Puntos por debajo de lo esperado para marcar un proyecto «En riesgo».'],
  ['DUE_SOON_DAYS', '7', 'Días antes del fin en que menos del 80 % de avance es «En riesgo».'],
  ['GANTT_DESDE', '', 'Inicio del Cronograma (yyyy-mm-dd). Vacío: semestre en curso.'],
  ['GANTT_HASTA', '', 'Fin del Cronograma (yyyy-mm-dd). Vacío: semestre en curso.'],
  ['FESTIVOS', '', 'Festivos que se sombrean en el Cronograma: fechas yyyy-mm-dd separadas por coma.'],
  ['MONTHLY_EVAL_DAY', '1', 'Día del mes de la evaluación y el archivo al histórico (mes más corto: el último día).'],
  ['PERSONAL_EVAL_SEND_DAY', '4', 'Día del mes en que cada persona recibe su evaluación calificada.'],
  ['RECURRING_TASKS_DAY', '1', 'Día del mes en que se regeneran las tareas recurrentes.'],
  ['MOTIVATIONAL_ENABLED', 'TRUE', 'TRUE: mensaje de cierre el último día del mes.'],
  ['SEND_WELCOME_EMAIL', 'TRUE', 'TRUE: correo de bienvenida al agregar una persona.']
];

/**
 * Crea las pestañas base que falten, con sus encabezados, y siembra 00_Config.
 * Idempotente: no toca pestañas que ya existan ni pisa claves ya definidas.
 */
function crearPestanasBase() {
  const ss = getSS();
  const creadas = [];
  Object.keys(BASE_TABS).forEach(name => {
    if (ss.getSheetByName(name)) return;
    const sh = ss.insertSheet(name);
    const headers = BASE_TABS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#0F2D52');
    sh.setFrozenRows(1);
    creadas.push(name);
  });
  // El periodo del log se compara como texto: que Sheets no lo convierta en fecha.
  try { getSheet(SHEET_NAMES.EMAIL_LOG).getRange('C:C').setNumberFormat('@'); } catch (_) {}

  invalidateConfigCache();
  const cfg = getAllConfig();
  const sembradas = [];
  BASE_CONFIG.forEach(([k, v, d]) => {
    if (cfg[k] !== undefined) return;
    appendRowByObject(SHEET_NAMES.CONFIG, { clave: k, valor: v, descripcion: d });
    sembradas.push(k);
  });
  invalidateConfigCache();
  return { creadas: creadas, claves: sembradas };
}

function crearPestanasBaseDesdeMenu() {
  // En un Sheet nuevo aún no hay admins configurados: se permite crear la
  // estructura (no borra ni pisa nada). Con 00_Config ya creado, solo admins.
  if (getSS().getSheetByName(SHEET_NAMES.CONFIG)) assertAdmin('crear pestañas');
  const r = crearPestanasBase();
  SpreadsheetApp.getUi().alert('Pestañas base',
    'Creadas: ' + (r.creadas.join(', ') || '(ya existían todas)') +
    '\nClaves nuevas en 00_Config: ' + (r.claves.join(', ') || '(ninguna)') +
    '\n\nSiguiente paso: llene 00_Config (al menos ADMIN_EMAIL y EMAIL_DOMAIN) y recargue el Sheet.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ============================================================================
 *  NAVEGACIÓN
 * ============================================================================ */
function goToInicio() {
  getSS().setActiveSheet(getSheet(SHEET_NAMES.INICIO));
}
function goToValidaciones() {
  getSS().setActiveSheet(getSheet(SHEET_NAMES.VALIDACIONES));
}

/* ============================================================================
 *  SIDEBARS — Abrir desde menú
 * ============================================================================ */
function _sidebar(file, title, width) {
  const html = HtmlService.createTemplateFromFile(file).evaluate().setTitle(title).setWidth(width || 360);
  SpreadsheetApp.getUi().showSidebar(html);
}
function openMyCommentSidebar() { _sidebar('sidebar_my_comment', '💬 Mi comentario semanal', 360); }
function openRecurrentesSidebar() { _sidebar('sidebar_recurrentes', '🔁 Tareas recurrentes', 380); }

/** Genera las instancias recurrentes del período (botón admin). */
function generateRecurringFromMenu() {
  assertAdmin('generar las recurrentes del período');
  const r = generateRecurringTasks();
  SpreadsheetApp.getUi().alert('Tareas recurrentes',
    'Instancias nuevas generadas: ' + r.created + '\nPlantillas activas: ' + r.plantillas,
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function openAddPersonSidebar() {
  assertAdmin('agregar personas');
  _sidebar('sidebar_add_person', '➕ Agregar persona', 360);
}
function openAddProjectSidebar() {
  assertAdmin('crear proyectos desde el menú Admin');
  _sidebar('sidebar_add_project', '➕ Agregar proyecto', 360);
}

/** El editor de proyecto va como VENTANA GRANDE (diálogo), no panel chico. */
function openProjectManagerSidebar() {
  const html = HtmlService.createTemplateFromFile('sidebar_project_manager').evaluate()
    .setWidth(880).setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, '✏️ Editar proyecto y tareas');
}
function openGanttFiltroSidebar() { _sidebar('sidebar_gantt_filtro', '📅 Ver Gantt filtrado', 360); }
function openRelevanteSidebar() { _sidebar('sidebar_relevante', '📝 Crear relevante', 400); }

/* ============================================================================
 *  DIÁLOGO — Inactivar persona
 * ============================================================================ */
function openInactivatePersonDialog() {
  assertAdmin('inactivar personas');
  const personas = getActivePersons();
  if (personas.length === 0) {
    SpreadsheetApp.getUi().alert('No hay personas activas.');
    return;
  }
  const ui = SpreadsheetApp.getUi();
  const opts = personas.map((p, i) => (i + 1) + '. ' + p.nombre + ' (' + p.person_id + ')').join('\n');
  const r = ui.prompt('Inactivar persona',
    'Escribe el número de la persona a inactivar:\n\n' + opts,
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const idx = parseInt(r.getResponseText(), 10);
  if (isNaN(idx) || idx < 1 || idx > personas.length) {
    ui.alert('Número inválido.');
    return;
  }
  const p = personas[idx - 1];
  const confirm = ui.alert('Confirmar', '¿Inactivar a ' + p.nombre + '? Sus proyectos abiertos quedarán para reasignar.',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;
  inactivatePerson(p.person_id);
  ui.alert(p.nombre + ' marcada como inactiva.');
}

/* ============================================================================
 *  ADMIN — modo SANDBOX/PROD
 * ============================================================================ */
function switchToSandbox() {
  assertAdmin('cambiar el modo del sistema');
  setConfigValue('SYSTEM_MODE', 'SANDBOX');
  SpreadsheetApp.getUi().alert('Sistema en modo SANDBOX. Los correos se redirigen al admin.');
}
function switchToProd() {
  assertAdmin('cambiar el modo del sistema');
  const ui = SpreadsheetApp.getUi();
  const valid = runValidations();
  if (valid.critical > 0) {
    ui.alert('No puedes pasar a PROD: hay ' + valid.critical + ' errores críticos. Revisa 99_Validaciones primero.');
    return;
  }
  const r = ui.alert('⚠️ Cambiar a PRODUCCIÓN',
    'Los correos se enviarán a destinatarios REALES. ¿Confirmas?',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  setConfigValue('SYSTEM_MODE', 'PROD');
  ui.alert('Sistema en modo PROD. Los correos salen a los destinatarios reales desde el próximo ' +
    'disparador (recordatorio: ' + _ctxDiaEdicion().dia_edicion + ' 8:30; ejecutivo: viernes 8:30).');
}

/**
 * Modifica un valor en 00_Config.
 */
function setConfigValue(key, value) {
  const data = readSheetAsObjects(SHEET_NAMES.CONFIG);
  const row = data.rows.find(r => r.clave === key);
  if (row) {
    setCellByHeader(SHEET_NAMES.CONFIG, row._rowIndex, 'valor', value);
  } else {
    appendRowByObject(SHEET_NAMES.CONFIG, { clave: key, valor: value, descripcion: '' });
  }
  invalidateConfigCache();
}

/* ============================================================================
 *  ESTADO DEL SISTEMA
 * ============================================================================ */
function showSystemStatus() {
  assertAdmin('ver el estado del sistema');
  const mode = getConfig('SYSTEM_MODE') || 'SANDBOX';
  const log = readSheetAsObjects(SHEET_NAMES.EMAIL_LOG).rows;
  const lastSent = log.filter(r => r.status === 'OK').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  const valid = readSheetAsObjects(SHEET_NAMES.VALIDACIONES).rows;
  const critical = valid.filter(r => r.nivel === 'CRITICO').length;
  const warnings = valid.filter(r => r.nivel === 'WARNING').length;

  const activeProjects = getAllProjects().filter(p => {
    if ((p.estado_manual || '') === 'Archivado') return false;
    const m = computeProjectMetrics(p.project_id);
    return m && m.status !== 'Completado';
  }).length;

  const msg = [
    'MODO: ' + mode,
    'Último envío OK: ' + (lastSent ? lastSent.asunto + ' (' + fmtDateHuman(new Date(lastSent.timestamp)) + ')' : 'ninguno'),
    'Errores críticos: ' + critical,
    'Warnings: ' + warnings,
    'Personas activas: ' + getActivePersons().length,
    'Proyectos activos (no archivados, no cerrados): ' + activeProjects
  ].join('\n');
  SpreadsheetApp.getUi().alert('Estado del sistema', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ============================================================================
 *  MANUAL
 * ============================================================================ */
function openUserManual() {
  const url = getConfig('MANUAL_USER_URL');
  if (!url) {
    SpreadsheetApp.getUi().alert('Configura MANUAL_USER_URL en 00_Config para abrir el manual desde aquí.');
    return;
  }
  // La URL viene de 00_Config: solo http(s) y serializada como literal JS, no concatenada.
  if (!/^https?:\/\//i.test(String(url).trim())) {
    SpreadsheetApp.getUi().alert('MANUAL_USER_URL debe empezar por http:// o https://');
    return;
  }
  const lit = JSON.stringify(String(url).trim()).replace(/</g, '\\u003c');
  const html = '<script>window.open(' + lit + ',"_blank");google.script.host.close();</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html), 'Abriendo manual...');
}
