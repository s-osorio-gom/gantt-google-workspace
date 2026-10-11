/**
 * 19_Historico.gs — Histórico de proyectos completados (Sheet PRIVADO de jefes) +
 * rollover mensual (archiva completados del mes anterior) + vista pública "EQUIPO — Logros".
 *
 * El Sheet privado se abre por CONFIDENCIAL_SHEET_ID (00_Config). Contiene pestañas:
 *   - "Historico": proyecto, responsable, tareas, cierre de tareas, cierre proyecto, PERT.
 *   - "Relevantes": (ver 20_Relevantes.gs).
 * Solo el dueño/jefes tienen acceso al Sheet privado; el equipo NO.
 */

let _confidSSCache = null;

/** Abre el Sheet privado confidencial (jefes). Lanza si no está configurado/accesible. */
function getConfidSS() {
  if (_confidSSCache) return _confidSSCache;
  const id = getConfig('CONFIDENCIAL_SHEET_ID');
  if (!id) throw new Error('Falta CONFIDENCIAL_SHEET_ID en 00_Config.');
  _confidSSCache = SpreadsheetApp.openById(String(id).trim());
  return _confidSSCache;
}

const HIST_HEADERS = ['project_id', 'proyecto', 'responsable', 'fecha_cierre_proyecto', 'mes_cierre',
                      'n_tareas', 'tareas_detalle', 'pert_horas', 'fecha_archivado'];
const REL_HEADERS = ['timestamp', 'semana', 'person_id', 'persona', 'tipo', 'project_id', 'proyecto',
                     'relevante', 'comentario_lider', 'fecha_comentario', 'enviado'];

/** Asegura las pestañas del Sheet privado con encabezados y estética. Correr como dueño. */
function ensureConfidTabs() {
  const ss = getConfidSS();
  const out = [];
  [['Historico', HIST_HEADERS], ['Relevantes', REL_HEADERS]].forEach(pair => {
    const name = pair[0], headers = pair[1];
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); out.push('creada ' + name); }
    const cur = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
    if (cur.join('|') !== headers.join('|')) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    sh.getRange(1, 1, 1, headers.length).setBackground('#0F2D52').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  // limpiar la hoja por defecto si quedó vacía
  const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (_) {} }
  return { ok: true, detalle: out };
}

/** Detalle textual de las tareas de un proyecto: "nombre (cerró dd/mm)" separadas por " · ". */
function _tareasDetalle(projectId) {
  return getTasksForProject(projectId).map(t => {
    const cerr = toBool(t.completada) && t.fecha_completada ? ' (cerró ' + fmtDateHuman(t.fecha_completada) + ')' : '';
    return t.nombre + cerr;
  }).join(' · ');
}

/** Archiva UN proyecto al histórico privado y lo marca Archivado en 02_Proyectos. */
function archiveProjectToHistory(projectId) {
  const p = getProjectById(projectId);
  if (!p) return { ok: false, error: 'no existe' };
  const owner = getPersonById(p.owner_id);
  const tasks = getTasksForProject(projectId);
  const fcs = tasks.map(t => t.fecha_completada ? new Date(t.fecha_completada).getTime() : 0).filter(Boolean);
  const cierre = fcs.length ? new Date(Math.max.apply(null, fcs)) : today();
  const ss = getConfidSS();
  const sh = ss.getSheetByName('Historico') || ensureConfidTabs() && ss.getSheetByName('Historico');
  const row = [p.project_id, p.nombre, owner ? owner.nombre : '(sin responsable)',
    fmtDateHuman(cierre), getMonthId(cierre), tasks.length, _tareasDetalle(projectId),
    projectPertHours(projectId), fmtDateHuman(today())];
  sh.appendRow(row);
  setCellByHeader(SHEET_NAMES.PROYECTOS, p._rowIndex, 'estado_manual', 'Archivado');
  logEvent('admin_change', getMonthId(), '', '', 'Proyecto archivado a histórico: ' + projectId,
           'OK', isSandboxMode() ? 'SANDBOX' : 'PROD', '');
  return { ok: true };
}

/**
 * Rollover mensual: archiva los proyectos COMPLETADOS cuyo cierre fue en un mes ANTERIOR al actual.
 * (Los completados del mes en curso siguen visibles con su fecha; se archivan al cambiar de mes.)
 */
