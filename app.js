/* App del menú semanal. Lee datos.json (lo genera scripts/exportar_app.py) y no calcula nutrición:
   solo suma lo que ya viene calculado. Estado local por semana: cambios de plato, tomas libres y checks. */
"use strict";

const TOMAS = ["desayuno", "comida", "cena"];
const OPCIONALES = ["media_manana", "media_tarde"];
const ORDEN_DIA = ["desayuno", "media_manana", "comida", "media_tarde", "cena"];
const NOMBRE_TOMA = { desayuno: "Desayuno", media_manana: "Media mañana", comida: "Comida",
                      media_tarde: "Media tarde", cena: "Cena" };
const ROL = { principal: "Plato", postre: "Postre", pan: "Pan", acompanamiento: "Acompañamiento" };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

let D = null;          // datos.json
let E = {};            // estado de la semana: {clave: {v, t}}
let persona = "carlos";
let panel = null;      // panel abierto en la ficha: "cambiar"

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const limpio = (a) => a.split(/[\/,]/)[0].trim();   // "Calabacín/ zapallito/ zucchini" -> "Calabacín"

const guardado = {
  leer(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  escribir(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin memoria: sigue igual */ } },
  limpiar(actual) {
    try {
      Object.keys(localStorage).filter((k) => /^nv:\d{4}-/.test(k) && k !== actual).forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* nada */ }
  },
};

/* ---------- Estado ---------- */
const claveSemana = () => "nv:" + D.semana.inicio;
const valor = (k) => (E[k] ? E[k].v : undefined);

function poner(k, v) {
  E[k] = { v, t: Date.now() };
  guardado.escribir(claveSemana(), E);
  if (window.Sync) Sync.anotar(k);
  render();
}

/* ---------- Modelo: qué se come cada día ---------- */
const toma = (d, c) => (D.dias[d] || {})[c] || null;

/* Platos de la toma para p: [{i, id, original, p}]; cada uno se puede cambiar (clave c:dia:toma:i). */
function itemsDe(d, c, p) {
  const t = toma(d, c);
  if (!t || !t.items) return [];
  return t.items.map((it, i) => ({ i, original: it.id, p: it.p, id: valor(`c:${d}:${c}:${i}`) || it.id }))
    .filter((it) => it.p === "ambos" || it.p === p);
}
const cambiado = (d, c, i) => { const v = valor(`c:${d}:${c}:${i}`); return !!v && v !== toma(d, c).items[i].id; };
const nCambiados = (d, c) => ((toma(d, c) || {}).items || []).filter((_, i) => cambiado(d, c, i)).length;

function libreDe(d, c, p) {
  const v = valor(`l:${d}:${c}`);
  if (v !== undefined) return v ? { nombre: v, kcal: D.libres[v] ?? 0 } : null;
  const t = toma(d, c);
  return t && t.libre && t.libre[p] ? t.libre[p] : null;
}

const fijosDe = (c, p) => ((D.semana.fijos[p] || {})[c] || []);
const idsToma = (d, c, p) => itemsDe(d, c, p).map((x) => x.id);

function rol(id, c) {
  const cl = D.recetas[id].clase;
  return cl === "postre" && c === "desayuno" ? "Fruta" : ROL[cl] || "Plato";
}

function kcalDia(d, p) {
  let k = 0;
  for (const c of ORDEN_DIA) {
    const lib = libreDe(d, c, p);
    if (lib) { k += lib.kcal; continue; }
    if (!TOMAS.includes(c)) continue;
    for (const id of [...idsToma(d, c, p), ...fijosDe(c, p)]) k += D.recetas[id].kcal[p];
  }
  return k;
}

/* Números con el mismo formato que compra.py (Python redondea .5 al par). */
function f0(g) {
  const r = Math.round(g);
  return String(Math.abs(g - Math.trunc(g)) === 0.5 && r % 2 ? r - 1 : r);
}
const fg = (g) => String(Number(g.toPrecision(6)));
const coma = (t) => String(t).replace(/(\d)\.(\d)/g, "$1,$2");   // 0.5 g -> 0,5 g al mostrar

