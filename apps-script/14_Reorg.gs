/**
 * 14_Reorg.gs — Siembra / reorganización del equipo y los proyectos.
 *
 * Reconstruye 01_Personas, 02_Proyectos y 03_Tareas desde cero con el equipo y
 * el catálogo de proyectos definidos abajo. Los que vienen son FICTICIOS: un
 * molde para reemplazar por el equipo real antes de correrlo.
 *
 * SEGURIDAD:
 *  - Hace BACKUP de las 3 pestañas antes de tocar nada (copias con fecha).
 *  - Pide confirmación desde el menú.
 *  - NO envía correos (solo reescribe datos).
 *  - Idempotente: se puede correr de nuevo; siempre deja el mismo estado limpio.
 *
 * Para correr: menú 🍀 EQUIPO → ⚙️ Admin → 🔄 Reorganizar equipo y proyectos.
 */

/* ============================================================================
 *  DATOS FUENTE (equipo de ejemplo) — única fuente de verdad de la reorg
 * ============================================================================ */

/** Roster canónico del equipo (orden = filas en 01_Personas). */
function _reorgPersonas() {
  // [person_id, nombre, email, rol, jefe, frente, zona, activo, ingreso, salida, obs]
  return [
    ['P001','Nicolás Vega','jefe.canal@example.com','Jefe del Canal','','EQUIPO','Nacional', true,'2024-01-01','','Recibe ejecutivo + métricas por persona + califica mensual'],
    ['P002','Andrés Soto','jefe.operativo@example.com','Jefe Operativo','P001','EQUIPO','Nacional', true,'2024-01-01','','Recibe ejecutivo. Lidera el día a día del equipo.'],
    ['P003','Ana Torres','ana.torres@example.com','Analista','P002','EQUIPO','Región Oriente', true,'2024-01-01','',''],
    ['P004','Luis Marín','luis.marin@example.com','Analista','P002','EQUIPO','Canal institucional', true,'2024-01-01','',''],
    ['P005','Clara Duque','clara.duque@example.com','Analista','P002','EQUIPO','Automatización', true,'2024-01-01','',''],
    ['P006','Sara Ochoa','admin@example.com','Analista / Admin','P002','EQUIPO','Analítica', true,'2024-01-01','','Administrador del sistema'],
    ['P007','Elsa Bernal','','Analista','P002','EQUIPO','', false,'2024-01-01','2026-05-15','Salió del equipo.'],
    ['P008','Pablo Serna','pablo.serna@example.com','Analista','P002','EQUIPO','', false,'2026-05-26','2026-06-22','Salió del equipo.'],
    ['P009','Rosa Pineda','rosa.pineda@example.com','Analista','P002','EQUIPO','Digital', true,'2026-05-26','',''],
    ['P010','Hugo Bravo','hugo.bravo@example.com','Analista','P002','EQUIPO','Región Norte', true,'2026-06-22','','Ingresa junio 2026.'],
    ['P011','Elena Paz','elena.paz@example.com','Analista','P002','EQUIPO','Región Centro', true,'2026-06-22','','Ingresa junio 2026.']
  ];
}

/** Proyectos del tablero nuevo, agrupados por responsable. [owner_id, [ [nombre, prioridad], ... ] ] */
function _reorgProyectos() {
  // Catálogo de ejemplo. Sustitúyalo por el suyo antes de sembrar el tablero:
  // son los proyectos con los que arranca cada responsable.
  return [
    ['P009', [ // Rosa Pineda — Digital
      ['Portal de autogestión','Media'],
      ['Tablero de cobertura','Media'],
      ['Piloto de facturación electrónica','Media'],
      ['Firma digital de contratos','Media'],
      ['Plan de comunicación interna','Media']
    ]],
    ['P010', [ // Hugo Bravo — Región Norte
      ['Aplicación de reparto','Media'],
      ['Liberación de garantías','Media'],
      ['Seguimiento de acuerdos comerciales','Media'],
      ['Rediseño de rutas','Media'],
      ['Revisión de anexos contractuales','Media']
    ]],
    ['P011', [ // Elena Paz — Región Centro
      ['Ruteo dinámico','Media'],
      ['Canal mayorista','Media'],
      ['Tipologías de punto de venta','Media'],
      ['Tratamiento de datos personales','Media'],
      ['Dotaciones de la fuerza de ventas','Media']
    ]],
    ['P006', [ // Sara Ochoa — Analítica
      ['Seguimiento nacional de operación','Alta'],
      ['Liquidación mensual de incentivos','Media'],
      ['Seguimiento de resultados por aliado','Media'],
      ['Evolutivo de precios','Alta'],
      ['Mapa nacional de cobertura','Media'],
      ['Pedidos fuera del punto de venta','Media']
    ]],
    ['P003', [ // Ana Torres — Región Oriente
      ['Modelo de atención local','Media'],
      ['Programa de capacitaciones','Media'],
      ['Calculadora de surtido','Media'],
      ['Canal mayorista regional','Media'],
      ['Actualización de acuerdos','Alta']
    ]],
    ['P004', [ // Luis Marín — Canal institucional
      ['Asistente de pedidos','Media'],
      ['Terminal de campo','Media'],
      ['Módulo autónomo','Media'],
      ['Modelo para industria','Media'],
      ['Piloto de cobertura','Media'],
      ['Tablero del canal','Media']
    ]],
    ['P005', [ // Clara Duque — Automatización
      ['Seguimiento de entregas en 48 h','Alta'],
      ['Automatización de liquidaciones','Alta'],
      ['Aplicación para gerencia','Media'],
      ['Conciliación de facturas','Media'],
      ['Automatización de resultados','Media'],
      ['Microcréditos a tenderos','Media'],
      ['Pagos sin efectivo','Media']
    ]]
  ];
}

