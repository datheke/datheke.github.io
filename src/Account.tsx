import { ArrowUpCircle, BellRing, Check, CheckCircle2, ChevronDown, Copy, Download, ExternalLink, Globe, LogOut, Monitor, Smartphone, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { desktop } from './auth.ts'
import { useBack } from './back.ts'
import { DOWNLOADS, getUpdate, latestDownloads, openLink, type Downloads, type Update } from './update.ts'
import { newer } from './version.ts'
import { ReminderModeRow, type ReminderMode } from './Reminders.tsx'

declare const __VERSION__: string // vite.config.ts

// La cuenta arriba de la barra: al tocar el avatar o el correo se abre una tarjeta con el correo completo, la
// dirección de la versión web (para entrar desde cualquier navegador: PC, Mac, iPhone) y Salir.
export const WEB = 'https://datheke.github.io'
const WEB_LABEL = 'datheke.github.io'
const android = desktop && /android/i.test(navigator.userAgent)
const platform = android ? 'App de Android' : desktop ? 'App de Windows' : 'Versión web'

const openWeb = () => openLink(WEB)

// Sección plegable de la tarjeta: cerrada se ve solo su título con una flechita. Tocarla en cualquier parte la abre; abierta,
// tocar el título la vuelve a cerrar (los botones de adentro no la cierran).
function Fold({ className, icon, title, extra, children }: { className: string; icon: ReactNode; title: string; extra?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`cuenta-plegable ${className}${open ? ' abierto' : ''}`} onClick={() => { if (!open) setOpen(true) }}>
      <button type="button" className="cuenta-cabeza" aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(!open) }}>
        {icon} <strong>{title}</strong>{extra}<ChevronDown size={16} className="flecha" aria-hidden="true" />
      </button>
      {open && <div className="cuenta-cuerpo">{children}</div>}
    </div>
  )
}

// update: hay una versión más nueva (update.ts). Se nota con un puntito en el avatar y una línea en la tarjeta.
export function Account({ email, onLogout, update, mode, calendarHere, onPickMode, onConnect }: {
  email: string; onLogout: () => void; update?: Update | null
  mode: ReminderMode; calendarHere: boolean; onPickMode: (m: ReminderMode) => void; onConnect: () => void
}) {
  // Dónde se dibuja la tarjeta: flota sobre todo (la barra lateral la cortaría), debajo del botón y dentro de la pantalla.
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null)
  const [copied, setCopied] = useState('') // qué enlace se acaba de copiar
  const [downloads, setDownloads] = useState<Downloads | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Al abrir la tarjeta se miran los enlaces de la última versión (para descargar o copiar).
  useEffect(() => { if (open) latestDownloads().then(setDownloads) }, [open])

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

  async function copy(what: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(what)
      setTimeout(() => setCopied(''), 2000)
    } catch { /* sin portapapeles: se puede abrir el enlace */ }
  }
  const upToDate = !update && downloads && !newer(downloads.version, __VERSION__)
  const apps = [
    { id: 'android', label: 'Android', file: '.apk', Icon: Smartphone, url: downloads?.android ?? DOWNLOADS },
    { id: 'windows', label: 'Windows', file: '.exe', Icon: Monitor, url: downloads?.windows ?? DOWNLOADS },
  ]

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
        <div className="cuenta-version">
          <span>Versión instalada <strong>{__VERSION__}</strong> · {platform}</span>
          {upToDate && <small><CheckCircle2 size={14} aria-hidden="true" /> Es la más reciente</small>}
        </div>
        {update && <div className="cuenta-nueva">
          <ArrowUpCircle size={16} aria-hidden="true" />
          <span>Versión <strong>{update.version}</strong> disponible</span>
          <button className="principal" onClick={() => getUpdate(update)}>{update.url ? 'Descargar' : 'Actualizar'}</button>
        </div>}
        <Fold className="cuenta-web" icon={<Globe size={15} aria-hidden="true" />} title={desktop ? 'Entra también desde la web' : 'Esta es la versión web'}>
          <p className="cuenta-nota">Desde cualquier navegador (PC, Mac, iPhone), con tu misma cuenta de Google:</p>
          <div className="cuenta-direccion">
            <span>{WEB_LABEL}</span>
            <button onClick={() => copy('web', WEB)} title="Copiar la dirección" aria-label="Copiar la dirección">
              {copied === 'web' ? <Check size={15} /> : <Copy size={15} />}
            </button>
            {desktop && <button onClick={openWeb} title="Abrir en el navegador" aria-label="Abrir en el navegador"><ExternalLink size={15} /></button>}
          </div>
          {copied === 'web' && <small className="cuenta-copiado" role="status">¡Dirección copiada!</small>}
        </Fold>
        <Fold className="cuenta-apps" icon={<Download size={15} aria-hidden="true" />} title="Apps para instalar" extra={downloads && <small> · {downloads.version}</small>}>
          {apps.map(({ id, label, file, Icon, url }) => <div key={id} className="cuenta-direccion">
            <Icon size={15} aria-hidden="true" />
            <span>{label} <small>({file})</small></span>
            <button onClick={() => copy(id, url)} title={`Copiar el enlace de ${label}`} aria-label={`Copiar el enlace de ${label}`}>
              {copied === id ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button onClick={() => openLink(url)} title={`Descargar para ${label}`} aria-label={`Descargar para ${label}`}><Download size={15} /></button>
          </div>)}
          {(copied === 'android' || copied === 'windows') && <small className="cuenta-copiado" role="status">¡Enlace copiado! Ábrelo en el otro aparato para descargar.</small>}
          <button className="enlace" onClick={() => openLink(DOWNLOADS)}>Página de descargas <ExternalLink size={12} aria-hidden="true" /></button>
        </Fold>
        <Fold className="cuenta-recordar" icon={<BellRing size={15} aria-hidden="true" />} title="Recordatorios"
          extra={<small> · avisa {mode === 'calendar' ? 'Google Calendar' : 'Datheke'}</small>}>
          <ReminderModeRow mode={mode} onPick={m => { close(); onPickMode(m) }} />
          {mode === 'calendar' && !calendarHere && <p className="cuenta-nota">
            En este aparato aún no está conectado: lo que cambies aquí llega a Calendar cuando abras Datheke en un aparato conectado.{' '}
            <button className="enlace" onClick={() => { close(); onConnect() }}>Conectar aquí</button></p>}
          {/* Escondido aquí a propósito: cómo recuperar la clave de notas. */}
          <p className="cuenta-nota cuenta-olvido">¿Olvidaste tu clave de notas? En la ventana que la pide, mantén presionado el candado
            2 segundos y toca «¿Olvidaste la clave?». Entras con tu cuenta de Google y pones una nueva; no se pierde ninguna nota.</p>
        </Fold>
        <div className="cuenta-pie">
          <small>Datheke {__VERSION__}</small>
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