function monthlyRollover() {
  return withLock(() => {
    const mesActual = getMonthId(today());
    const recId = getRecurringProjectId();
    const proyectos = getAllProjects().filter(p => (p.estado_manual || '') !== 'Archivado');
    let archivados = 0;
    proyectos.forEach(p => {
      if (recId && String(p.project_id).trim() === recId) return; // nunca archivar el contenedor de recurrentes
      const m = computeProjectMetrics(p.project_id);
      if (!m || mapStatus3(m.status) !== 'Completados') return;
      const tasks = getTasksForProject(p.project_id);
      const fcs = tasks.map(t => t.fecha_completada ? new Date(t.fecha_completada).getTime() : 0).filter(Boolean);
      const cierre = fcs.length ? new Date(Math.max.apply(null, fcs)) : null;
      if (cierre && getMonthId(cierre) < mesActual) { archiveProjectToHistory(p.project_id); archivados++; }
    });
    if (archivados > 0) { try { reconstruirTodo(); } catch (e) { logWarn('rollover rebuild: ' + e.message); } }
    logInfo('monthlyRollover: ' + archivados + ' proyectos archivados');
    return { archivados: archivados };
  });
}

/* ============================================================================
 *  VISTA PÚBLICA — "EQUIPO — Logros" (elegante, para mostrar a un superior externo)
 * ============================================================================ */
function construirLogros() {
  return withLock(() => {
    const ss = getSS();
    let sh = ss.getSheetByName('EQUIPO — Logros');
    if (!sh) sh = ss.insertSheet('EQUIPO — Logros');
    try { return _construirLogrosBody(sh); }
    catch (e) { _vistaError(sh, 'EQUIPO — Logros', e); throw e; }
  });
}

