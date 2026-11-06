import { Archive, ArrowUpCircle, BellRing, Check, CheckCircle2, ChevronLeft, Copy, Download, ExternalLink, FileDown, Globe, KeyRound, LogOut, Monitor, Search, ShieldCheck, Smartphone, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { desktop } from './auth.ts'
import { useBack } from './back.ts'
import { HOME } from './drive.ts'
import { folderResult, onFolderResult } from './folder.ts'
import { shortDate } from './format.ts'
import { GeminiLink } from './GeminiPanel.tsx'
import { ReminderModeRow, type ReminderMode } from './Reminders.tsx'
import { matches, searchWords } from './search.ts'
import { DOWNLOADS, getUpdate, latestDownloads, openLink, type Downloads, type Update } from './update.ts'
import { newer } from './version.ts'

declare const __VERSION__: string // vite.config.ts

const WEB = 'https://datheke.github.io'
const WEB_LABEL = 'datheke.github.io'
const android = desktop && /android/i.test(navigator.userAgent)
const platform = android ? 'App de Android' : desktop ? 'App de Windows' : 'Versión web'
const webTitle = desktop ? 'Entra también desde la web' : 'Esta es la versión web'

// Ventana de Ajustes: lo de la cuenta y la app en secciones, con buscador. En el celular primero se ve la lista de
// secciones y al tocar una se ve solo esa (regresar vuelve a la lista).
export type Section = 'cuenta' | 'ia' | 'recordatorios' | 'importar' | 'respaldo' | 'apps'
const SECTIONS: { id: Section; label: string; Icon: typeof Search; words: string }[] = [
  { id: 'cuenta', label: 'Inicio de sesión y seguridad', Icon: ShieldCheck, words: 'cuenta correo salir clave notas cambiar olvidaste google' },
  { id: 'ia', label: 'IA y aplicaciones conectadas', Icon: Sparkles, words: 'gemini vincular desvincular inteligencia artificial dictar' },
  { id: 'recordatorios', label: 'Recordatorios', Icon: BellRing, words: 'avisos quien avisa google calendar tono sonido conectar' },
  { id: 'importar', label: 'Importar', Icon: FileDown, words: 'nota recibida archivo datheke compartida conmigo abrir' },
  { id: 'respaldo', label: 'Respaldo', Icon: Archive, words: 'drive copia hacer ahora permiso semana' },
  { id: 'apps', label: 'Apps y versión', Icon: Download, words: 'android windows web navegador descargar actualizar version documentos direccion' },
]

export function Settings({ start, onClose, email, onLogout, update, hasKey, onChangeKey, geminiKey, onGeminiKey,
  mode, calendarHere, onPickMode, onConnect, onReceive, lastBackup, backup, onBackup, onPermission }: {
  start?: Section; onClose: () => void; email: string; onLogout: () => void; update?: Update | null
  hasKey: boolean; onChangeKey: () => void; geminiKey: string; onGeminiKey: (key: string) => void
  mode: ReminderMode; calendarHere: boolean; onPickMode: (m: ReminderMode) => void; onConnect: () => void
  onReceive: () => void; lastBackup: string; backup: { busy?: boolean; msg?: string; needsLogin?: boolean }
  onBackup: () => void; onPermission: () => void
}) {
  const narrow = window.matchMedia('(max-width: 700px)').matches
  const [sec, setSec] = useState<Section | null>(start ?? (narrow ? null : 'cuenta'))
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState('') // qué enlace se acaba de copiar
  const [downloads, setDownloads] = useState<Downloads | null>(null)
  const folder = useSyncExternalStore(onFolderResult, folderResult)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), []) // así Esc la cierra y el lector de pantalla empieza aquí
  // En este orden: regresar primero vuelve a la lista de secciones (celular) y luego cierra.
  useBack(true, onClose)
  useBack(narrow && sec !== null, () => setSec(null))

  const words = searchWords(query)
  const found = SECTIONS.filter(x => matches(x.label, x.words, words))
  const current = found.find(x => x.id === sec) ?? found[0]
  const id = current?.id

  useEffect(() => { if (id === 'apps') latestDownloads().then(setDownloads) }, [id])

  async function copy(what: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(what)
      setTimeout(() => setCopied(''), 2000)
    } catch { /* sin portapapeles: se puede abrir el enlace */ }
  }
  const then = (f: () => void) => () => { onClose(); f() } // lo que abre otra ventana cierra Ajustes antes
  const upToDate = !update && downloads && !newer(downloads.version, __VERSION__)
  const apps = [
    { id: 'android', label: 'Android', file: '.apk', Icon: Smartphone, url: downloads?.android ?? DOWNLOADS },
    { id: 'windows', label: 'Windows', file: '.exe', Icon: Monitor, url: downloads?.windows ?? DOWNLOADS },
  ]

  return (
    <div className="ventana-fondo ajustes-fondo" role="dialog" aria-modal="true" aria-label="Ajustes"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className={sec ? 'ajustes en-seccion' : 'ajustes'} ref={box} tabIndex={-1}>
        <button className="btn-icono cerrar" onClick={onClose} title="Cerrar" aria-label="Cerrar Ajustes"><X size={20} /></button>
        <nav aria-label="Secciones de Ajustes">
          <h2>Ajustes</h2>
          <div className="buscador" role="search">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar en Ajustes" aria-label="Buscar en Ajustes" />
          </div>
          {found.map(({ id: key, label, Icon }) => (
            <button key={key} className={key === id && (sec || !narrow) ? 'item activo' : 'item'} onClick={() => setSec(key)}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
          {!found.length && <p className="vacio">No se encontró “{query.trim()}”</p>}
        </nav>

        <div className="ajustes-cuerpo">
          <button className="enlace ajustes-volver solo-celular" onClick={() => setSec(null)}><ChevronLeft size={18} /> Ajustes</button>
          {current && <h3>{current.label}</h3>}

          {id === 'cuenta' && <>
            <div className="ajuste-caja ajuste-fila">
              <span className="avatar grande" aria-hidden="true">{email[0]?.toUpperCase()}</span>
              <div className="ajuste-crece">
                <small>Sesión iniciada como</small>
                <strong>{email}</strong>
              </div>
              <button onClick={then(onLogout)}><LogOut size={14} /> Salir</button>
            </div>
            <div className="ajuste-caja">
              <strong>Clave de notas</strong>
              <p className="ajuste-nota">Una sola clave para todas tus notas con clave, en todos tus aparatos.</p>
              {hasKey
                ? <div className="ajuste-botones"><button className="principal" onClick={then(onChangeKey)}><KeyRound size={16} /> Cambiar clave</button></div>
                : <p className="ajuste-nota">Aún no tienes clave: se crea la primera vez que proteges una nota (⋯ → Proteger con clave).</p>}
              {/* Escondido aquí a propósito: cómo recuperar la clave de notas. */}
              <p className="cuenta-olvido">¿Olvidaste tu clave de notas? En la ventana que la pide, mantén presionado el candado
                2 segundos y toca «¿Olvidaste la clave?». Entras con tu cuenta de Google y pones una nueva; no se pierde ninguna nota.</p>
            </div>
          </>}

          {id === 'ia' && (geminiKey
            ? <div className="ajuste-caja">
              <p className="ajuste-ok"><CheckCircle2 size={16} aria-hidden="true" /> <strong>Gemini está vinculado</strong> en todos tus aparatos con esta cuenta.</p>
              <p className="ajuste-nota">Se usa desde la barra de la nota: Gemini y Dictar.</p>
              <div className="ajuste-botones">
                <button onClick={() => { if (confirm('¿Desvincular Gemini en todos tus aparatos?')) onGeminiKey('') }}>Desvincular Gemini</button>
              </div>
            </div>
            : <div className="gemini ajuste-gemini"><GeminiLink onKey={onGeminiKey} /></div>)}

          {id === 'recordatorios' && <div className="ajuste-caja">
            <ReminderModeRow mode={mode} onPick={m => then(() => onPickMode(m))()} />
            {mode === 'calendar' && !calendarHere && <p className="ajuste-nota">
              En este aparato aún no está conectado: lo que cambies aquí llega a Calendar cuando abras Datheke en un aparato conectado.{' '}
              <button className="enlace" onClick={then(onConnect)}>Conectar aquí</button></p>}
          </div>}

          {id === 'importar' && <div className="ajuste-caja">
            <strong>Nota recibida</strong>
            <p className="ajuste-nota">Abre una nota que te enviaron (archivo .datheke) o una que te compartieron por Google Drive.</p>
            <div className="ajuste-botones"><button className="principal" onClick={then(onReceive)}><FileDown size={16} /> Nota recibida</button></div>
          </div>}

          {id === 'respaldo' && <div className="ajuste-caja">
            <p><strong>Respaldo en Drive:</strong> {lastBackup ? shortDate(lastBackup) : 'aún no'}</p>
            <p className="ajuste-nota">Se hace solo una vez por semana si hubo cambios, en tu Drive: carpeta «{HOME}» → Respaldos.</p>
            <div className="ajuste-botones">
              {backup.needsLogin ? <button onClick={onPermission}>Dar permiso</button>
                : <button onClick={onBackup} disabled={backup.busy}>{backup.busy ? 'Haciendo…' : 'Hacer ahora'}</button>}
            </div>
            {backup.msg && <small role="status">{backup.msg}</small>}
          </div>}

          {id === 'apps' && <>
            <div className="ajuste-caja">
              <div className="cuenta-version">
                <span>Versión instalada <strong>{__VERSION__}</strong> · {platform}</span>
                {upToDate && <small><CheckCircle2 size={14} aria-hidden="true" /> Es la más reciente</small>}
              </div>
              {update && <div className="cuenta-nueva">
                <ArrowUpCircle size={16} aria-hidden="true" />
                <span>Versión <strong>{update.version}</strong> disponible</span>
                <button className="principal" onClick={() => getUpdate(update)}>{update.url ? 'Descargar' : 'Actualizar'}</button>
              </div>}
              {desktop && folder && <p className="ajuste-nota" role="status">{folder === 'ok'
                ? `Copia de tus notas en ${android ? 'Documents' : 'Documentos'}/Datheke ✓`
                : `⚠️ No se pudo hacer la copia en ${android ? 'Documents' : 'Documentos'}/Datheke: ${folder}`}</p>}
            </div>
            <div className="ajuste-caja">
              <strong className="ajuste-titulo"><Globe size={15} aria-hidden="true" /> {webTitle}</strong>
              <p className="ajuste-nota">Desde cualquier navegador (PC, Mac, iPhone), con tu misma cuenta de Google:</p>
              <div className="cuenta-direccion">
                <span>{WEB_LABEL}</span>
                <button onClick={() => copy('web', WEB)} title="Copiar la dirección" aria-label="Copiar la dirección">
                  {copied === 'web' ? <Check size={15} /> : <Copy size={15} />}
                </button>
                {desktop && <button onClick={() => openLink(WEB)} title="Abrir en el navegador" aria-label="Abrir en el navegador"><ExternalLink size={15} /></button>}
              </div>
              {copied === 'web' && <small className="cuenta-copiado" role="status">¡Dirección copiada!</small>}
            </div>
            <div className="ajuste-caja cuenta-apps">
              <strong className="ajuste-titulo"><Download size={15} aria-hidden="true" /> Apps para instalar{downloads && <small> · {downloads.version}</small>}</strong>
              {apps.map(({ id: app, label, file, Icon, url }) => <div key={app} className="cuenta-direccion">
                <Icon size={15} aria-hidden="true" />
                <span>{label} <small>({file})</small></span>
                <button onClick={() => copy(app, url)} title={`Copiar el enlace de ${label}`} aria-label={`Copiar el enlace de ${label}`}>
                  {copied === app ? <Check size={15} /> : <Copy size={15} />}
                </button>
                <button onClick={() => openLink(url)} title={`Descargar para ${label}`} aria-label={`Descargar para ${label}`}><Download size={15} /></button>
              </div>)}
              {(copied === 'android' || copied === 'windows') && <small className="cuenta-copiado" role="status">¡Enlace copiado! Ábrelo en el otro aparato para descargar.</small>}
              <button className="enlace" onClick={() => openLink(DOWNLOADS)}>Página de descargas <ExternalLink size={12} aria-hidden="true" /></button>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
