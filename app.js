/* App del menú semanal. Lee datos.json (lo genera scripts/exportar_app.py) y no calcula nutrición:
   solo suma lo que ya viene calculado. Estado local por semana: cambios de plato, tomas libres y checks. */
"use strict";

const TOMAS = ["desayuno", "comida", "cena"];
const OPCIONALES = ["media_manana", "media_tarde"];
const ORDEN_DIA = ["desayuno", "media_manana", "comida", "media_tarde", "cena"];
const NOMBRE_TOMA = { desayuno: "Desayuno", media_manana: "Media mañana", comida: "Comida",
                      media_tarde: "Media tarde", cena: "Cena" };
const ROL = { principal: "Plato", bebida: "Bebida", postre: "Postre", pan: "Pan", acompanamiento: "Acompañamiento" };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

let D = null;          // datos.json
let E = {};            // estado de la semana: {clave: {v, t}}
let persona = "carlos";
let panel = null;      // panel abierto en la ficha: "cambiar"
let para = "ambos";    // a quién se aplica un cambio o una toma libre: "ambos" o una persona

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

function poner(k, v) { ponerVarios([[k, v]]); }

function ponerVarios(pares) {
  const t = Date.now();
  for (const [k, v] of pares) {
    E[k] = { v, t };
    if (window.Sync) Sync.anotar(k);
  }
  guardado.escribir(claveSemana(), E);
  render();
}

/* ---------- Modelo: qué se come cada día ---------- */
const PERSONAS = () => Object.keys(D.personas);

/* Intercambio de días: el día d muestra el menú del día origen(d) (clave c:<día>:orden). Los cambios, lo añadido
   y las tomas libres van con el menú, porque sus claves usan el día de origen. */
const origen = (d) => valor(`c:${d}:orden`) || d;
const toma = (d, c) => (D.dias[origen(d)] || {})[c] || null;
const esAnadido = (i) => String(i).startsWith("+");
const esFijo = (i) => String(i).startsWith("f");
const indice = (x) => (/^[+f]/.test(String(x)) ? String(x) : Number(x));

/* Plato de partida en ese hueco: el añadido, el fijo de cada día (bebida) o el de la plantilla. */
function originalDe(d, c, i, p) {
  if (esAnadido(i)) return String(i).slice(1);
  if (esFijo(i)) return fijosDe(c, p)[Number(String(i).slice(1))];
  return toma(d, c).items[i].id;
}

/* ¿Ese hueco de la toma es de p? */
function aplica(d, c, i, p) {
  if (esAnadido(i)) return (anadidos(d, c).find((a) => a.id === String(i).slice(1)) || { quien: [] }).quien.includes(p);
  if (esFijo(i)) return !!fijosDe(c, p)[Number(String(i).slice(1))];
  const t = toma(d, c).items[i];
  return t.p === "ambos" || t.p === p;
}

/* Plato i de la toma para p: cambio propio (c:dia:toma:i:p) > cambio de los dos (c:dia:toma:i) > el del menú.
   Los platos añadidos llevan i = "+<id>". */
function idDe(d, c, i, p) {
  if (esAnadido(i)) return String(i).slice(1);
  const o = origen(d);
  return valor(`c:${o}:${c}:${i}:${p}`) || valor(`c:${o}:${c}:${i}`) || originalDe(d, c, i, p);
}

/* Platos añadidos a la toma: c:<día>:<toma>:+<id> = "carlos,angela" (para quién), en el orden en que se añadieron. */
function anadidos(d, c) {
  const pre = `c:${origen(d)}:${c}:+`;
  return Object.keys(E).filter((k) => k.startsWith(pre) && E[k].v && D.recetas[k.slice(pre.length)])
    .sort((a, b) => E[a].t - E[b].t)
    .map((k) => ({ id: k.slice(pre.length), quien: String(E[k].v).split(",") }));
}

/* Plato quitado de la toma (no toma postre, o lo cambia por uno añadido): c:<día>:<toma>:<i>:quitar = "carlos,angela". */
const quitado = (d, c, i, p) => String(valor(`c:${origen(d)}:${c}:${i}:quitar`) || "").split(",").includes(p);
function quitar(d, c, i, si) {
  const k = `c:${origen(d)}:${c}:${i}:quitar`, quien = new Set(String(valor(k) || "").split(",").filter(Boolean));
  (para === "ambos" ? PERSONAS() : [para]).forEach((p) => (si ? quien.add(p) : quien.delete(p)));
  poner(k, PERSONAS().filter((p) => quien.has(p)).join(","));
}
/* Platos de la plantilla quitados para p, para poder deshacerlo desde la tarjeta: [{i, id}]. */
const quitadosDe = (d, c, p) => [...((toma(d, c) || {}).items || []).map((it, i) => ({ i, it })), ...fijosDe(c, p).map((id, k) => ({ i: "f" + k, it: { id, p } }))]
  .filter(({ i, it }) => (it.p === "ambos" || it.p === p) && quitado(d, c, i, p)).map(({ i }) => ({ i, id: idDe(d, c, i, p) }));

/* Platos de la toma para p: [{i, id, original, p, anadido}]. */
function itemsDe(d, c, p) {
  const t = toma(d, c);
  const base = t && t.items ? t.items.map((it, i) => ({ i, original: it.id, p: it.p, id: idDe(d, c, i, p) }))
    .filter((it) => (it.p === "ambos" || it.p === p) && !quitado(d, c, it.i, p)) : [];
  const bebidas = libreReal(d, c, p) ? [] : fijosDe(c, p).map((id, k) => ({ i: "f" + k, original: id, p, id: idDe(d, c, "f" + k, p), fijo: true }))
    .filter((it) => D.recetas[it.original].clase === "bebida" && !quitado(d, c, it.i, p));
  return base.concat(bebidas, anadidos(d, c).filter((a) => a.quien.includes(p))
    .map((a) => ({ i: "+" + a.id, original: a.id, p, id: a.id, anadido: true })));
}
const cambiado = (d, c, i, p) => !esAnadido(i) && aplica(d, c, i, p) && idDe(d, c, i, p) !== originalDe(d, c, i, p);
const huecosFijos = (c) => (fijosDe(c, PERSONAS()[0]) || []).map((_, k) => "f" + k);
const nCambiados = (d, c) => [...((toma(d, c) || {}).items || []).map((_, i) => i), ...huecosFijos(c)]
  .filter((i) => PERSONAS().some((p) => cambiado(d, c, i, p))).length;

/* Toma saltada (c:<día>:<toma>:saltar = "carlos,angela"): casos extraordinarios (dormir más, viaje...). Para la energía
   cuenta como una toma libre de 0 kcal; la compra y el batch no cambian, porque lo cocinado se aprovecha. */
const saltada = (d, c, p) => String(valor(`c:${origen(d)}:${c}:saltar`) || "").split(",").includes(p);
/* Libre de verdad (no saltada): la compra, el batch y las bebidas fijas no cuentan esa toma. */
const libreReal = (d, c, p) => { const l = libreDe(d, c, p); return l && !l.saltada ? l : null; };

/* Toma libre para p: la propia (l:dia:toma:p; "-" = no libre para p) > la de los dos (l:dia:toma) > la del menú. */
function libreDe(d, c, p) {
  if (TOMAS.includes(c) && saltada(d, c, p)) return { nombre: "Saltada", kcal: 0, saltada: true };
  const o = origen(d);
  const vp = valor(`l:${o}:${c}:${p}`);
  if (vp === "-") return null;
  if (vp) return { nombre: vp, kcal: D.libres[vp] ?? 0 };
  const v = valor(`l:${o}:${c}`);
  if (v !== undefined) return v ? { nombre: v, kcal: D.libres[v] ?? 0 } : null;
  const t = toma(d, c);
  return t && t.libre && t.libre[p] ? t.libre[p] : null;
}

/* Batch: días elegidos en la pestaña Batch (c:batch:dias, "-" = sin batch) o, si no, los de la plantilla. Cada día de
   batch cocina, hasta el siguiente día de batch, los platos que se pueden hacer en batch (recetas con batch). Si se
   cambia un plato o se intercambian días, el batch se rehace solo. */
function diasBatch() {
  const v = valor("c:batch:dias"), dias = D.semana.dias;
  if (v === "-") return [];
  return (v ? String(v).split(",") : Object.keys(D.semana.batch)).filter((d) => dias.includes(d))
    .sort((x, y) => dias.indexOf(x) - dias.indexOf(y));
}
function tramo(b) {
  const dias = D.semana.dias, ini = dias.indexOf(b), sig = diasBatch().find((x) => dias.indexOf(x) > ini);
  return dias.slice(ini, sig ? dias.indexOf(sig) : dias.length);
}
/* Raciones que cocina el batch del día b: [{d, c, id, p}], una por persona y toma. */
function usosBatch(b) {
  const out = [];
  for (const d of tramo(b)) for (const c of TOMAS) for (const p of PERSONAS()) {
    if (libreReal(d, c, p)) continue;
    for (const id of idsToma(d, c, p)) if (D.recetas[id].batch) out.push({ d, c, id, p });
  }
  return out;
}
const batchDe = (b) => [...new Set(usosBatch(b).map((u) => u.id))];

/* Lo que la otra persona come distinto en esa toma, para avisarlo en la tarjeta. */
const otra = (p) => PERSONAS().find((x) => x !== p);

const fijosDe = (c, p) => ((D.semana.fijos[p] || {})[c] || []);
/* Los fijos que no son bebida (lino, nuez de Brasil): van en una línea aparte y no se cambian. */
const fijosLinea = (d, c, p) => {
  const fd = ((D.semana.fijos_dia || {})[p] || {})[origen(d)];
  return fd ? fd[c] || [] : fijosDe(c, p).filter((id) => D.recetas[id].clase !== "bebida");
};
const idsToma = (d, c, p) => itemsDe(d, c, p).map((x) => x.id);

function rol(id, c) {
  if (OPCIONALES.includes(c)) return "Tentempié";
  const cl = D.recetas[id].clase;
  return cl === "postre" && c === "desayuno" ? "Fruta" : ROL[cl] || "Plato";
}

/* Energía de una lista de platos para p (la suma común de la tarjeta de energía, Añadir, Saltar y Crear receta). */
const kcalDe = (ids, p) => ids.reduce((n, id) => n + D.recetas[id].kcal[p], 0);

