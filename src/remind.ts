// Recordatorios por línea: una etiqueta 🔔 al final de una línea de la nota (desplegable, punto de lista o párrafo).
// Viven dentro del HTML de la nota (<span data-type="recordatorio" ...>), así viajan con ella a todos los aparatos.
//   at: la próxima vez que suena (ISO) · rep: cómo se repite · insistir: vuelve a avisar cada día hasta marcarlo
//   hecho: ya se hizo (solo los que no se repiten) · historial: fechas en que se marcó hecho
// rep: '' no se repite · 'dia' · 'sem:1,4' (días de la semana, 0 = domingo) · 'mes:15' (día del mes) · 'ano:3-10' (mes-día)
// solo: en una nota compartida, el correo de la única persona a la que le suena (vacío: a todos).
export type Reminder = { id: string; at: string; rep: string; insist: boolean; done: boolean; hist: string[]; solo?: string }
export type Group = 'pendiente' | 'hoy' | 'proximo' | 'hecho'

const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const time = (d: Date) => d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
const short = (d: Date, now: Date) =>
  d.toLocaleDateString('es', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }).replace(/\./g, '')

// "Hoy 18:00", "Mañana 09:00", "Ayer 18:00", "vie 31 oct, 09:00"
export function whenLabel(iso: string, now = new Date()) {
  const d = new Date(iso)
  const days = Math.round((dayStart(d) - dayStart(now)) / 86400000)
  if (days === 0) return `Hoy ${time(d)}`
  if (days === 1) return `Mañana ${time(d)}`
  if (days === -1) return `Ayer ${time(d)}`
  return `${d.toLocaleDateString('es', { weekday: 'short' }).replace('.', '')} ${short(d, now)}, ${time(d)}`
}

export function repeatText(rep: string) {
  const [kind, arg = ''] = rep.split(':')
  if (kind === 'dia') return 'cada día'
  if (kind === 'sem') {
    const ds = arg.split(',').map(Number).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // lunes primero
    return ds.length === 7 ? 'cada día' : `cada ${ds.map(d => DAYS[d]).join(', ').replace(/, ([^,]*)$/, ' y $1')}`
  }
  if (kind === 'mes') return `el ${arg} de cada mes`
  if (kind === 'ano') { const [m, d] = arg.split('-').map(Number); return `cada ${d} de ${MONTHS[m - 1]}` }
  return ''
}

// La repetición que corresponde a una fecha: el mismo día del mes, la misma fecha del año, el mismo día de la semana.
export const repeatFor = (kind: string, d: Date, weekdays: number[] = [d.getDay()]) =>
  kind === 'mes' ? `mes:${d.getDate()}` : kind === 'ano' ? `ano:${d.getMonth() + 1}-${d.getDate()}`
    : kind === 'sem' ? `sem:${[...new Set(weekdays)].join(',')}` : kind === 'dia' ? 'dia' : ''

// La próxima vez después de "after" (para un día 31 en un mes de 30, el último día de ese mes).
export function nextTime(at: string, rep: string, after = new Date()): string {
  const [kind, arg = ''] = rep.split(':')
  if (!kind) return at
  const base = new Date(at)
  const h = base.getHours(), mi = base.getMinutes()
  const d = new Date(Math.max(after.getTime(), base.getTime()))
  d.setHours(h, mi, 0, 0)
  const ok = (x: Date) => x > after && x >= base
  if (kind === 'dia' || kind === 'sem') {
    const days = kind === 'sem' ? arg.split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6]
    for (let i = 0; i < 15; i++, d.setDate(d.getDate() + 1)) if (days.includes(d.getDay()) && ok(d)) return d.toISOString()
  }
  if (kind === 'mes' || kind === 'ano') {
    const [m, day] = kind === 'mes' ? [-1, Number(arg)] : arg.split('-').map(Number)
    for (let i = 0; i < 30; i++) {
      const y = d.getFullYear() + (kind === 'ano' ? i : 0)
      const month = kind === 'ano' ? m - 1 : d.getMonth() + i
      const last = new Date(y, month + 1, 0).getDate()
      const x = new Date(y, month, Math.min(day, last), h, mi)
      if (ok(x)) return x.toISOString()
    }
  }
  return at
}

export function groupOf(r: Reminder, now = new Date()): Group {
  if (r.done) return 'hecho'
  const d = new Date(r.at)
  if (d < now) return 'pendiente'
  return dayStart(d) === dayStart(now) ? 'hoy' : 'proximo'
}

