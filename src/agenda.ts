import { nextTime, type Reminder } from './remind.ts'

// Agenda de avisos: a partir de los recordatorios, qué notificaciones tienen que sonar y cuándo.
// Pura (sin aparato): notify.ts la usa para programarlas en Android, Windows o la web.
export type Fire = { key: string; at: number; title: string; body: string; noteId: string; rid: string }
export type Source = { r: Reminder; label: string; noteId: string; noteTitle: string; locked: boolean }

const AHEAD = 3 // de uno que se repite se programan las próximas 3 veces (suena aunque no se abra la app en semanas)
const INSIST_DAYS = 7 // "insistir": hasta 7 avisos diarios después de la hora, mientras no se marque hecho
const DAY = 86400_000

// Texto de la notificación: el de la línea y la nota; en una nota con clave, nada del contenido.
export function texts(s: Source, late = false) {
  if (s.locked) return { title: '🔔 Recordatorio de una nota con clave', body: 'Tócalo para abrirla con tu clave o tu huella.' }
  return { title: `🔔 ${s.label}`, body: late ? `Sigue pendiente · ${s.noteTitle}` : s.noteTitle }
}

export function agenda(sources: Source[], now = Date.now()): Fire[] {
  const out: Fire[] = []
  for (const s of sources) {
    const { r } = s
    if (r.done || !r.at) continue
    const at = Date.parse(r.at)
    const push = (when: number, n: string, late = false) => { if (when > now) out.push({ key: `${s.noteId}:${r.id}:${n}`, at: when, ...texts(s, late), noteId: s.noteId, rid: r.id }) }
    if (at > now) push(at, 'a')
    // Ya pasó la hora y no se marcó: si insiste, vuelve a avisar cada día a la misma hora.
    else if (r.insist) for (let i = 1; i <= INSIST_DAYS; i++) push(at + Math.ceil((now - at) / DAY + i - 1) * DAY, `i${i}`, true)
    // Los que se repiten siguen sonando en las próximas fechas, aunque la anterior no se haya marcado.
    if (r.rep) {
      let t = r.at
      for (let i = 1; i <= AHEAD; i++) {
        t = nextTime(t, r.rep, new Date(Math.max(now, Date.parse(t))))
        push(Date.parse(t), `r${i}`)
      }
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

// Número fijo para cada aviso (Android pide un entero): el mismo aviso siempre tiene el mismo número.
export function fireId(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0
  return Math.abs(h) % 2_000_000_000 + 1
}
