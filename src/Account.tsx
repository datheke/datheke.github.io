import { ArrowUpCircle, Check, Copy, ExternalLink, Globe, LogOut, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { desktop } from './auth.ts'
import { getUpdate, type Update } from './update.ts'
import { ReminderModeRow, type ReminderMode } from './Reminders.tsx'

declare const __VERSION__: string // vite.config.ts

// La cuenta arriba de la barra: al tocar el avatar o el correo se abre una tarjeta con el correo completo, la
// dirección de la versión web (para entrar desde cualquier navegador: PC, Mac, iPhone) y Salir.
export const WEB = 'https://datheke.github.io'
const WEB_LABEL = 'datheke.github.io'
const android = desktop && /android/i.test(navigator.userAgent)
const platform = android ? 'App de Android' : desktop ? 'App de Windows' : 'Versión web'

async function openWeb() {
  if (desktop) (await import('@tauri-apps/plugin-opener')).openUrl(WEB)
  else window.open(WEB, '_blank', 'noopener')
}

// update: hay una versión más nueva (update.ts). Se nota con un puntito en el avatar y una línea en la tarjeta.
export function Account({ email, onLogout, update, reminderMode, onReminderHelp }: {
  email: string; onLogout: () => void; update?: Update | null
  reminderMode: ReminderMode; onReminderHelp: (m: ReminderMode) => void // abre la ventana que explica ese modo
}) {
  // Dónde se dibuja la tarjeta: flota sobre todo (la barra lateral la cortaría), debajo del botón y dentro de la pantalla.
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => { if (!ref.current?.contains(e.target as globalThis.Node)) setOpen(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const close = () => setOpen(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(WEB)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* sin portapapeles: la dirección está a la vista */ }
  }

  return (
    <div className="cuenta" ref={ref}>
      <button className="cuenta-boton" aria-haspopup="dialog" aria-expanded={!!open} onClick={e => {
        const r = e.currentTarget.getBoundingClientRect()
        setOpen(open ? null : { left: Math.max(12, Math.min(r.left, window.innerWidth - 312)), top: r.bottom + 6 })
      }}
        title="Tu cuenta y la versión web">
        <span className="avatar" aria-hidden="true">{email[0]?.toUpperCase()}{update && <i className="punto-nuevo" />}</span>
        <span className="correo">{email}</span>
      </button>
      {open && <div className="cuenta-tarjeta" role="dialog" aria-label="Tu cuenta" style={open}>
        <div className="cuenta-quien">
          <span className="avatar grande" aria-hidden="true">{email[0]?.toUpperCase()}</span>
          <div>
            <small>Sesión iniciada como</small>
            <strong>{email}</strong>
          </div>
        </div>
        {update && <div className="cuenta-nueva">
          <ArrowUpCircle size={16} aria-hidden="true" />
          <span>Versión <strong>{update.version}</strong> disponible</span>
          <button className="principal" onClick={() => getUpdate(update)}>{update.url ? 'Descargar' : 'Actualizar'}</button>
        </div>}
        <div>
          <ReminderModeRow mode={reminderMode} onPick={m => { close(); onReminderHelp(m) }} />
          <button className="enlace recordar-como" onClick={() => { close(); onReminderHelp(reminderMode) }}>¿Cómo funciona?</button>
        </div>
        <div className="cuenta-web">
          <p><Globe size={15} aria-hidden="true" /> <strong>{desktop ? 'Entra también desde la web' : 'Esta es la versión web'}</strong></p>
          <p className="cuenta-nota">Desde cualquier navegador (PC, Mac, iPhone), con tu misma cuenta de Google:</p>
          <div className="cuenta-direccion">
            <span>{WEB_LABEL}</span>
            <button onClick={copy} title="Copiar la dirección" aria-label="Copiar la dirección">
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            {desktop && <button onClick={openWeb} title="Abrir en el navegador" aria-label="Abrir en el navegador"><ExternalLink size={15} /></button>}
          </div>
          {copied && <small className="cuenta-copiado" role="status">¡Dirección copiada!</small>}
        </div>
        <div className="cuenta-pie">
          <small>Datheke {__VERSION__} · {platform}</small>
          <button onClick={() => { close(); onLogout() }}><LogOut size={14} /> Salir</button>
        </div>
      </div>}
    </div>
  )
}

// Aviso pequeño abajo a la izquierda, una vez por versión: se cierra con ✕ y no vuelve hasta que salga otra.
// El puntito del avatar y la línea de la tarjeta siguen ahí mientras no se actualice.
const SEEN = 'datheke-aviso-version'
export function UpdateToast({ update }: { update: Update }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(SEEN) === update.version } catch { return false } })
  if (hidden) return null
  const close = () => { try { localStorage.setItem(SEEN, update.version) } catch { /* se vuelve a mostrar */ } setHidden(true) }
  return (
    <div className="aviso-version" role="status">
      <ArrowUpCircle size={16} aria-hidden="true" />
      <span>Datheke <strong>{update.version}</strong> disponible</span>
      <button className="principal" onClick={() => getUpdate(update)}>{update.url ? 'Descargar' : 'Actualizar'}</button>
      <button className="btn-icono" onClick={close} aria-label="Cerrar aviso" title="Más tarde"><X size={14} /></button>
    </div>
  )
}
