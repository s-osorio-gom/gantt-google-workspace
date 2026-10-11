/**
 * Config.gs — acceso a parámetros centrales del sistema (pestaña 00_Config).
 * Cero hardcoding en el resto del código: todo viene de aquí.
 */

let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_MS = 30 * 1000; // 30 segundos

/**
 * Lee toda la pestaña 00_Config y devuelve un objeto { clave: valor }.
 * Cache de 30 segundos para no leer el Sheet en cada llamada.
 */
function getAllConfig() {
  const now = Date.now();
  if (_configCache && (now - _configCacheTime) < CONFIG_CACHE_MS) return _configCache;
  const data = readSheetAsObjects(SHEET_NAMES.CONFIG);
  const cfg = {};
  data.rows.forEach(r => {
    if (r.clave) cfg[String(r.clave).trim()] = r.valor;
  });
  _configCache = cfg;
  _configCacheTime = now;
  return cfg;
}

/**
 * Obtiene un valor de configuración por clave.
 */
function getConfig(key) {
  const cfg = getAllConfig();
  return cfg[key];
}

/**
 * Obtiene un valor de configuración como número.
 */
function getConfigInt(key, defaultValue) {
  const v = getConfig(key);
  if (v === undefined || v === '' || v === null) return defaultValue;
  const n = parseInt(v, 10);
  return isNaN(n) ? defaultValue : n;
}

/**
 * Obtiene un valor de configuración como boolean.
 */
function getConfigBool(key, defaultValue) {
  const v = getConfig(key);
  if (v === undefined || v === '' || v === null) return defaultValue;
  return toBool(v);
}

/**
 * Dominio de correo admitido para las personas del equipo.
 *
 * Estaba fijo en el código. Si la organización cambia de dominio, o el sistema
 * se instala en otra, no debería haber que editar dos archivos fuente: se
 * define en la clave EMAIL_DOMAIN de la pestaña 00_Config.
 */
function getEmailDomain() {
  return String(getConfig('EMAIL_DOMAIN') || 'example.com').trim().toLowerCase();
}

/**
 * Valida que un correo pertenezca al dominio configurado.
 */
function isEmailDelDominio(email) {
  const dom = getEmailDomain().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^[^@\\s]+@' + dom + '$', 'i').test(String(email || '').trim());
}

/**
 * Verifica si el sistema está en modo SANDBOX.
 */
function isSandboxMode() {
  return (getConfig('SYSTEM_MODE') || 'SANDBOX').toUpperCase() === 'SANDBOX';
}

/**
 * Devuelve el email real al cual debe ir un correo dado el modo.
 * En SANDBOX redirige a SANDBOX_REDIRECT_TO.
 */
function resolveRecipient(realEmail) {
  if (isSandboxMode()) {
    return getConfig('SANDBOX_REDIRECT_TO') || getConfig('ADMIN_EMAIL') || realEmail;
  }
  return realEmail;
}

/**
 * Devuelve el prefijo de asunto según modo (ej. "[SANDBOX] " en pruebas).
 */
function subjectPrefix() {
  return isSandboxMode() ? '[SANDBOX] ' : '';
}

/**
 * URL del Sheet con un gid opcional.
 */
function buildSheetUrl(gid) {
  const base = getConfig('SHEET_URL') || getSS().getUrl();
  const cleanBase = base.split('#')[0].split('?')[0];
  if (gid === undefined || gid === null || gid === '') return cleanBase;
  return cleanBase + '#gid=' + gid;
}

/**
 * URL del Sheet a una pestaña por nombre (resuelve gid automáticamente).
 */
function urlToSheet(sheetName) {
  try {
    const sh = getSheet(sheetName);
    return buildSheetUrl(sh.getSheetId());
  } catch (e) {
    return buildSheetUrl();
  }
}

/**
 * URL del Sheet a la vista filtrada de una persona en 03_Tareas.
 */
function urlToMyTasks(personId) {
  const sh = getSheet(SHEET_NAMES.TAREAS);
  const baseUrl = buildSheetUrl(sh.getSheetId());
  // Si guardaste fvid en 01_Personas.vista_filtrada_id, úsalo
  const personas = readSheetAsObjects(SHEET_NAMES.PERSONAS).rows;
  const p = personas.find(x => x.person_id === personId);
  if (p && p.vista_filtrada_id) {
    return baseUrl + '&fvid=' + p.vista_filtrada_id;
  }
  return baseUrl;
}

/**
 * Invalida cache de config (al editar manualmente).
 */
function invalidateConfigCache() {
  _configCache = null;
  _configCacheTime = 0;
}
