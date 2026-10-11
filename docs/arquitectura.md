# Arquitectura

## Los 21 módulos

| Módulo | Líneas | Responsabilidad |
|---|---:|---|
| `01_Utils.gs` | 373 | Acceso al Sheet, mapa de columnas, zona horaria, bloqueos, log, helpers compartidos |
| `02_Config.gs` | 141 | Lectura cacheada de `00_Config`, modo SANDBOX/PROD, dominio de correo |
| `03_Personas.gs` | 148 | Altas, bajas y consulta de personas |
| `04_Proyectos.gs` | 254 | Proyectos y cálculo de estado, avance y alertas |
| `05_Tareas.gs` | 475 | Tareas binarias, PERT y disparador de edición |
| `06_Snapshots.gs` | 78 | Foto semanal, solo se agrega, una por semana |
| `07_Validations.gs` | 229 | Chequeo de salud; bloquea envíos si algo crítico falla |
| `08_Reports.gs` | 693 | Recordatorios, correos ejecutivos y bienvenida; envío con anti-duplicado |
| `09_Evaluations.gs` | 320 | Evaluación mensual sobre el Sheet privado |
| `10_Motivational.gs` | 90 | Mensaje de cierre de mes, frase rotativa |
| `11_Triggers.gs` | 210 | Instalación de los ocho disparadores y sus manejadores |
| `12_UI.gs` | 379 | Menú, paneles laterales, pestañas base y acciones de administración |
| `13_MyComment.gs` | 71 | Comentario semanal de quien está usando el Sheet |
| `14_Reorg.gs` | 268 | Siembra y reorganización del equipo (equipo de ejemplo) |
| `15_Calendar.gs` | 118 | Sincronización con Google Calendar |
| `16_Vistas.gs` | 1021 | Vistas calculadas: Resumen, Proyectos y Tareas, Cronograma, Gantt filtrado |
| `17_ProjectManager.gs` | 127 | Soporte del editor de proyectos y tareas |
| `18_Access.gs` | 190 | Quién puede ver y hacer qué; bloqueo de edición por día |
| `19_Historico.gs` | 294 | Histórico privado, rollover mensual y vista de logros |
| `20_Relevantes.gs` | 155 | Lo relevante de la semana y el comentario del jefe operativo |
| `21_Recurrentes.gs` | 417 | Tareas que se repiten |

Parciales HTML: `_styles` y `_brand_bar` (correos), `_sidebar_styles` y
`_sidebar_utils` (paneles; el segundo trae `esc()` para escapar datos).

## Estado de un proyecto, por precedencia

Se evalúa en este orden y gana el primero que se cumpla:

1. avance ≥ 100 % → **Completado**
2. todas las tareas están bloqueadas con justificación → **Bloqueado**
3. la fecha de fin ya pasó y no está completo → **Vencido**
4. va 15 puntos o más por debajo de lo esperado, o faltan 7 días y está bajo el
   80 % → **En riesgo**
5. si no → **En curso**

## Tareas bloqueadas

```
avance = tareas_completadas / tareas_efectivas
tareas_efectivas = total − tareas_bloqueadas_con_comentario
```

Una tarea marcada como bloqueada **con comentario** no penaliza la métrica. Sin
comentario, el bloqueo no aplica y cuenta normal.

Protege a quien depende de un tercero sin abrir la puerta a que "bloqueado" se
vuelva la excusa por defecto: el comentario deja rastro y alguien lo lee.

## Por qué las evaluaciones van en otro archivo

Google Sheets no tiene permisos por pestaña. Ocultar una hoja no es un control
de acceso: `Ver → Hojas ocultas` la devuelve. La única frontera real es el
archivo, así que las calificaciones viven en un Sheet aparte cuyo identificador
se guarda en `00_Config!EVAL_SHEET_ID`.

## Quién es quién en los correos

