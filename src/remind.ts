// Recordatorios de una nota (en sus propiedades de Drive, así se ven en todos los aparatos):
//   recordatorio: fecha y hora (ISO) · repite: '' | dia | semana | mes · hecho: 'true'
// Marcar ✓ uno que se repite lo pasa a la siguiente vez (como en Evernote); uno que no se repite queda hecho.
export type Repeat = '' | 'dia' | 'semana' | 'mes'
export const REPEATS: [Repeat, string][] = [['', 'No se repite'], ['dia', 'Cada día'], ['semana', 'Cada semana'], ['mes', 'Cada mes']]
export const repeatLabel = (r: string) => ({ dia: 'cada día', semana: 'cada semana', mes: 'cada mes' } as Record<string, string>)[r] ?? ''

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const time = (d: Date) => d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

// "Hoy 18:00", "Mañana 09:00", "Ayer 18:00", "vie 31 oct, 09:00"
export function whenLabel(iso: string, now = new Date()) {
  const d = new Date(iso)
  const days = Math.round((dayStart(d) - dayStart(now)) / 86400000)
  if (days === 0) return `Hoy ${time(d)}`
  if (days === 1) return `Mañana ${time(d)}`
  if (days === -1) return `Ayer ${time(d)}`
  const date = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
  return `${date.replace(/\./g, '')}, ${time(d)}`
}

export type Group = 'vencido' | 'hoy' | 'proximo' | 'hecho'
export function groupOf(iso: string, done: boolean, now = new Date()): Group {
  if (done) return 'hecho'
  const d = new Date(iso)
  if (d < now) return 'vencido'
  return dayStart(d) === dayStart(now) ? 'hoy' : 'proximo'
}

// La siguiente vez de uno que se repite, ya en el futuro.
export function nextTime(iso: string, repeat: Repeat, now = new Date()) {
  const d = new Date(iso)
  do {
    if (repeat === 'dia') d.setDate(d.getDate() + 1)
    else if (repeat === 'semana') d.setDate(d.getDate() + 7)
    else if (repeat === 'mes') d.setMonth(d.getMonth() + 1)
    else return iso
  } while (d <= now)
  return d.toISOString()
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