/* Lista de la compra de la semana con los cambios: misma regla que scripts/compra.py, con lo fijo ya
   decidido en datos.json (compra.info). */
function calcularCompra() {
  const tot = {};
  for (const p of Object.keys(D.personas)) {
    for (const d of D.semana.dias) {
      for (const c of TOMAS) {
        if (libreDe(d, c, p)) continue;
        for (const id of [...idsToma(d, c, p), ...fijosDe(c, p)]) {
          for (const [a, g] of D.recetas[id].raciones[p]) {
            const k = D.compra.como[a] || a;
            tot[k] = (tot[k] || 0) + g;
          }
        }
      }
    }
  }
  const sec = {}, revisar = [];
  for (const a of Object.keys(tot).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))) {
    const g = tot[a], i = D.compra.info[a] || { s: "despensa" };
    if (i.r) { revisar.push([a, "", ""]); continue; }
    let q;
    if (i.u) {
      const n = Math.ceil(g / i.u[0] - 0.05);
      q = `${n} ${n === 1 ? i.u[1] : i.u[2]} (unos ${f0(g)} g)`;
    } else {
      q = g >= 1 ? `${f0(g)} g` : `${fg(g)} g`;
    }
    if (i.casa || (i.cond && g < 20)) { revisar.push([a, q, ""]); continue; }
    (sec[i.s] = sec[i.s] || []).push([a, q, i.soleis ? "soléis tenerlo" : ""]);
  }
  const out = D.compra.orden.filter((s) => sec[s]).map((s) => [D.compra.titulos[s], sec[s]]);
  if (revisar.length) out.push(["Revisar en casa", revisar]);
  return out;
}

/* Autocomprobación: sin cambios, la app debe dar la misma compra y kcal que los scripts. */
function comprobar() {
  const guardadoE = E;
  E = {};
  const ref = D.ref.compra.filter(([t]) => !t.startsWith("Tentempiés"));
  const okCompra = JSON.stringify(calcularCompra()) === JSON.stringify(ref);
  const difKcal = [];
  for (const p of Object.keys(D.personas)) {
    for (const d of D.semana.dias) {
      const a = kcalDia(d, p), b = D.ref.kcal[p][d];
      if (Math.abs(a - b) > 1) difKcal.push(`${p} ${d}: app ${a.toFixed(0)} / scripts ${b}`);
    }
  }
  E = guardadoE;
  const res = { compra: okCompra, kcal: difKcal.length ? difKcal : "ok" };
  (okCompra && !difKcal.length ? console.info : console.warn)("Autocomprobación", res);
  return res;
}
window.nvComprobar = comprobar;

/* ---------- Fechas ---------- */
function hoyISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function fecha(d) {
  const [, m, dd] = D.semana.fechas[d].split("-");
  return `${Number(dd)} ${MESES[Number(m) - 1]}`;
}
function situacion() {
  const h = hoyISO(), f = D.semana.fechas, dias = D.semana.dias;
  if (h < f[dias[0]]) return "antes";
  if (h > f[dias[dias.length - 1]]) return "despues";
  return "dentro";
}
function diaHoy() {
  const h = hoyISO();
  const d = D.semana.dias.find((x) => D.semana.fechas[x] === h);
  if (d) return d;
  return situacion() === "antes" ? D.semana.dias[0] : D.semana.dias[D.semana.dias.length - 1];
}
const esHoy = (d) => D.semana.fechas[d] === hoyISO();

/* ---------- Piezas ---------- */
function interruptor() {
  return `<div class="quien" role="group" aria-label="Raciones de">` +
    Object.entries(D.personas).map(([p, n]) =>
      `<button data-persona="${p}" class="${p === persona ? "si" : ""}" aria-pressed="${p === persona}">${esc(n)}</button>`).join("") +
    `</div>`;
}

