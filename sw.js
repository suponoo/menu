/* Service worker: la app funciona sin conexión.
   - datos.json: primero la red (para ver la semana nueva) y, sin conexión, la última copia.
   - El resto (carcasa): copia guardada al momento y se actualiza por detrás para la próxima vez.
   - Las llamadas a otros dominios (Apps Script) no pasan por aquí. */
const CACHE = "menu-v3";
const CARCASA = ["./", "index.html", "app.js", "sync.js", "estilo.css", "manifest.json", "datos.json",
                 "iconos/icono-192.png", "iconos/icono-512.png", "iconos/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  // cache: "reload" para no coger copias viejas de la caché del navegador al instalar una versión nueva
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CARCASA.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith("/datos.json")) {
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put("datos.json", copia)); }
      return r;
    }).catch(() => caches.match("datos.json")));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((guardada) => {
    const red = fetch(e.request).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => guardada);
    return guardada || red;
  }));
});
