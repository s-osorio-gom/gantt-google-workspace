# Instalación

De cero a un sistema funcionando. Calcule una tarde para la instalación y una
semana en `SANDBOX` antes de que le escriba a alguien.

## 0 · Requisitos

- Google Workspace (Standard o superior). Con una cuenta `@gmail.com` personal
  funciona casi todo, pero el límite de correos diarios es mucho menor.
- Node.js, para `clasp` y para el verificador.
- Python 3.9 o superior, para el verificador.
- Permiso para habilitar la API de Apps Script en la cuenta.

> Si la organización restringe los permisos de OAuth, hable con TI **antes** de
> empezar: los alcances que este sistema necesita están en `appsscript.json`, y
> algunos —`script.send_mail`, `calendar`— suelen estar bloqueados por defecto
> en cuentas corporativas. Es el punto donde más instalaciones se atascan.

Alcances de `appsscript.json` y para qué se usan:

| Alcance | Lo usa |
|---|---|
| `spreadsheets` | El Sheet del equipo y los dos Sheets privados (`openById`) |
| `script.send_mail` | Todos los correos (`MailApp`) |
| `calendar` | `Enviar tareas a los calendarios` (`CalendarApp`) |
| `drive.readonly` | Leer el logo de `LOGO_FILE_ID` (`DriveApp`) |
| `script.scriptapp` | Instalar los disparadores |
| `script.container.ui` | Menú, paneles y diálogos |
| `userinfo.email` | Saber quién usa el Sheet (permisos y bloqueo por día) |

## 1 · Crear los archivos

1. Un **Sheet del equipo**. Todos lo ven y lo editan.
2. Un **Sheet privado de evaluaciones**, compartido solo con el administrador y
   el jefe que califica. La pestaña `Evaluaciones` se crea sola.
3. Un **Sheet privado de jefes** (histórico de proyectos y relevantes),
   compartido solo con el administrador y los jefes. Sus pestañas `Historico`
   y `Relevantes` se crean con `Completar configuración`.

La confidencialidad es **por archivo**, no por pestaña: ocultar una pestaña no
es un permiso, cualquiera la vuelve a mostrar desde el menú.

El identificador de un Sheet es la parte de su URL entre `/d/` y `/edit`.

## 2 · Subir el código con clasp

**No pegue los archivos en el editor web de Apps Script.** El navegador puede
interpretar el portapapeles con otra codificación y romper el UTF-8: los
acentos quedan como `√≥` y los emojis como basura. No es obvio hasta que sale
un correo con los nombres mal escritos.

```bash
npm install -g @google/clasp
clasp login                 # con la cuenta de la organización, no la personal
```

Habilite la API en <https://script.google.com/home/usersettings>.

Desde el Sheet del equipo: `Extensiones → Apps Script`. En `Configuración del
proyecto` está el **ID de la secuencia de comandos** (scriptId). Déjelo en la
configuración local:

```bash
cp .clasp.json.ejemplo apps-script/.clasp.json
# edite apps-script/.clasp.json y pegue el scriptId

python3 herramientas/verificar_apps_script.py apps-script   # antes de subir
cd apps-script && clasp push --force
```

`apps-script/.clasp.json` está en `.gitignore`: apunta a un proyecto concreto y
no debe viajar en el repositorio. Las credenciales de `clasp login` quedan en
`~/.clasprc.json`, fuera del repositorio.

Antes de subir, ajuste `timeZone` en `apps-script/appsscript.json` a la zona
del equipo (formato IANA, p. ej. `America/Mexico_City`): de ahí salen las
fechas de todo el sistema y la hora de los disparadores.

## 3 · Crear las pestañas

Recargue el Sheet. Aparece el menú **🍀 EQUIPO** con una sola opción:
`🧱 Crear pestañas base`. Crea las que falten con sus encabezados y siembra
`00_Config` con todas las claves que el código lee, con su valor por defecto y
su descripción (salvo `RECURRING_PROJECT_ID`, que escribe el sistema). No toca pestañas que ya
existan. (También se puede correr `crearPestanasBase` desde el editor de Apps
Script.)

| Pestaña | Para qué |
|---|---|
| `00_Inicio` | Panel libre; el correo de bienvenida enlaza aquí |
| `00_Config` | Parámetros centrales |
| `01_Personas` | **Fuente de verdad de las personas.** Nada de correos en el código |
| `02_Proyectos` | Proyectos, con un responsable por proyecto |
| `03_Tareas` | Tareas binarias: completada sí o no, con horas PERT opcionales |
| `04_Timeline` | Vista calculada para la Línea de tiempo nativa de Sheets |
| `06_Snapshots` | Foto semanal, solo se agrega |
| `08_Email_Log` | Trazabilidad de envíos y control anti-duplicado |
| `10_Mensajes_Motivacionales` | Una frase por mes (`mes_numero` 1–12) |
| `99_Validaciones` | Chequeo de salud. Bloquea envíos si hay errores críticos |