function cantidad(g, m) {
  return `${coma(fg(g))} g` + (m && m.length <= 28 ? `<span class="medida">${esc(m)}</span>` : "");
}

function chipsReceta(id, d, c, i) {
  const r = D.recetas[id];
  let s = "";
  if (d && cambiado(d, c, i)) s += ` <span class="chip aviso">cambiado</span>`;
  if (r.alternativa) s += ` <span class="chip gris">alternativa</span>`;
  return s;
}

const kcalTxt = (ids, p) => {
  const k = ids.reduce((s, id) => s + D.recetas[id].kcal[p], 0);
  const pr = ids.reduce((s, id) => s + D.recetas[id].prot[p], 0);
  return `${Math.round(k)} kcal · ${Math.round(pr)} g proteína`;
};

function racionesChips(id, p) {
  return D.recetas[id].raciones[p].filter(([a]) => !(D.compra.info[D.compra.como[a] || a] || {}).cond)
    .map(([a, g, m]) => `<span class="rac">${esc(limpio(a))} <b>${coma(fg(g))} g</b>${m && m.length <= 14 ? ` (${esc(m)})` : ""}</span>`).join("");
}

function tarjetaItem(d, c, it) {
  const r = D.recetas[it.id], p = persona;
  return `<button class="tarjeta item ${r.clase}" data-ir="#item/${d}/${c}/${it.i}">
    <span class="rol">${rol(it.id, c)}${chipsReceta(it.id, d, c, it.i)}</span>
    <span class="nombre">${esc(r.corto)}</span>
    <span class="raciones">${racionesChips(it.id, p)}</span>
    <span class="kcal">${Math.round(r.kcal[p])} kcal · ${r.prot[p]} g proteína</span>
  </button>`;
}

function tarjetaToma(d, c) {
  const p = persona, lib = libreDe(d, c, p);
  const cab = `<div class="cabeza"><span class="etiqueta">${NOMBRE_TOMA[c]}</span>${interruptor()}</div>`;
  if (lib) {
    return `<section class="toma">${cab}<button class="tarjeta item libre" data-ir="#libre/${d}/${c}">
      <span class="rol">Toma libre</span><span class="nombre">${esc(lib.nombre)}</span>
      <span class="kcal">Unas ${lib.kcal} kcal, estimadas · no entra en la compra</span></button></section>`;
  }
  const items = itemsDe(d, c, p);
  const fijos = fijosDe(c, p);
  return `<section class="toma">${cab}
    <div class="items">${items.length ? items.map((it) => tarjetaItem(d, c, it)).join("")
      : '<p class="acomp">Nada previsto.</p>'}</div>
    <div class="pie-toma"><span>${items.length ? "Total: " + kcalTxt(items.map((x) => x.id), p) : ""}</span>
      <button class="enlace" data-ir="#libre/${d}/${c}">Toma libre…</button></div>
    ${fijos.length ? `<div class="fijos">Además, cada día: ${fijos.map((x) => esc(D.recetas[x].corto)).join(" · ")}</div>` : ""}
  </section>`;
}

function tarjetaOpcional(d, c) {
  const lib = libreDe(d, c, persona);
  const ids = D.semana.opcionales[c] || [];
  if (!ids.length && !lib) return "";
  const lista = lib
    ? `<button data-ir="#libre/${d}/${c}">Libre: ${esc(lib.nombre)} · unas ${lib.kcal} kcal</button>`
    : ids.map((id) => `<button data-ir="#receta/${id}">${esc(D.recetas[id].corto)}</button>`).join("") +
      `<button data-ir="#libre/${d}/${c}">Libre…</button>`;
  return `<article class="tarjeta opcional"><span class="etiqueta">${NOMBRE_TOMA[c]} · opcional</span>
    <div class="lista">${lista}</div></article>`;
}

