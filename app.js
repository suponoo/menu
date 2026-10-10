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

/* Plato i de la toma para p: cambio propio (c:dia:toma:i:p) > cambio de los dos (c:dia:toma:i) > el del menú.
   Los platos añadidos llevan i = "+<id>". */
function idDe(d, c, i, p) {
  if (esAnadido(i)) return String(i).slice(1);
  const o = origen(d);
  return valor(`c:${o}:${c}:${i}:${p}`) || valor(`c:${o}:${c}:${i}`) || toma(d, c).items[i].id;
}

/* Platos añadidos a la toma: c:<día>:<toma>:+<id> = "carlos,angela" (para quién), en el orden en que se añadieron. */
function anadidos(d, c) {
  const pre = `c:${origen(d)}:${c}:+`;
  return Object.keys(E).filter((k) => k.startsWith(pre) && E[k].v && D.recetas[k.slice(pre.length)])
    .sort((a, b) => E[a].t - E[b].t)
    .map((k) => ({ id: k.slice(pre.length), quien: String(E[k].v).split(",") }));
}

/* Platos de la toma para p: [{i, id, original, p, anadido}]. */
function itemsDe(d, c, p) {
  const t = toma(d, c);
  const base = t && t.items ? t.items.map((it, i) => ({ i, original: it.id, p: it.p, id: idDe(d, c, i, p) }))
    .filter((it) => it.p === "ambos" || it.p === p) : [];
  return base.concat(anadidos(d, c).filter((a) => a.quien.includes(p))
    .map((a) => ({ i: "+" + a.id, original: a.id, p, id: a.id, anadido: true })));
}
const cambiado = (d, c, i, p) => !esAnadido(i) && idDe(d, c, i, p) !== toma(d, c).items[i].id;
const nCambiados = (d, c) => ((toma(d, c) || {}).items || [])
  .filter((_, i) => PERSONAS().some((p) => cambiado(d, c, i, p))).length;

/* Toma libre para p: la propia (l:dia:toma:p; "-" = no libre para p) > la de los dos (l:dia:toma) > la del menú. */
function libreDe(d, c, p) {
  const o = origen(d);
  const vp = valor(`l:${o}:${c}:${p}`);
  if (vp === "-") return null;
  if (vp) return { nombre: vp, kcal: D.libres[vp] ?? 0 };
  const v = valor(`l:${o}:${c}`);
  if (v !== undefined) return v ? { nombre: v, kcal: D.libres[v] ?? 0 } : null;
  const t = toma(d, c);
  return t && t.libre && t.libre[p] ? t.libre[p] : null;
}

/* Batch: el día de batch b cocina los platos de su tramo (hasta el siguiente día de batch) que ocupan el sitio de un
   plato de batch de la plantilla. Si se cambia, entra el nuevo solo si se puede hacer en batch; si se intercambian
   días, cada plato va al batch del tramo donde cae. */
function batchDe(b) {
  const dias = D.semana.dias;
  const bs = Object.keys(D.semana.batch).sort((x, y) => dias.indexOf(x) - dias.indexOf(y));
  const ini = dias.indexOf(b), sig = bs.find((x) => dias.indexOf(x) > ini);
  const deBatch = new Set(Object.values(D.semana.batch).flat());
  const out = [];
  for (const d of dias.slice(ini, sig ? dias.indexOf(sig) : dias.length)) {
    for (const c of TOMAS) {
      ((toma(d, c) || {}).items || []).forEach((it, i) => {
        if (!deBatch.has(it.id)) return;
        for (const p of PERSONAS()) {
          if (libreDe(d, c, p) || !(it.p === "ambos" || it.p === p)) continue;
          const id = idDe(d, c, i, p);
          if ((id === it.id || D.recetas[id].batch) && !out.includes(id)) out.push(id);
        }
      });
    }
  }
  return out;
}

/* Lo que la otra persona come distinto en esa toma, para avisarlo en la tarjeta. */
const otra = (p) => PERSONAS().find((x) => x !== p);

const fijosDe = (c, p) => ((D.semana.fijos[p] || {})[c] || []);
const idsToma = (d, c, p) => itemsDe(d, c, p).map((x) => x.id);

function rol(id, c) {
  if (OPCIONALES.includes(c)) return "Tentempié";
  const cl = D.recetas[id].clase;
  return cl === "postre" && c === "desayuno" ? "Fruta" : ROL[cl] || "Plato";
}

