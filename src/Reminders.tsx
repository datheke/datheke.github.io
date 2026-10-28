import { BellRing, CalendarDays, CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'
import { desktop } from './auth.ts'

// Recordatorios: quién hace sonar el aviso. Uno solo para toda la cuenta (así nunca suenan dos).
//  - "datheke": la propia app (Android aunque esté cerrada; Windows en segundo plano; la web solo abierta).
//  - "calendar": Datheke copia el recordatorio a Google Calendar y avisa la app de calendario de cada aparato.
// La ventana de ayuda explica qué hace cada modo y, con Calendar, qué hay que hacer en cada aparato.
export type ReminderMode = 'datheke' | 'calendar'
type Device = 'android' | 'windows' | 'iphone' | 'mac' | 'pc'

const ua = navigator.userAgent
const device: Device = desktop ? (/android/i.test(ua) ? 'android' : 'windows')
  : /iphone|ipad|ipod/i.test(ua) ? 'iphone' : /mac/i.test(ua) ? 'mac' : /android/i.test(ua) ? 'android' : 'pc'
const DEVICE_NAME: Record<Device, string> = {
  android: desktop ? 'App de Android' : 'Android (web)', windows: 'App de Windows', iphone: 'iPhone (web)', mac: 'Mac (web)', pc: 'Computadora (web)',
}

// Cómo suena en modo Datheke, por aparato. ok = suena aunque Datheke esté cerrado o en segundo plano.
const DATHEKE: { key: Device | 'web'; name: string; ok: boolean; text: string }[] = [
  { key: 'android', name: 'Celular Android (app)', ok: true, text: 'Suena aunque la app esté cerrada, como una alarma, con botones Hecho y Posponer. La primera vez te pide permiso para notificaciones.' },
  { key: 'windows', name: 'Windows (app)', ok: true, text: 'Al cerrar la ventana, Datheke queda en segundo plano (iconito junto al reloj) y arranca al prender la PC: suena aunque no la tengas abierta. Para salir del todo: clic derecho en el iconito → Salir.' },
  { key: 'web', name: 'Web: iPhone, Mac u otra PC', ok: false, text: 'Solo suena con la página de Datheke abierta. Si está cerrada, al abrirla te muestra los recordatorios que pasaron.' },
]

// Qué hacer una sola vez en cada aparato para que Google Calendar avise, con la misma cuenta de Google.
const CALENDAR: Record<'iphone' | 'mac' | 'windows' | 'android', { name: string; steps: string[]; result: string }> = {
  iphone: {
    name: 'iPhone',
    steps: ['Instala Google Calendar desde la App Store (gratis).', 'Entra con tu misma cuenta de Google.', 'Cuando lo pida, toca Permitir notificaciones.'],
    result: 'Suena como cualquier notificación del iPhone, aunque Datheke y Safari estén cerrados.',
  },
  mac: {
    name: 'Mac',
    steps: ['Abre Ajustes del Sistema → Cuentas de Internet.', 'Toca Google, entra con tu cuenta y deja activado Calendarios.', 'Abre la app Calendario una vez y permite las notificaciones.'],
    result: 'Avisa macOS aunque Datheke y el navegador estén cerrados.',
  },
  windows: {
    name: 'Windows',
    steps: ['Abre Outlook (la app gratis que trae Windows).', 'Agrega tu cuenta de Google y acepta el acceso al calendario.', 'Deja Outlook abierto o minimizado (puede arrancar con Windows).'],
    result: 'Avisa Windows mientras Outlook esté abierto o en segundo plano. Otra opción: tener calendar.google.com abierto en Chrome o Edge con notificaciones permitidas.',
  },
  android: {
    name: 'Android',
    steps: ['Abre Google Calendar (ya viene en casi todos los Android).', 'Revisa que esté tu misma cuenta de Google.', 'Permite sus notificaciones si te lo pide.'],
    result: 'Suena como cualquier notificación del teléfono.',
  },
}

const firstTab = (): keyof typeof CALENDAR => device === 'pc' ? 'windows' : device

// Línea de la tarjeta de la cuenta: elegir quién avisa. Al tocar una opción se abre la ventana que la explica.
export function ReminderModeRow({ mode, onPick }: { mode: ReminderMode; onPick: (m: ReminderMode) => void }) {
  return (
    <div className="recordar-modo">
      <p><BellRing size={15} aria-hidden="true" /> <strong>Recordatorios</strong> · avisar con:</p>
      <div className="segmento" role="radiogroup" aria-label="Quién avisa los recordatorios">
        <button role="radio" aria-checked={mode === 'datheke'} className={mode === 'datheke' ? 'activo' : undefined} onClick={() => onPick('datheke')}>Datheke</button>
        <button role="radio" aria-checked={mode === 'calendar'} className={mode === 'calendar' ? 'activo' : undefined} onClick={() => onPick('calendar')}>Google Calendar</button>
      </div>
    </div>
  )
}

// Ventana flotante: qué hace el modo y cómo suena (Datheke) o cómo activarlo en cada aparato (Calendar).
export function ReminderHelp({ mode, current, onUse, onClose }: {
  mode: ReminderMode; current: ReminderMode; onUse: (m: ReminderMode) => void; onClose: () => void
}) {
  const [tab, setTab] = useState(firstTab)
  const here = device === 'android' || device === 'windows' ? device : 'web'
  return (
    <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Cómo funcionan los recordatorios" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ventana recordar-ayuda">
        <button className="btn-icono cerrar" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        {mode === 'datheke' ? <>
          <h2><BellRing size={20} aria-hidden="true" /> Recordatorios con Datheke</h2>
          <p>Pones un recordatorio en una nota (menú ⋯ → <strong>Recordatorio</strong>) y a esa hora <strong>suena la notificación de Datheke</strong>. Al tocarla se abre la nota.</p>
          <ul className="recordar-lista">
            {DATHEKE.map(d => (
              <li key={d.key} className={d.key === here ? 'aqui' : undefined}>
                {d.ok ? <CheckCircle2 size={18} className="ok" aria-hidden="true" /> : <AlertTriangle size={18} className="ojo" aria-hidden="true" />}
                <div><strong>{d.name}{d.key === here && <span className="etiqueta">este aparato</span>}</strong><span>{d.text}</span></div>
              </li>
            ))}
          </ul>
          <p className="recordar-nota">Pronto: <strong>Google Calendar</strong>, para que suene también en iPhone y Mac con todo cerrado.</p>
        </> : <>
          <h2><CalendarDays size={20} aria-hidden="true" /> Recordatorios con Google Calendar</h2>
          <p>Datheke copia tus recordatorios a tu <strong>Google Calendar</strong> y es Calendar quien avisa. Datheke ya no suena, así <strong>nunca hay dos avisos</strong>.</p>
          <p className="recordar-nota">Lo que borres o cambies en Calendar también cambia en Datheke, y al revés. Borrarlo en Calendar cuenta como hecho.</p>
          <p><strong>Para que suene, haz esto una vez en cada aparato:</strong></p>
          <div className="pestanas" role="tablist">
            {(Object.keys(CALENDAR) as (keyof typeof CALENDAR)[]).map(k => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'activo' : undefined} onClick={() => setTab(k)}>
                {CALENDAR[k].name}{k === firstTab() && device !== 'pc' ? ' · este' : ''}
              </button>
            ))}
          </div>
          <ol className="recordar-pasos">{CALENDAR[tab].steps.map(s => <li key={s}>{s}</li>)}</ol>
          <p className="recordar-resultado"><CheckCircle2 size={16} aria-hidden="true" /> {CALENDAR[tab].result}</p>
        </>}
        <div className="caja-fila recordar-botones">
          {mode !== current
            ? <><button className="principal" onClick={() => onUse(mode)}>{mode === 'calendar' ? 'Conectar Google Calendar' : 'Usar Datheke'}</button>
              <button onClick={onClose}>Cancelar</button></>
            : <button className="principal" onClick={onClose}>Entendido</button>}
        </div>
        <p className="recordar-aparato">Estás en: {DEVICE_NAME[device]}</p>
      </div>
    </div>
  )
}
