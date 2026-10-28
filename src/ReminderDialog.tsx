import { Bell, BellOff, Check, LockKeyhole, WifiOff, X } from 'lucide-react'
import { useState } from 'react'
import { chipText, groupOf, nextTime, quickTimes, repeatFor, repeatText, type Reminder } from './remind.ts'

// Ventana del recordatorio de una línea: poner o cambiar fecha, hora y repetición; marcar hecho; ver y borrar el historial.
const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const isPast = (d: Date) => d.getTime() < Date.now()
const WEEK = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']] as const
const KINDS = [['', 'No se repite'], ['dia', 'Cada día'], ['sem', 'Días de la semana'], ['mes', 'Cada mes, ese día'], ['ano', 'Cada año, esa fecha']] as const
const histDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')

export function ReminderDialog({ reminder, label, locked, offline, onSave, onRemove, onDone, onHistory, onClose }: {
  reminder?: Reminder; label: string; locked: boolean; offline: boolean
  onSave: (r: Reminder) => void; onRemove: () => void; onDone: () => void; onHistory: (hist: string[]) => void; onClose: () => void
}) {
  const start = reminder ? new Date(reminder.at) : quickTimes()[0].date
  const [date, setDate] = useState(dateValue(start))
  const [time, setTime] = useState(timeValue(start))
  const [kind, setKind] = useState(reminder?.rep.split(':')[0] ?? '')
  const [days, setDays] = useState<number[]>(reminder?.rep.startsWith('sem:') ? reminder.rep.slice(4).split(',').map(Number) : [start.getDay()])
  const [insist, setInsist] = useState(reminder?.insist ?? false)
  const chosen = new Date(`${date}T${time}`)
  const valid = !isNaN(chosen.getTime()) && (kind !== 'sem' || days.length > 0)
  const rep = valid ? repeatFor(kind, chosen, days) : ''
  // Si ya pasó y no se repite, no tiene sentido; si se repite, sonará la próxima vez.
  const past = valid && !rep && isPast(chosen) && chosen.getTime() !== new Date(reminder?.at ?? 0).getTime()
  const g = reminder && groupOf(reminder)

  function save() {
    // Con días de la semana, la primera vez es el primero de esos días desde la fecha elegida.
    const first = kind === 'sem' && !days.includes(chosen.getDay()) ? nextTime(chosen.toISOString(), rep, chosen) : chosen.toISOString()
    onSave({ id: reminder?.id ?? crypto.randomUUID().slice(0, 8), at: first, rep, insist, done: false, hist: reminder?.hist ?? [] })
  }

  return (
    <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Recordatorio" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ventana recordatorio-ventana">
        <button className="btn-icono cerrar" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <h2><Bell size={20} aria-hidden="true" /> {label}</h2>
        {reminder && <div className={`recordatorio-estado ${g}`}>
          <span>{g === 'pendiente' ? '⏰ ' : g === 'hecho' ? '✓ ' : '🔔 '}{chipText(reminder)}</span>
          {g !== 'hecho' && <button className="principal" onClick={onDone}><Check size={15} /> Marcar hecho</button>}
        </div>}
        <div className="atajos">
          {quickTimes().map(q => (
            <button key={q.label} className={dateValue(q.date) === date && timeValue(q.date) === time ? 'activo' : undefined}
              onClick={() => { setDate(dateValue(q.date)); setTime(timeValue(q.date)) }}>{q.label}</button>
          ))}
        </div>
        <div className="recordatorio-campos">
          <label>Día<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Hora<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
          <label>Repetir<select value={kind} onChange={e => setKind(e.target.value)}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        </div>
        {kind === 'sem' && <div className="dias-semana" role="group" aria-label="Días de la semana">
          {WEEK.map(([d, l]) => <button key={d} aria-pressed={days.includes(d)} className={days.includes(d) ? 'activo' : undefined}
            onClick={() => setDays(days.includes(d) ? days.filter(x => x !== d) : [...days, d])}>{l}</button>)}
        </div>}
        <label className="insistir"><input type="checkbox" checked={insist} onChange={e => setInsist(e.target.checked)} />
          <span><strong>Insistir hasta que lo marque</strong><small>Si no lo marcas hecho, vuelve a avisar cada día a la misma hora.</small></span></label>
        {valid && <p className="recordatorio-resumen"><Bell size={14} aria-hidden="true" />
          <span>Sonará <strong>{chosen.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })} a las {time}</strong>{rep && <>, y luego <strong>{repeatText(rep)}</strong></>}.</span></p>}
        {past && <p className="error">Esa hora ya pasó.</p>}
        {locked && <p className="recordatorio-aviso"><LockKeyhole size={15} aria-hidden="true" /> Esta nota tiene clave: el aviso no mostrará el texto de la línea, y al tocarlo te pedirá tu clave o tu huella.</p>}
        {offline && <p className="recordatorio-aviso"><WifiOff size={15} aria-hidden="true" /> Sin conexión: el aviso de este aparato ya queda listo; tus otros aparatos se enterarán al volver internet.</p>}
        {reminder && reminder.hist.length > 0 && <div className="historial">
          <p><strong>Historial</strong> <small>(cuándo lo marcaste hecho)</small></p>
          <ul>{reminder.hist.map((h, i) => <li key={h + i}>✓ {histDate(h)}
            <button className="btn-icono" title="Borrar esta fecha" aria-label={`Borrar ${histDate(h)} del historial`}
              onClick={() => onHistory(reminder.hist.filter((_, j) => j !== i))}><X size={14} /></button></li>)}</ul>
          <button className="enlace" onClick={() => { if (confirm('¿Borrar todo el historial de este recordatorio? El recordatorio sigue igual.')) onHistory([]) }}>
            Borrar todo el historial</button>
        </div>}
        <div className="caja-fila recordar-botones">
          {reminder && <button className="peligro" onClick={() => { if (confirm('¿Quitar este recordatorio de la línea?')) onRemove() }}><BellOff size={15} /> Quitar</button>}
          <button className="principal" disabled={!valid || past} onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
