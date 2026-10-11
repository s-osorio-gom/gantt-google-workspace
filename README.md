# Gantt para un equipo, sobre Google Workspace

[![verificar](https://github.com/s-osorio-gom/gantt-google-workspace/actions/workflows/verificar.yml/badge.svg)](https://github.com/s-osorio-gom/gantt-google-workspace/actions/workflows/verificar.yml)

Sistema de gestión de proyectos para un equipo pequeño o mediano, hecho con
**Google Sheets + Apps Script + Gmail**: proyectos y tareas en un Sheet, un
Gantt diario dibujado en una pestaña, recordatorios y reportes por correo,
evaluación mensual confidencial y altas, bajas y ediciones desde paneles
laterales, **sin tocar código**.

Para un equipo que ya paga Workspace no cuesta una licencia más. Es la
extracción de un sistema que estuvo en operación; los datos y las personas del
despliegue original no están aquí.

## Qué hace, en concreto

Disparadores que deja `Instalar / reinstalar disparadores` (zona horaria de
`appsscript.json`):

| Cuándo | Qué pasa |
|---|---|
| Día de edición (`EDIT_LOCK_DAY`, jueves por defecto) 8:30 | Recordatorio a cada persona con sus tareas pendientes y atrasadas |
| Viernes 8:30 | Foto semanal (`06_Snapshots`) + correo ejecutivo a los jefes + limpia comentarios semanales |
| Sábado 8:00 | A cada persona, sus «relevantes» de la semana que el jefe operativo ya comentó |
| Día 1 del mes, 8:30 | Archiva al histórico los proyectos completados el mes anterior, prepara la evaluación en el Sheet **privado** y le escribe al jefe del canal; genera las tareas recurrentes |
| Día 4 del mes, 8:30 | Envía a cada persona su evaluación, solo si el jefe ya la calificó y comentó |
| Último día del mes, 16:00 | Mensaje de cierre con la frase del mes (`10_Mensajes_Motivacionales`) |
| Cada minuto | Si alguien marcó tareas, refresca `Resumen` y `Logros` y pasa los relevantes al Sheet privado |
| Al editar el Sheet | La casilla ✔ de `Proyectos y Tareas` completa la tarea y actualiza avance y Gantt |

En el Sheet, un menú **🍀 EQUIPO**:

- **Para todo el equipo:** editar proyectos y tareas (ventana grande con PERT
  por tarea), crear relevante, tareas recurrentes (semanal, quincenal, mensual o
  fecha única), Gantt filtrado por persona o proyecto, comentario semanal.
- **Admin** (solo a quien esté en `ADMIN_EMAIL` / `ADMIN_EMAILS`): crear
  proyecto, agregar o inactivar persona, reconstruir vistas, validar datos,
  enviar tareas a Google Calendar, envíos manuales y de prueba, modo
  SANDBOX/PROD, reorganizar el equipo, instalación.

Vistas que genera: **Resumen** (KPIs y tabla por persona), **Proyectos y
Tareas** (proyecto y sus tareas, con casilla para completar), **Cronograma**
(Gantt diario con fines de semana y festivos), **Gantt filtrado** y **EQUIPO —
Logros** (proyectos completados).

## Arquitectura en una página

Todos los `.gs` comparten un único ámbito global (así funciona Apps Script);
el orden numérico es solo para leerlos por capas:

| Capa | Módulos | Qué hace |
|---|---|---|
| Base | `01_Utils`, `02_Config`, `18_Access` | Leer/escribir el Sheet por nombre de columna, zona horaria, `withLock`, log; `00_Config` con caché; quién es admin y el bloqueo por día |
| Datos | `03_Personas`, `04_Proyectos`, `05_Tareas`, `21_Recurrentes` | Altas y ediciones con sus reglas; estado y avance de un proyecto; PERT; recurrencias |
| Procesos | `06_Snapshots`, `07_Validations`, `08_Reports`, `09_Evaluations`, `10_Motivational`, `19_Historico`, `20_Relevantes`, `15_Calendar` | Foto semanal, chequeo de salud, correos con anti-duplicado, evaluación, archivo mensual, calendario |
| Entrada | `11_Triggers`, `12_UI`, `13_MyComment`, `14_Reorg`, `16_Vistas`, `17_ProjectManager` | Disparadores, menú y paneles, vistas calculadas (Resumen, Cronograma…) |
| Presentación | `email_*.html`, `sidebar_*.html`, `_*.html` | 9 correos, 7 paneles y 4 parciales (estilos y `esc()`) |

**Un día cualquiera**, con los disparadores instalados (hora de
`appsscript.json`):

```
cada minuto  autoRefreshDirty ─ si alguien editó: Resumen, Logros y relevantes → Sheet privado
08:30        dailyDispatcherMorning
               día MONTHLY_EVAL_DAY (1)       archivo al histórico + evaluación al jefe del canal
               día RECURRING_TASKS_DAY (1)    regenera las recurrentes
               día PERSONAL_EVAL_SEND_DAY (4) envía las evaluaciones ya calificadas
08:30        día EDIT_LOCK_DAY (jueves)  thursdayReminderJob → recordatorio a cada persona
08:30        viernes   fridayExecJob → 99_Validaciones (bloquea si hay críticos) + foto + ejecutivos
08:00        sábado    satRelevantesJob → relevantes que el jefe operativo ya comentó
16:00        dailyDispatcherAfternoon → si es el último día del mes, mensaje de cierre
al editar    onSheetEdit (casilla ✔ completa la tarea) · onEvalSheetEdit (marca LISTO)
```

Todo envío pasa por `sendEmailGTM()`: respeta `SANDBOX`, registra en
`08_Email_Log` y no repite `(tipo, periodo, destinatario, modo)`. Detalle de
reglas (estado de un proyecto, permisos, idempotencia, fechas) en
[`docs/arquitectura.md`](docs/arquitectura.md).

## Las decisiones que lo sostienen

**IDs estables, nunca nombres.** `P001`, `PR001`, `T0001`. Si alguien cambia de
apellido o de rol, su identificador no cambia y nada se rompe.

**Se lee por nombre de columna, nunca por letra.** Un helper devuelve
`{encabezado: índice}`. Cuando alguien inserta una columna en el Sheet —y
alguien siempre lo hace— el sistema sigue funcionando.

**Una sola fuente de verdad por entidad.** `01_Personas` manda sobre personas,
`02_Proyectos` sobre proyectos y `03_Tareas` sobre tareas. `Resumen`,
`Proyectos y Tareas` y `Cronograma` son vistas calculadas y se reconstruyen.

**Idempotencia.** Cada envío queda en `08_Email_Log` con
`(tipo, periodo, destinatario, modo)`; si un disparador se reintenta, quien ya
recibió no recibe dos veces (la bienvenida y las muestras de prueba sí se
pueden reenviar a propósito). La foto semanal tampoco se duplica.

**Modo SANDBOX.** Mientras `SYSTEM_MODE=SANDBOX`, todos los correos (y las
invitaciones de calendario) van al administrador. Se prueba el sistema completo
sin escribirle a nadie.

**Personas y proyectos no se borran.** Las personas que salen quedan
`activo=FALSE` y los proyectos se archivan. Las tareas sí se pueden eliminar
desde el panel de edición.

**Confidencialidad por archivo, no por pestaña.** Evaluaciones, histórico y
relevantes viven en Sheets **separados**, compartidos solo con quien
corresponde. Ocultar una pestaña no es un permiso: cualquiera la vuelve a
mostrar.

**Cero datos en el código.** Correos, dominio, administradores, IDs de Sheets y
festivos salen de `00_Config` y de `01_Personas`. El equipo de ejemplo de
`14_Reorg.gs` es ficticio y sus correos son `@example.com`.

## Requisitos

- **Cuenta:** Google Workspace (recomendado). Con `@gmail.com` funciona casi
  todo, con un cupo de correos diarios y de ejecución de disparadores mucho
  menor.
- **Quién instala:** la cuenta que será `ADMIN_EMAIL`. Los disparadores corren
  y envían correo como quien los instala.
- **Permisos OAuth** (los 7 de `appsscript.json`, cada uno con uso en el
  código; tabla en [`docs/instalacion.md`](docs/instalacion.md#0--requisitos)).
  `script.send_mail` y `calendar` suelen requerir aprobación de TI en cuentas
  corporativas: pídala antes de empezar.
- **Tres Sheets:** el del equipo y dos privados (evaluaciones; histórico y
  relevantes de jefes).
- **Local:** Node.js y [`clasp`](https://github.com/google/clasp) para subir el
  código; Python 3.9+ y Node.js para el verificador (sin dependencias).

## Instalar

Guía completa en **[`docs/instalacion.md`](docs/instalacion.md)**. En resumen:

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.ejemplo apps-script/.clasp.json   # y poner el scriptId real
python3 herramientas/verificar_apps_script.py apps-script
cd apps-script && clasp push --force
```

Después, desde el Sheet:

1. `🍀 EQUIPO → 🧱 Crear pestañas base`.
2. Llenar `00_Config` (como mínimo `ADMIN_EMAIL` y `EMAIL_DOMAIN`) y recargar.
3. `Admin → 👥 Agregar persona`: al menos usted, con el correo de `ADMIN_EMAIL`.
4. `Admin → ⚙️ Completar configuración (1 vez)`.
5. Cargar el resto del equipo y los proyectos.
6. `Admin → ⏰ Instalar / reinstalar disparadores`.

Déjelo en `SANDBOX` una semana antes de pasar a `PROD`.

> **No pegue el código en el editor web de Apps Script.** El navegador
> puede interpretar el portapapeles con otra codificación y romper el UTF-8: los
> acentos quedan como `√≥`. Por eso `clasp`.

## Qué se verifica sin Google, y qué no

```bash
python3 herramientas/verificar_apps_script.py apps-script
```

```
  [OK  ] Cada .gs parsea como JavaScript — 21 / 21
  [OK  ] Cada <script> de los paneles parsea — 8 / 8
  [OK  ] Cada plantilla referenciada existe — 16 / 16 referencias
  [OK  ] Sin plantillas huérfanas — 20 en uso
  [OK  ] Ninguna función definida dos veces — 287 funciones
  [OK  ] Menús, disparadores y paneles llaman funciones que existen — todas resuelven
  [OK  ] Menú Admin comprueba admin en el servidor — 20 / 20 con assertAdmin()
  [OK  ] innerHTML de los paneles sin datos sin escapar — todo pasa por esc()
  [OK  ] Fechas en la zona de appsscript.json, no en una escrita a mano — usan tz()
  [OK  ] appsscript.json válido — 7 permisos · V8 · America/Bogota
  [OK  ] Sin correos fuera de los de ejemplo — dominios permitidos: …
  [OK  ] Sin identificadores de Sheets o Drive en el código — limpio
  [OK  ] Pruebas de lógica (pruebas_logica.js) — 55 / 55 pruebas pasan
```

Sale con código 1 si algún chequeo crítico falla; el workflow
`.github/workflows/verificar.yml` corre lo mismo en cada push y pull request.
El resultado no depende de la zona horaria de la máquina (las pruebas usan la
de `appsscript.json`, como Apps Script).

**`herramientas/pruebas_logica.js`** (`node herramientas/pruebas_logica.js
apps-script`) carga todos los `.gs` en un solo contexto de Node con dobles de
`Session`, `Utilities`, `LockService`, `ScriptApp`, `MailApp` y `HtmlService`,
y datos en memoria en lugar del Sheet. Cubre:

- estado de un proyecto, PERT, semana ISO y cambio de año;
- recurrencias (fin de mes, 29 de febrero, quincenal entre años, ventana de 2
  años) y días del mes configurados (29–31 en meses cortos);
- ventana del Gantt y `FESTIVOS` (texto, lista, fecha única, fechas
  imposibles);
- permisos (admin, supervisor, correo vacío, menú Admin);
- anti-duplicado y que lo enviado en `SANDBOX` no consuma el envío en `PROD`;
- los disparadores que instala `installAllTriggers` y su día;
- que `crearPestanasBase` siembre todas las claves que el código lee y que la
  guía las documente;
- el renderizado del recordatorio y la bienvenida (con un intérprete mínimo de
  plantillas, no el `HtmlService` real).

**Lo que no se comprueba aquí:** nada que toque Google. Ni el Sheet real, ni
Gmail, Calendar o Drive, ni que los disparadores corran a su hora, ni los
permisos OAuth de su organización, ni las cuotas. Eso solo se prueba en el
Sheet, con la semana en `SANDBOX` que pide la guía.

Por qué vale la pena igual: Apps Script no avisa de casi nada hasta que el
disparador corre y el correo no sale. Dos funciones con el mismo nombre en
archivos distintos no dan error (gana la que se cargue de último), y un menú o
`google.script.run` que apunta a una función inexistente solo falla al hacer
clic.

## Configuración

Todo vive en la pestaña `00_Config` (`clave | valor | descripcion`); `Crear
pestañas base` siembra las claves con su descripción. Las principales:

| Clave | Para qué |
|---|---|
| `SYSTEM_MODE` | `SANDBOX` (todo a `SANDBOX_REDIRECT_TO` o, si está vacío, a `ADMIN_EMAIL`) o `PROD` |
| `ADMIN_EMAIL`, `ADMIN_EMAILS` | Administradores. `ADMIN_EMAIL` debe ser quien instala los disparadores |
| `SUPERVISOR_EMAILS` | Editan cualquier día, sin menú Admin |
| `EMAIL_DOMAIN` | Dominio admitido al dar de alta una persona |
| `EDIT_LOCK_ENABLED`, `EDIT_LOCK_DAY` | El equipo solo edita un día de la semana (por defecto jueves, `4`) |
| `EVAL_SHEET_ID`, `EVAL_SHEET_URL` | Sheet privado de evaluaciones |
| `CONFIDENCIAL_SHEET_ID` | Sheet privado de jefes: histórico y relevantes |
| `GANTT_DESDE`, `GANTT_HASTA` | Ventana del Cronograma; vacías = semestre en curso |
| `FESTIVOS` | Fechas `yyyy-mm-dd` que el Cronograma sombrea |

Lista completa en [`docs/instalacion.md`](docs/instalacion.md#4--llenar-00_config).

## Cuándo NO usar esto

- Si necesita **dependencias entre tareas** y un Gantt interactivo → Asana,
  Monday o MS Project. Aquí el Gantt es una pestaña dibujada, de solo lectura.
- Si necesita **app móvil nativa** → AppSheet o Notion.
- Si son **menos de 3 personas y menos de 5 proyectos** → un Sheet compartido
  basta; esto es desproporcionado.
- Si la organización **no usa Google Workspace** → no aplica.

## Limitaciones conocidas

- **Los permisos del menú no son una frontera.** Ocultar el menú Admin y
  comprobar `ADMIN_EMAILS` en el servidor evita errores, pero quien puede editar
  el Sheet puede editar `00_Config`. Proteja `00_Config` como hoja protegida
  (`Datos → Proteger hojas y rangos`). `01_Personas`, `02_Proyectos` y
  `03_Tareas` no se pueden proteger igual: los paneles escriben ahí con la
  cuenta de quien los usa.
- El disparador de cada minuto consume cuota diaria de ejecución de
  disparadores; en cuentas `@gmail.com` el cupo es menor.
- Hay un solo «jefe del canal» (quien recibe el ejecutivo con detalle y
  califica): `JEFE_CANAL_ID` o, vacía, `P001` / un rol con «canal». Ver
  [`docs/arquitectura.md`](docs/arquitectura.md#quién-es-quién-en-los-correos).
- Los correos están en español y algunos textos son fijos (viernes del
  ejecutivo, «jefe operativo»). El día de edición sí se toma de
  `EDIT_LOCK_DAY`; al cambiarlo, reinstale los disparadores para que el
  recordatorio se mueva.
- `weeklyJob` (correo individual semanal) y `sundayReminderJob` siguen en el
  código pero `installAllTriggers` no los programa.
- Las funciones `_diag_*` y `_demo*` son de diagnóstico para `clasp run` o el
  editor: `_demoFechas*` **sobrescribe fechas** de proyectos y tareas.

## Estructura

```
apps-script/        21 módulos .gs · 9 correos · 7 paneles · 4 parciales · appsscript.json
herramientas/       verificador previo al despliegue + pruebas de lógica en Node
docs/               instalación y arquitectura
```

---

### In English

A team project-management system on Google Sheets + Apps Script + Gmail:
weekly reminders and executive emails, a drawn daily Gantt, confidential
monthly reviews kept in a separate private Sheet, recurring tasks, and no-code
sidebars to edit people, projects and tasks. SANDBOX mode, idempotent sending,
stable IDs, column-name lookups. Ships a pre-deploy verifier (syntax, template
and function references, duplicate globals, unescaped `innerHTML`, server-side
admin checks) and Node tests for the pure logic. Nothing here touches Google:
Sheets, Gmail, Calendar and triggers are only tested in a real SANDBOX week. Docs in Spanish.

## Licencia

MIT — ver [LICENSE](LICENSE).
