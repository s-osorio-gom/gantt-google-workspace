# Gantt para un equipo, sobre Google Workspace

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
| Jueves 8:30 | Recordatorio a cada persona con sus tareas pendientes y atrasadas |
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
recibió no recibe dos veces. La foto semanal tampoco se duplica.

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

- Una cuenta de Google Workspace (con `@gmail.com` funciona casi todo, con un
  cupo de correos diarios mucho menor).
- Node.js y [`clasp`](https://github.com/google/clasp) para subir el código.
- Python 3.9+ y Node.js para el verificador (sin dependencias externas).
- Que la organización permita los alcances OAuth de `appsscript.json`
  (`script.send_mail` y `calendar` suelen requerir aprobación de TI).

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
3. `Admin → ⚙️ Completar configuración (1 vez)`.
4. Cargar el equipo (`Admin → Agregar persona`) y los proyectos.
5. `Admin → ⏰ Instalar / reinstalar disparadores`.

Déjelo en `SANDBOX` una semana antes de pasar a `PROD`.

> **No pegue el código en el editor web de Apps Script.** El navegador
> puede interpretar el portapapeles con otra codificación y romper el UTF-8: los
> acentos quedan como `√≥`. Por eso `clasp`.

## Verificar antes de subir

```bash
python3 herramientas/verificar_apps_script.py apps-script
```

```
  [OK  ] Cada .gs parsea como JavaScript — 21 / 21
  [OK  ] Cada <script> de los paneles parsea — 12 / 12
  [OK  ] Cada plantilla referenciada existe — 20 / 20 referencias
  [OK  ] Sin plantillas huérfanas — 24 en uso
  [OK  ] Ninguna función definida dos veces — 288 funciones
  [OK  ] Menús, disparadores y paneles llaman funciones que existen — todas resuelven
  [OK  ] innerHTML de los paneles sin datos sin escapar — todo pasa por esc()
  [OK  ] Fechas en la zona de appsscript.json, no en una escrita a mano — usan tz()
  [OK  ] appsscript.json válido — 7 permisos · V8 · America/Bogota
  [OK  ] Sin correos fuera de los de ejemplo — dominios permitidos: …
  [OK  ] Sin identificadores de Sheets o Drive en el código — limpio
  [OK  ] Pruebas de lógica (pruebas_logica.js) — 25 / 25 pruebas pasan
```

Sale con código 1 si algún chequeo crítico falla; el workflow
`.github/workflows/verificar.yml` corre lo mismo en cada push y pull request.

Apps Script no avisa de casi nada hasta que el disparador corre a las 8:30 y
el correo no sale. Esto adelanta lo comprobable:

- **Funciones duplicadas.** Todos los archivos de un proyecto de Apps Script
  comparten un único ámbito global. Dos funciones con el mismo nombre en
  archivos distintos no producen ningún error: gana la del archivo que se
  cargue de último, en silencio.
- **Referencias rotas.** Un elemento de menú, un disparador o un
  `google.script.run.x()` que apunta a una función inexistente solo falla
  cuando alguien hace clic.
- **`herramientas/pruebas_logica.js`** carga todos los `.gs` en un solo
  contexto de Node con dobles mínimos de `Session`, `Utilities` y
  `LockService`, y prueba la lógica que no depende de la API: estado de un
  proyecto, PERT, recurrencias, permisos, ventana del Gantt y anti-duplicados.
  Se puede correr sola: `node herramientas/pruebas_logica.js apps-script`.

Lo que **no** cubre: nada de esto toca Google. El Sheet, Gmail, Calendar y los
disparadores solo se prueban de verdad con la semana en `SANDBOX`.

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
- La identificación del «jefe del canal» (quien recibe el ejecutivo con ranking
  y califica) es por convención: `recibe_reporte_jefe=TRUE` y `person_id` `P001`
  o un rol que contenga «canal». Ver [`docs/arquitectura.md`](docs/arquitectura.md).
- Los correos llevan textos fijos en español (jueves, viernes, «jefe
  operativo»); cambiar el día de edición no reescribe esos textos.
- Las funciones `_diag_*` y `_demo*` son de diagnóstico para `clasp run` o el
  editor: `_demoFechas*` **sobrescribe fechas** de proyectos y tareas.

## Estructura

```
apps-script/        21 módulos .gs · 9 correos · 11 paneles · 4 parciales · appsscript.json
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
and function references, duplicate globals, unescaped `innerHTML`) and Node
tests for the pure logic. Docs in Spanish.

## Licencia

MIT — ver [LICENSE](LICENSE).
