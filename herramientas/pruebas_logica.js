#!/usr/bin/env node
/*
 * pruebas_logica.js — pruebas de la lógica pura del proyecto, sin Google.
 *
 *     node herramientas/pruebas_logica.js apps-script
 *
 * Carga TODOS los .gs en un mismo contexto de `vm` (como Apps Script: un único
 * ámbito global) con dobles mínimos de Session, Utilities y LockService, y
 * reemplaza las funciones que leen el Sheet (getConfig, getAllTasks…) por datos
 * en memoria. Así se prueban las reglas que no dependen de la API: cálculo de
 * estado, PERT, recurrencias, permisos, ventana del Gantt, anti-duplicados.
 *
 * No sustituye la semana en SANDBOX: no ve el Sheet, ni Gmail, ni los disparadores.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(process.argv[2] || 'apps-script');
// Apps Script ejecuta el código con la zona de appsscript.json como zona local
// del runtime: new Date(...), getDate(), setHours()… la usan. Se replica aquí
// para que el resultado no dependa de la zona de la máquina (el CI corre en UTC).
const TZ = JSON.parse(fs.readFileSync(path.join(raiz, 'appsscript.json'), 'utf8')).timeZone;
process.env.TZ = TZ;

// ── dobles de los servicios de Apps Script ─────────────────────────────────
function formatDate(date, zona, patron) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).forEach(x => { p[x.type] = x.value; });
  return patron.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
               .replace('HH', p.hour).replace('mm', p.minute);
}
const estado = { activo: '', efectivo: '', lock: false, config: {} };
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  Session: {
    getScriptTimeZone: () => TZ,
    getActiveUser: () => ({ getEmail: () => estado.activo }),
    getEffectiveUser: () => ({ getEmail: () => estado.efectivo })
  },
  Utilities: { formatDate },
  LockService: {
    getScriptLock: () => ({
      hasLock: () => estado.lock,
      tryLock: () => { if (estado.lock) return false; estado.lock = true; return true; },
      releaseLock: () => { estado.lock = false; }
    })
  }
};
vm.createContext(ctx);

const archivos = fs.readdirSync(raiz).filter(f => f.endsWith('.gs')).sort();
archivos.forEach(f => vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f }));

// Datos en memoria en lugar del Sheet (redefinir una función global en el
// mismo contexto la reemplaza, igual que en Apps Script).
vm.runInContext(`
  var __datos = { tareas: [], proyectos: [], personas: [] };
  function getConfig(k) { return __config()[k]; }
  function getAllConfig() { return __config(); }
  function getAllTasks() { return __datos.tareas; }
  function getAllProjects() { return __datos.proyectos; }
  function getAllPersons() { return __datos.personas; }
`, ctx);
ctx.__config = () => estado.config;
const G = (expr) => vm.runInContext(expr, ctx);

// ── mini-runner ────────────────────────────────────────────────────────────
let fallos = 0, total = 0;
function prueba(nombre, fn) {
  total++;
  estado.config = {}; estado.activo = ''; estado.efectivo = ''; estado.lock = false;
  G('__datos.tareas = []; __datos.proyectos = []; __datos.personas = [];');
  try { fn(); console.log('  [OK  ] ' + nombre); }
  catch (e) { fallos++; console.log('  [FALLA] ' + nombre + ' — ' + e.message); }
}
function igual(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error((msg ? msg + ': ' : '') + 'esperaba ' + jb + ', obtuvo ' + ja);
}
const iso = (d) => G('fmtDateISO')(d);
// Las fechas se crean DENTRO del contexto: `instanceof Date` no reconoce las de otro realm.
const fecha = (s) => { const p = s.split('-').map(Number); return G(`new Date(${p[0]}, ${p[1] - 1}, ${p[2]})`); };

console.log(`\n  pruebas de lógica: ${archivos.length} archivos .gs cargados en un solo ámbito\n`);

// ── utilidades ─────────────────────────────────────────────────────────────
prueba('PERT = (O + 4·M + P) / 6, redondeado a 1 decimal', () => {
  igual(G('pertHoras')(1, 2, 4), 2.2);   // (1 + 8 + 4) / 6 = 2,1666…
  igual(G('pertHoras')('', '', ''), '');
});

prueba('_toISO no corre la fecha por zona horaria', () => {
  igual(G('_toISO')('2026-03-01'), '2026-03-01');
  igual(G('_toISO')(fecha('2026-03-01')), '2026-03-01');
  igual(G('_toISO')('no es fecha'), '');
});

prueba('_mondayOf: el domingo cierra la semana anterior', () => {
  igual(iso(G('_mondayOf')(fecha('2026-10-11'))), '2026-10-05'); // domingo
  igual(iso(G('_mondayOf')(fecha('2026-10-12'))), '2026-10-12'); // lunes
});

prueba('getWeekId usa semana ISO', () => {
  igual(G('getWeekId')(fecha('2026-01-01')), '2026-W01');
  igual(G('getWeekId')(fecha('2027-01-01')), '2026-W53');
});

// ── estado de un proyecto ──────────────────────────────────────────────────
function proyecto(tareas, extra) {
  G('__datos.proyectos').push(Object.assign({ project_id: 'PR001', nombre: 'X', owner_id: 'P001',
    fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31' }, extra || {}));
  tareas.forEach((t, i) => G('__datos.tareas').push(Object.assign({ task_id: 'T' + i, project_id: 'PR001' }, t)));
  return G('computeProjectMetrics')('PR001', fecha('2026-06-01'));
}
prueba('Bloqueada con comentario no penaliza el avance', () => {
  const m = proyecto([{ completada: true }, { bloqueado: true, comentario: 'espera proveedor' }]);
  igual([m.effective_total, m.progress_pct_display, m.status], [1, 100, 'Completado']);
});
prueba('Bloqueada sin comentario cuenta normal', () => {
  const m = proyecto([{ completada: true }, { bloqueado: true, comentario: '' }]);
  igual([m.effective_total, m.progress_pct_display], [2, 50]);
});
prueba('Fecha fin pasada y no completo → Vencido', () => {
  const m = proyecto([{ completada: false }], { fecha_inicio: '2026-01-01', fecha_fin: '2026-05-01' });
  igual(m.status, 'Vencido');
});
prueba('15 puntos o más por debajo de lo esperado → En riesgo', () => {
  const m = proyecto([{ completada: false }, { completada: false }]); // ~42 % del plazo, 0 % de avance
  igual(m.status, 'En riesgo');
});

prueba('addProject rechaza fin anterior al inicio (antes solo lo validaba el panel)', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  estado.efectivo = 'admin@example.com';
  G('__datos.personas').push({ person_id: 'P001', nombre: 'Ana', activo: true });
  let msg = '';
  try { G('addProject')({ nombre: 'X', owner_id: 'P001', fecha_inicio: '2026-05-02', fecha_fin: '2026-05-01' }); }
  catch (e) { msg = e.message; }
  igual(/anterior/.test(msg), true, msg);
});

// ── recurrencias ───────────────────────────────────────────────────────────
prueba('Recurrencia quincenal: semanas alternas desde la semana ancla', () => {
  const r = G('_recInstanceStarts')('quincenal', fecha('2026-07-01'), fecha('2026-07-31'), [3],
                                    fecha('2026-07-01'), fecha('2026-12-31'));
  igual(r.map(iso), ['2026-07-01', '2026-07-15', '2026-07-29']);
});
prueba('Recurrencia mensual el día 31 cae en el último día de los meses cortos', () => {
  const r = G('_recInstanceStarts')('mensual', fecha('2026-01-31'), fecha('2026-04-30'), [],
                                    fecha('2026-01-01'), fecha('2026-12-31'));
  igual(r.map(iso), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});
prueba('Validación de recurrencia rechaza fin anterior al inicio', () => {
  let lanzo = false;
  try { G('_recValidateRecurrence')({ frecuencia: 'semanal', fecha_inicio: '2026-05-02', fecha_fin: '2026-05-01' }); }
  catch (e) { lanzo = true; }
  igual(lanzo, true);
});

// ── ventana del Gantt (antes fija en jul–dic 2026) ─────────────────────────
prueba('Gantt sin configuración: semestre en curso, también después de 2026', () => {
  const w1 = G('ganttWindow')(fecha('2027-03-10'));
  igual([iso(w1.start), iso(w1.end)], ['2027-01-01', '2027-06-30']);
  const w2 = G('ganttWindow')(fecha('2026-10-11'));
  igual([iso(w2.start), iso(w2.end)], ['2026-07-01', '2026-12-31']);
});
prueba('Gantt con GANTT_DESDE / GANTT_HASTA', () => {
  estado.config = { GANTT_DESDE: '2027-02-01', GANTT_HASTA: '2027-04-30' };
  const w = G('ganttWindow')(fecha('2026-10-11'));
  igual([iso(w.start), iso(w.end)], ['2027-02-01', '2027-04-30']);
});
prueba('Festivos salen de 00_Config, no de una lista fija', () => {
  estado.config = { FESTIVOS: '2026-12-08, 2026-12-25' };
  igual(Object.keys(G('_festivos')()), ['2026-12-08', '2026-12-25']);
  estado.config = {};
  igual(Object.keys(G('_festivos')()), []);
});

// ── permisos ───────────────────────────────────────────────────────────────
prueba('Email vacío ya no da permisos de admin a cualquiera', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  estado.activo = ''; estado.efectivo = 'otra@example.com';
  igual([G('isAdminUser')(), G('isExemptUser')()], [false, false]);
});
prueba('Email vacío corriendo como el admin (disparador, clasp run) sí es de confianza', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  estado.activo = ''; estado.efectivo = 'admin@example.com';
  igual(G('isAdminUser')(), true);
});
prueba('Editor desconocido en onEdit (null) no queda exento del bloqueo', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  estado.efectivo = 'admin@example.com';
  igual(G('isExemptUser')(null), false);
});
prueba('Supervisores exentos del bloqueo pero sin menú Admin', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com', SUPERVISOR_EMAILS: 'jefe@example.com' };
  igual([G('isExemptUser')('jefe@example.com'), G('isAdminUser')('jefe@example.com')], [true, false]);
});
prueba('Sin ADMIN_EMAILS no hay admin de ejemplo implícito', () => {
  igual(G('getAdminEmails')(), []);
});
prueba('assertAdmin lanza para quien no es admin', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  estado.activo = 'ana@example.com';
  let lanzo = false;
  try { G('assertAdmin')('probar'); } catch (e) { lanzo = true; }
  igual(lanzo, true);
});
prueba('Dominio de correo se toma de EMAIL_DOMAIN', () => {
  estado.config = { EMAIL_DOMAIN: 'example.org' };
  igual([G('isEmailDelDominio')('ana@example.org'), G('isEmailDelDominio')('ana@example.net')], [true, false]);
});

// ── concurrencia e idempotencia ────────────────────────────────────────────
prueba('withLock es reentrante: la llamada interna no suelta el lock de la externa', () => {
  const dentro = G('withLock')(() => { G('withLock')(() => 1); return estado.lock; });
  igual([dentro, estado.lock], [true, false]);
});
prueba('Anti-duplicado: periodo mensual que Sheets convirtió en fecha', () => {
  igual(G('logPeriodKey')(fecha('2026-06-01')), '2026-06');
  igual(G('logPeriodKey')('2026-W22'), '2026-W22');
});
prueba('Snapshot: una foto por semana (o por día si no hay snapshot_week)', () => {
  const ya = G('snapshotYaExiste');
  igual(ya([{ snapshot_week: '2026-W22' }], '2026-W22', '2026-05-29', true), true);
  igual(ya([{ snapshot_week: '2026-W21' }], '2026-W22', '2026-05-29', true), false);
  igual(ya([{ snapshot_date: fecha('2026-05-29') }], '2026-W22', '2026-05-29', false), true);
});

// ── SANDBOX no consume lo que tiene que llegar en PROD ─────────────────────
// Reemplaza temporalmente funciones globales del contexto (como redefinirlas en
// Apps Script) y las restaura al terminar.
function con(dobles, fn) {
  const antes = {};
  Object.keys(dobles).forEach(k => { antes[k] = ctx[k]; ctx[k] = dobles[k]; });
  try { return fn(); } finally { Object.keys(antes).forEach(k => { ctx[k] = antes[k]; }); }
}
function evalDia4(modo) {
  estado.config = { SYSTEM_MODE: modo, ADMIN_EMAIL: 'admin@example.com' };
  G('__datos.personas').push({ person_id: 'P002', nombre: 'Ana Pérez', email: 'ana@example.com', activo: true });
  const marcas = [], envios = [];
  const r = con({
    today: () => fecha('2026-11-04'),
    getActivePersons: () => G('__datos.personas'),
    readEvalSheetAsObjects: () => ({ rows: [{ _rowIndex: 2, year: 2026, month: 10, person_id: 'P002',
      calificacion_1_5: 4, comentario_jefe: 'Buen mes', estado: 'LISTO', fecha_evaluacion: 'x' }] }),
    setEvalCell: (tab, fila, col, v) => marcas.push(col + '=' + v),
    renderTemplate: () => '',
    sendEmailGTM: (o) => { envios.push(o); return { ok: true }; }
  }, () => G('sendPersonalEvalsDay4')());
  return { r, marcas, envios };
}
prueba('Evaluación enviada en SANDBOX no queda ENVIADO (si no, en PROD nunca llega)', () => {
  const { r, marcas, envios } = evalDia4('SANDBOX');
  igual([r.sent, marcas, envios[0].allowDuplicate], [1, [], false]);
});
prueba('Evaluación enviada en PROD sí queda ENVIADO', () => {
  const { r, marcas } = evalDia4('PROD');
  igual([r.sent, marcas], [1, ['estado=ENVIADO']]);
});
function relevantesSabado(modo) {
  estado.config = { SYSTEM_MODE: modo, ADMIN_EMAIL: 'admin@example.com' };
  G('__datos.personas').push({ person_id: 'P002', nombre: 'Ana Pérez', email: 'ana@example.com', activo: true });
  const escrituras = [], envios = [];
  const hoja = { getRange: (f, c) => ({ setValue: (v) => escrituras.push([f, c, v]) }) };
  con({
    getConfidSS: () => ({ getSheetByName: () => hoja }),
    readSheetObjectsFrom: () => [{ _rowIndex: 5, person_id: 'P002', tipo: 'Otro', relevante: 'r',
      comentario_lider: 'ok', enviado: 'FALSE', semana: '2026-W45' }],
    renderTemplate: () => '',
    sendEmailGTM: (o) => { envios.push(o); return { ok: true }; }
  }, () => G('enviarRelevantesComentados')());
  return { escrituras, envios };
}
prueba('Relevantes enviados en SANDBOX no quedan enviado=TRUE', () => {
  const { escrituras, envios } = relevantesSabado('SANDBOX');
  igual([envios.length, escrituras.length, envios[0].allowDuplicate], [1, 0, false]);
});
prueba('Relevantes enviados en PROD sí quedan enviado=TRUE', () => {
  const { escrituras } = relevantesSabado('PROD');
  igual(escrituras.map(e => e[2]).indexOf('TRUE') >= 0, true);
});

// ── instalación: el contenedor de recurrentes siempre tiene responsable ────
function contenedor(personas, proyectos) {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  personas.forEach(p => G('__datos.personas').push(p));
  proyectos.forEach(p => G('__datos.proyectos').push(p));
  const filas = [], celdas = [];
  let error = '', pid = '';
  con({
    getActivePersons: () => G('__datos.personas').filter(p => p.activo),
    nextId: () => 'PR009',
    appendRowByObject: (hoja, o) => filas.push(o),
    setCellByHeader: (hoja, fila, col, v) => celdas.push(col + '=' + v),
    setConfigValue: (k, v) => { estado.config[k] = v; }
  }, () => { try { pid = G('_ensureRecurringContainer')(); } catch (e) { error = e.message; } });
  return { filas, celdas, error, pid };
}
const ADMIN = { person_id: 'P003', nombre: 'Admin', email: 'admin@example.com', activo: true };
prueba('Sin personas no se crea un contenedor de recurrentes sin responsable', () => {
  const r = contenedor([], []);
  igual([r.filas.length, /persona/i.test(r.error)], [0, true], r.error);
});
prueba('Contenedor de recurrentes existente sin responsable se repara con el admin', () => {
  const r = contenedor([ADMIN], [{ project_id: 'PR004', nombre: '🔁 Recurrentes', owner_id: '', _rowIndex: 5 }]);
  igual([r.pid, r.filas.length, r.celdas], ['PR004', 0, ['owner_id=P003']]);
});
prueba('Contenedor de recurrentes nuevo queda a nombre del admin', () => {
  const r = contenedor([{ person_id: 'P001', nombre: 'Otra', email: 'otra@example.com', activo: true }, ADMIN], []);
  igual([r.pid, r.filas.length && r.filas[0].owner_id], ['PR009', 'P003']);
});

// ── festivos y fechas de 00_Config ─────────────────────────────────────────
prueba('FESTIVOS con una sola fecha (Sheets la guarda como fecha) sí cuenta', () => {
  estado.config = { FESTIVOS: fecha('2026-12-25') };
  igual(Object.keys(G('_festivos')()), ['2026-12-25']);
});
prueba('FESTIVOS ignora fechas imposibles y acepta el 29 de febrero bisiesto', () => {
  estado.config = { FESTIVOS: '2028-02-29, 2027-02-29, 2026-02-30, navidad, 2026-12-08' };
  igual(Object.keys(G('_festivos')()), ['2028-02-29', '2026-12-08']);
});
prueba('GANTT_DESDE imposible no corre la ventana: se usa el semestre en curso', () => {
  estado.config = { GANTT_DESDE: '2027-02-30', GANTT_HASTA: '2027-04-30' };
  const w = G('ganttWindow')(fecha('2026-10-11'));
  igual([iso(w.start), iso(w.end)], ['2026-07-01', '2026-12-31']);
});

// ── recurrencias en los extremos ───────────────────────────────────────────
prueba('Recurrencia semanal en una ventana de 2 años llega hasta el final', () => {
  const r = G('_recInstanceStarts')('semanal', fecha('2027-01-01'), fecha('2028-12-31'), [1],
                                    fecha('2027-01-01'), fecha('2028-12-31'));
  igual([r.length, iso(r[0]), iso(r[r.length - 1])], [104, '2027-01-04', '2028-12-25']);
});
prueba('Recurrencia mensual el día 29: 28-feb en año normal, 29-feb en bisiesto', () => {
  const r = G('_recInstanceStarts')('mensual', fecha('2027-01-29'), fecha('2028-03-31'), [],
                                    fecha('2027-01-01'), fecha('2028-12-31'));
  const feb = r.map(iso).filter(x => x.slice(5, 7) === '02');
  igual(feb, ['2027-02-28', '2028-02-29']);
});
prueba('Recurrencia quincenal conserva la alternancia al cambiar de año', () => {
  const r = G('_recInstanceStarts')('quincenal', fecha('2026-12-21'), fecha('2027-01-31'), [1],
                                    fecha('2026-07-01'), fecha('2027-06-30'));
  igual(r.map(iso), ['2026-12-21', '2027-01-04', '2027-01-18']);
});

console.log('\n  ' + '─'.repeat(56));
console.log(`  ${total - fallos} / ${total} pruebas pasan\n`);
process.exit(fallos ? 1 : 0);
