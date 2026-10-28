import { call } from './drive.ts'
import type { Reminder } from './remind.ts'

// Recordatorios con Google Calendar: Datheke copia cada recordatorio a un calendario propio llamado "Datheke" y es
// Calendar quien avisa en todos los aparatos (Datheke deja de sonar: nunca hay dos avisos). Va en los dos sentidos:
//  - Cambiar la fecha u hora en Calendar la cambia en la nota.
//  - Borrarlo en Calendar cuenta como hecho.
//  - Lo que cambies en Datheke (hora, repetición, hecho, quitarlo) se copia a Calendar.
// Permiso: calendar.app.created, solo el calendario que crea Datheke; los demás calendarios no se tocan.
const API = 'https://www.googleapis.com/calendar/v3'
const DURATION = 15 * 60_000
const REMOVED = 'datheke-cal-quitados' // eventos que borró Datheke (no la persona): si vuelven (nota restaurada) se crean de nuevo

export type Item = { noteId: string; r: Reminder; label: string; noteTitle: string; locked: boolean }
export type CalEvent = {
  id: string; status?: string; recurringEventId?: string
  start?: { dateTime?: string; date?: string }
  extendedProperties?: { private?: Record<string, string> }
}
type Body = Record<string, unknown>
export type Plan = { put: { id: string; body: Body; exists: boolean }[]; remove: string[]; pull: { noteId: string; rid: string; r: Reminder }[] }

// Id del evento a partir de la nota y el recordatorio (Calendar acepta letras a-v y números: el hexadecimal sirve).
export const eventId = (noteId: string, rid: string) =>
  [...new TextEncoder().encode(`${noteId}:${rid}`)].map(b => b.toString(16).padStart(2, '0')).join('')

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
// Repetición de Datheke → regla de Calendar. El día 29, 30 o 31: en los meses más cortos, el último día (como Datheke).
export function rrule(rep: string): string | undefined {
  const [kind, arg = ''] = rep.split(':')
  if (kind === 'dia') return 'RRULE:FREQ=DAILY'
  if (kind === 'sem') return `RRULE:FREQ=WEEKLY;BYDAY=${arg.split(',').map(d => BYDAY[Number(d)]).join(',')}`
  const lastDays = (d: number) => d <= 28 ? `BYMONTHDAY=${d}` : `BYMONTHDAY=${Array.from({ length: d - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`
  if (kind === 'mes') return `RRULE:FREQ=MONTHLY;${lastDays(Number(arg))}`
  if (kind === 'ano') { const [m, d] = arg.split('-').map(Number); return `RRULE:FREQ=YEARLY;BYMONTH=${m};${lastDays(d)}` }
  return undefined
}

// El evento: a la hora del recordatorio, con aviso en ese momento. En una nota con clave, nada del contenido.
export function eventBody(x: Item, tz: string): Body {
  const summary = x.locked ? '🔔 Recordatorio de una nota con clave' : `🔔 ${x.label}`
  const description = x.locked ? 'Ábrela en Datheke con tu clave o tu huella.' : `En la nota "${x.noteTitle}".\n\nAbrir Datheke: https://datheke.github.io`
  const start = Date.parse(x.r.at)
  const rule = rrule(x.r.rep)
  return {
    id: eventId(x.noteId, x.r.id), status: 'confirmed', summary, description,
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(start + DURATION).toISOString(), timeZone: tz },
    recurrence: rule ? [rule] : [],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    transparency: 'transparent', // no te marca como "ocupado"
    extendedProperties: { private: { dk: '1', nota: x.noteId, rid: x.r.id, at: x.r.at, rep: x.r.rep || '', t: summary + description } },
  }
}