- `recibe_reporte=TRUE`: recordatorio del jueves y fila en la evaluación mensual.
- `recibe_reporte_jefe=TRUE`: correo ejecutivo del viernes.
- **Jefe del canal**: entre los anteriores, `P001` o quien tenga «canal» en el
  rol. Recibe `email_exec_jefe` (todos los proyectos, detalle por persona) y la
  evaluación mensual para calificar. El resto recibe `email_exec_lider`.

Es una convención heredada del despliegue original; si su jerarquía es otra,
el lugar para cambiarla es `sendExecutiveReports()` (`08_Reports.gs`) y
`sendMonthlyEvalEmailToBoss()` (`09_Evaluations.gs`).

## Permisos

- `ADMIN_EMAIL` + `ADMIN_EMAILS`: menú Admin y edición cualquier día.
- `SUPERVISOR_EMAILS`: edición cualquier día, sin menú Admin.
- El resto: solo edita el día `EDIT_LOCK_DAY` (jueves por defecto).

Cada entrada del submenú Admin llama `assertAdmin()` en el servidor, además de
`addPerson` e `inactivatePerson`: el menú oculto no basta, porque cualquier
función global se puede invocar con `google.script.run` desde un panel
abierto. El verificador lo exige (chequeo «Menú Admin comprueba admin en el
servidor»).

No es una frontera de seguridad: quien puede editar el Sheet puede abrir
`Extensiones → Apps Script` y cambiar el código, o editar `00_Config`. Evita
usos accidentales y desde la consola de un panel. Las funciones internas que
corren desde los disparadores (envíos del jueves, viernes, día 1 y día 4) no
lo comprueban: si `ADMIN_EMAIL` cambiara después de instalar los disparadores,
dejarían de correr.

Si Apps Script no revela el correo de quien ejecuta (cuentas de otro dominio),
solo se trata como contexto de confianza cuando el script corre como un admin:
disparadores instalados por él, `clasp run` o el editor.

## Correos

Estilos **en línea y tablas HTML**, no `div` con clases. Gmail ignora las
variables CSS y `display:flex`; lo que se ve bien en el navegador se
desarma en la aplicación de correo.

El logo, si se configura, va embebido por `cid:logo` desde Drive, no como URL:
las imágenes remotas llegan bloqueadas por defecto en la mayoría de los
clientes. Solo se adjunta cuando la plantilla lo referencia.

Las plantillas usan `<?= ?>`, que escapa el contenido; los paneles construyen
HTML en el navegador y pasan todo dato por `esc()` (el verificador lo exige).

## Idempotencia

Cada envío deja una fila en `08_Email_Log` con `(tipo, periodo, destinatario,
modo)`. Antes de enviar se consulta. Si un disparador falla a medias y se
reintenta, quien ya recibió no recibe dos veces. El periodo se compara como
texto: Sheets convierte `2026-06` en fecha al guardarlo, y se normaliza al
leerlo. La foto de `06_Snapshots` se deduplica por semana (`snapshot_week`).

Lo que se envía en `SANDBOX` no consume el envío real: las evaluaciones no
pasan a `ENVIADO` ni los relevantes a `enviado=TRUE` mientras el modo sea
`SANDBOX` (el correo fue al admin, no a la persona). Al pasar a `PROD`, el
siguiente envío los entrega.

## Concurrencia

Las operaciones que escriben toman `LockService.tryLock(30000)` con
`withLock()`. Dos ejecuciones simultáneas sobre el mismo Sheet producen
escrituras intercaladas y filas a medias; el bloqueo lo evita. `withLock()` es
reentrante: si una operación con lock llama a otra que también lo pide, la
interna no lo suelta antes de tiempo.

## Fechas

La zona horaria sale de `timeZone` en `appsscript.json` (`tz()` en
`01_Utils.gs`); el verificador rechaza zonas escritas a mano. El Cronograma
dibuja la ventana `GANTT_DESDE`–`GANTT_HASTA` o, sin ellas, el semestre en
curso, y sombrea los `FESTIVOS` de `00_Config`.