function avisoEnergia(d) {
  const p = persona, n = D.personas[p];
  const k = Math.round(kcalDia(d, p)), obj = D.energia.kcal_dia[p], tol = D.energia.tolerancia;
  if (k < obj * (1 - tol)) {
    return `<div class="energia aviso">Día algo corto de energía para ${esc(n)}: unas ${k} de ${obj} kcal. ` +
      `Si tienes hambre, toma uno de los tentempiés opcionales.</div>`;
  }
  if (k > obj * (1 + tol)) {
    return `<div class="energia aviso">Día algo largo de energía para ${esc(n)}: unas ${k} de ${obj} kcal. ` +
      `${esc(D.energia.alta)}.</div>`;
  }
  return `<div class="energia">Energía del día de ${esc(n)}: unas ${k} kcal (objetivo ${obj}).</div>`;
}

/* ---------- Vistas ---------- */
function cabecera(izq, titulo, sub, der) {
  $("#cab").innerHTML = `<div class="fila">${izq || '<span class="flecha vacia"></span>'}<h1>${titulo}` +
    `${sub ? `<small>${sub}</small>` : ""}</h1>${der || '<span class="flecha vacia"></span>'}</div>`;
}

function vistaHoy(d) {
  const dias = D.semana.dias, i = dias.indexOf(d);
  const ant = dias[i - 1], sig = dias[i + 1];
  cabecera(`<button class="flecha" data-dia="${ant || ""}" ${ant ? "" : "disabled"} aria-label="Día anterior">‹</button>`,
    `${D.semana.nombre_dia[d]} ${fecha(d)}`, esHoy(d) ? "hoy" : `semana del ${fecha(dias[0])}`,
    `<button class="flecha" data-dia="${sig || ""}" ${sig ? "" : "disabled"} aria-label="Día siguiente">›</button>`);
  const notas = [];
  const sit = situacion();
  let aviso = "";
  if (sit === "antes") aviso = `<p class="aviso-semana">Esta semana empieza el ${D.semana.nombre_dia[dias[0]].toLowerCase()} ${fecha(dias[0])}.</p>`;
  if (sit === "despues") aviso = `<p class="aviso-semana">Esta semana ya ha pasado: falta publicar la nueva.</p>`;
  const batch = D.semana.batch[d];
  if (batch) notas.push(`<span class="chip gris">Hoy toca batch</span> ${batch.map((x) => esc(D.recetas[x].corto)).join(" · ")}`);
  if (Object.values(D.semana.b12).includes(d)) notas.push(`<span class="chip">B12</span> suplemento hoy`);
  const tarjetas = ORDEN_DIA.map((c) => (TOMAS.includes(c) ? tarjetaToma(d, c) : tarjetaOpcional(d, c))).join("");
  return `${aviso}${notas.length ? `<p class="nota-dia">${notas.join(" &nbsp; ")}</p>` : ""}
    <div class="tomas">${tarjetas}</div>${avisoEnergia(d)}`;
}

function tablaIngredientes(id) {
  const r = D.recetas[id], ps = Object.keys(D.personas);
  const filas = new Map();
  for (const p of ps) for (const [a, g, m] of r.raciones[p]) {
    if (!filas.has(a)) filas.set(a, {});
    filas.get(a)[p] = [g, m];
  }
  const th = ps.map((p) => `<th class="num ${p === persona ? "yo" : ""}">${esc(D.personas[p])}</th>`).join("");
  const tr = [...filas].map(([a, por]) => `<tr><td>${esc(limpio(a))}</td>` + ps.map((p) =>
    `<td class="num ${p === persona ? "yo" : ""}">${por[p] ? cantidad(...por[p]) : "–"}</td>`).join("") + "</tr>").join("");
  return `<table><tr><th>Ingrediente</th>${th}</tr>${tr}</table>`;
}