function _construirLogrosBody(sh) {
  sh.clear();
  const f0 = sh.getFilter(); if (f0) f0.remove();
  sh.setHiddenGridlines(true);
  const NC = 6;
  const W = [230, 190, 120, 120, 110, 110];
  for (let c = 0; c < NC; c++) sh.setColumnWidth(c + 1, W[c]);

  // Completados aún activos (mes en curso) + histórico privado (si hay acceso)
  const activos = getAllProjects().filter(p => (p.estado_manual || '') !== 'Archivado');
  const completadosMes = [];
  activos.forEach(p => {
    const m = computeProjectMetrics(p.project_id);
    if (m && mapStatus3(m.status) === 'Completados') {
      const owner = getPersonById(p.owner_id);
      const tasks = getTasksForProject(p.project_id);
      const fcs = tasks.map(t => t.fecha_completada ? new Date(t.fecha_completada).getTime() : 0).filter(Boolean);
      const cierre = fcs.length ? new Date(Math.max.apply(null, fcs)) : today();
      completadosMes.push({ nombre: p.nombre, responsable: owner ? owner.nombre : '—',
        cierre: cierre, mes: getMonthId(cierre), horas: Math.round(projectPertHours(p.project_id)) });
    }
  });
  let historico = [];
  try {
    historico = readSheetObjectsFrom(getConfidSS(), 'Historico').map(r => ({
      nombre: r.proyecto, responsable: r.responsable, cierreTxt: r.fecha_cierre_proyecto,
      mes: r.mes_cierre, horas: parseFloat(r.pert_horas) || 0
    }));
  } catch (e) { historico = []; } // sin acceso al privado → solo lo del mes

  const totalCompletados = completadosMes.length + historico.length;
  const esteMesId = getMonthId(today());
  const esteMes = completadosMes.filter(c => c.mes === esteMesId).length +
                  historico.filter(h => h.mes === esteMesId).length;
  const esteAnio = new Date().getFullYear() + '';
  const anio = completadosMes.filter(c => String(c.mes).indexOf(esteAnio) === 0).length +
               historico.filter(h => String(h.mes).indexOf(esteAnio) === 0).length;

  // color-bar + título
  const bar = [AL.NAVY, AL.BLUE, AL.LBLUE, AL.AMBER, AL.GREEN, AL.RED];
  sh.getRange(1, 1, 1, NC).setBackgrounds([bar]); sh.setRowHeight(1, 8);
  sh.getRange(2, 1, 2, NC).setBackground(AL.NAVY);
  sh.getRange(2, 1).setValue('  Logros del equipo').setFontColor(AL.WHITE).setFontSize(20).setFontWeight('bold').setVerticalAlignment('middle');
  sh.getRange(3, 1).setValue('  Proyectos completados · actualizado ' + fmtDateHuman(today())).setFontColor('#CFE0F5').setFontSize(11);
  sh.setRowHeight(2, 30); sh.setRowHeight(3, 20);

  // KPIs
  const kpis = [['Completados (total)', totalCompletados, AL.GREEN], ['Este mes', esteMes, AL.AMBER], ['Este año', anio, AL.NAVY]];
  sh.getRange(5, 1, 1, 3).setValues([kpis.map(k => k[0])]).setFontColor(AL.STEEL).setFontSize(10).setHorizontalAlignment('center').setBackground(AL.CLOUD);
  const nums = sh.getRange(6, 1, 1, 3); nums.setValues([kpis.map(k => k[1])]).setFontSize(26).setFontWeight('bold').setHorizontalAlignment('center').setBackground(AL.CLOUD);
  nums.setFontColors([kpis.map(k => k[2])]);
  sh.setRowHeight(6, 42);

  // Por persona (completados)
  const byPer = {};
  completadosMes.concat(historico).forEach(c => { byPer[c.responsable] = (byPer[c.responsable] || 0) + 1; });
  sh.getRange(8, 1).setValue('  Completados por responsable').setFontColor(AL.NAVY).setFontWeight('bold').setFontSize(12);
  const perRows = Object.keys(byPer).sort((a, b) => byPer[b] - byPer[a]).map(n => [n, byPer[n]]);
  if (perRows.length) {
    sh.getRange(9, 1, 1, 2).setValues([['Responsable', 'Completados']]).setBackground(AL.NAVY).setFontColor(AL.WHITE).setFontWeight('bold');
    sh.getRange(10, 1, perRows.length, 2).setValues(perRows).setFontSize(11);
  }

  // Lista de completados recientes (mes en curso primero, luego histórico)
  const listStart = 10 + Math.max(1, perRows.length) + 2;
  sh.getRange(listStart - 1, 1).setValue('  Últimos proyectos completados').setFontColor(AL.NAVY).setFontWeight('bold').setFontSize(12);
  const head = ['Proyecto', 'Responsable', 'Cierre', 'Mes', 'Horas (PERT)'];
  sh.getRange(listStart, 1, 1, 5).setValues([head]).setBackground(AL.NAVY).setFontColor(AL.WHITE).setFontWeight('bold');
  const lista = completadosMes.map(c => [c.nombre, c.responsable, fmtDateHuman(c.cierre), c.mes, c.horas + ' h'])
    .concat(historico.map(h => [h.nombre, h.responsable, h.cierreTxt, h.mes, h.horas + ' h']));
  if (lista.length) {
    sh.getRange(listStart + 1, 1, lista.length, 5).setValues(lista).setFontSize(11);
    const bgs = lista.map((_, i) => new Array(5).fill(i % 2 === 1 ? AL.CLOUD : AL.WHITE));
    sh.getRange(listStart + 1, 1, lista.length, 5).setBackgrounds(bgs);
  }

  sh.setFrozenRows(1);
  const maxC = sh.getMaxColumns(); if (maxC > NC) sh.deleteColumns(NC + 1, maxC - NC);
  logInfo('EQUIPO — Logros: ' + totalCompletados + ' completados');
  return { total: totalCompletados, esteMes: esteMes, anio: anio };
}

/* ============================================================================
 *  ESTÉTICA de los Sheets PRIVADOS (Confidencial + Evaluaciones) — misma identidad,
 *  manteniendo el encabezado en la fila 1 (para no romper la automatización).
 * ============================================================================ */

/** Aplica tabla con banda (zebra), header navy, anchos y wrap a una hoja. */
function _bandTable(sh, widths, wrapCols, tabColor) {
  if (!sh) return;
  const NC = widths.length;
  sh.setHiddenGridlines(true);
  try { sh.getBandings().forEach(b => b.remove()); } catch (_) {}
  const band = sh.getRange(1, 1, sh.getMaxRows(), NC).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  band.setHeaderRowColor('#0F2D52').setFirstRowColor('#FFFFFF').setSecondRowColor('#F4F6F8');
  sh.getRange(1, 1, 1, NC).setFontColor('#FFFFFF').setFontWeight('bold').setVerticalAlignment('middle').setWrap(true);
  sh.setFrozenRows(1); sh.setRowHeight(1, 30);
  for (let c = 0; c < NC; c++) sh.setColumnWidth(c + 1, widths[c]);
  (wrapCols || []).forEach(cc => sh.getRange(2, cc, sh.getMaxRows() - 1, 1).setWrap(true).setVerticalAlignment('top'));
  if (tabColor) { try { sh.setTabColor(tabColor); } catch (_) {} }
}

