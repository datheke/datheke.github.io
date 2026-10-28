import { Bell, BellOff, Check, LockKeyhole, WifiOff, X } from 'lucide-react'
import { useState } from 'react'
import { groupOf, quickTimes, REPEATS, repeatLabel, whenLabel, type Repeat } from './remind.ts'

// Ventana para poner, cambiar o quitar el recordatorio de una nota (menú ⋯ → Recordatorio, o tocando el aviso de la nota).
const pad = (n: number) => String(n).padStart(2, '0')
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const isPast = (d: Date) => d.getTime() < Date.now()

export function ReminderDialog({ at, repeat, locked, offline, onSave, onRemove, onClose }: {
  at?: string; repeat?: Repeat; locked: boolean; offline: boolean
  onSave: (at: string, repeat: Repeat) => void; onRemove: () => void; onClose: () => void
}) {
  const start = at ? new Date(at) : quickTimes()[0].date
  const [date, setDate] = useState(dateValue(start))
  const [time, setTime] = useState(timeValue(start))
  const [rep, setRep] = useState<Repeat>(repeat ?? '')
  const chosen = new Date(`${date}T${time}`)
  const valid = !isNaN(chosen.getTime())
  const past = valid && isPast(chosen)

  return (
    <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Recordatorio" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ventana recordatorio-ventana">
        <button className="btn-icono cerrar" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <h2><Bell size={20} aria-hidden="true" /> Recordatorio</h2>
        <div className="atajos">
          {quickTimes().map(q => (
            <button key={q.label} className={dateValue(q.date) === date && timeValue(q.date) === time ? 'activo' : undefined}
              onClick={() => { setDate(dateValue(q.date)); setTime(timeValue(q.date)) }}>{q.label}</button>
          ))}
        </div>
        <div className="recordatorio-campos">
          <label>Día<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Hora<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
          <label>Repetir<select value={rep} onChange={e => setRep(e.target.value as Repeat)}>
            {REPEATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        </div>
        {valid && <p className="recordatorio-resumen"><Bell size={14} aria-hidden="true" /><span>Sonará <strong>{whenLabel(chosen.toISOString()).toLowerCase()}</strong>{rep && `, ${repeatLabel(rep)}`}.</span></p>}
        {past && <p className="error">Esa hora ya pasó.</p>}
        {locked && <p className="recordatorio-aviso"><LockKeyhole size={15} aria-hidden="true" /> Esta nota tiene clave: el aviso no mostrará el título, y al tocarlo te pedirá tu clave o tu huella.</p>}
        {offline && <p className="recordatorio-aviso"><WifiOff size={15} aria-hidden="true" /> Sin conexión: el aviso de este aparato ya queda listo; tus otros aparatos se enterarán al volver internet.</p>}
        <div className="caja-fila recordar-botones">
          {at && <button className="peligro" onClick={onRemove}><BellOff size={15} /> Quitar</button>}
          <button className="principal" disabled={!valid || past} onClick={() => onSave(chosen.toISOString(), rep)}>Guardar</button>
        </div>
      </div>
    </div>
  )
}

// El aviso bajo el título de la nota: cuándo suena (rojo si ya pasó), tocarlo lo cambia, ✓ lo marca hecho.
export function ReminderChip({ at, repeat, done, onEdit, onDone }: {
  at: string; repeat?: string; done: boolean; onEdit: () => void; onDone: () => void
}) {
  const g = groupOf(at, done)
  return (
    <div className={`recordatorio-chip ${g}`}>
      <button className="recordatorio-cuando" onClick={onEdit} title="Cambiar el recordatorio">
        <Bell size={14} aria-hidden="true" /> {done ? 'Hecho' : g === 'vencido' ? `Venció: ${whenLabel(at)}` : whenLabel(at)}
        {repeat && !done && <span> · {repeatLabel(repeat)}</span>}
      </button>
      {!done && <button className="recordatorio-hecho" onClick={onDone} title="Marcar como hecho" aria-label="Marcar como hecho"><Check size={15} /></button>}
    </div>
  )
}