function cuerpoReceta(id) {
  const r = D.recetas[id];
  const ps = Object.keys(D.personas);
  return `${tablaIngredientes(id)}
    ${r.pasos.length ? `<h3>Pasos</h3><ol class="pasos">${r.pasos.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
    ${r.mejoras.length ? `<h3>Qué hemos mejorado</h3><ul class="mejoras">${r.mejoras.map((m) =>
      `<li>${esc(m.cambio)}${m.motivo ? `<br><span>${esc(m.motivo)}</span>` : ""}</li>`).join("")}</ul>` : ""}
    <h3>Por persona</h3><p class="acomp">${ps.map((p) => `<b>${esc(D.personas[p])}</b> ${kcalTxt([id], p)}`).join("<br>")}</p>`;
}

function metaReceta(id) {
  const r = D.recetas[id];
  const mom = r.momentos.map((m) => NOMBRE_TOMA[m] || m).join(", ");
  return [mom, r.min ? `${r.min} min` : ""].filter(Boolean).join(" · ");
}

function opcionesCambiar(d, c, i) {
  const t = toma(d, c).items[i];
  const actual = valor(`c:${d}:${c}:${i}`) || t.id;
  const alts = ((D.alternativas[c] || {})[actual] || []).filter((x) => x !== t.id);
  const linea = (id) => Object.keys(D.personas).map((p) =>
    `${esc(D.personas[p])}: ${Math.round(D.recetas[id].kcal[p])} kcal · ${D.recetas[id].prot[p]} g proteína`).join("<br>");
  const op = (id, orig) => `<div class="alt ${orig ? "original" : ""}">
      <button class="alt-elegir" data-elegir="${id}">
        <b>${orig ? "Volver al original: " : ""}${esc(D.recetas[id].corto)}${D.recetas[id].alternativa ? ' <span class="chip gris">alternativa</span>' : ""}</b>
        <span>${linea(id)}</span></button>
      <button class="ver" data-ir="#receta/${id}" aria-label="Ver la receta">Ver</button></div>`;
  return `<div class="opciones">${cambiado(d, c, i) ? op(t.id, true) : ""}${alts.map((id) => op(id)).join("")}
    ${alts.length ? "" : '<p class="acomp">No hay nada parecido en el recetario.</p>'}</div>`;
}

function opcionesLibre(d, c) {
  const activo = libreDe(d, c, persona);
  return `<div class="opciones">` +
    (activo ? `<button class="opcion original" data-libre=""><b>Quitar libre</b><span>Vuelve lo previsto</span></button>` : "") +
    Object.entries(D.libres).map(([n, k]) => {
      const si = activo && activo.nombre === n;
      return `<button class="opcion ${si ? "original" : ""}" data-libre="${esc(n)}"><b>${esc(n)}${si ? " ✓" : ""}</b>` +
        `<span>Unas ${k} kcal por persona</span></button>`;
    }).join("") + `</div>`;
}

function vistaItem(d, c, i) {
  cabecera(`<button class="flecha" data-volver="#hoy/${d}" aria-label="Volver">‹</button>`,
    NOMBRE_TOMA[c], `${D.semana.nombre_dia[d]} ${fecha(d)}`);
  const t = toma(d, c) && toma(d, c).items && toma(d, c).items[i];
  if (!t) return `<p class="vacio">No está en el menú.</p>`;
  const id = valor(`c:${d}:${c}:${i}`) || t.id;
  const r = D.recetas[id];
  return `<div class="ficha"><span class="chip gris">${rol(id, c)}</span><h2>${esc(r.nombre)}</h2>
    <div class="meta">${esc(metaReceta(id))}${chipsReceta(id, d, c, i)}</div>
    <div class="botones"><button class="boton ${panel === "cambiar" ? "abierto" : ""}" data-panel="cambiar">Cambiar</button>
      ${r.clase === "principal" ? `<button class="boton" data-ir="#libre/${d}/${c}">Toma libre</button>` : ""}</div>
    ${panel === "cambiar" ? opcionesCambiar(d, c, i) : ""}
    <div class="cabeza" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
      <h3 style="margin:0">Ingredientes</h3>${interruptor()}</div>
    ${cuerpoReceta(id)}</div>`;
}

function vistaLibre(d, c) {
  cabecera(`<button class="flecha" data-volver="#hoy/${d}" aria-label="Volver">‹</button>`,
    `${NOMBRE_TOMA[c]} libre`, `${D.semana.nombre_dia[d]} ${fecha(d)}`);
  const lib = libreDe(d, c, persona);
  const principal = TOMAS.includes(c);
  const previsto = principal ? idsToma(d, c, persona) : (D.semana.opcionales[c] || []);
  return `<div class="ficha"><h2>${lib ? `Libre: ${esc(lib.nombre)}` : "Toma libre"}</h2>
    <p class="meta">${principal ? "Para los dos: sale de la compra y su energía se estima." : "Su energía se suma al día."}</p>
    ${opcionesLibre(d, c)}
    ${previsto.length ? `<h3>${principal ? "Lo previsto" : "Tentempiés del menú"}</h3>` +
      previsto.map((id) => `<p class="acomp"><button class="volver" data-ir="#receta/${id}">${esc(D.recetas[id].corto)} ›</button></p>`).join("") : ""}</div>`;
}

function vistaReceta(id) {
  const r = D.recetas[id];
  cabecera(`<button class="flecha" data-volver="#hoy" aria-label="Volver">‹</button>`, "Receta", "");
  if (!r) return `<p class="vacio">No está en el recetario.</p>`;
  return `<div class="ficha"><h2>${esc(r.nombre)}</h2><div class="meta">${esc(metaReceta(id))}${chipsReceta(id)}</div>
    <div class="cabeza" style="display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0">Ingredientes</h3>${interruptor()}</div>${cuerpoReceta(id)}</div>`;
}

function vistaSemana() {
  const dias = D.semana.dias;
  cabecera("", "Semana", `del ${fecha(dias[0])} al ${fecha(dias[dias.length - 1])}`, `<button class="flecha" data-ir="#ajustes" aria-label="Sincronizar"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18 2v4h-4M6 22v-4h4"/></svg></button>`);
  const celda = (d, c) => {
    const lib = libreDe(d, c, persona);
    if (lib) return `<span class="chip aviso">libre</span> ${esc(lib.nombre)}`;
    const ids = idsToma(d, c, persona);
    return ids.length ? ids.map((x) => esc(D.recetas[x].corto)).join(" + ") +
      (nCambiados(d, c) ? ' <span class="chip aviso">cambiado</span>' : "") : "–";
  };
  const batch = Object.entries(D.semana.batch).map(([d, ids]) =>
    `<span class="chip gris">Batch ${esc(D.semana.nombre_dia[d].toLowerCase())}</span> ${ids.map((x) => esc(D.recetas[x].corto)).join(" · ")}`);
  const opc = [...new Set(OPCIONALES.flatMap((c) => D.semana.opcionales[c] || []))];
  return `${batch.length ? `<p class="nota-dia">${batch.join("<br>")}</p>` : ""}
    <div class="semana">${dias.map((d) => `<button class="tarjeta dia ${esHoy(d) ? "hoy" : ""}" data-ir="#hoy/${d}">
      <h3>${D.semana.nombre_dia[d]} ${fecha(d)}${esHoy(d) ? ' <span class="chip">hoy</span>' : ""}</h3>
      ${TOMAS.map((c) => `<p><i>${NOMBRE_TOMA[c]}</i> ${celda(d, c)}</p>`).join("")}</button>`).join("")}</div>
    ${opc.length ? `<p class="nota-dia" style="margin-top:12px"><span class="chip gris">Si tenéis hambre</span> ${opc.map((x) => esc(D.recetas[x].corto)).join(" · ")}</p>` : ""}
    <p class="nota-dia"><button class="enlace" data-ir="#ajustes">Sincronizar</button> <span class="estado-sync">${esc(Sync.texto())}</span></p>`;
}

function vistaCompra() {
  cabecera("", "Compra", `semana del ${fecha(D.semana.dias[0])} · para los dos`, `<button class="flecha" data-ir="#ajustes" aria-label="Sincronizar"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18 2v4h-4M6 22v-4h4"/></svg></button>`);
  const secciones = calcularCompra();
  secciones.push(["Tentempiés opcionales (para una vez, los dos)", D.compra.opcionales.map(([n, q]) => ["opc:" + n, q, ""])]);
  let total = 0, hechos = 0;
  const html = secciones.map(([titulo, filas]) => {
    const items = filas.map(([a, q, nota]) => ({ a, q, nota, si: !!valor("k:" + a) }));
    total += items.length; hechos += items.filter((x) => x.si).length;
    items.sort((x, y) => x.si - y.si);
    return `<section><h3>${esc(titulo)}</h3><ul>${items.map((x) => `<li class="${x.si ? "si" : ""}">
      <button data-check="${esc(x.a)}" aria-pressed="${x.si}"><span class="caja"></span><span class="txt">${esc(limpio(x.a.replace(/^opc:/, "")))}
      ${x.q || x.nota ? `<span class="cant">${esc(coma(x.q))}${x.nota ? `${x.q ? " · " : ""}<em>${esc(x.nota)}</em>` : ""}</span>` : ""}</span></button></li>`).join("")}</ul></section>`;
  }).join("");
  const n = { c: 0, l: 0 };
  for (const d of D.semana.dias) for (const c of TOMAS) {
    n.c += nCambiados(d, c);
    if (valor(`l:${d}:${c}`)) n.l++;
  }
  const cambios = [n.c ? `${n.c} plato${n.c > 1 ? "s" : ""} cambiado${n.c > 1 ? "s" : ""}` : "",
    n.l ? `${n.l} toma${n.l > 1 ? "s" : ""} libre${n.l > 1 ? "s" : ""}` : ""].filter(Boolean).join(" y ");
  return `<p class="progreso">Marcado ${hechos} de ${total}.${cambios ? ` Recalculada con ${cambios}.` : ""}
    <br><span class="estado-sync">${esc(Sync.texto())}</span></p>
    <div class="compra">${html}</div>`;
}

function vistaAjustes() {
  cabecera(`<button class="flecha" data-volver="#semana" aria-label="Volver">‹</button>`, "Sincronizar", "los dos móviles");
  const c = Sync.conf() || {};
  return `<div class="ficha">
    <p class="acomp">Con la hoja de Google, los platos cambiados, las tomas libres y los checks de la compra se ven en los
      dos móviles. Sin ella, la app funciona igual, cada móvil por su cuenta. La URL y la clave se guardan solo en este móvil.</p>
    <label class="campo">URL de la aplicación web del script
      <input id="sync-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url || "")}"></label>
    <label class="campo">Clave (solo si la pusiste en el script)
      <input id="sync-clave" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(c.clave || "")}"></label>
    <div class="botones"><button class="boton lleno" data-accion="sync-guardar">Guardar y sincronizar</button>
      ${c.url ? '<button class="boton" data-accion="sync-quitar">Dejar de sincronizar</button>' : ""}</div>
    <p class="acomp" id="sync-error" role="alert"></p>
    <p class="acomp estado-sync">${esc(Sync.texto())}</p></div>`;
}

/* ---------- Rutas y eventos ---------- */
function ruta() {
  const [v, ...r] = decodeURIComponent(location.hash.slice(1)).split("/");
  return { v: v || "hoy", r };
}

function render() {
  if (!D) return;
  const { v, r } = ruta();
  let html;
  if (v === "item" && D.dias[r[0]]) html = vistaItem(r[0], r[1], Number(r[2]));
  else if (v === "libre" && D.dias[r[0]]) html = vistaLibre(r[0], r[1]);
  else if (v === "receta") html = vistaReceta(r[0]);
  else if (v === "semana") html = vistaSemana();
  else if (v === "compra") html = vistaCompra();
  else if (v === "ajustes") html = vistaAjustes();
  else html = vistaHoy(D.dias[r[0]] ? r[0] : diaHoy());
  $("#vista").innerHTML = html;
  const tab = v === "semana" || v === "compra" ? v : v === "ajustes" ? "" : "hoy";
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("activa", a.dataset.tab === tab));
}