/* ============================================================================
 *  EJECUCIÓN
 * ============================================================================ */

/**
 * Punto de entrada desde el menú (con confirmación + alertas).
 */
function reorganizarDesdeMenu() {
  assertAdmin('reorganizar el equipo');
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('🔄 Reorganizar equipo y proyectos',
    'Esto va a RECONSTRUIR las pestañas 01_Personas, 02_Proyectos y 03_Tareas con el tablero nuevo.\n\n' +
    '• Antes hace una copia de respaldo de las 3 pestañas (con fecha).\n' +
    '• Las tareas actuales se reemplazan por el formato nuevo (cada proyecto arranca con 2 tareas de ejemplo).\n' +
    '• NO envía correos.\n\n' +
    '¿Continuar?',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;

  const res = withErrorAlert(() => reorganizarEquipoYProyectos(), 'reorganizarEquipoYProyectos');

  ui.alert('✅ Reorganización lista',
    'Personas: ' + res.personas + ' (activas: ' + res.activas + ')\n' +
    'Proyectos: ' + res.proyectos + '\n' +
    'Tareas de ejemplo: ' + res.tareas + '\n' +
    'Cronograma regenerado: ' + res.timeline + ' barras\n\n' +
    'Respaldo guardado en pestañas: ' + res.backups.join(', ') + '\n\n' +
    'Revisa 02_Proyectos y el Cronograma. Cada quien puede ya cargar sus tareas reales.',
    ui.ButtonSet.OK);
}

/**
 * Reconstrucción real. Devuelve un resumen.
 */
function reorganizarEquipoYProyectos() {
  assertAdmin('reorganizar el equipo');
  return withLock(() => {
    const ss = getSS();
    const stamp = Utilities.formatDate(new Date(), tz(), 'yyyyMMdd_HHmm');

    // 1) BACKUP de seguridad de las 3 pestañas
    const backups = [];
    [SHEET_NAMES.PERSONAS, SHEET_NAMES.PROYECTOS, SHEET_NAMES.TAREAS].forEach(name => {
      const orig = ss.getSheetByName(name);
      if (!orig) return;
      const copy = orig.copyTo(ss);
      const bakName = name + '_bak_' + stamp;
      copy.setName(bakName);
      copy.hideSheet();
      backups.push(bakName);
    });

    // 2) PERSONAS
    const personasHeaders = ['person_id','nombre','email','rol','jefe_directo_id','frente','zona',
      'activo','recibe_reporte','recibe_reporte_jefe','recibe_recordatorio_domingo','recibe_motivacional',
      'fecha_ingreso','fecha_salida','comentario_semanal','observaciones'];
    const pData = _reorgPersonas();
    const pRows = pData.map(p => {
      const [id,nombre,email,rol,jefe,frente,zona,activo,ingreso,salida,obs] = p;
      const isBoss = (id === 'P001' || id === 'P002');
      return [
        id, nombre, email, rol, jefe, frente, zona,
        activo ? 'TRUE' : 'FALSE',
        isBoss ? 'FALSE' : (activo ? 'TRUE' : 'FALSE'),   // recibe_reporte (individual)
        isBoss ? 'TRUE' : 'FALSE',                         // recibe_reporte_jefe
        (isBoss || !activo) ? 'FALSE' : 'TRUE',            // recordatorio domingo
        activo ? 'TRUE' : 'FALSE',                         // motivacional
        ingreso, salida, '', obs
      ];
    });
    _writeTabFull(SHEET_NAMES.PERSONAS, personasHeaders, pRows);

    // 3) PROYECTOS
    const proyHeaders = ['project_id','nombre','owner_id','frente','prioridad',
      'fecha_inicio','fecha_fin','objetivo','link_drive','peso','estado_manual'];
    const proyRows = [];
    let prn = 0;
    _reorgProyectos().forEach(group => {
      const ownerId = group[0];
      group[1].forEach(item => {
        prn++;
        const pid = 'PR' + String(prn).padStart(3, '0');
        proyRows.push([pid, item[0], ownerId, 'EQUIPO', item[1], '', '', '', '', 1, '']);
      });
    });
    _writeTabFull(SHEET_NAMES.PROYECTOS, proyHeaders, proyRows);

    // 4) TAREAS — 2 de ejemplo por proyecto, con fechas cercanas para que se vean en el cronograma
    const tareaHeaders = ['task_id','project_id','nombre','owner_ids','fecha_inicio','fecha_fin',
      'completada','fecha_completada','peso','bloqueado','comentario'];
    const t0 = today();
    const fIni = fmtDateISO(t0);
    const fFin = fmtDateISO(new Date(t0.getTime() + 14 * 24 * 60 * 60 * 1000));
    const tareaRows = [];
    let tn = 0;
    proyRows.forEach(pr => {
      const pid = pr[0]; const ownerId = pr[2];
      const ejemplos = ['(ejemplo) Definir alcance y primeras tareas', '(ejemplo) Primer avance / hito'];
      ejemplos.forEach(nombre => {
        tn++;
        tareaRows.push(['T' + String(tn).padStart(4, '0'), pid, nombre, ownerId,
          fIni, fFin, 'FALSE', '', 1, 'FALSE', '']);
      });
    });
    _writeTabFull(SHEET_NAMES.TAREAS, tareaHeaders, tareaRows);

    // 5) Checkboxes en completada/bloqueado (se pierden al reescribir)
    _applyCheckbox(SHEET_NAMES.TAREAS, 'completada', tareaRows.length);
    _applyCheckbox(SHEET_NAMES.TAREAS, 'bloqueado', tareaRows.length);

    // 6) Regenerar cronograma con nombres
    invalidateConfigCache();
    let tl = { rows: 0 };
    try { tl = rebuildTimeline(); } catch (e) { logWarn('Timeline: ' + e.message); }

    logEvent('admin_change', getMonthId(), '', '',
             'Reorganización: ' + pRows.length + ' personas, ' + proyRows.length + ' proyectos, ' + tareaRows.length + ' tareas',
             'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', backups.join(';'));

    return {
      personas: pRows.length,
      activas: pData.filter(p => p[7]).length,
      proyectos: proyRows.length,
      tareas: tareaRows.length,
      timeline: tl.rows,
      backups: backups
    };
  });
}

/* ============================================================================
 *  HELPERS de escritura masiva
 * ============================================================================ */

/**
 * Reescribe por completo una pestaña: limpia todo y escribe headers + filas.
 * Atómico (un solo setValues), preservando ancho de columnas.
 */
function _writeTabFull(sheetName, headers, rows) {
  const sh = getSheet(sheetName);
  sh.clear();  // limpia contenido y formato de datos viejos (deja la hoja)
  // clear() NO borra las validaciones → hay que limpiarlas aparte (si no, quedan desalineadas)
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  const all = [headers].concat(rows);
  sh.getRange(1, 1, all.length, headers.length).setValues(all);
  // Formato del header
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#0F2D52');
  sh.setFrozenRows(1);
  // Limpiar columnas sobrantes a la derecha (de estructuras viejas)
  const maxCol = sh.getMaxColumns();
  if (maxCol > headers.length) {
    sh.deleteColumns(headers.length + 1, maxCol - headers.length);
  }
}

/**
 * Aplica validación de checkbox a una columna (por header) en las filas de datos.
 */
function _applyCheckbox(sheetName, headerName, nDataRows) {
  if (nDataRows < 1) return;
  const sh = getSheet(sheetName);
  const colMap = getColMap(sheetName);
  const col = colMap[headerName];
  if (!col) return;
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(2, col, nDataRows, 1).setDataValidation(rule);
}