function kcalDia(d, p) {
  let k = 0;
  for (const c of ORDEN_DIA) {
    const lib = libreDe(d, c, p);
    if (lib) { k += lib.kcal; continue; }
    k += kcalDe([...idsToma(d, c, p), ...fijosLinea(d, c, p)], p);
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
      for (const c of ORDEN_DIA) {
        if (libreReal(d, c, p)) continue;
        for (const id of [...idsToma(d, c, p), ...fijosLinea(d, c, p)]) {
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
    if (i.e) {   // envases de Alcampo: misma regla que texto_envase() de scripts/compra.py
      const [peso, uno, varios, pack, avisa] = i.e, n = Math.max(1, Math.ceil(g / peso - 0.05)), sobra = n * peso - g;
      q = `${n} ${n === 1 ? uno : varios} de ${fg(peso)} g${pack ? ` (packs de ${pack})` : ""}` +
        `${avisa && sobra >= Math.max(10, 0.1 * peso) ? `; sobran unos ${f0(sobra)} g` : ""} (unos ${f0(g)} g)`;
    } else if (i.u) {
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
  // Crear receta: rehacer recetas aprobadas con sus mismos gramos da sus kcal y proteína (±2 %).
  const difCrear = [];
  for (const id of ["nutri_lentejas_cremosas_curry", "pasta_bolonesa_soja", "r_crema_coliflor", "empanada_verduras_atun_vegano"]) {
    const r = D.recetas[id];
    if (!r) continue;
    for (const p of PERSONAS()) {
      const t = sumaNut(r.raciones[p]);
      if (Math.abs(t.kcal / r.kcal[p] - 1) > 0.02 || Math.abs(t.proteina - r.prot[p]) > Math.max(1, 0.02 * r.prot[p])) difCrear.push(`${id} ${p}`);
    }
  }
  // Saltar: sin desayuno el lunes y reforzando la comida, el día de cada uno vuelve a la banda de ±tolerancia.
  const difSaltar = [];
  for (const p of PERSONAS()) {
    const d = D.semana.dias[0];
    E = { [`c:${d}:desayuno:saltar`]: { v: p, t: 1 } };
    rellenar(d, "comida", p, REFUERZO).ids.forEach((id, n) => { E[`c:${d}:comida:+${id}`] = { v: p, t: 2 + n }; });
    if (estadoEnergia(kcalDia(d, p), p) !== "dentro") difSaltar.push(`${p}: ${Math.round(kcalDia(d, p))} kcal`);
  }
  E = {};
  // Suplementos: nadie pasa de max_semana; un quincenal tomado hace 7 días no vuelve a salir.
  const difSup = [];
  const globSup = guardado.leer("nv:sup-tomados", null);
  for (const p of PERSONAS()) {
    for (const s of planSuplementos(p)) if (s.dias.length > (s.x.max_semana || 7)) difSup.push(`${p} ${s.x.id}`);
    for (const x of D.suplementos.lista.filter((y) => y.frecuencia === "quincenal")) {
      if (!planSuplementos(p).some((s) => s.x.id === x.id && s.dias.length)) continue;
      const hace7 = new Date(new Date(D.semana.fechas[x.dia || D.semana.dias[0]]) - 7 * 864e5).toISOString().slice(0, 10);
      guardado.escribir("nv:sup-tomados", { [`${x.id}:${p}`]: hace7 });
      if (planSuplementos(p).some((s) => s.x.id === x.id && s.dias.length)) difSup.push(`${p} ${x.id} quincenal`);
    }
  }
  if (globSup) guardado.escribir("nv:sup-tomados", globSup); else { try { localStorage.removeItem("nv:sup-tomados"); } catch (e) { /* nada */ } }
  // Batch: la suma de las bases es la suma de los ingredientes de los platos del batch.
  const difBatch = diasBatch().filter((b) => {
    const enBases = Object.values(basesBatch(b)).flatMap((x) => Object.values(x)).reduce((n, x) => n + x.g, 0);
    const enPlatos = usosBatch(b).reduce((n, u) => n + D.recetas[u.id].raciones[u.p].reduce((m, [, g]) => m + g, 0), 0);
    return Math.abs(enBases - enPlatos) > 0.5;
  });
  E = guardadoE;
  const res = { compra: okCompra, kcal: difKcal.length ? difKcal : "ok", batch: difBatch.length ? difBatch : "ok",
    saltar: difSaltar.length ? difSaltar : "ok", crear: difCrear.length ? difCrear : "ok",
    suplementos: difSup.length ? difSup : "ok" };
  (okCompra && !difKcal.length && !difBatch.length && !difSaltar.length && !difCrear.length && !difSup.length ? console.info : console.warn)("Autocomprobación", res);
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
  if (d && cambiado(d, c, i, persona)) s += ` <span class="chip aviso">cambiado</span>`;
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
  const r = D.recetas[it.id], p = persona, o = otra(p);
  let delOtro = null, marca = "";
  if (it.anadido) {
    const solo = !anadidos(d, c).find((a) => a.id === it.id).quien.includes(o);
    marca = ` <span class="chip aviso">añadido${solo ? ` · solo ${esc(D.personas[p])}` : ""}</span>`;
  } else {
    delOtro = aplica(d, c, it.i, o) && !libreDe(d, c, o) ? idDe(d, c, it.i, o) : null;
  }
  return `<button class="tarjeta item ${r.clase}" data-ir="#item/${d}/${c}/${encodeURIComponent(it.i)}">
    <span class="rol">${rol(it.id, c)}${chipsReceta(it.id, d, c, it.i)}${marca}</span>
    <span class="nombre">${esc(r.corto)}</span>
    <span class="raciones">${racionesChips(it.id, p)}</span>
    <span class="kcal">${Math.round(r.kcal[p])} kcal · ${r.prot[p]} g proteína</span>
    ${delOtro && delOtro !== it.id ? `<span class="otro">${esc(D.personas[o])}: ${esc(D.recetas[delOtro].corto)}</span>` : ""}
  </button>`;
}

function tarjetaToma(d, c) {
  const p = persona, lib = libreDe(d, c, p), o = otra(p), libO = libreDe(d, c, o);
  const cab = `<div class="cabeza"><span class="etiqueta">${NOMBRE_TOMA[c]}</span>${interruptor()}</div>`;
  if (lib && lib.saltada) {
    const delOtro = libO ? (libO.saltada ? "también la salta" : `libre (${libO.nombre})`)
      : idsToma(d, c, o).map((x) => D.recetas[x].corto).join(" + ");
    return `<section class="toma">${cab}<button class="tarjeta item libre" data-ir="#saltar/${d}/${c}">
      <span class="rol">Toma saltada</span><span class="nombre">Sin ${NOMBRE_TOMA[c].toLowerCase()}</span>
      <span class="kcal">Toca para repartir la energía que falta o deshacerlo</span>
      ${delOtro ? `<span class="otro">${esc(D.personas[o])}: ${esc(delOtro)}</span>` : ""}</button></section>`;
  }
  if (lib) {
    const delOtro = libO ? (libO.nombre !== lib.nombre ? `libre (${libO.nombre})` : "")
      : idsToma(d, c, o).map((x) => D.recetas[x].corto).join(" + ");
    return `<section class="toma">${cab}<button class="tarjeta item libre" data-ir="#libre/${d}/${c}">
      <span class="rol">Toma libre</span><span class="nombre">${esc(lib.nombre)}</span>
      <span class="kcal">Unas ${lib.kcal} kcal, estimadas · no entra en la compra</span>
      ${delOtro ? `<span class="otro">${esc(D.personas[o])}: ${esc(delOtro)}</span>` : ""}</button></section>`;
  }
  const items = itemsDe(d, c, p);
  const fijos = fijosLinea(d, c, p);
  return `<section class="toma">${cab}
    <div class="items">${items.length ? items.map((it) => tarjetaItem(d, c, it)).join("")
      : '<p class="acomp">Nada previsto.</p>'}</div>
    ${libO ? `<p class="otro-toma">${esc(D.personas[o])}: libre (${esc(libO.nombre)})</p>` : ""}
    ${quitadosDe(d, c, p).map(({ i, id }) => `<p class="otro-toma">Quitado: <button class="enlace" data-ir="#item/${d}/${c}/${i}">${esc(D.recetas[id].corto)} (volver a ponerlo)</button></p>`).join("")}
    ${lineaSuplementos(d, c, p)}
    <div class="pie-toma"><span>${items.length ? "Total: " + kcalTxt(items.map((x) => x.id), p) : ""}</span>
      <span class="acciones"><button class="enlace" data-ir="#anadir/${d}/${c}">＋ Añadir</button>
      <button class="enlace" data-ir="#libre/${d}/${c}">Toma libre…</button>
      <button class="enlace" data-ir="#saltar/${d}/${c}">Saltar…</button></span></div>
    ${fijos.length ? `<div class="fijos">Con esta toma: ${fijos.map((x) => esc(D.recetas[x].corto)).join(" · ")}</div>` : ""}
  </section>`;
}

function tarjetaOpcional(d, c) {
  const lib = libreDe(d, c, persona);
  const ids = D.semana.opcionales[c] || [];
  const mios = itemsDe(d, c, persona);
  const lista = lib
    ? `<button data-ir="#libre/${d}/${c}">Libre: ${esc(lib.nombre)} · unas ${lib.kcal} kcal</button>`
    : ids.filter((id) => !mios.some((x) => x.id === id))
      .map((id) => `<button data-ir="#receta/${id}">${esc(D.recetas[id].corto)}</button>`).join("") +
      `<button data-ir="#anadir/${d}/${c}">＋ Añadir</button><button data-ir="#libre/${d}/${c}">Libre…</button>`;
  const fijos = lib ? [] : fijosLinea(d, c, persona);
  return `<article class="tarjeta opcional ${(mios.length || fijos.length) && !lib ? "con-algo" : ""}"><span class="etiqueta">${NOMBRE_TOMA[c]} · opcional</span>
    ${lib ? "" : `<div class="items">${mios.map((it) => tarjetaItem(d, c, it)).join("")}</div>`}
    ${fijos.length ? `<div class="fijos">Con esta toma: ${fijos.map((x) => esc(D.recetas[x].corto)).join(" · ")}</div>` : ""}
    <div class="lista">${lista}</div></article>`;
}

function estadoEnergia(k, p) {
  const obj = D.energia.kcal_dia[p], tol = D.energia.tolerancia;
  return k < obj * (1 - tol) ? "corto" : k > obj * (1 + tol) ? "largo" : "dentro";
}

/* Tentempiés para completar el día de p según sus pautas (03_datos/pautas.json) y, al final, los del menú de la semana:
   en su orden, que quepan sin pasar del máximo, que no estén ya en el día y sin pasar de las frutas del día. */
const frutasDia = (d, p) => ORDEN_DIA.flatMap((c) => (libreDe(d, c, p) ? [] : [...idsToma(d, c, p), ...fijosLinea(d, c, p)]))
  .reduce((n, id) => n + (D.recetas[id].frutas || 0), 0);

function sugerencias(d, p, k, max) {
  if (D.energia.kcal_dia[p] - k < 50) return [];
  const delDia = new Set(ORDEN_DIA.flatMap((c) => idsToma(d, c, p)));
  let frutas = frutasDia(d, p);
  const out = [];
  const menu = [...new Set(OPCIONALES.flatMap((c) => D.semana.opcionales[c] || []))];
  const grupos = [...((D.pautas[p] || {}).sugerencias || []), { motivo: "tentempié del menú de la semana", recetas: menu }];
  for (const g of grupos) {
    for (const id of g.recetas) {
      const r = D.recetas[id];
      if (out.length >= 3 || delDia.has(id) || out.some((x) => x.id === id) || k + r.kcal[p] > max) continue;
      if (r.frutas && frutas + r.frutas > D.energia.frutas_max) continue;
      out.push({ id, motivo: g.motivo });
      frutas += r.frutas || 0;
      break;   // una por grupo, para variar
    }
  }
  return out;
}

/* ---------- Suplementos por semana (fase 4d) ---------- */
/* Lo que pediría cada día para p según lo que come (03_datos/suplementos.json): {id: {c, texto, aviso}}. Es la regla
   de antes, día a día; planSuplementos() la reparte en la semana sin pasar de max_semana. */
function necesidadesDia(d, p) {
  const S = D.suplementos, out = {};
  const tomas = TOMAS.filter((c) => !libreDe(d, c, p));
  if (!tomas.length) return out;
  const ids = (c) => [...idsToma(d, c, p), ...fijosLinea(d, c, p)];
  const suma = (lista, k) => lista.reduce((n, id) => n + (D.recetas[id].n[p][k] || 0), 0);   // n: hierro, calcio, vit C, ALA, grasa
  const delDia = ORDEN_DIA.flatMap((c) => (libreDe(d, c, p) ? [] : ids(c)));
  const marcas = new Set(delDia.flatMap((id) => D.recetas[id].marcas || []));
  const principales = tomas.filter((c) => c !== "desayuno");
  const conGrasa = principales.length ? principales.reduce((a, b) => (suma(ids(b), 4) > suma(ids(a), 4) ? b : a)) : tomas[0];
  const conVitC = principales.length ? [...principales].sort((a, b) =>
    (suma(ids(b), 2) >= 25) - (suma(ids(a), 2) >= 25) || suma(ids(a), 1) - suma(ids(b), 1) || suma(ids(b), 2) - suma(ids(a), 2))[0] : tomas[0];
  const momento = (m) => (m === "desayuno" ? (tomas.includes("desayuno") ? "desayuno" : tomas[0]) : m === "hierro" ? conVitC : conGrasa);
  const fmt = (t, v, o) => t.replace("{valor}", coma(v.toFixed(1)).replace(",0", "")).replace("{objetivo}", o);
  const mes = Number(D.semana.fechas[d].slice(5, 7));
  for (const x of S.lista) {
    let texto = null, aviso = false;
    if (x.dia && x.dia !== d) continue;   // semanal o quincenal: solo su día
    if (x.regla === "dia_b12" && D.semana.b12[p] === d) texto = x.motivo;
    if (x.regla === "siempre") texto = x.motivo;
    if (x.regla === "meses" && x.meses.includes(mes)) texto = x.motivo;
    if (x.regla === "sin" && !marcas.has(x.marca)) texto = x.motivo;
    if (x.regla === "ala_bajo") {
      const v = suma(delDia, 3), obj = S.ala_g[p];
      if (v < obj) texto = fmt(x.motivo, v, obj);
    }
    if (x.regla === "hierro_bajo") {
      const v = suma(delDia, 0), obj = x.hierro_mg[p];
      if (v < obj) {
        aviso = (x.solo_aviso || []).includes(p);
        texto = fmt(aviso ? x.aviso : x.motivo, v, obj);
      }
    }
    if (texto) out[x.id] = { c: momento(x.momento), texto, aviso };
  }
  return out;
}

/* Última vez que p tomó un quincenal: casilla "ya lo tomé" (c:sup:hecho:<id>:<p> = fecha, se sincroniza) y una copia
   en este móvil (nv:sup-tomados), porque el estado de la semana se borra al pasar a la siguiente. */
function tomadoEl(id, p) {
  const glob = guardado.leer("nv:sup-tomados", {}), k = `${id}:${p}`, v = valor(`c:sup:hecho:${k}`);
  if (v) glob[k] = v;
  else if (v === "" && glob[k] >= D.semana.fechas[D.semana.dias[0]]) delete glob[k];
  guardado.escribir("nv:sup-tomados", glob);
  return glob[k] || null;
}
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

/* Plan de la semana de p: [{x, dias: [{d, c, texto}], avisos: [{d, c, texto}], nota}]. Las pastillas, como mucho
   x.max_semana (los primeros días que las piden); un quincenal no sale si se tomó en los 13 días anteriores. */
function planSuplementos(p) {
  const nec = Object.fromEntries(D.semana.dias.map((d) => [d, necesidadesDia(d, p)]));
  return D.suplementos.lista.map((x) => {
    const pide = D.semana.dias.filter((d) => nec[d][x.id]).map((d) => ({ d, ...nec[d][x.id] }));
    let nota = "", dias = pide.filter((y) => !y.aviso).slice(0, x.max_semana || 7);
    if (x.frecuencia === "quincenal" && dias.length) {
      const ult = tomadoEl(x.id, p), dia = D.semana.fechas[dias[0].d];
      if (ult && ult < D.semana.fechas[D.semana.dias[0]] && diasEntre(ult, dia) < 14) {
        nota = `No toca: la tomaste el ${fecha2(ult)}.`;
        dias = [];
      }
    }
    return { x, dias, avisos: pide.filter((y) => y.aviso), nota };
  }).filter((s) => s.dias.length || s.avisos.length || s.nota);
}
const fecha2 = (iso) => { const [, m, d] = iso.split("-"); return `${Number(d)} ${MESES[Number(m) - 1]}`; };

/* Semana cerrada: c:sup:cerrada = {fecha, plan: {p: [[id, [[día, toma, texto]], [[día, toma, aviso]], nota]]}}. Se fija al
   pulsar "Cerrar semana" para que no cambie solo; "Recalcular" lo rehace con los cambios. */
const semanaCerrada = () => valor("c:sup:cerrada") || null;
function cerrarSemana() {
  const plan = Object.fromEntries(PERSONAS().map((p) => [p, planSuplementos(p).map((s) =>
    [s.x.id, s.dias.map((y) => [y.d, y.c, y.texto]), s.avisos.map((y) => [y.d, y.c, y.texto]), s.nota])]));
  poner("c:sup:cerrada", { fecha: hoyISO(), plan });
}
const supDe = (id) => D.suplementos.lista.find((x) => x.id === id) || { nombre: id, dosis: "" };

function lineaSuplementos(d, c, p) {
  const cer = semanaCerrada();
  if (!cer) return "";
  const lista = [];
  for (const [id, dias, avisos] of cer.plan[p] || []) {
    for (const [dd, cc, texto] of dias) if (dd === d && cc === c) lista.push({ id, texto, aviso: false });
    for (const [dd, cc, texto] of avisos) if (dd === d && cc === c) lista.push({ id, texto, aviso: true });
  }
  if (!lista.length) return "";
  return `<div class="suple"><span class="suple-tit">Suplementos con esta toma</span>` + lista.map(({ id, texto, aviso }) => {
    const x = supDe(id), hecho = x.frecuencia === "quincenal" && valor(`c:sup:hecho:${id}:${p}`);
    const casilla = x.frecuencia === "quincenal" && !aviso
      ? ` <button class="chip-boton ${hecho ? "si" : ""}" data-suphecho="${id}|${p}|${d}" aria-pressed="${!!hecho}">${hecho ? "✓ ya lo tomé" : "ya lo tomé"}</button>` : "";
    return `<p class="${aviso ? "aviso" : ""}"><b>${aviso ? "Ojo" : esc(x.nombre)}</b>${!aviso && x.dosis ? ` <small>${esc(x.dosis)}</small>` : ""} ${esc(texto)}${casilla}</p>`;
  }).join("") + `<span class="suple-nota">Dosis: confirmadlas con la nutri o el médico.</span></div>`;
}

/* Semana: los suplementos van en la tarjeta de cada día; abajo, el botón para cerrar o recalcular. */
function supDia(d) {
  const cer = semanaCerrada();
  if (!cer) return "";
  const lineas = PERSONAS().map((p) => {
    const ns = (cer.plan[p] || []).filter(([, dias]) => dias.some(([dd]) => dd === d)).map(([id]) => {
      const x = supDe(id);
      return esc(x.nombre) + (x.frecuencia === "quincenal" ? (valor(`c:sup:hecho:${id}:${p}`) ? " ✓" : " (cada 2 semanas)") : "");
    });
    return ns.length ? `<span class="solo"><b>${esc(D.personas[p])}:</b> ${ns.join(" · ")}</span>` : "";
  }).join("");
  return lineas ? `<p class="sup-dia"><i>Suplementos</i><span>${lineas}</span></p>` : "";
}

function pieSuplementos() {
  const cer = semanaCerrada();
  if (!cer) return `<div class="sup-pie"><p class="acomp">Cuando tengáis la semana definida, cerradla: la app reparte los
    suplementos de cada uno en los días que tocan, sin pasar de la dosis.</p>
    <div class="botones"><button class="boton lleno" data-supcerrar="1">Cerrar semana y ver suplementos</button></div></div>`;
  const notas = PERSONAS().flatMap((p) => (cer.plan[p] || []).filter(([, , , nota]) => nota)
    .map(([id, , , nota]) => `${esc(D.personas[p])}, ${esc(supDe(id).nombre)}: ${esc(nota)}`));
  return `<div class="sup-pie"><p class="acomp">Suplementos calculados el ${esc(fecha2(cer.fecha))}: salen en cada día y, en Hoy,
    en la toma que toca. Dosis: confirmadlas con la nutri o el médico.${notas.length ? "<br>" + notas.join("<br>") : ""}</p>
    <div class="botones"><button class="boton" data-supcerrar="1">Recalcular con los cambios</button>
    <button class="boton" data-supabrir="1">Reabrir la semana</button></div></div>`;
}

function tarjetaEnergia(d) {
  const tol = D.energia.tolerancia;
  const filas = PERSONAS().map((p) => {
    const k = Math.round(kcalDia(d, p)), obj = D.energia.kcal_dia[p];
    const min = Math.round(obj * (1 - tol)), max = Math.round(obj * (1 + tol));
    const e = estadoEnergia(k, p), escala = obj * 1.4;
    const pct = (x) => Math.min(100, (x / escala) * 100);
    let consejo = "";
    if (e === "corto") consejo = `Faltan unas ${min - k} kcal para el mínimo (${min}): cabe un tentempié de media mañana o media tarde.`;
    if (e === "largo") {
      const anad = TOMAS.flatMap((c) => itemsDe(d, c, p).filter((x) => x.anadido).map((x) => D.recetas[x.id].corto));
      consejo = `Sobran unas ${k - max} kcal sobre el máximo (${max}): quita ` +
        (anad.length ? `lo añadido (${anad.join(", ")}), ` : "") + "el pan o el postre de una toma, o baja el aceite.";
    }
    const sug = sugerencias(d, p, k, max);
    const hueco = obj - k;
    const bloqueSug = sug.length ? `<p class="en-sug-tit">Para completar${hueco > 0 ? ` (unas ${hueco} kcal hasta tu objetivo)` : ""}, según tus pautas:</p>
      <div class="en-sug">${sug.map(({ id, motivo }) => `<button class="enlace" data-sugerir="${esc(id)}" data-quien="${p}">
        ＋ ${esc(D.recetas[id].corto)} · ${Math.round(D.recetas[id].kcal[p])} kcal<small>${esc(motivo)}</small></button>`).join("")}</div>` : "";
    const nota = (D.pautas[p] || {}).nota;
    return `<div class="en-fila ${e}"><div class="en-cab"><b>${esc(D.personas[p])}</b><span>${k} de ${obj} kcal</span>
      <span class="chip ${e === "dentro" ? "" : "aviso"}">${e === "dentro" ? "✓ dentro" : e === "corto" ? "se queda corto" : "se pasa"}</span></div>
      <div class="barra" role="img" aria-label="${k} de ${obj} kcal"><span class="banda" style="left:${pct(min).toFixed(1)}%;width:${(pct(max) - pct(min)).toFixed(1)}%"></span>
      <span class="relleno" style="width:${pct(k).toFixed(1)}%"></span></div>
      ${consejo ? `<p class="en-consejo">${esc(consejo)}</p>` : ""}${bloqueSug}
      ${nota ? `<p class="en-nota">${esc(nota)}</p>` : ""}</div>`;
  }).join("");
  return `<section class="tarjeta energia-dia"><div class="en-titulo"><span class="etiqueta">Energía del día</span>
    <span>objetivo ±${Math.round(tol * 100)} % (banda verde)</span></div>${filas}</section>`;
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
  const batch = diasBatch().includes(d) ? batchDe(d) : [];
  if (batch.length) notas.push(`<span class="chip gris">Hoy toca batch</span> ${batch.map((x) => esc(D.recetas[x].corto)).join(" · ")}`);
  if (origen(d) !== d) notas.push(`<span class="chip aviso">Menú del ${esc(D.semana.nombre_dia[origen(d)].toLowerCase())}</span>`);
  if (Object.values(D.semana.b12).includes(d)) notas.push(`<span class="chip">B12</span> suplemento hoy`);
  const tarjetas = ORDEN_DIA.map((c) => (TOMAS.includes(c) ? tarjetaToma(d, c) : tarjetaOpcional(d, c))).join("");
  return `${aviso}${notas.length ? `<p class="nota-dia">${notas.join(" &nbsp; ")}</p>` : ""}
    <div class="tomas">${tarjetas}</div>
    ${tarjetaEnergia(d)}
    <p class="nota-dia" style="margin-top:16px"><button class="enlace" data-ir="#intercambiar/${d}">⇄ Intercambiar el menú de este día…</button></p>`;
}

function tablaIngredientes(id, solo) {
  const r = D.recetas[id], ps = solo ? [solo] : Object.keys(D.personas);
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

function cuerpoReceta(id, solo) {
  const r = D.recetas[id];
  const ps = solo ? [solo] : Object.keys(D.personas);
  const olla = r.olla ? `<h3>Para cocinar (rinde ${r.rinde} raciones${r.modo === "una_comida" ? ", una comida de los dos" : ""})</h3>
    <ul class="olla">${r.olla.map(([a, g]) => `<li>${esc(limpio(a))}: ${cantidad(g, "")}</li>`).join("")}</ul>
    <h3>Ración de cada uno</h3>` : "";
  return `${olla}${tablaIngredientes(id, solo)}
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

function selectorPara(texto) {
  const ops = [["ambos", "Los dos"], ...Object.entries(D.personas).map(([p, n]) => [p, "Solo " + n])];
  return `<div class="para"><span>${texto}</span><div class="quien" role="group">` +
    ops.map(([k, n]) => `<button data-para="${k}" class="${para === k ? "si" : ""}" aria-pressed="${para === k}">${esc(n)}</button>`).join("") +
    `</div></div>`;
}

function opcionesCambiar(d, c, i) {
  const orig = originalDe(d, c, i, persona);
  const quien = para === "ambos" ? PERSONAS() : [para];
  const actual = idDe(d, c, i, para === "ambos" ? persona : para);
  const propias = D.recetas[actual].clase === "principal" ? propiasPara(c) : [];
  const alts = [...((D.alternativas[c] || {})[actual] || []), ...propias]
    .filter((x) => x !== orig && !quien.every((p) => idDe(d, c, i, p) === x));
  const linea = (id) => PERSONAS().map((p) =>
    `${esc(D.personas[p])}: ${Math.round(D.recetas[id].kcal[p])} kcal · ${D.recetas[id].prot[p]} g proteína`).join("<br>");
  // Fruta que deja sin vitamina C una comida de legumbre o soja (regla "hierro sin vitamina C" de revisar_plan.py).
  const sinVitC = (id) => c !== "desayuno" && D.recetas[actual].clase === "postre" && quien.some((p) => {
    const otros = itemsDe(d, c, p).filter((it) => String(it.i) !== String(i)).map((it) => it.id);
    if (!otros.some((x) => D.recetas[x].fe)) return false;
    const vc = otros.reduce((n, x) => n + (D.recetas[x].n[p][2] || 0), 0);
    return vc + D.recetas[id].n[p][2] < D.energia.vit_c_min && vc + D.recetas[actual].n[p][2] >= D.energia.vit_c_min;
  });
  const op = (id, esOrig) => `<div class="alt ${esOrig ? "original" : ""}">
      <button class="alt-elegir" data-elegir="${id}">
        <b>${esOrig ? "Volver al original: " : ""}${esc(D.recetas[id].corto)}${D.recetas[id].alternativa ? ' <span class="chip gris">alternativa</span>' : ""}</b>
        <span>${linea(id)}</span>${sinVitC(id) ? '<span class="aviso-vitc">Poca vitamina C para el hierro de la legumbre: mejor naranja o fresas, o añade pimiento crudo al plato.</span>' : ""}</button>
      <button class="ver" data-ir="#receta/${id}" aria-label="Ver la receta">Ver</button></div>`;
  return `${selectorPara("Cambiar para:")}<div class="opciones">
    ${quien.some((p) => cambiado(d, c, i, p)) ? op(orig, true) : ""}${alts.map((id) => op(id)).join("")}
    ${alts.length ? "" : '<p class="acomp">No hay nada parecido en el recetario.</p>'}</div>`;
}

function elegirPlato(d, c, i, id) {
  const orig = originalDe(d, c, i, persona);
  if (para === "ambos") {
    ponerVarios([[`c:${origen(d)}:${c}:${i}`, id === orig ? "" : id],
      ...PERSONAS().filter((p) => valor(`c:${origen(d)}:${c}:${i}:${p}`)).map((p) => [`c:${origen(d)}:${c}:${i}:${p}`, ""])]);
  } else {
    const comun = valor(`c:${origen(d)}:${c}:${i}`) || orig;
    poner(`c:${origen(d)}:${c}:${i}:${para}`, id === comun ? "" : id);
  }
}

function opcionesLibre(d, c) {
  const quien = para === "ambos" ? PERSONAS() : [para];
  const libres = quien.map((p) => libreDe(d, c, p));
  const alguno = libres.some(Boolean);
  return `${selectorPara("Para:")}<div class="opciones">` +
    (alguno ? `<button class="opcion original" data-libre=""><b>Quitar libre</b><span>Vuelve lo previsto</span></button>` : "") +
    Object.entries(D.libres).map(([n, k]) => {
      const si = libres.every((l) => l && l.nombre === n);
      return `<button class="opcion ${si ? "original" : ""}" data-libre="${esc(n)}"><b>${esc(n)}${si ? " ✓" : ""}</b>` +
        `<span>Unas ${k} kcal por persona</span></button>`;
    }).join("") + `</div>`;
}

function elegirLibre(d, c, nombre) {
  if (para === "ambos") {
    ponerVarios([[`l:${origen(d)}:${c}`, nombre],
      ...PERSONAS().filter((p) => valor(`l:${origen(d)}:${c}:${p}`)).map((p) => [`l:${origen(d)}:${c}:${p}`, ""])]);
  } else {
    poner(`l:${origen(d)}:${c}:${para}`, nombre || "-");
  }
}

function vistaItem(d, c, i) {
  cabecera(`<button class="flecha" data-volver="#hoy/${d}" aria-label="Volver">‹</button>`,
    NOMBRE_TOMA[c], `${D.semana.nombre_dia[d]} ${fecha(d)}`);
  if (esAnadido(i)) return fichaAnadido(d, c, String(i).slice(1));
  const existe = esFijo(i) ? !!fijosDe(c, persona)[Number(String(i).slice(1))] : !!(toma(d, c) && toma(d, c).items && toma(d, c).items[i]);
  if (!existe) return `<p class="vacio">No está en el menú.</p>`;
  const id = idDe(d, c, i, persona), o = otra(persona);
  const idO = aplica(d, c, i, o) && !libreDe(d, c, o) ? idDe(d, c, i, o) : null;
  const distinto = idO && idO !== id;
  const r = D.recetas[id];
  const quitadoPara = PERSONAS().filter((p) => aplica(d, c, i, p) && quitado(d, c, i, p));
  return `<div class="ficha"><span class="chip gris">${rol(id, c)}</span><h2>${esc(r.nombre)}</h2>
    <div class="meta">${esc(metaReceta(id))}${chipsReceta(id, d, c, i)}</div>
    ${distinto ? `<p class="otro-toma">${esc(D.personas[o])} come otra cosa:
      <button class="volver" data-ir="#receta/${idO}">${esc(D.recetas[idO].corto)} ›</button></p>` : ""}
    ${quitadoPara.length ? `<p class="aviso-semana">Quitado para ${esc(quitadoPara.map((p) => D.personas[p]).join(" y "))}.</p>` : ""}
    <div class="botones"><button class="boton ${panel === "cambiar" ? "abierto" : ""}" data-panel="cambiar">Cambiar</button>
      <button class="boton ${panel === "quitar" ? "abierto" : ""}" data-panel="quitar">${quitadoPara.length ? "Quitar o poner" : "Quitar"}</button>
      ${r.clase === "principal" ? `<button class="boton" data-ir="#libre/${d}/${c}">Toma libre</button>` : ""}</div>
    ${panel === "cambiar" ? opcionesCambiar(d, c, i) : ""}
    ${panel === "quitar" ? `${selectorPara("Para:")}<div class="botones">
      ${(para === "ambos" ? PERSONAS() : [para]).every((p) => quitado(d, c, i, p))
        ? `<button class="boton lleno" data-quitarplato="">Volver a ponerlo</button>`
        : `<button class="boton lleno" data-quitarplato="1">Quitar de la toma</button>`}</div>
      <p class="acomp">Sale de la energía del día y de la compra. Para cambiarlo por otro, mejor "Cambiar" o "＋ Añadir" en la toma.</p>` : ""}
    <div class="cabeza" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
      <h3 style="margin:0">Ingredientes</h3>${interruptor()}</div>
    ${cuerpoReceta(id, distinto ? persona : null)}</div>`;
}

function fichaAnadido(d, c, id) {
  const a = anadidos(d, c).find((x) => x.id === id);
  if (!a) return `<p class="vacio">Ya no está en el menú.</p>`;
  const r = D.recetas[id];
  return `<div class="ficha"><span class="chip aviso">añadido</span><h2>${esc(r.nombre)}</h2>
    <div class="meta">${esc(metaReceta(id))} · para ${esc(a.quien.map((p) => D.personas[p]).join(" y "))}</div>
    ${selectorPara("Quitar para:")}
    <div class="botones"><button class="boton" data-quitar="${esc(id)}">Quitar</button></div>
    <div class="cabeza" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
      <h3 style="margin:0">Ingredientes</h3>${interruptor()}</div>
    ${cuerpoReceta(id, a.quien.length === 1 ? a.quien[0] : null)}</div>`;
}

function cambiarAnadido(d, c, id, poner_, personas) {
  const k = `c:${origen(d)}:${c}:+${id}`;
  const quien = new Set(String(valor(k) || "").split(",").filter(Boolean));
  (personas || (para === "ambos" ? PERSONAS() : [para])).forEach((p) => (poner_ ? quien.add(p) : quien.delete(p)));
  poner(k, PERSONAS().filter((p) => quien.has(p)).join(","));
}

const norm = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/* Añadir un plato a la toma: primero lo que acompaña bien a esa toma; cada opción dice cómo queda el día. */
function vistaAnadir(d, c) {
  cabecera(`<button class="flecha" data-volver="#hoy/${d}" aria-label="Volver">‹</button>`,
    `Añadir: ${NOMBRE_TOMA[c].toLowerCase()}`, `${D.semana.nombre_dia[d]} ${fecha(d)}`);
  const fijos = new Set(PERSONAS().flatMap((p) => Object.values(D.semana.fijos[p] || {}).flat()));
  const quien = para === "ambos" ? PERSONAS() : [para];
  const ya = new Set(quien.flatMap((p) => idsToma(d, c, p)));
  const vale = (r) => (c === "desayuno" ? r.momentos.includes("desayuno") || (r.clase === "postre" && r.tipo === "complemento")
    : OPCIONALES.includes(c) ? r.momentos.includes(c) || r.tipo === "snack"
    : r.momentos.some((m) => ["comida", "cena", "media_tarde"].includes(m)));
  const ids = Object.keys(D.recetas).filter((id) => !id.includes("~") && !fijos.has(id) && !ya.has(id))
    .sort((a, b) => D.recetas[a].corto.localeCompare(D.recetas[b].corto, "es"));
  const sugeridos = ids.filter((id) => vale(D.recetas[id]) && (D.recetas[id].clase !== "principal" || OPCIONALES.includes(c)));
  const otros = ids.filter((id) => !sugeridos.includes(id));
  const k0 = Object.fromEntries(PERSONAS().map((p) => [p, kcalDia(d, p)]));
  const fr0 = Object.fromEntries(PERSONAS().map((p) => [p, frutasDia(d, p)]));
  const fila = (id) => {
    const r = D.recetas[id];
    const pred = quien.map((p) => {
      if (libreDe(d, c, p)) return `${esc(D.personas[p])}: tiene la toma libre`;
      const k1 = k0[p] + r.kcal[p], e = estadoEnergia(k1, p);
      return `<span class="${e === "dentro" ? "ok" : "mal"}">${esc(D.personas[p])}: +${Math.round(r.kcal[p])} kcal → ` +
        `${Math.round(k1)} ${e === "dentro" ? "✓ dentro" : e === "largo" ? "· se pasa" : "· aún corto"}` +
        (r.frutas && fr0[p] + r.frutas > D.energia.frutas_max ? ` · más de ${D.energia.frutas_max} frutas` : "") + "</span>";
    }).join("<br>");
    return `<button class="opcion fila-anadir" data-anadir="${esc(id)}" data-nombre="${esc(norm(r.nombre + " " + r.corto))}">
      <b>${esc(r.corto)} <span class="chip gris">${rol(id, c)}</span></b><span>${pred}</span></button>`;
  };
  return `<div class="ficha">${selectorPara("Añadir para:")}
    <label class="campo">Buscar<input id="buscar" type="search" autocomplete="off" placeholder="zumo, pan, yogur…"></label>
    ${sugeridos.length ? `<h3>Para acompañar</h3><div class="opciones">${sugeridos.map(fila).join("")}</div>` : ""}
    <h3>Otros platos</h3><div class="opciones">${otros.map(fila).join("")}</div></div>`;
}

/* ---------- Saltar una toma ---------- */
/* Dónde se recupera la energía: [tentempié, toma que se refuerza]. */
const SALTAR_A = { desayuno: ["media_manana", "comida"], comida: ["media_tarde", "cena"], cena: ["media_tarde", "comida"] };
/* Tentempiés con proteína y complementos para reforzar (sin huevo, para no pasar de 2 por toma: regla HUE-1). */
const CON_PROTEINA = ["tupper_yogur_proteico", "altramuces", "edamame_vaina", "n_hummus_edamame", "nutri_yogur_cacao"];
const REFUERZO = ["pan_integral", "hummus_casero_usuario", "postre_yogur_soja_caqui", "edamame_vaina", "naranja", "nutri_yogur_cacao", "pera", "biscote_integral"];

/* Platos que se añaden en la toma c2 para que el día de p vuelva a la banda de energía: la misma previsión de kcal que
   "＋ Añadir" y la tarjeta Energía del día (kcalDia), sin pasar del máximo ni de las frutas del día. */
function rellenar(d, c2, p, candidatos) {
  const obj = D.energia.kcal_dia[p], tol = D.energia.tolerancia, min = obj * (1 - tol), max = obj * (1 + tol);
  let k = kcalDia(d, p), fr = frutasDia(d, p);
  const ya = new Set(idsToma(d, c2, p)), ids = [];
  for (const id of candidatos) {
    const r = D.recetas[id];
    if (k >= min || ids.length >= 5) break;
    if (!r || ya.has(id) || ids.includes(id) || k + r.kcal[p] > max) continue;
    if (r.frutas && fr + r.frutas > D.energia.frutas_max) continue;
    ids.push(id); k += r.kcal[p]; fr += r.frutas || 0;
  }
  return { ids, k, ok: estadoEnergia(k, p) === "dentro" };
}

function opcionesReparto(d, c, p) {
  const [tent, ref] = SALTAR_A[c];
  const max = D.energia.kcal_dia[p] * (1 + D.energia.tolerancia), k = kcalDia(d, p);
  const sug = sugerencias(d, p, k, max).map((x) => x.id);
  const ops = [
    [tent, `Tentempié a ${NOMBRE_TOMA[tent].toLowerCase()}`, rellenar(d, tent, p, [...CON_PROTEINA, ...sug])],
    ...(libreDe(d, ref, p) ? [] : [[ref, `Reforzar la ${NOMBRE_TOMA[ref].toLowerCase()}`, rellenar(d, ref, p, REFUERZO)]]),
  ];
  return ops.filter(([, , x]) => x.ids.length).map(([c2, titulo, x]) => `<button class="opcion" data-reparto="${c2}|${p}|${x.ids.join(",")}">
    <b>${esc(titulo)}</b><span>＋ ${x.ids.map((id) => `${esc(D.recetas[id].corto)} (${Math.round(D.recetas[id].kcal[p])} kcal)`).join(" + ")}</span>
    <span class="${x.ok ? "ok" : "mal"}">El día queda en ${Math.round(x.k)} kcal ${x.ok ? "✓ dentro" : "· aún corto"}</span></button>`).join("");
}

function vistaSaltar(d, c) {
  cabecera(`<button class="flecha" data-volver="#hoy/${d}" aria-label="Volver">‹</button>`,
    `Saltar ${NOMBRE_TOMA[c].toLowerCase()}`, `${D.semana.nombre_dia[d]} ${fecha(d)}`);
  const quien = para === "ambos" ? PERSONAS() : [para];
  const todas = quien.every((p) => saltada(d, c, p));
  const estado = PERSONAS().map((p) => `<b>${esc(D.personas[p])}</b>: ${saltada(d, c, p) ? "la salta" : "la toma"}`).join(" · ");
  // Lo cocinado de batch u olla que no se come: aviso para aprovecharlo.
  const sobras = [...new Set(PERSONAS().filter((p) => saltada(d, c, p)).flatMap((p) => {
    const l = libreDe(d, c, p); return l && l.saltada ? itemsDe(d, c, p).map((x) => x.id) : [];
  }).filter((id) => D.recetas[id].batch || D.recetas[id].rinde))];
  const reparto = PERSONAS().filter((p) => saltada(d, c, p)).map((p) => {
    const ops = opcionesReparto(d, c, p);
    return `<h3>${esc(D.personas[p])}: ${Math.round(kcalDia(d, p))} de ${D.energia.kcal_dia[p]} kcal</h3>
      ${estadoEnergia(kcalDia(d, p), p) === "dentro" ? '<p class="acomp">El día ya está dentro de la banda: no hace falta nada.</p>'
        : ops ? `<p class="acomp">Elige una forma de repartir lo que falta:</p><div class="opciones">${ops}</div>`
        : '<p class="acomp">No hay nada que quepa sin pasarse: mira la tarjeta Energía del día.</p>'}`;
  }).join("");
  return `<div class="ficha"><h2>Saltar ${NOMBRE_TOMA[c].toLowerCase()}</h2>
    <p class="meta">${estado}</p>
    <p class="acomp">Para casos puntuales: la compra no cambia y lo cocinado se aprovecha.</p>
    ${selectorPara("Saltar para:")}
    <div class="botones"><button class="boton ${todas ? "" : "lleno"}" data-saltar="${todas ? "" : "1"}">${todas ? "Deshacer: sí la toma" : "Saltar esta toma"}</button></div>
    ${sobras.length ? `<p class="aviso-semana">La ración de ${esc(lista(sobras.map((id) => D.recetas[id].corto)))} queda para mañana o al congelador.</p>` : ""}
    ${reparto}</div>`;
}

function saltar(d, c, si) {
  const k = `c:${origen(d)}:${c}:saltar`, quien = new Set(String(valor(k) || "").split(",").filter(Boolean));
  (para === "ambos" ? PERSONAS() : [para]).forEach((p) => (si ? quien.add(p) : quien.delete(p)));
  poner(k, PERSONAS().filter((p) => quien.has(p)).join(","));
}

/* Intercambiar el menú completo de dos días (para los dos). */
function vistaIntercambiar(d) {
  cabecera(`<button class="flecha" data-volver="#hoy/${d}" aria-label="Volver">‹</button>`,
    "Intercambiar día", `${D.semana.nombre_dia[d]} ${fecha(d)}`);
  const dias = D.semana.dias, nd = (x) => D.semana.nombre_dia[x].toLowerCase();
  const resumen = (x) => TOMAS.map((c) => {
    const lib = libreDe(x, c, persona);
    if (lib) return `libre (${lib.nombre})`;
    return idsToma(x, c, persona).filter((id) => D.recetas[id].clase === "principal").map((id) => D.recetas[id].corto).join(" + ");
  }).filter(Boolean).join(" · ");
  const hay = dias.some((x) => origen(x) !== x);
  return `<div class="ficha"><h2>Intercambiar el ${nd(d)} con…</h2>
    <p class="acomp">Se cambian los menús completos de los dos, con lo que hayáis cambiado o añadido. La fecha, la B12 y
      los días de batch se quedan donde están; la lista del batch se rehace sola.</p>
    <p class="acomp"><b>Ahora el ${nd(d)}:</b> ${esc(resumen(d))}</p>
    <div class="opciones">${dias.filter((x) => x !== d).map((x) => `<button class="opcion" data-intercambiar="${x}">
      <b>${D.semana.nombre_dia[x]} ${fecha(x)}${origen(x) !== x ? ` <span class="chip gris">menú del ${nd(origen(x))}</span>` : ""}</b>
      <span>${esc(resumen(x))}</span></button>`).join("")}</div>
    ${hay ? `<div class="botones"><button class="boton" data-intercambiar="">Deshacer todos los intercambios</button></div>` : ""}</div>`;
}

function intercambiar(d1, d2) {
  if (!d2) {
    ponerVarios(D.semana.dias.filter((x) => valor(`c:${x}:orden`)).map((x) => [`c:${x}:orden`, ""]));
    return;
  }
  const o1 = origen(d1), o2 = origen(d2);
  ponerVarios([[`c:${d1}:orden`, o2 === d1 ? "" : o2], [`c:${d2}:orden`, o1 === d2 ? "" : o1]]);
}

function vistaLibre(d, c) {
  cabecera(`<button class="flecha" data-volver="#hoy/${d}" aria-label="Volver">‹</button>`,
    `${NOMBRE_TOMA[c]} libre`, `${D.semana.nombre_dia[d]} ${fecha(d)}`);
  const principal = TOMAS.includes(c);
  const estado = PERSONAS().map((p) => {
    const l = libreDe(d, c, p);
    return `<b>${esc(D.personas[p])}</b>: ${l ? `libre (${esc(l.nombre)})` : "lo previsto"}`;
  }).join(" · ");
  const previsto = principal ? idsToma(d, c, persona) : (D.semana.opcionales[c] || []);
  return `<div class="ficha"><h2>Toma libre</h2>
    <p class="meta">${estado}</p>
    <p class="acomp">${principal ? "Lo libre sale de la compra de quien lo tome y su energía se estima." : "Su energía se suma al día."}</p>
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
  // Lo que comen los dos en una línea; debajo, dentro de la toma, lo distinto de cada uno.
  const celda = (d, c) => {
    const ps = PERSONAS(), t = toma(d, c) || { items: [] };
    const lib = Object.fromEntries(ps.map((p) => [p, libreDe(d, c, p)]));
    const de = (p, i) => ((t.items[i].p === "ambos" || t.items[i].p === p) && !quitado(d, c, i, p) ? idDe(d, c, i, p) : null);
    const comun = [], solo = Object.fromEntries(ps.map((p) => [p, []]));
    if (ps.every((p) => lib[p]) && ps.every((p) => lib[p].nombre === lib[ps[0]].nombre)) {
      comun.push(`<span class="chip aviso">libre</span> ${esc(lib[ps[0]].nombre)}`);
    } else {
      t.items.forEach((_, i) => {
        const ids = ps.map((p) => (lib[p] ? null : de(p, i)));
        if (ids.every((x) => x && x === ids[0])) comun.push(esc(D.recetas[ids[0]].corto));
        else ps.forEach((p, k) => { if (ids[k]) solo[p].push(esc(D.recetas[ids[k]].corto)); });
      });
      huecosFijos(c).filter((i) => ps.some((p) => cambiado(d, c, i, p))).forEach((i) => {
        const ids = ps.map((p) => (!lib[p] && aplica(d, c, i, p) && !quitado(d, c, i, p) ? idDe(d, c, i, p) : null));
        if (ids.every((x) => x && x === ids[0])) comun.push(esc(D.recetas[ids[0]].corto));
        else ps.forEach((p, k) => { if (ids[k]) solo[p].push(esc(D.recetas[ids[k]].corto)); });
      });
      anadidos(d, c).forEach((a) => {
        const ids = ps.map((p) => (!lib[p] && a.quien.includes(p) ? a.id : null));
        if (ids.every((x) => x)) comun.push(esc(D.recetas[a.id].corto));
        else ps.forEach((p, k) => { if (ids[k]) solo[p].push(esc(D.recetas[a.id].corto)); });
      });
      ps.forEach((p) => { if (lib[p]) solo[p] = [`libre (${esc(lib[p].nombre)})`]; });
    }
    const lineas = ps.filter((p) => solo[p].length)
      .map((p) => `<span class="solo"><b>${esc(D.personas[p])}:</b> ${solo[p].join(" + ")}</span>`).join("");
    const marca = (nCambiados(d, c) || anadidos(d, c).length) && !lineas ? ' <span class="chip aviso">cambiado</span>' : "";
    return `<span>${comun.join(" + ") || (lineas ? "" : "–")}${marca}${lineas}</span>`;
  };
  const kcal = (d) => `<p class="kcal-dia">` + PERSONAS().map((p) => {
    const k = Math.round(kcalDia(d, p)), obj = D.energia.kcal_dia[p];
    const fuera = Math.abs(k / obj - 1) > D.energia.tolerancia;
    return `<span class="${fuera ? "mal" : ""}">${esc(D.personas[p])} ${k}</span>`;
  }).join(" · ") + ` kcal</p>`;
  const batch = diasBatch().map((d) => [d, batchDe(d)]).filter(([, ids]) => ids.length).map(([d, ids]) =>
    `<span class="chip gris">Batch ${esc(D.semana.nombre_dia[d].toLowerCase())}</span> ${ids.map((x) => esc(D.recetas[x].corto)).join(" · ")}`);
  const opc = [...new Set(OPCIONALES.flatMap((c) => D.semana.opcionales[c] || []))];
  return `${batch.length ? `<p class="nota-dia">${batch.join("<br>")}</p>` : ""}
    <div class="semana">${dias.map((d) => `<button class="tarjeta dia ${esHoy(d) ? "hoy" : ""}" data-ir="#hoy/${d}">
      <h3>${D.semana.nombre_dia[d]} ${fecha(d)}${esHoy(d) ? ' <span class="chip">hoy</span>' : ""}${origen(d) !== d
        ? ` <span class="chip gris">menú del ${esc(D.semana.nombre_dia[origen(d)].toLowerCase())}</span>` : ""}</h3>
      ${TOMAS.map((c) => `<p><i>${NOMBRE_TOMA[c]}</i> ${celda(d, c)}</p>`).join("")}${supDia(d)}${kcal(d)}</button>`).join("")}</div>
    ${pieSuplementos()}
    ${opc.length ? `<p class="nota-dia" style="margin-top:12px"><span class="chip gris">Si tenéis hambre</span> ${opc.map((x) => esc(D.recetas[x].corto)).join(" · ")}</p>` : ""}
    <p class="nota-dia"><button class="enlace" data-ir="#ajustes">Sincronizar</button> <span class="estado-sync">${esc(Sync.texto())}</span></p>`;
}

/* ---------- Pestaña Batch ---------- */
const BASES_ORDEN = ["horno", "sofrito", "legumbre", "cereal", "proteina", "salsa", "momento", "otros"];
const pocoTiempo = (d) => !!valor(`c:batch:poco:${d}`);
const nd = (d) => D.semana.nombre_dia[d].toLowerCase();
const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs.join(""));

/* Bases sumadas del batch b: {base: {alimento: {g, por: {id: g}}}} (bases de 03_datos/bases_batch.json). */
function basesBatch(b) {
  const out = {};
  for (const u of usosBatch(b)) for (const [a, g] of D.recetas[u.id].raciones[u.p]) {
    const base = (D.recetas[u.id].bb || {})[a] || "momento";
    const x = ((out[base] = out[base] || {})[a] = out[base][a] || { g: 0, por: {} });
    x.g += g;
    x.por[u.id] = (x.por[u.id] || 0) + g;
  }
  return out;
}

/* Tareas en paralelo según el equipo: horno, dos fuegos de vitro, airfryer y microondas. Tiempos orientativos. */
function tareasBatch(bases) {
  const nom = (base) => Object.keys(bases[base] || {}).map((a) => limpio(a).toLowerCase());
  const gr = (base) => Object.entries(bases[base] || {}).map(([a, x]) => `${limpio(a).toLowerCase()} ${f0(x.g)} g`);
  const t = [];
  if (bases.horno) t.push(["Horno", 35, `Horno a 200 °C: ${lista(gr("horno"))}. Va primero porque es lo más largo.`]);
  if (bases.sofrito) t.push(["Fuego 1", 20, `Sofrito único en la sartén grande: ${lista(gr("sofrito"))}. Al final, repartirlo (arriba).`]);
  if (bases.salsa) t.push(["Fuego 1", 15, `Salsas, cada una con su parte del sofrito: ${lista(nom("salsa"))}.`]);
  if (bases.legumbre) {
    const ls = Object.keys(bases.legumbre);
    const secas = ls.filter((a) => /seca|seco/.test(a)), bote = ls.filter((a) => /cocid|bote/.test(a));
    const cong = ls.filter((a) => /congelad/.test(a));
    if (secas.length) t.push(["Fuego 2", secas.every((a) => /roja/.test(a)) ? 20 : 40,
      `Cocer ${lista(secas.map((a) => limpio(a).toLowerCase()))}${secas.some((a) => !/lenteja/i.test(a)) ? " (en remojo desde la noche antes)" : ""}.`]);
    if (bote.length) t.push(["Fuego 2", 5, `Escurrir y enjuagar ${lista(bote.map((a) => limpio(a).toLowerCase()))}.`]);
    if (cong.length) t.push(["Microondas", 5, `${lista(cong.map((a) => limpio(a)))} al microondas con un poco de agua, 4-5 min.`]);
  }
  if (bases.cereal) t.push(["Fuego 2", 18, `Cocer ${lista(gr("cereal"))} (pesos en crudo).`]);
  if (bases.proteina) t.push(["Airfryer", 15, `Airfryer a 200 °C: ${lista(nom("proteina"))} en dados, dorados (la soja texturizada, hidratada antes 10 min).`]);
  const fin = {};
  const tareas = t.map(([zona, min, texto]) => { const ini = fin[zona] || 0; fin[zona] = ini + min; return { zona, ini, min, texto }; });
  tareas.sort((a, b) => a.ini - b.ini);
  return { tareas, total: Math.max(0, ...Object.values(fin)) + 15 };
}

/* Dónde va cada plato: nevera si aguanta hasta el día que se come; si no, congelador u otro batch. */
function destinos(b) {
  const dias = D.semana.dias, por = {};
  for (const u of usosBatch(b)) (por[u.id] = por[u.id] || new Set()).add(u.d);
  return Object.entries(por).map(([id, ds]) => {
    const [nevera, congela] = D.recetas[id].conserva || [3, false];
    const lejos = [...ds].filter((d) => dias.indexOf(d) - dias.indexOf(b) > nevera);
    const texto = !lejos.length ? `nevera (aguanta ${nevera} días)`
      : congela ? `nevera, y la del ${lista(lejos.map(nd))} al congelador (sacarla la noche antes)`
      : `no aguanta hasta el ${lista(lejos.map(nd))}: cocinarlo ese día o en otro batch`;
    const r = D.recetas[id], comidas = usosBatch(b).filter((u) => u.id === id).length / PERSONAS().length;
    const sobra = r.rinde && comidas < r.rinde / 2 ? `. Rinde para ${r.rinde / 2} comidas de los dos y aquí se usan ${comidas}: ` +
      `lo que sobra, ${congela ? "al congelador" : `para otra comida antes de ${nevera} días`}` : "";
    return { id, dias: [...ds], texto: texto + sobra, mal: lejos.length && !congela };
  });
}

/* Lo que queda cada día: calentar lo del batch y añadir lo de al momento; lo que no es de batch, cocinarlo. */
function paraTerminar(d) {
  const out = [];
  const conBatch = diasBatch().some((b) => tramo(b).includes(d));
  for (const c of ["comida", "cena"]) {
    const ids = [...new Set(PERSONAS().flatMap((p) => (libreDe(d, c, p) ? [] : idsToma(d, c, p))))]
      .filter((id) => ["principal", "acompanamiento"].includes(D.recetas[id].clase));
    for (const id of ids) {
      const r = D.recetas[id];
      if (r.batch && conBatch) {
        const mom = Object.entries(r.bb || {}).filter(([, b]) => b === "momento").map(([a]) => limpio(a).toLowerCase());
        out.push(`<b>${NOMBRE_TOMA[c]}:</b> calentar ${esc(r.corto)}${mom.length ? ` y añadir ${esc(lista(mom))}` : ""}`);
      } else {
        out.push(`<b>${NOMBRE_TOMA[c]}:</b> cocinar ${esc(r.corto)}${r.min ? ` (${r.min} min)` : ""}${r.rapida ? ' <span class="chip">rápida</span>' : ""}`);
      }
    }
  }
  return out;
}

function vistaBatch() {
  cabecera("", "Batch", `semana del ${fecha(D.semana.dias[0])}`);
  const dias = D.semana.dias, bs = diasBatch();
  // 1. Platos de la semana (comida y cena), con los días de poco tiempo.
  const platos = dias.map((d) => {
    const filas = ["comida", "cena"].map((c) => {
      if (PERSONAS().every((p) => libreDe(d, c, p))) return `<p><i>${NOMBRE_TOMA[c]}</i> libre</p>`;
      const t = toma(d, c) || { items: [] };
      return t.items.map((it, i) => ({ i, id: idDe(d, c, i, persona) })).filter((x) => D.recetas[x.id].clase === "principal")
        .map(({ i, id }) => {
          const r = D.recetas[id];
          const chips = (r.batch ? ' <span class="chip gris">batch</span>' : "") + (r.rapida ? ' <span class="chip">rápida</span>' : "") +
            (r.min ? ` <small>${r.min} min</small>` : "");
          let prop = "";
          if (pocoTiempo(d) && !r.batch && !r.rapida) {
            const alts = ((D.alternativas[c] || {})[id] || []).filter((x) => D.recetas[x].rapida || D.recetas[x].batch).slice(0, 4);
            prop = `<div class="b-prop"><span>Poco tiempo: mejor una rápida o algo del batch.</span>${alts.map((x) =>
              `<button class="enlace" data-belegir="${d}|${c}|${i}|${x}">→ ${esc(D.recetas[x].corto)}${D.recetas[x].rapida ? " (rápida)" : " (batch)"}</button>`).join("")}</div>`;
          }
          return `<p><i>${NOMBRE_TOMA[c]}</i> <button class="enlace" data-ir="#item/${d}/${c}/${i}">${esc(r.corto)}</button>${chips}${prop}</p>`;
        }).join("");
    }).join("");
    return `<div class="b-dia ${bs.includes(d) ? "es-batch" : ""}"><div class="b-dia-cab"><b>${D.semana.nombre_dia[d]} ${fecha(d)}</b>
      <button class="chip-boton ${pocoTiempo(d) ? "si" : ""}" data-poco="${d}" aria-pressed="${pocoTiempo(d)}">poco tiempo</button></div>${filas}</div>`;
  }).join("");
  // 2. Días de batch.
  const selector = `<div class="b-dias">${dias.map((d) => `<button class="chip-boton ${bs.includes(d) ? "si" : ""}" data-bdia="${d}"
    aria-pressed="${bs.includes(d)}">${D.semana.nombre_dia[d].slice(0, 3)}</button>`).join("")}
    <button class="chip-boton ${valor("c:batch:dias") === "-" ? "si" : ""}" data-bdia="-">sin batch</button></div>`;
  // 3. El plan de cada día de batch.
  const planes = bs.map((b) => {
    const bases = basesBatch(b), ids = batchDe(b);
    if (!ids.length) return `<section class="tarjeta b-plan"><h3>Batch del ${nd(b)}</h3><p class="acomp">No hay platos de batch en su tramo.</p></section>`;
    const { tareas, total } = tareasBatch(bases);
    const bloques = BASES_ORDEN.filter((x) => bases[x] && x !== "otros").map((x) => {
      const filas = Object.entries(bases[x]).sort((p, q) => q[1].g - p[1].g);
      const reparto = ids.filter((id) => filas.some(([, v]) => v.por[id])).map((id) =>
        `${esc(D.recetas[id].corto)} ${f0(filas.reduce((n, [, v]) => n + (v.por[id] || 0), 0))} g`);
      return `<div class="b-base"><h4>${esc(D.bases[x] || x)}</h4><p>${filas.map(([a, v]) => `${esc(limpio(a))} ${f0(v.g)} g`).join(" · ")}</p>
        ${x === "momento" ? '<p class="acomp">No se cocina en el batch: se añade cada día.</p>'
          : reparto.length > 1 ? `<p class="acomp">Repartir: ${reparto.join(" · ")}</p>` : ""}</div>`;
    }).join("");
    const orden = tareas.map((t) => `<li><span class="chip gris">${esc(t.zona)}</span> <small>min ${t.ini}-${t.ini + t.min}</small> ${esc(t.texto)}</li>`).join("");
    const dest = destinos(b).map((x) => `<li class="${x.mal ? "mal" : ""}"><b>${esc(D.recetas[x.id].corto)}</b> (${esc(lista(x.dias.map(nd)))}): ${esc(x.texto)}</li>`).join("");
    const fin = tramo(b).map((d) => { const l = paraTerminar(d); return l.length ? `<p><b>${D.semana.nombre_dia[d]}</b><br>${l.join("<br>")}</p>` : ""; }).join("");
    return `<section class="tarjeta b-plan"><h3>Batch del ${nd(b)} <small>unos ${total} min · ${ids.length} plato${ids.length > 1 ? "s" : ""} para ${esc(lista(tramo(b).map(nd)))}</small></h3>
      <p class="acomp">${ids.map((id) => esc(D.recetas[id].corto)).join(" · ")}</p>
      <h4>Bases sumadas</h4>${bloques}
      <h4>Orden de tareas</h4><ol class="b-tareas">${orden}<li><span class="chip gris">Final</span> Montar cada plato con su parte, tuppers y etiquetas (15 min).</li></ol>
      <h4>Dónde va cada cosa</h4><ul class="b-dest">${dest}</ul>
      <h4>Para terminar cada día (unos 10 min)</h4><div class="b-fin">${fin}</div></section>`;
  }).join("");
  const sueltos = dias.filter((d) => !bs.some((b) => tramo(b).includes(d)));
  const sinBatch = sueltos.length ? `<section class="tarjeta b-plan"><h3>Días sin batch</h3><div class="b-fin">${sueltos.map((d) =>
    `<p><b>${D.semana.nombre_dia[d]}</b><br>${paraTerminar(d).join("<br>")}</p>`).join("")}</div></section>` : "";
  return `<div class="ficha"><h2>1. Platos de la semana</h2>
    <p class="acomp">Marca los días con poco tiempo y te propone rápidas o algo del batch. Toca un plato para cambiarlo.</p>
    <div class="b-semana">${platos}</div>
    <h2>2. Días de batch</h2><p class="acomp">Cada batch cocina hasta el siguiente. Por defecto, los de la plantilla.</p>${selector}
    <h2>3. El plan</h2></div>${planes}${sinBatch}`;
}

/* ---------- Pestaña Crear receta (fase 4c) ---------- */
/* Sumas comunes: nutrientes de una lista [[alimento, g]] con la tabla por 100 g de datos.json (los mismos valores que
   usan fichas.py y revisar_plan.sumar(), en el orden de reglas.campos), más la lactosa. */
function sumaNut(lista) {
  const C = D.reglas.campos, t = Object.fromEntries(C.map((c) => [c, 0]));
  t.lactosa = 0;
  for (const [a, g] of lista) {
    const x = D.alimentos[a];
    if (!x) continue;
    C.forEach((c, i) => { t[c] += (x.n[i] * g) / 100; });
    t.lactosa += ((x.l || 0) * g) / 100;
  }
  return t;
}

/* Parte de cada uno en una receta que rinde n raciones: la misma regla que la olla de fichas.py (con_olla). */
function partes(tipo, n) {
  const t = tipo === "desayuno" ? "desayuno" : "plato";
  const obj = Object.fromEntries(PERSONAS().map((p) => [p, D.reglas.ficha[p][t].kcal]));
  const tot = Object.values(obj).reduce((a, b) => a + b, 0);
  return Object.fromEntries(PERSONAS().map((p) => [p, (2 / n) * (obj[p] / tot)]));
}

const r1 = (x) => Math.round(x * 10) / 10;
const tipoDe = (toma) => (toma === "desayuno" ? "desayuno" : "plato");

/* Receta propia -> entrada de D.recetas, como las de exportar_app.py (raciones, kcal, n, bases...). */
function recetaPropia(slug, x) {
  const parte = partes(tipoDe(x.toma), x.raciones);
  const raciones = Object.fromEntries(PERSONAS().map((p) => [p, x.ing.map(([a, g]) => [a, r1(g * parte[p]), ""])]));
  const tot = Object.fromEntries(PERSONAS().map((p) => [p, sumaNut(raciones[p])]));
  return {
    nombre: x.nombre, corto: x.nombre, tipo: tipoDe(x.toma), clase: "principal",
    momentos: x.toma === "desayuno" ? ["desayuno"] : x.toma === "ambas" ? ["comida", "cena"] : [x.toma],
    min: x.min || null, alternativa: false, batch: !!x.batch, rapida: !!x.min && x.min <= 20, propia: true,
    frutas: x.ing.filter(([a, g]) => (D.alimentos[a] || {}).g === "fruta" && g * parte[PERSONAS()[0]] >= 50).length,
    n: Object.fromEntries(PERSONAS().map((p) => [p, ["hierro_mg", "calcio_mg", "vit_c_mg", "ala_g", "grasa"].map((c) => r1(tot[p][c]))])),
    marcas: [], pasos: x.pasos || [], mejoras: [],
    raciones, kcal: Object.fromEntries(PERSONAS().map((p) => [p, r1(tot[p].kcal)])),
    prot: Object.fromEntries(PERSONAS().map((p) => [p, Math.round(tot[p].proteina)])),
    bb: Object.fromEntries(x.ing.map(([a]) => [a, (D.alimentos[a] || {}).b || "momento"])),
    conserva: [3, false], olla: x.ing, rinde: x.raciones, modo: "raciones",
  };
}

/* Recetas propias guardadas: c:receta:<slug> en la semana (se sincroniza) y una copia en este móvil (nv:propias),
   para que sigan al cambiar de semana. Se registran en D.recetas como "propia:<slug>". */
function propiasGuardadas() {
  const glob = guardado.leer("nv:propias", {});
  for (const k of Object.keys(E)) if (k.startsWith("c:receta:")) {
    const slug = k.slice(9);
    if (E[k].v) glob[slug] = E[k].v; else delete glob[slug];
  }
  return glob;
}
function registrarPropias() {
  if (!D || !D.alimentos) return;
  for (const id of Object.keys(D.recetas)) if (id.startsWith("propia:")) delete D.recetas[id];
  const todas = propiasGuardadas();
  for (const [slug, x] of Object.entries(todas)) {
    if (x && x.ing && x.ing.every(([a]) => D.alimentos[a])) D.recetas["propia:" + slug] = recetaPropia(slug, x);
  }
  guardado.escribir("nv:propias", todas);
}
const propiasPara = (c) => Object.keys(D.recetas).filter((id) => id.startsWith("propia:") && D.recetas[id].momentos.includes(c));

/* Recomendaciones: reglas fijas, iguales que avisos_toma() de scripts/revisar_plan.py y las de reglas_mejora.md.
   Cada una dice qué pasa y, si se puede, cómo arreglarlo con un botón (aplicar -> nueva lista de ingredientes). */
function avisosReceta(x) {
  const R = D.reglas, tipo = tipoDe(x.toma), parte = partes(tipo, x.raciones), out = [];
  const conHierro = x.toma !== "desayuno";
  const add = (a, g, ing) => { const i = ing.findIndex(([b]) => b === a); if (i >= 0) ing[i] = [a, ing[i][1] + g]; else ing.push([a, g]); return ing; };
  const copia = () => x.ing.map(([a, g]) => [a, g]);
  const yaDicho = new Set();
  const poner_ = (clave, quien, texto, aplicar, boton) => {
    if (yaDicho.has(clave)) { out.find((o) => o.clave === clave).quien.push(quien); return; }
    yaDicho.add(clave);
    out.push({ clave, quien: [quien], texto, aplicar, boton });
  };
  for (const p of PERSONAS()) {
    const lista = x.ing.map(([a, g]) => [a, g * parte[p]]), t = sumaNut(lista), obj = R.ficha[p][tipo];
    const ali = (a) => D.alimentos[a] || { g: "", t: [] };
    // No comen o no gusta (avisos_toma: "No gusta o no lo coméis").
    for (const [a] of x.ing) if (R.no_gusta[p].includes(a))
      poner_("no:" + a, p, `${limpio(a)}: no lo coméis o no gusta.`, () => x.ing.filter(([b]) => b !== a), "Quitar");
    // Proteína por debajo del mínimo de la ficha (PR-1).
    if (obj.prot_min && t.proteina < obj.prot_min) {
      const falta = obj.prot_min - t.proteina, g = Math.ceil(falta / 0.111 / parte[p] / 10) * 10;
      poner_("prot", p, `Falta proteína: ${Math.round(t.proteina)} g de ${obj.prot_min}. Añade tofu, legumbre, altramuces, edamame o un huevo.`,
        () => add("Tofu", g, copia()), `＋ ${g} g de tofu`);
    }
    // Energía fuera de ±10 % de la ficha.
    if (t.kcal > obj.kcal * 1.1) {
      const aceite = x.ing.find(([a]) => a.startsWith("Aceite"));
      const hid = x.ing.filter(([a]) => ["cereal", "tuberculo"].includes(ali(a).g)).sort((u, v) => v[1] - u[1])[0];
      if (aceite && aceite[1] * parte[p] > 10) {
        const g = Math.round(10 / Math.max(...Object.values(parte)));
        poner_("aceite", p, `Se pasa de energía (${Math.round(t.kcal)} de ${obj.kcal} kcal): baja el aceite a 10 g por ración.`,
          () => copia().map(([a, gg]) => [a, a === aceite[0] ? g : gg]), `Aceite a ${g} g`);
      } else if (hid) {
        const sobra = t.kcal - obj.kcal, g = Math.max(0, Math.round((hid[1] - sobra / (ali(hid[0]).n[0] / 100) / parte[p]) / 5) * 5);
        poner_("hid", p, `Se pasa de energía (${Math.round(t.kcal)} de ${obj.kcal} kcal): baja ${limpio(hid[0]).toLowerCase()}.`,
          () => copia().map(([a, gg]) => [a, a === hid[0] ? g : gg]), `${limpio(hid[0])} a ${g} g`);
      } else poner_("kcal", p, `Se pasa de energía (${Math.round(t.kcal)} de ${obj.kcal} kcal).`);
    } else if (t.kcal < obj.kcal * 0.9) {
      const g = Math.round(40 / Math.min(...Object.values(parte)) / 10) * 10;
      poner_("corto", p, `Se queda corto de energía (${Math.round(t.kcal)} de ${obj.kcal} kcal): añade pan o más hidrato.`,
        () => add("Pan integral de trigo", g, copia()), `＋ ${g} g de pan integral`);
    }
    // Hierro de legumbre o soja sin vitamina C (FE-1).
    const hierro = x.ing.some(([a]) => ali(a).t.includes("hierro") && ["legumbre", "soja"].includes(ali(a).g));
    if (conHierro && hierro && t.vit_c_mg < R.vit_c_min) {
      const g = Math.round(50 / Math.min(...Object.values(parte)) / 10) * 10;
      poner_("vitc", p, `Hierro sin vitamina C (${Math.round(t.vit_c_mg)} mg): ${R.vit_c_sugerencia[p]}.`,
        () => add("Pimiento rojo", g, copia()), `＋ ${g} g de pimiento rojo crudo`);
    }
    // Crucífera cocinada sin mostaza.
    const tags = new Set(x.ing.flatMap(([a]) => ali(a).t));
    if (R.mostaza.includes(p) && tags.has("sulforafano") && !tags.has("mostaza"))
      poner_("mostaza", p, "Crucífera sin mostaza: media cucharadita de mostaza en grano sobre la crucífera ya cocinada.",
        () => add("Mostaza en grano", 2 * x.raciones, copia()), "＋ mostaza en grano");
    // Lactosa por toma (LAC-1).
    if (R.lactosa_max[p] != null && t.lactosa > R.lactosa_max[p]) {
      const cambio = { "Yogur": "Yogur de soja natural (Alcampo)", "Leche": "Bebida de soja enriquecida en calcio" };
      poner_("lac", p, `Lactosa ${t.lactosa.toFixed(1)} g (máximo ${R.lactosa_max[p]} g por toma).`,
        () => copia().map(([a, g]) => { const k = Object.keys(cambio).find((w) => a.startsWith(w) && (D.alimentos[a].l || 0) > 0); return [k ? cambio[k] : a, g]; }),
        "Yogur y leche por los de soja");
    }
    // Como mucho 2 huevos por persona y toma (HUE-1).
    const huevo = x.ing.find(([a]) => a === "Huevo de gallina");
    if (huevo && (huevo[1] * parte[p]) / 55 > R.huevos_max + 0.15) {
      const g = Math.floor((R.huevos_max * 55) / Math.max(...Object.values(parte)) / 55) * 55;
      poner_("huevo", p, `Más de ${R.huevos_max} huevos por persona.`, () => copia().map(([a, gg]) => [a, a === huevo[0] ? g : gg]), `Huevos a ${g / 55}`);
    }
  }
  return out;
}

const PLANTILLAS = {
  "Bol de legumbre": { toma: "comida", min: 15, ing: [["Garbanzos cocidos", 240], ["Tofu ahumado", 220], ["Arroz blanco", 60], ["Pimiento rojo", 150], ["Pepino", 100], ["Aceite de oliva", 8]] },
  "Salteado de tofu": { toma: "cena", min: 20, ing: [["Tofu", 400], ["Fideos de trigo", 90], ["Brócoli", 200], ["Zanahoria", 80], ["Salsa de soja", 20], ["Mostaza en grano", 4], ["Aceite de oliva", 10]] },
  "Tostada completa": { toma: "desayuno", min: 10, ing: [["Pan integral de trigo", 80], ["Hummus", 60], ["Huevo de gallina", 110], ["Tomate crudo", 100]] },
};
const BORRADOR0 = { nombre: "", toma: "comida", min: 20, raciones: 2, batch: false, ing: [] };
let borrador = null;
const leerBorrador = () => (borrador = borrador || guardado.leer("nv:borrador", null) || JSON.parse(JSON.stringify(BORRADOR0)));
const guardarBorrador = () => guardado.escribir("nv:borrador", borrador);

function cantidadesAyuda(a, g) {
  const x = D.alimentos[a] || {};
  if (x.u) { const n = g / x.u[0]; if (n >= 0.5) return `≈ ${coma(r1(n))} ${n === 1 ? x.u[1] : x.u[2]}`; }
  if (x.e) { const n = g / x.e[0]; if (n >= 0.25) return `≈ ${coma(r1(n))} ${n === 1 ? x.e[1] : x.e[2]} de ${fg(x.e[0])} g`; }
  return "";
}

/* Resultado en vivo: se repinta solo esta parte al escribir, para no perder el foco del campo. */
function resultadoCrear() {
  const x = leerBorrador();
  if (!x.ing.length) return '<p class="acomp">Añade ingredientes con el buscador o empieza con una plantilla.</p>';
  const tot = sumaNut(x.ing), parte = partes(tipoDe(x.toma), x.raciones), tipo = tipoDe(x.toma);
  const filas = PERSONAS().map((p) => {
    const t = sumaNut(x.ing.map(([a, g]) => [a, g * parte[p]])), obj = D.reglas.ficha[p][tipo];
    const ok = t.kcal >= obj.kcal * 0.9 && t.kcal <= obj.kcal * 1.1 && t.proteina >= obj.prot_min;
    return `<tr><td><b>${esc(D.personas[p])}</b></td><td class="num">${Math.round(t.kcal)}</td><td class="num">${Math.round(t.proteina)}</td>
      <td class="num">${Math.round(t.hc)}</td><td class="num">${Math.round(t.grasa)}</td><td>${ok ? '<span class="ok">✓</span>' : `<span class="mal">${obj.kcal} kcal · ${obj.prot_min} g</span>`}</td></tr>`;
  }).join("");
  const av = avisosReceta(x);
  return `<table><tr><th></th><th class="num">kcal</th><th class="num">Prot</th><th class="num">HC</th><th class="num">Grasa</th><th>Objetivo</th></tr>
    <tr><td>Todo (${x.raciones} rac.)</td><td class="num">${Math.round(tot.kcal)}</td><td class="num">${Math.round(tot.proteina)}</td>
    <td class="num">${Math.round(tot.hc)}</td><td class="num">${Math.round(tot.grasa)}</td><td></td></tr>${filas}</table>
    <p class="acomp">Ración de cada uno: su parte según sus kcal objetivo, como en las recetas de olla. Fibra ${Math.round(tot.fibra / x.raciones)} g ·
      vitamina C ${Math.round(tot.vit_c_mg / x.raciones)} mg · hierro ${coma(r1(tot.hierro_mg / x.raciones))} mg por ración media.</p>
    ${av.length ? `<h3>Recomendaciones</h3><ul class="c-avisos">${av.map((o, i) => `<li><b>${esc(o.quien.map((p) => D.personas[p]).join(" y "))}:</b> ${esc(o.texto)}
      ${o.aplicar ? `<button class="boton" data-caplicar="${i}">${esc(o.boton)}</button>` : ""}</li>`).join("")}</ul>`
      : '<p class="ok">✓ Sin avisos: proteína, energía, vitamina C, lactosa y huevos en orden.</p>'}`;
}

function vistaCrear() {
  cabecera("", "Crear receta", "con lo que tengáis en casa");
  const x = leerBorrador();
  const filas = x.ing.map(([a, g], i) => `<li><span>${esc(limpio(a))}</span>
    <input class="c-g" data-ci="${i}" type="number" inputmode="decimal" min="0" step="5" value="${g}" aria-label="Gramos de ${esc(a)}"> g
    <small>${esc(cantidadesAyuda(a, g))}</small><button class="enlace" data-cquitar="${i}" aria-label="Quitar">✕</button></li>`).join("");
  const mias = Object.keys(D.recetas).filter((id) => id.startsWith("propia:"));
  return `<div class="ficha">
    <h2>1. Ingredientes</h2>
    <div class="b-dias">${Object.keys(PLANTILLAS).map((n) => `<button class="chip-boton" data-cplantilla="${esc(n)}">${esc(n)}</button>`).join("")}
      <button class="chip-boton" data-cnueva="1">Vaciar</button></div>
    <label class="campo">Buscar alimento<input id="buscar-ali" type="search" autocomplete="off" placeholder="garbanzos, tofu, brócoli…"></label>
    <div id="c-resultados" class="opciones"></div>
    <ul class="c-ing">${filas}</ul>
    <label class="campo">Raciones que salen<input id="c-raciones" type="number" min="1" step="1" value="${x.raciones}"></label>
    <h2>2. Resultado</h2><div id="c-res">${resultadoCrear()}</div>
    <h2>3. Guardar</h2>
    <label class="campo">Nombre<input id="c-nombre" type="text" value="${esc(x.nombre)}" placeholder="Bol de garbanzos con…"></label>
    <label class="campo">Toma<select id="c-toma">${[["comida", "Comida"], ["cena", "Cena"], ["ambas", "Comida o cena"], ["desayuno", "Desayuno"]]
      .map(([v, n]) => `<option value="${v}" ${x.toma === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="campo">Minutos<input id="c-min" type="number" min="0" step="5" value="${x.min || ""}"></label>
    <label class="c-check"><input id="c-batch" type="checkbox" ${x.batch ? "checked" : ""}> Se puede hacer en batch</label>
    <div class="botones"><button class="boton lleno" data-cguardar="1" ${x.ing.length ? "" : "disabled"}>Guardar receta</button></div>
    <p class="acomp" id="c-msg" role="status"></p>
    ${mias.length ? `<h2>Mis recetas</h2><div class="opciones">${mias.map((id) => `<div class="alt"><button class="alt-elegir" data-ir="#receta/${id}">
      <b>${esc(D.recetas[id].nombre)}</b><span>${PERSONAS().map((p) => `${esc(D.personas[p])} ${Math.round(D.recetas[id].kcal[p])} kcal · ${D.recetas[id].prot[p]} g`).join(" · ")}</span></button>
      <button class="ver" data-ceditar="${esc(id.slice(7))}">Editar</button><button class="ver" data-cborrar="${esc(id.slice(7))}">Borrar</button></div>`).join("")}</div>
      <p class="acomp">Ya salen en "Cambiar", en "＋ Añadir" y, si son de batch, en la pestaña Batch. Para pasarlas a la batería (el domingo):</p>
      <div class="botones"><button class="boton" data-cexportar="1">Copiar mis recetas para Claude</button></div>
      <textarea id="c-json" class="c-json" readonly hidden></textarea>` : ""}</div>`;
}

function repintarCrear() {
  guardarBorrador();
  const r = document.getElementById("c-res");
  if (r) r.innerHTML = resultadoCrear();
  document.querySelectorAll(".c-g").forEach((el) => {
    const i = Number(el.dataset.ci), it = borrador.ing[i];
    if (it) el.nextElementSibling.textContent = cantidadesAyuda(it[0], it[1]);
  });
  const b = document.querySelector("[data-cguardar]");
  if (b) b.disabled = !borrador.ing.length;
}

const slugDe = (t) => norm(t).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "receta";

function guardarPropia() {
  const x = leerBorrador();
  if (!x.nombre.trim()) { $("#c-msg").textContent = "Ponle un nombre."; return; }
  const slug = x.slug || slugDe(x.nombre);
  const def = { nombre: x.nombre.trim(), toma: x.toma, min: Number(x.min) || null, raciones: x.raciones, batch: !!x.batch,
                ing: x.ing.filter(([, g]) => g > 0), creada: hoyISO() };
  const glob = guardado.leer("nv:propias", {});
  glob[slug] = def;
  guardado.escribir("nv:propias", glob);
  borrador = JSON.parse(JSON.stringify(BORRADOR0));
  poner(`c:receta:${slug}`, def);   // se sincroniza y repinta
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
  const n = { c: 0, l: 0, a: 0 };
  for (const d of D.semana.dias) for (const c of TOMAS) {
    n.c += nCambiados(d, c);
    n.a += anadidos(d, c).length;
    if (PERSONAS().some((p) => libreReal(d, c, p))) n.l++;
  }
  const cambios = [n.c ? `${n.c} plato${n.c > 1 ? "s" : ""} cambiado${n.c > 1 ? "s" : ""}` : "",
    n.a ? `${n.a} añadido${n.a > 1 ? "s" : ""}` : "",
    n.l ? `${n.l} toma${n.l > 1 ? "s" : ""} libre${n.l > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
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
  registrarPropias();
  const { v, r } = ruta();
  let html;
  if (v === "item" && D.dias[r[0]]) html = vistaItem(r[0], r[1], indice(r[2]));
  else if (v === "anadir" && D.dias[r[0]]) html = vistaAnadir(r[0], r[1]);
  else if (v === "intercambiar" && D.dias[r[0]]) html = vistaIntercambiar(r[0]);
  else if (v === "libre" && D.dias[r[0]]) html = vistaLibre(r[0], r[1]);
  else if (v === "saltar" && D.dias[r[0]] && TOMAS.includes(r[1])) html = vistaSaltar(r[0], r[1]);
  else if (v === "receta") html = vistaReceta(r[0]);
  else if (v === "semana") html = vistaSemana();
  else if (v === "compra") html = vistaCompra();
  else if (v === "batch") html = vistaBatch();
  else if (v === "crear") html = vistaCrear();
  else if (v === "ajustes") html = vistaAjustes();
  else html = vistaHoy(D.dias[r[0]] ? r[0] : diaHoy());
  $("#vista").innerHTML = html;
  const tab = ["semana", "compra", "batch", "crear"].includes(v) ? v : v === "ajustes" ? "" : "hoy";
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("activa", a.dataset.tab === tab));
}

function ir(hash) {
  panel = null;
  para = "ambos";
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
  const b = ev.target.closest("[data-ir],[data-persona],[data-panel],[data-para],[data-elegir],[data-libre],[data-check],[data-dia],[data-volver],[data-accion],[data-anadir],[data-quitar],[data-intercambiar],[data-sugerir],[data-poco],[data-bdia],[data-belegir],[data-saltar],[data-reparto],[data-cplantilla],[data-cnueva],[data-cquitar],[data-caplicar],[data-cguardar],[data-ceditar],[data-cborrar],[data-cexportar],[data-cali],[data-supcerrar],[data-supabrir],[data-suphecho],[data-quitarplato]");
  if (!b || b.disabled) return;
  const ds = b.dataset;
  const { r } = ruta();
  if (ds.ir !== undefined) ir(ds.ir);
  else if (ds.persona) { persona = ds.persona; guardado.escribir("nv:persona", persona); render(); }
  else if (ds.panel) { panel = panel === ds.panel ? null : ds.panel; render(); }
  else if (ds.para) { para = ds.para; render(); }
  else if (ds.elegir !== undefined) {
    const [d, c, i] = r;
    panel = null;
    elegirPlato(d, c, indice(i), ds.elegir);
  } else if (ds.libre !== undefined) {
    const [d, c] = r;
    elegirLibre(d, c, ds.libre);
  } else if (ds.check !== undefined) poner("k:" + ds.check, !valor("k:" + ds.check));
  else if (ds.sugerir !== undefined) {
    // Al tentempié que toca por la hora (si es hoy), o a la media tarde.
    const d = D.dias[r[0]] ? r[0] : diaHoy();
    const c = esHoy(d) && new Date().getHours() < 12 ? "media_manana" : "media_tarde";
    cambiarAnadido(d, c, ds.sugerir, true, [ds.quien]);
  } else if (ds.anadir !== undefined) { cambiarAnadido(r[0], r[1], ds.anadir, true); volver("#hoy/" + r[0]); }
  else if (ds.quitar !== undefined) {
    cambiarAnadido(r[0], r[1], ds.quitar, false);
    if (!anadidos(r[0], r[1]).some((a) => a.id === ds.quitar)) volver("#hoy/" + r[0]);
  } else if (ds.intercambiar !== undefined) { intercambiar(r[0], ds.intercambiar); volver("#hoy/" + r[0]); }
  else if (ds.dia !== undefined) cambiarDia(ds.dia);
  else if (ds.quitarplato !== undefined) { const [d, c, i] = r; panel = null; quitar(d, c, indice(i), !!ds.quitarplato); }
  else if (ds.supcerrar !== undefined) cerrarSemana();
  else if (ds.supabrir !== undefined) poner("c:sup:cerrada", "");
  else if (ds.suphecho !== undefined) {
    const [id, p, d] = ds.suphecho.split("|"), k = `c:sup:hecho:${id}:${p}`;
    poner(k, valor(k) ? "" : D.semana.fechas[d]);
    tomadoEl(id, p);
  } else if (ds.cplantilla !== undefined) {
    const t = PLANTILLAS[ds.cplantilla];
    borrador = { ...JSON.parse(JSON.stringify(BORRADOR0)), toma: t.toma, min: t.min, ing: t.ing.map(([a, g]) => [a, g]) };
    guardarBorrador(); render();
  } else if (ds.cnueva !== undefined) { borrador = JSON.parse(JSON.stringify(BORRADOR0)); guardarBorrador(); render(); }
  else if (ds.cali !== undefined) {
    const x = leerBorrador(), a = ds.cali, ali = D.alimentos[a];
    const g = ali.u ? ali.u[0] * x.raciones / 2 : ali.g === "condimento" ? 5 : ali.g === "grasa" ? 10 : 100;
    const i = x.ing.findIndex(([b]) => b === a);
    if (i >= 0) x.ing[i][1] += g; else x.ing.push([a, Math.round(g)]);
    guardarBorrador(); render();
    const q = document.getElementById("buscar-ali"); if (q) q.focus();
  } else if (ds.cquitar !== undefined) { leerBorrador().ing.splice(Number(ds.cquitar), 1); guardarBorrador(); render(); }
  else if (ds.caplicar !== undefined) {
    const o = avisosReceta(leerBorrador())[Number(ds.caplicar)];
    if (o && o.aplicar) { borrador.ing = o.aplicar().map(([a, g]) => [a, Math.round(g)]); guardarBorrador(); render(); }
  } else if (ds.cguardar !== undefined) guardarPropia();
  else if (ds.ceditar !== undefined) {
    const x = propiasGuardadas()[ds.ceditar];
    if (x) { borrador = { ...JSON.parse(JSON.stringify(x)), slug: ds.ceditar }; guardarBorrador(); render(); window.scrollTo(0, 0); }
  } else if (ds.cborrar !== undefined) {
    const glob = guardado.leer("nv:propias", {});
    delete glob[ds.cborrar];
    guardado.escribir("nv:propias", glob);
    poner(`c:receta:${ds.cborrar}`, "");
  } else if (ds.cexportar !== undefined) {
    const txt = JSON.stringify({ fecha: hoyISO(), recetas: propiasGuardadas() }, null, 1);
    const area = $("#c-json");
    area.value = txt; area.hidden = false; area.select();
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
      () => { $("#c-msg").textContent = "Copiado: pégalo en el chat con Claude el domingo."; },
      () => { $("#c-msg").textContent = "Selecciona el texto de abajo y cópialo."; });
  } else if (ds.saltar !== undefined) saltar(r[0], r[1], !!ds.saltar);
  else if (ds.reparto !== undefined) {
    const [c2, p, ids] = ds.reparto.split("|");
    ids.split(",").forEach((id) => cambiarAnadido(r[0], c2, id, true, [p]));
    volver("#hoy/" + r[0]);
  } else if (ds.poco !== undefined) poner(`c:batch:poco:${ds.poco}`, pocoTiempo(ds.poco) ? "" : "1");
  else if (ds.bdia !== undefined) {
    const ya = diasBatch();
    const nuevo = ds.bdia === "-" ? (valor("c:batch:dias") === "-" ? "" : "-")
      : (ya.includes(ds.bdia) ? ya.filter((x) => x !== ds.bdia) : [...ya, ds.bdia]).join(",") || "-";
    poner("c:batch:dias", nuevo);
  } else if (ds.belegir !== undefined) {
    const [d, c, i, id] = ds.belegir.split("|");
    para = "ambos";
    elegirPlato(d, c, indice(i), id);
  }
  else if (ds.accion === "sync-guardar" || ds.accion === "sync-quitar") {
    const quitar = ds.accion === "sync-quitar";
    const err = Sync.configurar(quitar ? "" : $("#sync-url").value, quitar ? "" : $("#sync-clave").value);
    if (err) $("#sync-error").textContent = err;
    else render();
  }
  else if (ds.volver !== undefined) volver(ds.volver);
});

function volver(destino) {
  if (history.state && history.state.app) history.back();
  else { history.replaceState(null, "", destino); panel = null; para = "ambos"; render(); }
}

/* Buscar al añadir: filtra sin volver a pintar (así no se pierde lo escrito). */
document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.id === "buscar-ali") {
    const q = norm(el.value.trim()), caja = $("#c-resultados");
    const ya = new Set(leerBorrador().ing.map(([a]) => a));
    caja.innerHTML = q.length < 2 ? "" : Object.keys(D.alimentos).filter((a) => norm(a).includes(q) && !ya.has(a)).slice(0, 12)
      .map((a) => `<button class="opcion" data-cali="${esc(a)}"><b>${esc(a)}</b><span>${Math.round(D.alimentos[a].n[0])} kcal y ` +
        `${coma(r1(D.alimentos[a].n[1]))} g de proteína por 100 g</span></button>`).join("");
    return;
  }
  if (el.classList.contains("c-g")) { leerBorrador().ing[Number(el.dataset.ci)][1] = Number(el.value) || 0; repintarCrear(); return; }
  if (el.id === "c-raciones") { leerBorrador().raciones = Math.max(1, Number(el.value) || 2); repintarCrear(); return; }
  if (el.id === "c-nombre") { leerBorrador().nombre = el.value; guardarBorrador(); return; }
  if (el.id === "c-min") { leerBorrador().min = Number(el.value) || null; guardarBorrador(); return; }
  if (el.id !== "buscar") return;
  const q = norm(ev.target.value.trim());
  document.querySelectorAll(".fila-anadir").forEach((b) => { b.hidden = !!q && !b.dataset.nombre.includes(q); });
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === "c-toma") { leerBorrador().toma = ev.target.value; repintarCrear(); }
  if (ev.target.id === "c-batch") { leerBorrador().batch = ev.target.checked; guardarBorrador(); }
});

window.addEventListener("popstate", () => { panel = null; para = "ambos"; render(); });
window.addEventListener("hashchange", () => { panel = null; para = "ambos"; render(); });

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

if ("serviceWorker" in navigator) {
  // Al publicar una versión nueva de la app, el service worker nuevo toma el control y se recarga una vez.
  const habia = !!navigator.serviceWorker.controller;
  let recargada = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (habia && !recargada) { recargada = true; location.reload(); }
  });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
arrancar();