function ir(hash) {
  panel = null;
  history.pushState({ app: (history.state && history.state.app || 0) + 1 }, "", hash);
  render();
  window.scrollTo(0, 0);
}

function cambiarDia(d) {
  if (!d) return;
  history.replaceState(history.state, "", "#hoy/" + d);
  render();
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-ir],[data-persona],[data-panel],[data-elegir],[data-libre],[data-check],[data-dia],[data-volver],[data-accion]");
  if (!b || b.disabled) return;
  const ds = b.dataset;
  const { r } = ruta();
  if (ds.ir !== undefined) ir(ds.ir);
  else if (ds.persona) { persona = ds.persona; guardado.escribir("nv:persona", persona); render(); }
  else if (ds.panel) { panel = panel === ds.panel ? null : ds.panel; render(); }
  else if (ds.elegir !== undefined) {
    const [d, c, i] = r;
    panel = null;
    poner(`c:${d}:${c}:${i}`, ds.elegir === toma(d, c).items[i].id ? "" : ds.elegir);
  } else if (ds.libre !== undefined) {
    const [d, c] = r;
    panel = null;
    poner(`l:${d}:${c}`, ds.libre);
  } else if (ds.check !== undefined) poner("k:" + ds.check, !valor("k:" + ds.check));
  else if (ds.dia !== undefined) cambiarDia(ds.dia);
  else if (ds.accion === "sync-guardar" || ds.accion === "sync-quitar") {
    const quitar = ds.accion === "sync-quitar";
    const err = Sync.configurar(quitar ? "" : $("#sync-url").value, quitar ? "" : $("#sync-clave").value);
    if (err) $("#sync-error").textContent = err;
    else render();
  }
  else if (ds.volver !== undefined) {
    if (history.state && history.state.app) history.back();
    else { history.replaceState(null, "", ds.volver); panel = null; render(); }
  }
});