Las vistas `Resumen`, `Proyectos y Tareas`, `Cronograma`, `EQUIPO — Logros` y
`Gantt filtrado` las crea el sistema al reconstruir vistas. Las pestañas de
sistema se ocultan; las ocultas `_Recurrentes` y `_Relevantes_IN` también se
crean solas.

## 4 · Llenar `00_Config`

Obligatorias para arrancar:

| Clave | Ejemplo | Qué hace |
|---|---|---|
| `SYSTEM_MODE` | `SANDBOX` | En SANDBOX **todos** los correos van a `SANDBOX_REDIRECT_TO` o, si está vacía, a `ADMIN_EMAIL` |
| `ADMIN_EMAIL` | `admin@example.org` | Administrador. Recibe errores y muestras. **Debe ser la cuenta que instala los disparadores** |
| `EMAIL_DOMAIN` | `example.org` | Dominio admitido al dar de alta una persona |
| `SUPPORT_EMAIL` | `admin@example.org` | Pie de los correos |
| `EVAL_SHEET_ID` | `1AbC…` | El Sheet **privado** de evaluaciones |
| `CONFIDENCIAL_SHEET_ID` | `1XyZ…` | El Sheet **privado** de jefes |

Opcionales:

| Clave | Por defecto | Qué hace |
|---|---|---|
| `ADMIN_EMAILS` | — | Más administradores, separados por coma |
| `JEFE_CANAL_ID` | P001 o rol con «canal» | `person_id` del jefe del canal: recibe el ejecutivo con detalle y califica la evaluación |
| `SUPERVISOR_EMAILS` | — | Editan cualquier día, sin menú Admin |
| `SANDBOX_REDIRECT_TO` | `ADMIN_EMAIL` | A quién van los correos en SANDBOX |
| `SENDER_NAME` | `Sistema de Proyectos` | Remitente visible |
| `EVAL_SHEET_URL` | — | Enlace al Sheet de evaluaciones en el correo al jefe |
| `SHEET_URL` | URL del Sheet | Base de los enlaces de los correos |
| `MANUAL_USER_URL` | — | Manual que abre `Abrir manual de usuario` (http/https) |
| `LOGO_FILE_ID` | — | Logo en Drive; ver «Logo» abajo |
| `EDIT_LOCK_ENABLED` | `TRUE` | El equipo solo edita el día `EDIT_LOCK_DAY` |
| `EDIT_LOCK_DAY` | `4` | 0 = domingo … 4 = jueves … 6 = sábado. El recordatorio sale ese día; si lo cambia, reinstale los disparadores |
| `PROJECT_DATES_LOCKED` | `TRUE` | Solo admins y supervisores cambian fechas de proyecto |
| `TASK_RANGE_ENFORCED` | `TRUE` | Las tareas deben caer dentro de las fechas de su proyecto |
| `BLOCKED_REQUIRES_COMMENT` | `TRUE` | Una tarea bloqueada solo deja de contar si tiene comentario |
| `RISK_GAP_THRESHOLD_PTS` | `-15` | Puntos por debajo de lo esperado para marcar «En riesgo» |
| `DUE_SOON_DAYS` | `7` | Días antes del fin en que < 80 % de avance es «En riesgo» |
| `GANTT_DESDE`, `GANTT_HASTA` | semestre en curso | Ventana del Cronograma (`yyyy-mm-dd`, máximo 2 años) |
| `FESTIVOS` | — | Fechas `yyyy-mm-dd` separadas por coma que el Cronograma sombrea |
| `MONTHLY_EVAL_DAY` | `1` | Día del mes de la evaluación y el archivo al histórico (si el mes es más corto, el último día; igual para los dos siguientes) |
| `PERSONAL_EVAL_SEND_DAY` | `4` | Día del mes en que cada persona recibe su evaluación |
| `RECURRING_TASKS_DAY` | `1` | Día del mes en que se regeneran las recurrentes |
| `MOTIVATIONAL_ENABLED` | `TRUE` | Mensaje del último día del mes |
| `SEND_WELCOME_EMAIL` | `TRUE` | Bienvenida al agregar una persona |

`RECURRING_PROJECT_ID` la escribe el sistema.

**Logo.** Para mostrarlo en los correos, suba la imagen a Drive, ponga su ID en
`LOGO_FILE_ID` y agregue `<img src="cid:logo" alt="" height="28">` donde lo
quiera en `apps-script/_brand_bar.html` (que también lleva el nombre de la
organización). Si la plantilla no usa `cid:logo`, la imagen no se adjunta.

Recargue el Sheet. Si su correo está en `ADMIN_EMAIL`, aparece el submenú
**⚙️ Admin**.

Agréguese como persona: `Admin → 👥 Agregar persona`, con el mismo correo de
`ADMIN_EMAIL`. El proyecto contenedor de recurrentes necesita un responsable;
si todavía no hay nadie en `01_Personas`, el paso siguiente no lo crea y lo
dice en el resumen («Proyecto de recurrentes: error: Cargue al menos una
persona…»).

