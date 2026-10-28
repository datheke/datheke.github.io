import { desktop } from './auth.ts'
import { fireId, type Fire } from './agenda.ts'

// Hacer sonar los recordatorios (agenda.ts dice qué y cuándo):
//  - Android: se programan en el teléfono (alarma del sistema): suenan aunque la app esté cerrada, también tras reiniciar.
//  - Windows: Datheke queda en segundo plano (iconito junto al reloj, arranca con la PC) y avisa a la hora.
//  - Web: avisa el navegador, solo con la página abierta.
// Lo programado se guarda en el aparato: así las notas con clave (caja cerrada) siguen avisando con lo último que se supo.
const android = desktop && /android/i.test(navigator.userAgent)
const AGENDA = 'datheke-agenda'
const DONE = 'datheke-avisados' // avisos que ya sonaron (Windows y web), para no repetirlos
const LATE_OK = 10 * 60_000 // si la PC estaba suspendida, un aviso de hace menos de 10 minutos igual suena
const MAX_ANDROID = 60

const read = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T } catch { return d } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin guardar: se recalcula */ } }

type Handlers = { open: (noteId: string, rid: string) => void; done: (noteId: string, rid: string) => void }
let handlers: Handlers = { open: () => {}, done: () => {} }

const plugin = () => import('@tauri-apps/plugin-notification')

// Pedir permiso para avisar (la primera vez que se pone un recordatorio).
export async function askPermission() {
  try {
    if (desktop) {
      const n = await plugin()
      if (!await n.isPermissionGranted()) await n.requestPermission()
    } else if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
  } catch { /* sin permiso: la lista y las etiquetas igual muestran lo pendiente */ }
}

// Al abrir la app: botones Hecho/Posponer (Android) y el reloj que revisa los avisos (Windows y web).
export async function start(h: Handlers) {
  handlers = h
  if (android) {
    try {
      const n = await plugin()
      await n.createChannel({ id: 'recordatorios', name: 'Recordatorios', description: 'Avisos de tus recordatorios', importance: n.Importance.High, vibration: true, lights: true })
      await n.registerActionTypes([{ id: 'recordatorio', actions: [
        { id: 'hecho', title: 'Hecho ✓', foreground: true },
        { id: 'posponer', title: 'Posponer 10 min', foreground: false },
      ] }])
      await n.onAction(e => {
        const x = (e.notification?.extra ?? {}) as { noteId?: string; rid?: string; title?: string; body?: string }
        if (!x.noteId || !x.rid) return
        if (e.actionId === 'hecho') handlers.done(x.noteId, x.rid)
        else if (e.actionId === 'posponer') snooze({ key: `${x.noteId}:${x.rid}:p`, at: Date.now() + 10 * 60_000, title: x.title ?? '🔔 Recordatorio', body: x.body ?? '', noteId: x.noteId, rid: x.rid })
        else handlers.open(x.noteId, x.rid)
      })
    } catch (e) { console.error('Avisos de Android', e) }
    return () => {}
  }
  const tick = () => {
    const now = Date.now()
    const fired = new Set(read<string[]>(DONE, []))
    for (const f of read<Fire[]>(AGENDA, [])) {
      const id = `${f.key}@${f.at}`
      if (f.at > now || f.at < now - LATE_OK || fired.has(id)) continue
      fired.add(id)
      show(f)
    }
    write(DONE, [...fired].slice(-300))
  }
  tick()
  const every = setInterval(tick, 20_000)
  return () => clearInterval(every)
}

async function show(f: Fire) {
  try {
    if (desktop) (await plugin()).sendNotification({ title: f.title, body: f.body })
    else if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(f.title, { body: f.body, icon: './favicon.png', tag: f.key })
      n.onclick = () => { window.focus(); handlers.open(f.noteId, f.rid); n.close() }
    }
  } catch (e) { console.error('No se pudo mostrar el aviso', e) }
}

// Guarda la agenda nueva y, en Android, la vuelve a programar si cambió. "known": notas cuyo texto se leyó ahora;
// de las demás (con clave y la caja cerrada, o aún sin bajar) se conservan sus avisos anteriores.
export async function schedule(fires: Fire[], known: Set<string>) {
  const now = Date.now()
  const keep = read<Fire[]>(AGENDA, []).filter(f => !known.has(f.noteId) && f.at > now - LATE_OK)
  const snoozed = read<Fire[]>(AGENDA, []).filter(f => f.key.endsWith(':p') && f.at > now && known.has(f.noteId))
  const all = [...fires, ...keep, ...snoozed].sort((a, b) => a.at - b.at)
  const before = localStorage.getItem(AGENDA)
  write(AGENDA, all)
  if (!android || before === localStorage.getItem(AGENDA)) return
  try {
    const n = await plugin()
    const pending = await n.pending()
    if (pending.length) await n.cancel(pending.map(p => p.id))
    for (const f of all.filter(f => f.at > now).slice(0, MAX_ANDROID)) {
      n.sendNotification({
        id: fireId(`${f.key}@${f.at}`), channelId: 'recordatorios', title: f.title, body: f.body, actionTypeId: 'recordatorio',
        schedule: n.Schedule.at(new Date(f.at), false, true), extra: { noteId: f.noteId, rid: f.rid, title: f.title, body: f.body },
      })
    }
  } catch (e) { console.error('No se pudieron programar los avisos', e) }
}

// Posponer 10 minutos: un aviso suelto más.
export async function snooze(f: Fire) {
  write(AGENDA, [...read<Fire[]>(AGENDA, []), f].sort((a, b) => a.at - b.at))
  if (!android) return
  try {
    const n = await plugin()
    n.sendNotification({ id: fireId(`${f.key}@${f.at}`), channelId: 'recordatorios', title: f.title, body: f.body, actionTypeId: 'recordatorio',
      schedule: n.Schedule.at(new Date(f.at), false, true), extra: { noteId: f.noteId, rid: f.rid, title: f.title, body: f.body } })
  } catch (e) { console.error('No se pudo posponer', e) }
}

// Windows: que Datheke arranque al prender la PC (en segundo plano) para que los avisos suenen.
export async function autostart() {
  if (!desktop || android) return
  try {
    const a = await import('@tauri-apps/plugin-autostart')
    if (!await a.isEnabled()) await a.enable()
  } catch (e) { console.error('Arranque con Windows', e) }
}
