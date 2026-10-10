/** @OnlyCurrentDoc */
// La línea de arriba hace que el script solo pueda tocar esta hoja, no el resto de tu Drive.

/**
 * Sincronización de la app del menú (04_app) entre los dos móviles, con esta hoja de Google.
 *
 * Guarda solo el estado de cada semana, una fila por cosa:
 *   c:<día>:<toma>:<n>  plato cambiado      l:<día>:<toma>  toma libre      k:<artículo>  check de la compra
 * Columnas de la pestaña "estado": semana | clave | valor (JSON) | hora (ms). Gana siempre la hora más nueva.
 *
 * Todo llega por POST con cuerpo de texto (así el navegador no hace la consulta previa de CORS) y nada va en la URL:
 *   {"accion": "sincronizar", "clave": "...", "semana": "2026-10-12", "cambios": [{"k": ..., "v": ..., "t": ...}]}
 * Responde {"ok": true, "filas": [{"k", "v", "t"}, ...]} con todo lo de esa semana.
 *
 * Clave opcional: en Configuración del proyecto > Propiedades del script, añade CLAVE con una palabra; la app
 * tendrá que llevar la misma. Sin CLAVE, cualquiera que tenga la URL del script puede escribir en la hoja.
 */
const HOJA = "estado";
const MAX_CAMBIOS = 500;

function doGet() {
  return ContentService.createTextOutput("Sincronización del menú: funcionando.");
}

function doPost(e) {
  let pet;
  try {
    pet = JSON.parse(e.postData.contents);
  } catch (err) {
    return salida({ ok: false, error: "petición no válida" });
  }
  const clave = PropertiesService.getScriptProperties().getProperty("CLAVE");
  if (clave && pet.clave !== clave) return salida({ ok: false, error: "clave incorrecta" });
  if (pet.accion !== "sincronizar") return salida({ ok: false, error: "acción desconocida" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pet.semana || "")) return salida({ ok: false, error: "semana no válida" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const hoja = obtenerHoja();
    const datos = hoja.getDataRange().getValues();   // con la cabecera en la fila 0
    const fila = {};                                  // "semana|clave" -> índice en datos
    for (let i = 1; i < datos.length; i++) fila[datos[i][0] + "|" + datos[i][1]] = i;
    const nuevas = [];
    for (const c of (pet.cambios || []).slice(0, MAX_CAMBIOS)) {
      if (typeof c.k !== "string" || !/^[clk]:/.test(c.k) || c.k.length > 200 || typeof c.t !== "number") continue;
      const v = JSON.stringify(c.v === undefined ? null : c.v);
      const id = pet.semana + "|" + c.k;
      if (id in fila) {
        const i = fila[id];
        if (c.t > Number(datos[i][3])) {
          datos[i][2] = v;
          datos[i][3] = c.t;
          if (i < datos.length - nuevas.length) hoja.getRange(i + 1, 3, 1, 2).setValues([[v, c.t]]);
        }
      } else {
        const r = [pet.semana, c.k, v, c.t];
        fila[id] = datos.length;
        datos.push(r);
        nuevas.push(r);
      }
    }
    if (nuevas.length) hoja.getRange(datos.length - nuevas.length + 1, 1, nuevas.length, 4).setValues(nuevas);
    const filas = datos.slice(1).filter((r) => r[0] === pet.semana)
      .map((r) => ({ k: r[1], v: JSON.parse(r[2]), t: Number(r[3]) }));
    return salida({ ok: true, filas: filas });
  } finally {
    lock.releaseLock();
  }
}

function obtenerHoja() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(HOJA);
  if (!hoja) {
    hoja = libro.insertSheet(HOJA);
    hoja.getRange("A:C").setNumberFormat("@");        // texto: que la hoja no convierta fechas ni "true"
    hoja.getRange(1, 1, 1, 4).setValues([["semana", "clave", "valor", "hora"]]);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function salida(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
