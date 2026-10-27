// Guarda los archivos de la app para que abra sin internet. Las notas no pasan por aquí: van en IndexedDB.
// Red primero: con internet siempre la versión nueva; sin internet, la última guardada.
// shortcut: los archivos de versiones viejas quedan en la caché (~250 KB por versión); limpiar si algún día pesa.
const CACHE = 'datheke'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return // Google y Drive siempre por la red
  // La página se pide sin la copia del navegador (GitHub la deja 10 min): si no, al recargar seguía la versión vieja.
  // El resto de archivos lleva su versión en el nombre.
  const fresh = e.request.mode === 'navigate' ? { cache: 'no-cache' } : undefined
  e.respondWith(fetch(e.request, fresh).then(res => {
    if (res.ok) {
      const copy = res.clone()
      caches.open(CACHE).then(c => c.put(e.request, copy))
    }
    return res
  }).catch(async () => (await caches.match(e.request)) ?? (await caches.match('./')) ?? Response.error()))
})
