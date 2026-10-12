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
    sendEmailGTM_: (o) => { envios.push(o); return { ok: true }; }
  }, () => G('sendPersonalEvalsDay4_')());
  return { r, marcas, envios };
}
prueba('Evaluación enviada en SANDBOX no queda ENVIADO (si no, en PROD nunca llega)', () => {
  const { r, marcas, envios } = evalDia4('SANDBOX');
  igual([r.sent, marcas, !!envios[0].allowDuplicate], [1, [], false]);
});
prueba('Evaluación enviada en PROD sí queda ENVIADO', () => {
  const { r, marcas } = evalDia4('PROD');
  igual([r.sent, marcas], [1, ['estado=ENVIADO']]);
});
// Relevantes: en SANDBOX se marcan aparte (enviado='SANDBOX') para no
// reenviárselos al admin cada sábado; esa marca NO impide el envío real en PROD
// (exigencia de H1, criterio C7: lo enviado en SANDBOX no consume PROD).
function relevantesSabado(modo, enviado) {
  estado.config = { SYSTEM_MODE: modo, ADMIN_EMAIL: 'admin@example.com' };
  G('__datos.personas').push({ person_id: 'P002', nombre: 'Ana Pérez', email: 'ana@example.com', activo: true });
  const escrituras = [], envios = [];
  const hoja = { getRange: (f, c) => ({ setValue: (v) => escrituras.push([f, c, v]) }) };
  const dobles = {
    getConfidSS: () => ({ getSheetByName: () => hoja }),
    readSheetObjectsFrom: () => [{ _rowIndex: 5, person_id: 'P002', tipo: 'Otro', relevante: 'r',
      comentario_lider: 'ok', enviado: enviado === undefined ? 'FALSE' : enviado, semana: '2026-W45' }],
    renderTemplate: () => '',
    sendEmailGTM_: (o) => { envios.push(o); return { ok: true }; }
  };
  con(dobles, () => G('enviarRelevantesComentados_')());
  return { escrituras, envios, marcas: escrituras.map(e => e[2]) };
}
prueba('Relevantes en SANDBOX: se envían una vez y quedan marcados SANDBOX, no TRUE', () => {
  const r = relevantesSabado('SANDBOX');
  igual([r.envios.length, r.marcas.indexOf('SANDBOX') >= 0, r.marcas.indexOf('TRUE') >= 0], [1, true, false]);
  igual(relevantesSabado('SANDBOX', 'SANDBOX').envios.length, 0);   // el sábado siguiente no se repiten
});
prueba('Relevantes: lo enviado en SANDBOX no impide PROD; PROD no repite lo ya enviado', () => {
  const r = relevantesSabado('PROD');
  igual([r.envios.length, r.marcas.indexOf('TRUE') >= 0], [1, true]);
  igual(relevantesSabado('PROD', 'SANDBOX').envios.length, 1);   // C7: le llega a la persona
  igual(relevantesSabado('PROD', '').envios.length, 1);
  igual(relevantesSabado('PROD', 'TRUE').envios.length, 0);
  igual(relevantesSabado('PROD', true).envios.length, 0);        // casilla marcada
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
    setConfigValue_: (k, v) => { estado.config[k] = v; }
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

// ── dispatcher diario: días del mes configurados ───────────────────────────
// Corre dailyDispatcherMorning cada día del rango y devuelve en qué fechas
// disparó cada tarea mensual.
function despachos(config, desde, hasta) {
  estado.config = Object.assign({ ADMIN_EMAIL: 'admin@example.com' }, config);
  estado.efectivo = 'admin@example.com';   // contexto de disparador: corre como quien lo instaló
  const hechos = { eval: [], rec: [], dia4: [] };
  let hoy = fecha(desde);
  const fin = fecha(hasta).getTime();
  while (hoy.getTime() <= fin) {
    const h = hoy;
    con({
      today: () => h,
      monthlyRollover_: () => {}, monthlyEvalJob: () => hechos.eval.push(iso(h)),
      generateRecurringTasks: () => hechos.rec.push(iso(h)),
      sendPersonalEvalsDay4_: () => hechos.dia4.push(iso(h))
    }, () => G('dailyDispatcherMorning')());
    hoy = G(`new Date(${h.getFullYear()}, ${h.getMonth()}, ${h.getDate() + 1})`);
  }
  return hechos;
}
prueba('Días del mes por defecto: evaluación y recurrentes el 1, envío personal el 4', () => {
  const h = despachos({}, '2026-12-28', '2027-01-06');
  igual([h.eval, h.rec, h.dia4], [['2027-01-01'], ['2027-01-01'], ['2027-01-04']]);
});
prueba('Día 31 configurado cae el último día de los meses cortos (28-feb, 29-feb bisiesto, 30-abr)', () => {
  igual(despachos({ MONTHLY_EVAL_DAY: 31 }, '2027-02-01', '2027-04-30').eval,
        ['2027-02-28', '2027-03-31', '2027-04-30']);
  igual(despachos({ MONTHLY_EVAL_DAY: 31 }, '2028-02-01', '2028-02-29').eval, ['2028-02-29']);
});
// C6: un día inválido (0, negativo, > 31, texto) usa el valor por defecto. La
// versión anterior de esta prueba exigía que 0 cayera el día 1, contra C6.
prueba('Día configurado inválido (0, negativo, > 31, texto) usa el valor por defecto', () => {
  igual(despachos({ PERSONAL_EVAL_SEND_DAY: 0, RECURRING_TASKS_DAY: 'abc', MONTHLY_EVAL_DAY: -3 }, '2027-03-01', '2027-03-31'),
        { eval: ['2027-03-01'], rec: ['2027-03-01'], dia4: ['2027-03-04'] });
  igual(despachos({ PERSONAL_EVAL_SEND_DAY: 32 }, '2027-03-01', '2027-03-31').dia4, ['2027-03-04']);
});

// ── menú Admin: control en el servidor ─────────────────────────────────────
const UI_DOBLE = { getUi: () => ({ alert() {}, ButtonSet: { OK: 0 } }) };
function ejecutivosAhora(quien) {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  estado.activo = quien;
  let enviados = 0, error = '';
  con({
    SpreadsheetApp: UI_DOBLE, generateSnapshot: () => {},
    sendExecutiveReports_: () => { enviados++; return { sent: 1, total: 1 }; }
  }, () => { try { G('sendExecNowFromMenu')(); } catch (e) { error = e.message; } });
  return { enviados, error };
}
prueba('Menú Admin: un no-admin que invoca «Ejecutivos (ahora)» no envía nada', () => {
  const r = ejecutivosAhora('ana@example.com');
  igual([r.enviados, /administrador/.test(r.error)], [0, true]);
});
prueba('Menú Admin: el admin sí puede', () => {
  igual(ejecutivosAhora('admin@example.com'), { enviados: 1, error: '' });
});
prueba('Sheet nuevo sin 00_Config: crear pestañas base sigue permitido sin admin', () => {
  estado.activo = 'ana@example.com';
  let creo = false;
  con({
    SpreadsheetApp: UI_DOBLE, getSS: () => ({ getSheetByName: () => null }),
    crearPestanasBase: () => { creo = true; return { creadas: [], claves: [] }; }
  }, () => G('crearPestanasBaseDesdeMenu')());
  igual(creo, true);
});

// ── instalación: 00_Config trae todas las claves que el código lee ─────────
prueba('crearPestanasBase siembra cada clave que lee el código, y la guía las documenta', () => {
  const leidas = new Set();
  archivos.forEach(f => {
    const t = fs.readFileSync(path.join(raiz, f), 'utf8');
    // esDia('X', n) es el atajo de dailyDispatcherMorning para getConfigInt('X', n)
    for (const m of t.matchAll(/\b(?:getConfig(?:Int|Bool)?|esDia)\(\s*'([A-Z_]+)'/g)) leidas.add(m[1]);
  });
  const sembradas = new Set(G('BASE_CONFIG').map(r => r[0]));
  const delSistema = ['RECURRING_PROJECT_ID'];   // la escribe setupRecurrentes
  const faltan = [...leidas].filter(k => !sembradas.has(k) && delSistema.indexOf(k) < 0).sort();
  igual(faltan, [], 'claves leídas que crearPestanasBase no siembra');
  const guia = fs.readFileSync(path.join(raiz, '..', 'docs', 'instalacion.md'), 'utf8');
  const documentadas = new Set();
  guia.split('\n').filter(l => /^\| `[A-Z_]+`/.test(l))
    .forEach(l => { for (const m of l.split('|')[1].matchAll(/`([A-Z_]+)`/g)) documentadas.add(m[1]); });
  igual([...sembradas].filter(k => !documentadas.has(k)).sort(), [], 'claves sembradas sin documentar');
});

// ── jefe del canal ─────────────────────────────────────────────────────────
const J1 = { person_id: 'P001', nombre: 'Uno', rol: 'Jefe operativo', activo: true, recibe_reporte_jefe: true };
const J2 = { person_id: 'P007', nombre: 'Siete', rol: 'Gerente', activo: true, recibe_reporte_jefe: true };
prueba('Jefe del canal sin JEFE_CANAL_ID: convención P001 o rol con «canal» (como antes)', () => {
  igual([G('esJefeCanal')(J1), G('esJefeCanal')(J2), G('esJefeCanal')(Object.assign({}, J2, { rol: 'Jefe de canal' }))],
        [true, false, true]);
});
prueba('JEFE_CANAL_ID manda sobre la convención', () => {
  estado.config = { JEFE_CANAL_ID: 'P007' };
  igual([G('esJefeCanal')(J1), G('esJefeCanal')(J2)], [false, true]);
});
prueba('Validación avisa si ningún jefe es jefe del canal (la evaluación mensual no saldría)', () => {
  igual(G('avisoJefeCanal')([J2]) !== null, true);
  igual(G('avisoJefeCanal')([J1, J2]), null);
  estado.config = { JEFE_CANAL_ID: 'P099' };
  igual(G('avisoJefeCanal')([J1, J2]) !== null, true);
});
prueba('Día 1: si la evaluación mensual falla (sin jefe del canal), las recurrentes igual se generan', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  estado.efectivo = 'admin@example.com';
  let rec = 0;
  con({
    today: () => fecha('2027-03-01'), monthlyRollover_: () => {}, sendPersonalEvalsDay4_: () => {},
    monthlyEvalJob: () => { throw new Error('No se encontró jefe del canal'); },
    generateRecurringTasks: () => { rec++; }, MailApp: { sendEmail() {} }
  }, () => G('dailyDispatcherMorning')());
  igual(rec, 1);
});

// ── día de edición: disparador y textos ────────────────────────────────────
// Renderizador mínimo de plantillas HtmlService: <?= x ?> escapa, <?!= x ?> no,
// <? código ?> se ejecuta. Basta para detectar variables que faltan y textos.
function renderizar(nombre, vars) {
  const fuente = fs.readFileSync(path.join(raiz, nombre + '.html'), 'utf8');
  let cuerpo = "var __o = '';\n", i = 0;
  const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  let m;
  while ((m = re.exec(fuente))) {
    cuerpo += '__o += ' + JSON.stringify(fuente.slice(i, m.index)) + ';\n';
    if (m[1] === '=') cuerpo += '__o += __esc(' + m[2] + ');\n';
    else if (m[1] === '!=') cuerpo += '__o += (' + m[2] + ');\n';
    else cuerpo += m[2] + '\n';
    i = re.lastIndex;
  }
  cuerpo += '__o += ' + JSON.stringify(fuente.slice(i)) + '; return __o;';
  const html = { createHtmlOutputFromFile: (f) => ({ getContent: () => fs.readFileSync(path.join(raiz, f + '.html'), 'utf8') }) };
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return con({ HtmlService: html, __esc: esc },
    () => G('(function (__v) { with (__v) { ' + cuerpo + ' } })')(vars));
}
function disparadores(config) {
  estado.config = Object.assign({ ADMIN_EMAIL: 'admin@example.com' }, config);
  estado.efectivo = 'admin@example.com';
  const creados = [];
  const builder = (fn) => { const t = { fn: fn }; const b = {
    timeBased: () => b, forSpreadsheet: () => b, onEdit: () => b, atHour: (h) => (t.hora = h, b),
    nearMinute: () => b, inTimezone: () => b, everyDays: () => (t.diario = true, b),
    everyMinutes: () => (t.minuto = true, b), onWeekDay: (d) => (t.dia = d, b), create: () => creados.push(t) }; return b; };
  const dias = {}; ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'].forEach(d => dias[d] = d);
  con({
    ScriptApp: { newTrigger: builder, getProjectTriggers: () => [], WeekDay: dias },
    getSS: () => ({}), getEvalSS: () => { throw new Error('sin EVAL_SHEET_ID'); }
  }, () => G('installAllTriggers')());
  return creados;
}
prueba('Disparadores por defecto: recordatorio jueves, ejecutivo viernes, relevantes sábado (7 sin Sheet de evaluaciones)', () => {
  const t = disparadores({});
  const dia = (fn) => (t.find(x => x.fn === fn) || {}).dia;
  igual([t.length, dia('thursdayReminderJob'), dia('fridayExecJob'), dia('satRelevantesJob')],
        [7, 'THURSDAY', 'FRIDAY', 'SATURDAY']);
});
prueba('El recordatorio se instala el día de edición (EDIT_LOCK_DAY); fuera de 0–6, jueves', () => {
  const dia = (cfg) => disparadores(cfg).find(x => x.fn === 'thursdayReminderJob').dia;
  igual([dia({ EDIT_LOCK_DAY: 2 }), dia({ EDIT_LOCK_DAY: 0 }), dia({ EDIT_LOCK_DAY: 9 })],
        ['TUESDAY', 'SUNDAY', 'THURSDAY']);
});
function recordatorio(config) {
  estado.config = Object.assign({ SUPPORT_EMAIL: 'ayuda@example.com' }, config);
  G('__datos.personas').push({ person_id: 'P002', nombre: 'Ana Pérez', email: 'ana@example.com', activo: true });
  G('__datos.proyectos').push({ project_id: 'PR001', nombre: 'Proyecto <b>X</b>', owner_id: 'P002' });
  G('__datos.tareas').push({ task_id: 'T1', project_id: 'PR001', nombre: 'Tarea vieja', owner_ids: 'P002', fecha_fin: fecha('2026-03-01') },
                           { task_id: 'T2', project_id: 'PR001', nombre: 'Tarea nueva', owner_ids: 'P002', fecha_fin: fecha('2026-04-01') });
  const c = con({ urlToSheet: () => 'https://example.com/hoja' },
    () => G('buildThursdayContext')('P002', fecha('2026-03-10')));
  return { c, html: renderizar('email_recordatorio', c) };
}
prueba('Recordatorio: renderiza, escapa nombres y dice el día de edición configurado', () => {
  const r = recordatorio({ EDIT_LOCK_DAY: 2 });
  igual([r.c.n_atrasadas, /martes/.test(r.html), /jueves/i.test(r.html), r.html.indexOf('<b>X</b>') < 0],
        [1, true, false, true]);
  igual(/jueves/.test(recordatorio({}).html), true);
});
prueba('Bienvenida: dice el día de edición, o que se edita cualquier día si no hay bloqueo', () => {
  const vars = (cfg) => { estado.config = cfg; return Object.assign(G('_ctxDiaEdicion')(), {
    nombre_corto: 'Ana', nombre: 'Ana', rol: 'Analista', link_sheet: '#', link_manual: '#', support_email: 'a@example.com' }); };
  const martes = renderizar('email_bienvenida', vars({ EDIT_LOCK_DAY: 2 }));
  const libre = renderizar('email_bienvenida', vars({ EDIT_LOCK_ENABLED: false }));
  igual([/martes/.test(martes), /jueves/i.test(martes), /cualquier día/.test(libre)], [true, false, true]);
});

// ── anti-duplicado del log de correos ──────────────────────────────────────
function envios(lista, modo) {
  estado.config = { SYSTEM_MODE: modo || 'PROD', ADMIN_EMAIL: 'admin@example.com' };
  let lecturas = 0; const mandados = [];
  G('_cacheEmailLog = null');
  con({
    readSheetAsObjects: () => { lecturas++; return { rows: [] }; },
    logEvent: () => {}, MailApp: { sendEmail: (to) => mandados.push(to) }
  }, () => lista.forEach(([to, periodo]) => G('sendEmailGTM_')({ eventType: 'x', period: periodo,
    realToEmail: to, realToName: to, subject: 's', htmlBody: '' })));
  G('_cacheEmailLog = null');
  return { lecturas, mandados };
}
prueba('Envío masivo: el log de correos se lee una vez por ejecución, no una por correo', () => {
  const r = envios([['a@example.com', 'W1'], ['b@example.com', 'W1'], ['c@example.com', 'W1']]);
  igual([r.lecturas, r.mandados.length], [1, 3]);
});
prueba('Anti-duplicado dentro de la misma ejecución: mismo destinatario y periodo no se repite', () => {
  igual(envios([['a@example.com', 'W1'], ['a@example.com', 'W1'], ['a@example.com', 'W2']]).mandados.length, 2);
});

// ── fragmentos que no son fechas en 00_Config ──────────────────────────────
prueba('FESTIVOS: un año suelto o texto alrededor no sombrea días falsos', () => {
  estado.config = { FESTIVOS: '2026-12-25, 2026' };
  igual(Object.keys(G('_festivos')()), ['2026-12-25']);
  estado.config = { FESTIVOS: 'Festivos 2026: 2026-12-25' };
  igual(Object.keys(G('_festivos')()), ['2026-12-25']);
});
prueba('FESTIVOS: los fragmentos ignorados se avisan en 99_Validaciones', () => {
  estado.config = { FESTIVOS: 'Festivos 2026: 2026-12-25, 2026-02-30' };
  const a = G('avisoFestivos')();
  igual([a !== null, a && /Festivos/.test(a.problema) && /2026-02-30/.test(a.problema)], [true, true]);
  estado.config = { FESTIVOS: '2026-12-25; 2026-12-08' };
  igual(G('avisoFestivos')(), null);
});
prueba('GANTT_DESDE con solo el año no corre la ventana al 31-dic', () => {
  estado.config = { GANTT_DESDE: '2027', GANTT_HASTA: '2027-04-30' };
  const w = G('ganttWindow')(fecha('2026-10-11'));
  igual([iso(w.start), iso(w.end)], ['2026-07-01', '2026-12-31']);
});

// ── recordatorio en un día que ya no es el de edición ──────────────────────
function recordatorioJob(dia, hoy) {
  estado.config = { ADMIN_EMAIL: 'admin@example.com', EDIT_LOCK_DAY: dia };
  estado.efectivo = 'admin@example.com';
  let envios = 0; const avisos = [];
  con({ today: () => fecha(hoy), MailApp: { sendEmail: (to, asunto) => avisos.push(to + ' | ' + asunto) },
        sendThursdayReminders_: () => { envios++; return { sent: 1, total: 1 }; } },
      () => G('thursdayReminderJob')());
  return { envios, avisos };
}
prueba('Recordatorio: si el disparador corre un día que no es EDIT_LOCK_DAY, no envía y avisa al admin', () => {
  const r = recordatorioJob(2, '2026-10-08');                  // jueves, día de edición martes
  igual([r.envios, r.avisos.length, /admin@example.com/.test(r.avisos[0] || '')], [0, 1, true]);
  igual(recordatorioJob(2, '2026-10-06'), { envios: 1, avisos: [] }); // martes
  igual(recordatorioJob(4, '2026-10-08'), { envios: 1, avisos: [] }); // jueves por defecto
});
prueba('Recordatorio con día de edición viernes o sábado no promete el reporte de «este» viernes 8:30', () => {
  const r5 = recordatorio({ EDIT_LOCK_DAY: 5 }).html, r4 = recordatorio({}).html;
  igual([/semana siguiente/.test(r5), /semana siguiente/.test(r4), /viernes 8:30/.test(r4)], [true, false, true]);
});

// ── PROD: un fallo entre el envío y la marca de la fila no reenvía ─────────
// sendEmailGTM_ real; el log persiste entre «ejecuciones» y la marca de la fila falla.
function conLogPersistente(fn) {
  const log = [], correos = [];
  const dobles = {
    readSheetAsObjects: () => ({ rows: log.slice() }),
    logEvent: (tipo, periodo, email, nombre, asunto, status, modo) =>
      log.push({ event_type: tipo, period: periodo, destinatario_email: email, status: status, mode: modo }),
    MailApp: { sendEmail: (to) => correos.push(to) }, renderTemplate: () => ''
  };
  const ejecucion = (extra) => { G('_cacheEmailLog = null'); con(Object.assign({}, dobles, extra), fn); G('_cacheEmailLog = null'); };
  return { ejecucion, correos };
}
const DIA4 = (fila) => ({ today: () => fecha('2026-11-04'), getActivePersons: () => G('__datos.personas'),
  readEvalSheetAsObjects: () => ({ rows: [fila] }),
  setEvalCell: () => { throw new Error('la hoja privada no respondió'); } });
prueba('Evaluación en PROD: si falla la marca ENVIADO, el reintento no la reenvía; una corrección sí sale', () => {
  estado.config = { SYSTEM_MODE: 'PROD', ADMIN_EMAIL: 'admin@example.com' };
  G('__datos.personas').push({ person_id: 'P002', nombre: 'Ana Pérez', email: 'ana@example.com', activo: true });
  const fila = { _rowIndex: 2, year: 2026, month: 10, person_id: 'P002', calificacion_1_5: 4,
                 comentario_jefe: 'Buen mes', estado: 'LISTO', fecha_evaluacion: 'x' };
  const fn = 'sendPersonalEvalsDay4_';
  const t = conLogPersistente(() => G(fn)());
  t.ejecucion(DIA4(fila)); t.ejecucion(DIA4(fila));
  igual(t.correos.length, 1);
  t.ejecucion(DIA4(Object.assign({}, fila, { comentario_jefe: 'Buen mes (corregido)' })));
  igual(t.correos.length, 2);
});
prueba('Relevantes en PROD: si falla la marca enviado, el reintento no los reenvía', () => {
  estado.config = { SYSTEM_MODE: 'PROD', ADMIN_EMAIL: 'admin@example.com' };
  G('__datos.personas').push({ person_id: 'P002', nombre: 'Ana Pérez', email: 'ana@example.com', activo: true });
  const hoja = { getRange: () => ({ setValue: () => { throw new Error('la hoja privada no respondió'); } }) };
  const extra = { today: () => fecha('2026-11-07'), getConfidSS: () => ({ getSheetByName: () => hoja }),
    readSheetObjectsFrom: () => [{ _rowIndex: 5, person_id: 'P002', tipo: 'Otro', relevante: 'r',
      comentario_lider: 'ok', enviado: '', semana: '2026-W45', timestamp: 'x' }] };
  const fn = 'enviarRelevantesComentados_';
  const t = conLogPersistente(() => { try { G(fn)(); } catch (_) {} });
  t.ejecucion(extra); t.ejecucion(extra);
  igual(t.correos.length, 1);
});

// ── funciones internas fuera del alcance de google.script.run ──────────────
// En Apps Script, una función cuyo nombre termina en «_» no se puede invocar
// desde el cliente (google.script.run) ni desde el menú Ejecutar.
const INTERNAS = ['setConfigValue', 'monthlyRollover', 'uninstallAllTriggers', 'sendExecutiveReports',
  'sendThursdayReminders', 'enviarRelevantesComentados', 'sendPersonalEvalsDay4', 'sendPersonalEvaluationEmail',
  'sendMonthlyEvalEmailToBoss', 'sendEmailGTM', 'sendWelcomeEmail', 'sendMotivationalEmail', 'sendIndividualReport',
  'sendRecordatorios', 'sincronizarCalendario', 'archiveProjectToHistory', 'clearWeeklyComments'];
prueba('Funciones que envían correo, escriben 00_Config o archivan son privadas (terminan en «_»)', () => {
  igual(INTERNAS.filter(f => typeof ctx[f] === 'function' || typeof ctx[f + '_'] !== 'function'), []);
});
const MANEJADORES = ['thursdayReminderJob', 'fridayExecJob', 'satRelevantesJob', 'dailyDispatcherMorning',
  'dailyDispatcherAfternoon', 'weeklyJob', 'sundayReminderJob', 'weeklySnapshotPre', 'monthlyEvalJob', 'motivationalJob'];
prueba('Manejadores de disparadores: un no-admin que los invoca no logra nada (ni correo de alerta)', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com' };
  estado.activo = 'ana@example.com'; estado.efectivo = 'ana@example.com';
  const correos = [], pasaron = [];
  con({ MailApp: { sendEmail: (to) => correos.push(to) }, today: () => { throw new Error('pasó el guardia'); } }, () => {
    MANEJADORES.forEach(fn => { try { G(fn)(); pasaron.push(fn); } catch (e) { if (!/administrador/.test(e.message)) pasaron.push(fn); } });
  });
  igual([pasaron, correos], [[], []]);
});
prueba('Manejadores de disparadores: en contexto de disparador (corre como el admin) sí pasan', () => {
  estado.config = { ADMIN_EMAIL: 'admin@example.com', EDIT_LOCK_DAY: 4 };
  estado.activo = ''; estado.efectivo = 'admin@example.com';
  let envios = 0;
  const stub = () => { envios++; return { sent: 1, total: 1 }; };
  con({ today: () => fecha('2026-10-08'), sendThursdayReminders_: stub },
      () => G('thursdayReminderJob')());
  estado.activo = 'admin@example.com';
  con({ today: () => fecha('2026-10-08'), sendThursdayReminders_: stub },
      () => G('thursdayReminderJob')());
  igual(envios, 2);
});

// ── huella de los relevantes: ni la semana ni la fila la cambian ───────────
function relevantesConMarcaFallida(corridas) {
  estado.config = { SYSTEM_MODE: 'PROD', ADMIN_EMAIL: 'admin@example.com' };
  G('__datos.personas').push({ person_id: 'P002', nombre: 'Ana Pérez', email: 'ana@example.com', activo: true });
  const hoja = { getRange: () => ({ setValue: () => { throw new Error('la hoja privada no respondió'); } }) };
  const t = conLogPersistente(() => { try { G('enviarRelevantesComentados_')(); } catch (_) {} });
  corridas.forEach(([dia, filas]) => t.ejecucion({ today: () => fecha(dia),
    getConfidSS: () => ({ getSheetByName: () => hoja }), readSheetObjectsFrom: () => filas }));
  return t.correos.length;
}
const REL = (fila, ts, texto) => ({ _rowIndex: fila, person_id: 'P002', tipo: 'Otro', relevante: texto || 'r',
  comentario_lider: 'ok', enviado: '', semana: '2026-W45', timestamp: ts || 'x' });
prueba('Relevantes: si falla la marca, el reintento del sábado siguiente no los reenvía', () => {
  igual(relevantesConMarcaFallida([['2026-11-07', [REL(5)]], ['2026-11-14', [REL(5)]]]), 1);
});
prueba('Relevantes: filas que cambian de posición u orden no cambian la huella; un lote nuevo sí sale', () => {
  igual(relevantesConMarcaFallida([['2026-11-07', [REL(5, 'a'), REL(6, 'b')]],
                                   ['2026-11-07', [REL(9, 'b'), REL(8, 'a')]]]), 1);
  igual(relevantesConMarcaFallida([['2026-11-07', [REL(5, 'a')]], ['2026-11-14', [REL(5, 'a'), REL(6, 'c', 'nuevo')]]]), 2);
});

console.log('\n  ' + '─'.repeat(56));
console.log(`  ${total - fallos} / ${total} pruebas pasan\n`);
process.exit(fallos ? 1 : 0);