// Qué hacer para que Calendar y las notas queden iguales (sin red: se puede probar).
//  known: notas cuyo texto se leyó ahora (las demás, con clave cerrada o sin bajar, no se tocan).
//  live: notas que existen y no están en el basurero. synced: la lista de notas ya llegó de Drive.
export function plan(items: Item[], events: CalEvent[], o: { known: Set<string>; live: Set<string>; synced: boolean; removedByUs: Set<string>; tz: string; now?: Date }): Plan {
  const out: Plan = { put: [], remove: [], pull: [] }
  const byId = new Map(events.filter(e => !e.recurringEventId).map(e => [e.id, e]))
  const seen = new Set<string>()
  for (const x of items) {
    const id = eventId(x.noteId, x.r.id)
    seen.add(id)
    const ev = byId.get(id)
    if (x.r.done) { if (ev && ev.status !== 'cancelled') out.remove.push(id); continue }
    if (!ev) { out.put.push({ id, body: eventBody(x, o.tz), exists: false }); continue }
    if (ev.status === 'cancelled') {
      // Lo borró Datheke (nota restaurada del basurero, deshacer): vuelve. Lo borró la persona en Calendar: hecho.
      if (o.removedByUs.has(id)) out.put.push({ id, body: eventBody(x, o.tz), exists: true })
      else out.pull.push({ noteId: x.noteId, rid: x.r.id, r: { ...x.r, done: true, hist: [(o.now ?? new Date()).toISOString(), ...x.r.hist] } })
      continue
    }
    const p = ev.extendedProperties?.private ?? {}
    const evStart = ev.start?.dateTime ? Date.parse(ev.start.dateTime) : NaN
    if (p.at && !isNaN(evStart) && Math.abs(evStart - Date.parse(p.at)) > 30_000) {
      // Se movió en Calendar: la nota toma la nueva fecha y hora.
      const r = { ...x.r, at: new Date(evStart).toISOString() }
      out.pull.push({ noteId: x.noteId, rid: x.r.id, r })
      out.put.push({ id, body: eventBody({ ...x, r }, o.tz), exists: true })
      continue
    }
    const body = eventBody(x, o.tz)
    const want = (body.extendedProperties as { private: Record<string, string> }).private
    if (p.at !== want.at || p.rep !== want.rep || p.t !== want.t) out.put.push({ id, body, exists: true })
  }
  for (const ev of events) {
    if (ev.recurringEventId || ev.status === 'cancelled' || seen.has(ev.id)) continue
    const nota = ev.extendedProperties?.private?.nota
    if (!nota) continue
    // Se quitó de la nota, o la nota se borró: se borra de Calendar. Si no se puede leer la nota, no se toca.
    if (o.known.has(nota) || (o.synced && !o.live.has(nota))) out.remove.push(ev.id)
  }
  return out
}

const readRemoved = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(REMOVED) ?? '[]')) } catch { return new Set() } }
const writeRemoved = (s: Set<string>) => { try { localStorage.setItem(REMOVED, JSON.stringify([...s].slice(-500))) } catch { /* */ } }
const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const status = (e: unknown) => (e as { status?: number }).status

// El calendario "Datheke": el guardado en Ajustes, o uno nuevo si no existe (o se borró en Calendar).
export async function ensureCalendar(id: string | undefined, tz: string): Promise<string> {
  if (id) {
    try { await call(`${API}/calendars/${encodeURIComponent(id)}`); return id } catch (e) { if (status(e) !== 404 && status(e) !== 403) throw e }
  }
  const cal = await (await call(`${API}/calendars`, { method: 'POST', ...json({ summary: 'Datheke', description: 'Recordatorios de tus notas de Datheke. Se cambian desde Datheke o aquí mismo.', timeZone: tz }) })).json()
  return cal.id
}

export async function deleteCalendar(id: string) {
  try { await call(`${API}/calendars/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch (e) { if (status(e) !== 404 && status(e) !== 410) throw e }
  writeRemoved(new Set())
}

async function listEvents(cal: string): Promise<CalEvent[]> {
  const all: CalEvent[] = []
  let pageToken = ''
  do {
    const q = new URLSearchParams({ showDeleted: 'true', maxResults: '2500', fields: 'nextPageToken,items(id,status,recurringEventId,start,extendedProperties)' })
    if (pageToken) q.set('pageToken', pageToken)
    const data = await (await call(`${API}/calendars/${encodeURIComponent(cal)}/events?${q}`)).json()
    all.push(...(data.items ?? []))
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return all
}

// Sincroniza y devuelve los cambios que hay que hacer en las notas (lo que se cambió o borró en Calendar).
export async function syncCalendar(cal: string, items: Item[], o: { known: Set<string>; live: Set<string>; synced: boolean }): Promise<Plan['pull']> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const removedByUs = readRemoved()
  const p = plan(items, await listEvents(cal), { ...o, removedByUs, tz })
  const base = `${API}/calendars/${encodeURIComponent(cal)}/events`
  for (const x of p.put) {
    if (x.exists) await call(`${base}/${x.id}`, { method: 'PUT', ...json(x.body) })
    else {
      try { await call(base, { method: 'POST', ...json(x.body) }) } catch (e) {
        if (status(e) !== 409) throw e
        await call(`${base}/${x.id}`, { method: 'PUT', ...json(x.body) }) // ya existía (borrado): se recupera
      }
    }
    removedByUs.delete(x.id)
  }
  for (const id of p.remove) {
    try { await call(`${base}/${id}`, { method: 'DELETE' }) } catch (e) { if (status(e) !== 404 && status(e) !== 410) throw e }
    removedByUs.add(id)
  }
  writeRemoved(removedByUs)
  return p.pull
}