Corra `⚙️ Completar configuración (1 vez)`: agrega columnas PERT, crea las
pestañas del Sheet de jefes y el proyecto contenedor de recurrentes (a nombre
del admin), y reconstruye las vistas. Se puede repetir sin riesgo.

Recomendado: proteja la hoja `00_Config` (`Datos → Proteger hojas y rangos`)
para que solo los administradores la editen. El menú Admin se oculta y el
servidor comprueba `ADMIN_EMAILS`, pero quien edita `00_Config` puede darse
permisos. No proteja `01_Personas`, `02_Proyectos` ni `03_Tareas`: los paneles
escriben ahí con la cuenta de quien los usa.

## 5 · Cargar el equipo

Desde el menú, `Admin → Agregar persona`, para el resto del equipo. O, para sembrar un equipo completo de
una vez, edite `_reorgPersonas()` y `_reorgProyectos()` en `14_Reorg.gs` (traen
un equipo ficticio de molde) y corra `Admin → Reorganizar equipo y proyectos`.
Ese comando **reescribe** `01_Personas`, `02_Proyectos` y `03_Tareas`; antes
deja una copia oculta de cada una con fecha.

La jerarquía se arma con banderas en `01_Personas`:

- `recibe_reporte=TRUE`: recibe recordatorios y entra en la evaluación mensual.
- `recibe_reporte_jefe=TRUE`: recibe el correo ejecutivo del viernes.
- Entre quienes reciben el ejecutivo, el **jefe del canal** —el que recibe la
  versión con detalle por persona y califica— es el `person_id` de
  `JEFE_CANAL_ID`. Si la deja vacía: `P001` o quien tenga un rol que contenga
  «canal». Los demás reciben la versión del jefe operativo. Si nadie cumple,
  `99_Validaciones` lo avisa y el día 1 el admin recibe un correo de error en
  lugar de la evaluación.

## 6 · Instalar los disparadores

Desde el menú, `Admin → ⏰ Instalar / reinstalar disparadores`, **con la cuenta
de `ADMIN_EMAIL`**: los disparadores corren y envían correo como quien los
instala. Quedan ocho (siete si `EVAL_SHEET_ID` no es accesible); la lista está
en el [README](../README.md#qué-hace-en-concreto).

Verifique en `Activadores` del editor de Apps Script que estén todos.

El recordatorio se programa el día `EDIT_LOCK_DAY` (jueves por defecto; el
manejador se sigue llamando `thursdayReminderJob`). Si cambia ese día después,
vuelva a `Instalar / reinstalar disparadores`.

## 7 · Una semana en SANDBOX

Deje `SYSTEM_MODE=SANDBOX` un ciclo completo. Todos los correos le llegarán a
usted, y `Admin → Enviar prueba (a mí)` manda uno en el momento. Revise:

- que los nombres salgan **con los acentos correctos** (si no, el código se
  subió pegándolo, no con `clasp`);
- que los números del correo coincidan con el Sheet;
- que el correo se vea bien **en el teléfono**, que es donde lo van a leer.

Cuando los tres estén bien, `Admin → Modo PROD`. No deja pasar si
`99_Validaciones` tiene errores críticos.

## 8 · Mantenimiento

- `99_Validaciones` corre antes del envío del viernes (y al pasar a PROD) y lo
  bloquea si hay errores críticos. Mírela cuando algo no salga.
- `08_Email_Log` dice exactamente qué se envió y a quién.
- Una persona que sale del equipo se marca `activo=FALSE` (`Admin → Inactivar
  persona`). **No se borra:** el histórico la necesita.
- Al cambiar de semestre, el Cronograma pasa solo a la ventana nueva (salvo que
  `GANTT_DESDE`/`GANTT_HASTA` estén fijas). Actualice `FESTIVOS` cada año.

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| Acentos rotos en los correos | El código se pegó en el editor web. Súbalo con `clasp push`. |
| No aparece el menú Admin | Su correo no está en `ADMIN_EMAIL`/`ADMIN_EMAILS`, o Google no lo revela (cuenta de otro dominio). |
| No llega ningún correo | `SYSTEM_MODE` sigue en `SANDBOX`, o `99_Validaciones` está bloqueando. |
| Llegan dos correos iguales | Hay disparadores duplicados, quizá instalados por dos cuentas. Bórrelos y reinstale desde el menú con `ADMIN_EMAIL`. |
| «No se encontró jefe del canal» | Nadie con `recibe_reporte_jefe=TRUE` es `JEFE_CANAL_ID` (o, vacía, `P001` / rol con «canal»). |
| Falla al leer un Sheet privado | `EVAL_SHEET_ID` o `CONFIDENCIAL_SHEET_ID` vacío, o el archivo no está compartido con quien ejecuta. |
| «Solo puedes actualizar los jueves» | Bloqueo por día (`EDIT_LOCK_*`). Admins y supervisores están exentos. |
| Error de permisos al instalar | La organización bloquea alcances de OAuth. Es cosa de TI, no del código. |