window.addEventListener("popstate", () => { panel = null; render(); });
window.addEventListener("hashchange", () => { panel = null; render(); });

/* Deslizar a los lados en Hoy para pasar de día. */
let toque = null;
document.addEventListener("touchstart", (e) => { toque = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!toque || !D || ruta().v !== "hoy") return;
  const dx = e.changedTouches[0].clientX - toque[0], dy = e.changedTouches[0].clientY - toque[1];
  toque = null;
  if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
  const dias = D.semana.dias, actual = D.dias[ruta().r[0]] ? ruta().r[0] : diaHoy();
  cambiarDia(dias[dias.indexOf(actual) + (dx < 0 ? 1 : -1)]);
});

/* ---------- Arranque ---------- */
async function arrancar() {
  persona = guardado.leer("nv:persona", "carlos");
  try {
    const res = await fetch("datos.json", { cache: "no-cache" });
    D = await res.json();
  } catch (e) {
    $("#vista").innerHTML = `<p class="vacio">No se ha podido cargar el menú. Abre la app una vez con conexión.</p>`;
    return;
  }
  if (!D.personas[persona]) persona = Object.keys(D.personas)[0];
  E = guardado.leer(claveSemana(), {});
  guardado.limpiar(claveSemana());
  render();
  comprobar();
  if (window.Sync) Sync.iniciar();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
arrancar();