function _cfClear(sh) { sh.setConditionalFormatRules([]); }
function _cfAdd(sh, rules) {
  const cur = sh.getConditionalFormatRules();
  sh.setConditionalFormatRules(cur.concat(rules));
}

/** Estiliza los Sheets privados con la identidad de la casa. Correr como dueño. */
function estilizarSheetsPrivados() {
  const out = [];
  // --- EQUIPO — Confidencial: Historico + Relevantes ---
  try {
    const c = getConfidSS();
    const hist = c.getSheetByName('Historico');
    _bandTable(hist, [90, 240, 160, 140, 90, 75, 380, 90, 120], [7], '#0F2D52');
    if (hist) {
      hist.hideColumns(1); // project_id (técnico)
      hist.getRange(2, 6, hist.getMaxRows() - 1, 1).setHorizontalAlignment('center'); // n_tareas
      hist.getRange(2, 8, hist.getMaxRows() - 1, 1).setNumberFormat('0" h"').setHorizontalAlignment('center'); // pert_horas
      hist.setFrozenColumns(2);
    }
    const rel = c.getSheetByName('Relevantes');
    _bandTable(rel, [140, 80, 80, 150, 80, 90, 190, 320, 320, 120, 80], [8, 9], '#0F2D52');
    if (rel) {
      rel.hideColumns(3); // person_id
      rel.hideColumns(6); // project_id
      rel.setFrozenColumns(4);
      _cfClear(rel);
      const rng = rel.getRange(2, 11, rel.getMaxRows() - 1, 1); // enviado
      _cfAdd(rel, [
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('TRUE').setBackground('#E8F1EC').setFontColor('#3F8C5C').setBold(true).setRanges([rng]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('FALSE').setFontColor('#8A93A8').setRanges([rng]).build()
      ]);
      rel.getRange(1, 9).setBackground('#E0A82E').setFontColor('#0F2D52'); // comentario_lider (el jefe operativo escribe)
    }
    out.push('Confidencial ✓');
  } catch (e) { out.push('Confidencial ERROR: ' + e.message); }

  // --- Evaluaciones ---
  try {
    const ev = getEvalSheet(EVAL_SHEET_TAB);
    _bandTable(ev, [150, 50, 55, 80, 170, 100, 100, 105, 100, 110, 95, 320, 105, 120, 160], [12], '#0A2140');
    ev.hideColumns(1); // eval_id
    ev.hideColumns(4); // person_id
    ev.getRange(2, 6, ev.getMaxRows() - 1, 6).setHorizontalAlignment('center'); // métricas 6-11 centradas
    ev.getRange(2, 7, ev.getMaxRows() - 1, 1).setNumberFormat('0"%"'); // avg_progress
    ev.setFrozenColumns(5); // hasta person_name
    _cfClear(ev);
    const cal = ev.getRange(2, 11, ev.getMaxRows() - 1, 1);   // calificacion_1_5
    const est = ev.getRange(2, 13, ev.getMaxRows() - 1, 1);   // estado
    _cfAdd(ev, [
      SpreadsheetApp.newConditionalFormatRule().whenNumberLessThanOrEqualTo(2).setFontColor('#C0392B').setBold(true).setRanges([cal]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(3).setFontColor('#B0641E').setBold(true).setRanges([cal]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(4).setFontColor('#3F8C5C').setBold(true).setRanges([cal]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ENVIADO').setBackground('#E8F1EC').setFontColor('#3F8C5C').setBold(true).setRanges([est]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('LISTO').setBackground('#FBF1E5').setFontColor('#B0641E').setBold(true).setRanges([est]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PENDIENTE').setFontColor('#8A93A8').setRanges([est]).build()
    ]);
    ev.getRange(1, 11, 1, 2).setBackground('#E0A82E').setFontColor('#0F2D52'); // calificacion + comentario (el jefe del canal escribe)
    out.push('Evaluaciones ✓');
  } catch (e) { out.push('Eval ERROR: ' + e.message); }

  return out;
}

/** Lee una hoja de OTRO spreadsheet como array de objetos (para el Sheet privado). */
function readSheetObjectsFrom(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return [];
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const obj = { _rowIndex: r + 1 }; headers.forEach((h, i) => { obj[h] = values[r][i]; });
    if (headers.some((h, i) => values[r][i] !== '' && values[r][i] !== null)) rows.push(obj);
  }
  return rows;
}
