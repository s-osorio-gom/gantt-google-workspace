/**
 * Snapshots.gs — guarda foto semanal del estado de los proyectos.
 * Append-only en 06_Snapshots para histórico inmutable.
 */

/**
 * Genera un snapshot del estado actual de todos los proyectos.
 * Idempotente: si ya existe snapshot de la semana actual, no lo duplica.
 */
function generateSnapshot() {
  return withLock(() => {
    const weekId = getWeekId();
    const todayDate = today();
    // Verificar duplicado. Antes se calculaba `existing` y nunca se usaba, así que
    // cada llamada (viernes automático + "Ejecutivos del viernes (ahora)") volvía
    // a agregar la foto completa. Con columna snapshot_week se deduplica por
    // semana; sin ella, por fecha.
    const data = readSheetAsObjects(SHEET_NAMES.SNAPSHOTS);
    const conSemana = !!getColMap(SHEET_NAMES.SNAPSHOTS)['snapshot_week'];
    if (snapshotYaExiste(data.rows, weekId, fmtDateISO(todayDate), conSemana)) {
      logInfo('Snapshot ya existía para ' + weekId + ': no se duplica');
      return { ok: true, count: 0, week: weekId, skipped: true };
    }

    const metrics = computeAllProjectMetrics(todayDate);
    let count = 0;
    metrics.forEach(m => {
      appendRowByObject(SHEET_NAMES.SNAPSHOTS, {
        snapshot_date: fmtDateISO(todayDate),
        snapshot_week: weekId,
        project_id: m.project_id,
        project_name: m.nombre,
        owner_id: m.owner_id,
        progress_pct: m.progress_pct,
        status: m.status,
        days_remaining: m.days_remaining,
        alert_type: m.alert_type
      });
      count++;
    });
    logInfo('Snapshot generado: ' + count + ' proyectos para ' + weekId);
    return { ok: true, count: count, week: weekId };
  });
}

/**
 * ¿Ya hay foto para esta semana (o, si la hoja no tiene snapshot_week, para hoy)?
 * Sheets convierte '2026-06-01' en fecha al escribirlo: por eso se normaliza con _toISO.
 */
function snapshotYaExiste(rows, weekId, todayIso, conSemana) {
  return rows.some(r => conSemana
    ? String(r.snapshot_week || '').trim() === weekId
    : _toISO(r.snapshot_date) === todayIso);
}

/**
 * Snapshot bajo demanda (desde menú).
 */
function generateSnapshotNow() {
  withErrorAlert(() => generateSnapshot(), 'generateSnapshotNow');
  SpreadsheetApp.getUi().alert('Snapshot generado para la semana ' + getWeekId());
}

/**
 * Devuelve el snapshot más reciente anterior a hoy para un proyecto.
 * Para calcular delta semanal.
 */
function getLastSnapshotForProject(projectId) {
  const rows = readSheetAsObjects(SHEET_NAMES.SNAPSHOTS).rows
    .filter(r => String(r.project_id) === String(projectId))
    .sort((a, b) => {
      const da = new Date(a.snapshot_date);
      const db = new Date(b.snapshot_date);
      return db - da;
    });
  if (rows.length < 2) return null; // necesitamos el anterior, no el de hoy
  return rows[1]; // [0] es el de hoy si ya se generó, [1] es el anterior
}