// Marcar hecho: queda en el historial; uno que se repite pasa a la siguiente vez (y vuelve a sonar solo).
export function markDone(r: Reminder, now = new Date()): Reminder {
  const hist = [now.toISOString(), ...r.hist]
  return r.rep ? { ...r, hist, at: nextTime(r.at, r.rep, now) } : { ...r, hist, done: true }
}

// Lo que dice la etiqueta. Uno que se repite y ya se hizo esta vez muestra "✓ oct" y la próxima fecha.
export function chipText(r: Reminder, now = new Date()) {
  const g = groupOf(r, now)
  const d = new Date(r.at)
  if (g === 'hecho') return `Hecho ${short(new Date(r.hist[0] ?? r.at), now)}`
  if (g === 'pendiente') return `Pendiente desde ${short(d, now)}`
  const when = g === 'hoy' ? `hoy ${time(d)}` : `${short(d, now)} · ${time(d)}`
  const last = r.hist[0] && r.rep ? `✓ ${new Date(r.hist[0]).toLocaleDateString('es', { month: 'short' }).replace('.', '')} · ` : ''
  return last + when
}

// En el HTML de la nota: atributos data-* de la etiqueta.
export const toAttrs = (r: Reminder) => ({
  'data-type': 'recordatorio', 'data-id': r.id, 'data-at': r.at, 'data-rep': r.rep || null,
  'data-insistir': r.insist ? 'true' : null, 'data-hecho': r.done ? 'true' : null, 'data-historial': r.hist.join(',') || null, 'data-solo': r.solo || null,
})
export const fromEl = (el: Element): Reminder => ({
  id: el.getAttribute('data-id') ?? '', at: el.getAttribute('data-at') ?? '', rep: el.getAttribute('data-rep') ?? '',
  insist: el.getAttribute('data-insistir') === 'true', done: el.getAttribute('data-hecho') === 'true',
  hist: (el.getAttribute('data-historial') ?? '').split(',').filter(Boolean), ...(el.getAttribute('data-solo') ? { solo: el.getAttribute('data-solo')! } : {}),
})

// Los recordatorios de una nota con el texto de su línea (para la lista y la notificación).
export function remindersIn(html: string): { r: Reminder; label: string }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('span[data-type="recordatorio"]')].map(el => {
    const line = el.closest('summary, li, p, h1, h2, h3') ?? el.parentElement
    const copy = line?.cloneNode(true) as HTMLElement | undefined
    copy?.querySelectorAll('span[data-type="recordatorio"], ul, ol, div').forEach(x => x.remove())
    return { r: fromEl(el), label: copy?.textContent?.trim() || 'Recordatorio' }
  })
}

// Cambia (o quita, con null) un recordatorio dentro del HTML de la nota.
export function updateIn(html: string, id: string, r: Reminder | null): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const el = doc.querySelector(`span[data-type="recordatorio"][data-id="${CSS.escape(id)}"]`)
  if (!el) return html
  if (!r) el.remove()
  else for (const [k, v] of Object.entries(toAttrs(r))) { if (v === null) el.removeAttribute(k); else el.setAttribute(k, v) }
  return doc.body.innerHTML
}

// Atajos de la ventana: en 1 hora, esta tarde (si aún no son las 5), mañana 9:00, el lunes 9:00.
export function quickTimes(now = new Date()) {
  const at = (days: number, h: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d }
  const hour = new Date(now.getTime() + 3600_000); hour.setSeconds(0, 0)
  const monday = (8 - now.getDay()) % 7 || 7
  return [
    { label: 'En 1 hora', date: hour },
    ...(now.getHours() < 17 ? [{ label: 'Esta tarde, 18:00', date: at(0, 18) }] : []),
    { label: 'Mañana, 9:00', date: at(1, 9) },
    { label: 'El lunes, 9:00', date: at(monday, 9) },
  ]
}

// Orden de la lista: pendientes (el más atrasado primero), hoy y próximos (el más cercano primero), hechos (el más reciente primero).
export function sortReminders<T extends { r: Reminder }>(items: T[], now = new Date()) {
  const rank: Record<Group, number> = { pendiente: 0, hoy: 1, proximo: 2, hecho: 3 }
  return [...items].sort((a, b) => {
    const ga = groupOf(a.r, now), gb = groupOf(b.r, now)
    if (ga !== gb) return rank[ga] - rank[gb]
    return ga === 'hecho' ? (b.r.hist[0] ?? '').localeCompare(a.r.hist[0] ?? '') : a.r.at.localeCompare(b.r.at)
  })
}
