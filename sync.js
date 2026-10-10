/* Sincronización opcional entre los dos móviles con una hoja de Google (código en sync/Code.gs).
   - La URL del script y la clave se pegan una vez en cada móvil (pantalla Sincronizar) y se guardan solo ahí.
   - Cada cambio (plato, toma libre, check) se apunta como pendiente y se envía al segundo; además se pide
     el estado al abrir, al volver a la app, al recuperar la conexión y cada 30 s con la app a la vista.
   - Por cada clave gana la hora más nueva. Sin URL o sin conexión, la app sigue igual en cada móvil.
   Usa D, E, guardado, claveSemana y render de app.js (se llaman cuando app.js ya ha cargado). */
"use strict";

const Sync = (() => {
  let enCurso = false, otraVez = false, temporizador = null, ultimo = null, error = "";

  const conf = () => guardado.leer("nv:sync", null);
  const clavePend = () => "nv:pend:" + D.semana.inicio;
  const pendientes = () => new Set(guardado.leer(clavePend(), []));
  const guardarPend = (s) => guardado.escribir(clavePend(), [...s]);

  function anotar(k) {
    const s = pendientes();
    s.add(k);
    guardarPend(s);
    pintar();
    programar(1000);
  }

  function programar(ms) {
    clearTimeout(temporizador);
    temporizador = setTimeout(sincronizar, ms);
  }

  async function sincronizar() {
    const c = conf();
    if (!D || !c || !c.url) { pintar(); return; }
    if (!navigator.onLine) { error = "sin conexión"; pintar(); return; }
    if (enCurso) { otraVez = true; return; }
    enCurso = true;
    const cambios = [...pendientes()].filter((k) => E[k]).map((k) => ({ k, v: E[k].v, t: E[k].t }));
    try {
      const r = await fetch(c.url, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ accion: "sincronizar", clave: c.clave || "", semana: D.semana.inicio, cambios }),
      });
      const res = await r.json();
      if (!res.ok) throw new Error(res.error || "respuesta no válida");
      const adoptadas = new Set();
      for (const f of res.filas) {
        if (!E[f.k] || f.t > E[f.k].t) { E[f.k] = { v: f.v, t: f.t }; adoptadas.add(f.k); }
      }
      // Fuera de pendientes lo enviado, salvo lo que se haya vuelto a tocar mientras tanto.
      const quedan = pendientes();
      for (const x of cambios) if (adoptadas.has(x.k) || E[x.k].t === x.t) quedan.delete(x.k);
      const hayNuevo = adoptadas.size > 0;
      guardarPend(quedan);
      guardado.escribir(claveSemana(), E);
      ultimo = new Date();
      error = "";
      if (hayNuevo && ruta().v !== "ajustes") render(); else pintar();
    } catch (e) {
      error = /fetch|network|Load failed/i.test(String(e)) ? "no se pudo conectar" : String(e.message || e);
      pintar();
    } finally {
      enCurso = false;
      if (otraVez) { otraVez = false; programar(300); }
    }
  }

  function texto() {
    const c = conf();
    if (!c || !c.url) return "Sin sincronizar: cada móvil va por su cuenta.";
    const n = D ? pendientes().size : 0;
    if (error) return `Sin sincronizar (${error})${n ? `: ${n} cambio${n > 1 ? "s" : ""} pendiente${n > 1 ? "s" : ""}` : ""}.`;
    if (n) return `Enviando ${n} cambio${n > 1 ? "s" : ""}…`;
    if (ultimo) return `Sincronizado a las ${String(ultimo.getHours()).padStart(2, "0")}:${String(ultimo.getMinutes()).padStart(2, "0")}.`;
    return "Conectando con la hoja…";
  }

  function pintar() {
    document.querySelectorAll(".estado-sync").forEach((x) => { x.textContent = texto(); });
  }

  function configurar(url, clave) {
    url = (url || "").trim();
    if (!url) {
      guardado.escribir("nv:sync", null);
      error = "";
      pintar();
      return "";
    }
    if (!/^https?:\/\/\S+\/exec$/.test(url)) return "La URL debe ser la de la aplicación web del script y acabar en /exec.";
    guardado.escribir("nv:sync", { url, clave: (clave || "").trim() });
    guardarPend(new Set(Object.keys(E)));   // lo de este móvil se sube la primera vez
    error = "";
    sincronizar();
    return "";
  }

  function iniciar() {
    sincronizar();
    setInterval(() => { if (document.visibilityState === "visible") sincronizar(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sincronizar(); });
    window.addEventListener("online", sincronizar);
  }

  return { anotar, iniciar, sincronizar, configurar, conf, texto, pintar };
})();
window.Sync = Sync;
