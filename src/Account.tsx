import { ArrowUpCircle, LogOut, Settings as SettingsIcon, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { desktop } from './auth.ts'
import { useBack } from './back.ts'
import { getUpdate, type Update } from './update.ts'

declare const __VERSION__: string // vite.config.ts

// La cuenta arriba de la barra: al tocar el avatar o el correo se abre una tarjeta con el correo, la versión, Ajustes y Salir.
// La rueda al lado abre Ajustes directo (Settings.tsx).
const android = desktop && /android/i.test(navigator.userAgent)
const platform =android ? 'App de Android' : desktop ? 'App de Windows' : 'Versión web'

// update: hay una versión más nueva (update.ts). Se nota con un puntito en el avatar y una línea en la tarjeta.
export function Account({ email, onLogout, update, onSettings }: {
  email: string; onLogout: () => void; update?: Update | null; onSettings: () => void
}) {
  // Dónde se dibuja la tarjeta: flota sobre todo (la barra lateral la cortaría), debajo del botón y dentro de la pantalla.
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null)
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
  useBack(!!open, close)

  return (
    <div className="cuenta" ref={ref}>
      <button className="cuenta-boton" aria-haspopup="dialog" aria-expanded={!!open} onClick={e => {
        const r = e.currentTarget.getBoundingClientRect()
        setOpen(open ? null : { left: Math.max(12, Math.min(r.left, window.innerWidth - 312)), top: r.bottom + 6 })
      }}
        title="Tu cuenta y Ajustes">
        <span className="avatar" aria-hidden="true">{email[0]?.toUpperCase()}{update && <i className="punto-nuevo" />}</span>
        <span className="correo">{email}</span>
      </button>
      <button className="btn-icono" onClick={onSettings} title="Ajustes" aria-label="Ajustes"><SettingsIcon size={18} /></button>
      {open && <div className="cuenta-tarjeta" role="dialog" aria-label="Tu cuenta" style={open}>
        <div className="cuenta-quien">
          <span className="avatar grande" aria-hidden="true">{email[0]?.toUpperCase()}</span>
          <div>
            <small>Sesión iniciada como</small>
            <strong>{email}</strong>
          </div>
        </div>
        <div className="cuenta-version">
          <span>Versión instalada <strong>{__VERSION__}</strong> · {platform}</span>
        </div>
        {update && <div className="cuenta-nueva">
          <ArrowUpCircle size={16} aria-hidden="true" />
          <span>Versión <strong>{update.version}</strong> disponible</span>
          <button className="principal" onClick={() => getUpdate(update)}>{update.url ? 'Descargar' : 'Actualizar'}</button>
        </div>}
        <div className="cuenta-pie">
          <button onClick={() => { close(); onSettings() }}><SettingsIcon size={14} /> Ajustes</button>
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