function kcalDia(d, p) {
  let k = 0;
  for (const c of ORDEN_DIA) {
    const lib = libreDe(d, c, p);
    if (lib) { k += lib.kcal; continue; }
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
      for (const c of ORDEN_DIA) {
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
    const t = toma(d, c).items[it.i];
    delOtro = (t.p === "ambos" || t.p === o) && !libreDe(d, c, o) ? idDe(d, c, it.i, o) : null;
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
  if (lib) {
    const delOtro = libO ? (libO.nombre !== lib.nombre ? `libre (${libO.nombre})` : "")
      : idsToma(d, c, o).map((x) => D.recetas[x].corto).join(" + ");
    return `<section class="toma">${cab}<button class="tarjeta item libre" data-ir="#libre/${d}/${c}">
      <span class="rol">Toma libre</span><span class="nombre">${esc(lib.nombre)}</span>
      <span class="kcal">Unas ${lib.kcal} kcal, estimadas · no entra en la compra</span>
      ${delOtro ? `<span class="otro">${esc(D.personas[o])}: ${esc(delOtro)}</span>` : ""}</button></section>`;
  }
  const items = itemsDe(d, c, p);
  const fijos = fijosDe(c, p);
  return `<section class="toma">${cab}
    <div class="items">${items.length ? items.map((it) => tarjetaItem(d, c, it)).join("")
      : '<p class="acomp">Nada previsto.</p>'}</div>
    ${libO ? `<p class="otro-toma">${esc(D.personas[o])}: libre (${esc(libO.nombre)})</p>` : ""}
    <div class="pie-toma"><span>${items.length ? "Total: " + kcalTxt(items.map((x) => x.id), p) : ""}</span>
      <span class="acciones"><button class="enlace" data-ir="#anadir/${d}/${c}">＋ Añadir</button>
      <button class="enlace" data-ir="#libre/${d}/${c}">Toma libre…</button></span></div>
    ${fijos.length ? `<div class="fijos">Además, cada día: ${fijos.map((x) => esc(D.recetas[x].corto)).join(" · ")}</div>` : ""}
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
  return `<article class="tarjeta opcional ${mios.length && !lib ? "con-algo" : ""}"><span class="etiqueta">${NOMBRE_TOMA[c]} · opcional</span>
    ${lib ? "" : `<div class="items">${mios.map((it) => tarjetaItem(d, c, it)).join("")}</div>`}
    <div class="lista">${lista}</div></article>`;
}

function estadoEnergia(k, p) {
  const obj = D.energia.kcal_dia[p], tol = D.energia.tolerancia;
  return k < obj * (1 - tol) ? "corto" : k > obj * (1 + tol) ? "largo" : "dentro";
}

/* Tentempiés para completar el día de p según sus pautas (03_datos/pautas.json) y, al final, los del menú de la semana:
   en su orden, que quepan sin pasar del máximo, que no estén ya en el día y sin pasar de las frutas del día. */
const frutasDia = (d, p) => ORDEN_DIA.flatMap((c) => (libreDe(d, c, p) ? [] : [...idsToma(d, c, p), ...fijosDe(c, p)]))
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
  const batch = D.semana.batch[d] ? batchDe(d) : [];
  if (batch.length) notas.push(`<span class="chip gris">Hoy toca batch</span> ${batch.map((x) => esc(D.recetas[x].corto)).join(" · ")}`);
  if (origen(d) !== d) notas.push(`<span class="chip aviso">Menú del ${esc(D.semana.nombre_dia[origen(d)].toLowerCase())}</span>`);
  if (Object.values(D.semana.b12).includes(d)) notas.push(`<span class="chip">B12</span> suplemento hoy`);
  const tarjetas = ORDEN_DIA.map((c) => (TOMAS.includes(c) ? tarjetaToma(d, c) : tarjetaOpcional(d, c))).join("");
  return `${aviso}${notas.length ? `<p class="nota-dia">${notas.join(" &nbsp; ")}</p>` : ""}
    ${tarjetaEnergia(d)}
    <div class="tomas">${tarjetas}</div>
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
  return `${tablaIngredientes(id, solo)}
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
  const orig = toma(d, c).items[i].id;
  const quien = para === "ambos" ? PERSONAS() : [para];
  const actual = idDe(d, c, i, para === "ambos" ? persona : para);
  const alts = ((D.alternativas[c] || {})[actual] || [])
    .filter((x) => x !== orig && !quien.every((p) => idDe(d, c, i, p) === x));
  const linea = (id) => PERSONAS().map((p) =>
    `${esc(D.personas[p])}: ${Math.round(D.recetas[id].kcal[p])} kcal · ${D.recetas[id].prot[p]} g proteína`).join("<br>");
  const op = (id, esOrig) => `<div class="alt ${esOrig ? "original" : ""}">
      <button class="alt-elegir" data-elegir="${id}">
        <b>${esOrig ? "Volver al original: " : ""}${esc(D.recetas[id].corto)}${D.recetas[id].alternativa ? ' <span class="chip gris">alternativa</span>' : ""}</b>
        <span>${linea(id)}</span></button>
      <button class="ver" data-ir="#receta/${id}" aria-label="Ver la receta">Ver</button></div>`;
  return `${selectorPara("Cambiar para:")}<div class="opciones">
    ${quien.some((p) => cambiado(d, c, i, p)) ? op(orig, true) : ""}${alts.map((id) => op(id)).join("")}
    ${alts.length ? "" : '<p class="acomp">No hay nada parecido en el recetario.</p>'}</div>`;
}

function elegirPlato(d, c, i, id) {
  const orig = toma(d, c).items[i].id;
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
  const t = toma(d, c) && toma(d, c).items && toma(d, c).items[i];
  if (!t) return `<p class="vacio">No está en el menú.</p>`;
  const id = idDe(d, c, i, persona), o = otra(persona);
  const idO = (t.p === "ambos" || t.p === o) && !libreDe(d, c, o) ? idDe(d, c, i, o) : null;
  const distinto = idO && idO !== id;
  const r = D.recetas[id];
  return `<div class="ficha"><span class="chip gris">${rol(id, c)}</span><h2>${esc(r.nombre)}</h2>
    <div class="meta">${esc(metaReceta(id))}${chipsReceta(id, d, c, i)}</div>
    ${distinto ? `<p class="otro-toma">${esc(D.personas[o])} come otra cosa:
      <button class="volver" data-ir="#receta/${idO}">${esc(D.recetas[idO].corto)} ›</button></p>` : ""}
    <div class="botones"><button class="boton ${panel === "cambiar" ? "abierto" : ""}" data-panel="cambiar">Cambiar</button>
      ${r.clase === "principal" ? `<button class="boton" data-ir="#libre/${d}/${c}">Toma libre</button>` : ""}</div>
    ${panel === "cambiar" ? opcionesCambiar(d, c, i) : ""}
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
    const de = (p, i) => (t.items[i].p === "ambos" || t.items[i].p === p ? idDe(d, c, i, p) : null);
    const comun = [], solo = Object.fromEntries(ps.map((p) => [p, []]));
    if (ps.every((p) => lib[p]) && ps.every((p) => lib[p].nombre === lib[ps[0]].nombre)) {
      comun.push(`<span class="chip aviso">libre</span> ${esc(lib[ps[0]].nombre)}`);
    } else {
      t.items.forEach((_, i) => {
        const ids = ps.map((p) => (lib[p] ? null : de(p, i)));
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
  const batch = Object.keys(D.semana.batch).map((d) => [d, batchDe(d)]).filter(([, ids]) => ids.length).map(([d, ids]) =>
    `<span class="chip gris">Batch ${esc(D.semana.nombre_dia[d].toLowerCase())}</span> ${ids.map((x) => esc(D.recetas[x].corto)).join(" · ")}`);
  const opc = [...new Set(OPCIONALES.flatMap((c) => D.semana.opcionales[c] || []))];
  return `${batch.length ? `<p class="nota-dia">${batch.join("<br>")}</p>` : ""}
    <div class="semana">${dias.map((d) => `<button class="tarjeta dia ${esHoy(d) ? "hoy" : ""}" data-ir="#hoy/${d}">
      <h3>${D.semana.nombre_dia[d]} ${fecha(d)}${esHoy(d) ? ' <span class="chip">hoy</span>' : ""}${origen(d) !== d
        ? ` <span class="chip gris">menú del ${esc(D.semana.nombre_dia[origen(d)].toLowerCase())}</span>` : ""}</h3>
      ${TOMAS.map((c) => `<p><i>${NOMBRE_TOMA[c]}</i> ${celda(d, c)}</p>`).join("")}${kcal(d)}</button>`).join("")}</div>
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
  const n = { c: 0, l: 0, a: 0 };
  for (const d of D.semana.dias) for (const c of TOMAS) {
    n.c += nCambiados(d, c);
    n.a += anadidos(d, c).length;
    if (PERSONAS().some((p) => libreDe(d, c, p))) n.l++;
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
  const { v, r } = ruta();
  let html;
  if (v === "item" && D.dias[r[0]]) html = vistaItem(r[0], r[1], esAnadido(r[2]) ? r[2] : Number(r[2]));
  else if (v === "anadir" && D.dias[r[0]]) html = vistaAnadir(r[0], r[1]);
  else if (v === "intercambiar" && D.dias[r[0]]) html = vistaIntercambiar(r[0]);
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
  const b = ev.target.closest("[data-ir],[data-persona],[data-panel],[data-para],[data-elegir],[data-libre],[data-check],[data-dia],[data-volver],[data-accion],[data-anadir],[data-quitar],[data-intercambiar],[data-sugerir]");
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
    elegirPlato(d, c, Number(i), ds.elegir);
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
  if (ev.target.id !== "buscar") return;
  const q = norm(ev.target.value.trim());
  document.querySelectorAll(".fila-anadir").forEach((b) => { b.hidden = !!q && !b.dataset.nombre.includes(q); });
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
