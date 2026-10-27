import {
  ChevronLeft, ChevronRight, FilePlus, FileText, GripVertical, KeyRound, LayoutTemplate, Lock, LockKeyhole, LogOut, Maximize2, Minimize2, Notebook,
  PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Shield, ShieldCheck, ShieldOff, Trash2,
} from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { desktop, forgetSession, loadSession, resume, signIn } from './auth.ts'
import { AuthError, OfflineError, readNote, type DriveFile } from './drive.ts'
import Editor, { Cover, EmojiPicker } from './Editor.tsx'
import { startFolder } from './folder.ts'
import { shortDate } from './format.ts'
import { pickImage, uploadImage } from './images.ts'
import * as store from './sync.ts'
import { TEMPLATES } from './templates.ts'
import { firstUnordered, lastUnordered, reorder } from './order.ts'
import { startSort } from './sortable.ts'
import { MoreMenu, Resizer } from './ui.tsx'
import * as vault from './vault.ts'
import { Create as CreateKey, Unlock } from './Vault.tsx'

const UNTITLED = store.UNTITLED
// Basurero: días que le quedan a una nota borrada, y la fecha que se le pone al borrarla.
const TRASH_DAYS = 30
const daysLeft = (f: DriveFile) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - Date.parse(f.appProperties?.borrada ?? '')) / 86400_000))
const nowIso = () => new Date().toISOString()
const byName = (a: DriveFile, b: DriveFile) => a.name.localeCompare(b.name)
const byDate = (a: DriveFile, b: DriveFile) => b.modifiedTime.localeCompare(a.modifiedTime)
const isTemplates = (f: DriveFile) => f.appProperties?.templates === 'true' // libreta "Plantillas"
const parentOf = (n: DriveFile) => n.appProperties?.parent
const messageOf = (e: unknown) => e instanceof AuthError ? 'auth'
  : e instanceof OfflineError ? 'Sin conexión: esto necesita internet.' : e instanceof Error ? e.message : String(e)
// Vista previa en texto de la otra versión (DOMParser no ejecuta nada de lo que lee).
const plain = (html: string) =>
  new DOMParser().parseFromString(html.replace(/<\/(p|li|h\d|div|summary)>|<br\s*\/?>/gi, '\n'), 'text/html').body.textContent ?? ''
// Las primeras palabras de la nota para su tarjeta. Se guardan por texto: la lista se vuelve a dibujar en cada tecla.
const previews = new Map<string, string>()
function preview(html = '') {
  let p = previews.get(html)
  if (p === undefined) {
    if (previews.size > 500) previews.clear()
    p = plain(html).replace(/\s+/g, ' ').trim().slice(0, 160)
    previews.set(html, p)
  }
  return p
}

// Ancho de las columnas, lista oculta y pantalla completa: son de cada aparato (las pantallas no son iguales) y solo
// valen en pantallas anchas; en el celular se ve una columna a la vez. Sin poder guardar, va el diseño de siempre.
type Layout = { sidebar: number; list: number; listHidden: boolean; expanded: boolean }
const LAYOUT: Layout = { sidebar: 240, list: 320, listHidden: false, expanded: false }
const LIMITS = { sidebar: [180, 360], list: [240, 480] } as const
const MIN_EDITOR = 380
function loadLayout(): Layout {
  try { return { ...LAYOUT, ...JSON.parse(localStorage.getItem('datheke-diseno') ?? '{}') } } catch { return LAYOUT }
}

export default function App() {
  const [session, setSession] = useState(loadSession)
  const s = useSyncExternalStore(store.subscribe, store.getState)
  const [ready, setReady] = useState(false) // copia local cargada
  const [notebookId, setNotebookId] = useState<string | null>(null) // null = todas
  const [trashView, setTrashView] = useState(false) // la lista muestra el basurero
  const [noteId, setNoteId] = useState<string | null>(null)
  const [picker, setPicker] = useState(false) // selector de ícono de la nota
  const [problem, setProblem] = useState<string | null>(null) // error de una acción ('auth' = sesión vencida)
  const [waiting, setWaiting] = useState(false) // escritorio: esperando que termine el login en el navegador
  const [layout, setLayout] = useState(loadLayout)
  // Al escribir en la nota (título o texto) la portada se esconde, y vuelve al abrirla de nuevo.
  const [writing, setWriting] = useState(false)
  // Ventana de la caja fuerte: crear la clave, abrirla antes de proteger una nota, o la clave nueva tras "olvidé la clave".
  const [keyDialog, setKeyDialog] = useState<{ mode: 'crear' | 'abrir' | 'nueva'; then?: () => void } | null>(null)
  const unlocked = useSyncExternalStore(vault.subscribe, vault.unlocked)
  useEffect(() => {
    try { localStorage.setItem('datheke-diseno', JSON.stringify(layout)) } catch { /* sin guardar: el diseño de siempre */ }
  }, [layout])

  const files = Object.values(s.files)
  const notebooks = files.filter(f => f.appProperties?.kind === 'notebook').sort(lastUnordered(byName))
  const templatesNb = notebooks.find(isTemplates)
  // Basurero: una nota borrada lleva la fecha en "borrada" y se elimina de verdad a los 30 días (ver efecto más abajo).
  const inTrash = (f?: DriveFile) => !!f?.appProperties?.borrada
  const allNotes = files.filter(f => f.appProperties?.kind === 'note' && !inTrash(f))
  const trash = files.filter(f => f.appProperties?.kind === 'note' && inTrash(f))
    .sort((a, b) => (b.appProperties?.borrada ?? '').localeCompare(a.appProperties?.borrada ?? ''))
  const regular = allNotes.filter(n => n.appProperties?.notebook !== templatesNb?.id) // "Todas las notas" sin plantillas
  const visible = trashView ? trash : notebookId ? allNotes.filter(n => n.appProperties?.notebook === notebookId) : regular
  // Subnotas debajo de su nota y con sangría; si la nota madre no está a la vista, la subnota va arriba. En cada nivel,
  // el orden que se les dio arrastrando; las que no tienen, arriba y la más nueva primero.
  const ids = new Set(visible.map(n => n.id))
  const shownParent = (n: DriveFile) => ids.has(parentOf(n) ?? '') ? parentOf(n) : undefined
  const siblings = (parent?: string) => visible.filter(n => shownParent(n) === parent).sort(firstUnordered(byDate))
  const tree = (parent?: string, depth = 0): [DriveFile, number][] =>
    siblings(parent).flatMap(n => [[n, depth] as [DriveFile, number], ...tree(n.id, depth + 1)])
  const list = trashView ? trash.map(n => [n, 0] as [DriveFile, number]) : tree()
  const saveOrder = (items: DriveFile[], from: number, to: number) =>
    reorder(items, from, to).forEach(({ id, orden }) => store.patch(id, { props: { orden } }))
  const descendants = (id: string): DriveFile[] => allNotes.filter(n => parentOf(n) === id).flatMap(n => [n, ...descendants(n.id)])
  // Ajustes de la cuenta (por ahora la clave de Gemini): un archivo sin contenido en la carpeta oculta de Drive,
  // así se vincula una vez y sirve en todos los aparatos de esa persona.
  const settings = files.find(f => f.appProperties?.kind === 'ajustes')
  const geminiKey = settings?.appProperties?.gemini ?? ''
  const setGeminiKey = (key: string) => act(() => {
    if (settings) store.patch(settings.id, { props: { gemini: key || null } })
    else if (key) store.create({ kind: 'ajustes', gemini: key }, 'Ajustes')
  })
  // Verificador de la clave de notas (no es la clave): va en Drive para que sirva igual en todos los aparatos.
  const verifier = settings?.appProperties?.boveda ?? ''
  const setVerifier = (v: string) => act(() => {
    if (settings) store.patch(settings.id, { props: { boveda: v } })
    else store.create({ kind: 'ajustes', boveda: v }, 'Ajustes')
  })
  const isLocked = (n?: DriveFile) => n?.appProperties?.protegida === 'true' // nota con clave
  const templates = templatesNb ? allNotes.filter(n => n.appProperties?.notebook === templatesNb.id).sort(byName) : []
  const note = noteId ? s.files[noteId] : undefined
  const doc = noteId ? s.texts[noteId] : undefined
  const conflict = noteId ? s.conflicts[noteId] : undefined
  const parent = note && allNotes.find(f => f.id === parentOf(note))
  const cover = note?.appProperties?.cover
  const pendingCount = Object.keys(s.pending).length
  const status = [s.offline && 'Sin conexión',
    pendingCount ? `${pendingCount} ${pendingCount === 1 ? 'cambio pendiente' : 'cambios pendientes'} de subir` : !s.offline && 'Guardado',
  ].filter(Boolean).join(' · ')
  const error = problem ?? (s.error ? messageOf(s.error) : null)
  const email = session?.email
  const hasNote = !!note
  const hasDoc = !!doc
  // Nota fijada: se lee y se copia, pero no se escribe ni se cambia de libreta. Va en Drive: igual en todos los aparatos.
  // Una nota en el basurero se ve igual: solo leer, hasta restaurarla.
  const trashed = inTrash(note)
  const locked = note?.appProperties?.locked === 'true' || trashed
  // Privada (sin Gemini): la nota sola, o todas las de una libreta (también las que se creen después).
  const isPrivate = (f?: DriveFile) => f?.appProperties?.privada === 'true'
  const noteNotebook = notebooks.find(nb => nb.id === note?.appProperties?.notebook)
  const withKey = isLocked(note)
  const sealedNote = withKey && !unlocked // con clave y la caja cerrada: se pide la clave en lugar de la nota
  // Una nota con clave también es privada: Gemini nunca la lee.
  const privacy = isPrivate(noteNotebook) ? 'libreta' as const : isPrivate(note) || withKey ? 'nota' as const : null
  const setPrivate = (f: DriveFile, on: boolean) => store.patch(f.id, { props: { privada: on ? 'true' : null } })
  const notebookName = notebooks.find(nb => nb.id === notebookId)?.name
  const countOf = (nbId: string) => allNotes.filter(n => n.appProperties?.notebook === nbId).length
  const columns = layout.expanded ? 'minmax(0, 1fr)'
    : `${layout.sidebar}px 6px ${layout.listHidden ? '' : `${layout.list}px 6px `}minmax(0, 1fr)`
  const appClass = ['app', noteId && 'con-nota', layout.expanded && 'expandida', layout.listHidden && 'sin-lista'].filter(Boolean).join(' ')

  // Cada columna entre su mínimo y su máximo, y la nota con al menos MIN_EDITOR de ancho.
  function resize(which: 'sidebar' | 'list', width: number) {
    setLayout(l => {
      const other = which === 'sidebar' ? (l.listHidden ? 0 : l.list) : l.sidebar
      const max = Math.min(LIMITS[which][1], window.innerWidth - other - MIN_EDITOR - 12)
      return { ...l, [which]: Math.round(Math.max(LIMITS[which][0], Math.min(max, width))) }
    })
  }

  const fail = (e: unknown) => setProblem(messageOf(e))
  // Crear necesita un id reservado; sin internet y sin ids avisa en vez de fallar en silencio.
  const act = (fn: () => void) => { try { fn() } catch (e) { fail(e) } }

  useEffect(() => { if (session) resume(session) }, [session])

  useEffect(() => {
    if (!email) return
    store.start(email).then(() => setReady(true), e => setProblem(messageOf(e)))
    const stopFolder = desktop ? startFolder(email) : undefined // copia visible en Documentos/Datheke
    // Al volver a la app, al recuperar internet y cada 30 s mientras está a la vista (o con cambios pendientes): así lo
    // cambiado en otro dispositivo llega solo, aunque esta ventana nunca se haya escondido (PC con la nota abierta).
    const sync = () => { store.sync() }
    const retry = setInterval(() => {
      if (document.visibilityState === 'visible' || Object.keys(store.getState().pending).length) sync()
    }, 30000)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    return () => {
      clearInterval(retry)
      stopFolder?.()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('online', sync)
      window.removeEventListener('focus', sync)
    }
  }, [email])

  // Nota que aún no se bajó a este dispositivo.
  useEffect(() => {
    if (noteId && hasNote && !hasDoc) store.ensureText(noteId).catch(e => setProblem(messageOf(e)))
  }, [noteId, hasNote, hasDoc, unlocked])

  // Lo que lleva más de 30 días en el basurero se elimina (en cualquier aparato que esté abierto, ya sincronizado).
  useEffect(() => {
    if (!ready || !s.synced) return
    for (const t of trash) if (daysLeft(t) === 0) store.remove(t.id)
  }, [ready, s.synced, trash])

  // La caja fuerte se cierra sola tras 5 minutos sin tocar la app (también si quedó en segundo plano).
  useEffect(() => {
    const touch = () => vault.touch()
    const check = () => { if (vault.unlocked() && vault.idleFor() > vault.AUTO_LOCK_MS) store.closeVault() }
    const every = setInterval(check, 15000)
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(every)
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  // Proteger: la primera vez se crea la clave; si la caja está cerrada, se abre primero.
  function protect(n: DriveFile) {
    const go = () => store.patch(n.id, { props: { protegida: 'true' } })
    if (!verifier) setKeyDialog({ mode: 'crear', then: go })
    else if (!vault.unlocked()) setKeyDialog({ mode: 'abrir', then: go })
    else go()
  }

  function unprotect(n: DriveFile) {
    if (confirm(`¿Quitar la clave a "${n.name || UNTITLED}"? Se podrá ver sin clave en este y tus otros aparatos.`))
      store.patch(n.id, { props: { protegida: null } })
  }

  // Olvidé la clave: se vuelve a entrar con Google (prueba que es el dueño) y se pone una clave nueva. Las notas se
  // vuelven a bajar de Drive, donde están sin cifrar; en los otros aparatos se abren con la clave nueva.
  async function forgotKey() {
    if (!confirm('Para poner una clave nueva tienes que volver a entrar con tu cuenta de Google (necesita internet). ¿Seguir?')) return
    try {
      setSession(await signIn(session?.email))
      setKeyDialog({ mode: 'nueva' })
    } catch (e) { fail(e) }
  }

  async function login() {
    if (desktop) setProblem(null)
    setWaiting(desktop)
    try {
      setSession(await signIn(session?.email))
      setProblem(null)
      store.sync()
    } catch (e) { fail(e) } finally { setWaiting(false) }
  }

  async function logout() {
    if (pendingCount && !confirm(`Hay ${pendingCount} cambios sin subir a Drive; si sales se pierden. ¿Salir igual?`)) return
    await store.clearLocal()
    forgetSession()
    location.reload()
  }

  function open(id: string | null) {
    setNoteId(id)
    setPicker(false)
    setWriting(false)
  }

  function renameNotebook(nb: DriveFile) {
    const name = prompt('Nuevo nombre de la libreta', nb.name)?.trim()
    if (name) store.patch(nb.id, { name })
  }

  function deleteNotebook(nb: DriveFile) {
    if (allNotes.some(n => n.appProperties?.notebook === nb.id)) return alert('La libreta tiene notas. Muévelas o bórralas primero.')
    if (!confirm(`¿Borrar la libreta "${nb.name}"?`)) return
    store.remove(nb.id)
    setNotebookId(null)
  }

  // Una subnota va en la libreta de su nota madre.
  function newNote(title = '', html = '', parentId?: string) {
    act(() => {
      const nbId = (parentId ? note?.appProperties?.notebook : notebookId)
        ?? notebooks.find(nb => !isTemplates(nb))?.id ?? store.create({ kind: 'notebook' }, 'Mis notas')
      open(store.create({ kind: 'note', notebook: nbId, ...(parentId ? { parent: parentId } : {}) }, title, html, 'text/html'))
    })
  }

  async function fromTemplate(value: string) {
    const builtIn = TEMPLATES.find(t => t.title === value)
    if (builtIn) return newNote(builtIn.title, builtIn.html)
    const tpl = s.files[value]
    if (!tpl) return
    try {
      newNote(tpl.name === UNTITLED ? '' : tpl.name, s.texts[tpl.id]?.text ?? await readNote(tpl.id, tpl.mimeType))
    } catch (e) { fail(e) }
  }

  function saveAsTemplate() {
    if (!doc) return
    act(() => {
      const nbId = templatesNb?.id ?? store.create({ kind: 'notebook', templates: 'true' }, 'Plantillas')
      store.create({ kind: 'note', notebook: nbId }, doc.title, doc.text, 'text/html')
      alert(`Guardada como plantilla en la libreta "${templatesNb?.name ?? 'Plantillas'}".`)
    })
  }

  // La nota se mueve con todas sus subnotas.
  function moveNote(nbId: string) {
    if (note) for (const n of [note, ...descendants(note.id)]) store.patch(n.id, { props: { notebook: nbId } })
  }

  async function changeCover() {
    if (!note) return
    const file = await pickImage()
    if (!file) return
    try {
      store.patch(note.id, { props: { cover: await uploadImage(file) } })
    } catch (e) { fail(e) }
  }

  // Borrar manda al basurero (con sus subnotas); se puede restaurar durante 30 días.
  function deleteNote() {
    if (!note) return
    const subs = descendants(note.id)
    if (!confirm(`¿Mandar "${note.name || UNTITLED}"${subs.length ? ` y sus ${subs.length} subnotas` : ''} al basurero? Puedes restaurarla durante 30 días.`)) return
    const when = nowIso()
    for (const n of [note, ...subs]) store.patch(n.id, { props: { borrada: when } })
    setNoteId(null)
  }

  // Notas del basurero que se borraron junto con esta (sus subnotas, con la misma fecha).
  const trashedWith = (n: DriveFile): DriveFile[] => trash.filter(t => parentOf(t) === n.id && t.appProperties?.borrada === n.appProperties?.borrada)
    .flatMap(t => [t, ...trashedWith(t)])

  function restore(n: DriveFile) {
    // Si su libreta ya no existe, vuelve a la primera.
    const home = notebooks.some(nb => nb.id === n.appProperties?.notebook) ? undefined
      : notebooks.find(nb => !isTemplates(nb))?.id
    for (const t of [n, ...trashedWith(n)]) store.patch(t.id, { props: { borrada: null, ...(home ? { notebook: home } : {}) } })
    setTrashView(false)
    setNotebookId(null)
  }

  function deleteForever(n: DriveFile) {
    if (!confirm(`¿Eliminar "${n.name || UNTITLED}" para siempre? Esto no se puede deshacer.`)) return
    for (const t of [n, ...trashedWith(n)]) store.remove(t.id)
    setNoteId(null)
  }

  function emptyTrash() {
    if (!confirm(`¿Vaciar el basurero? Se eliminan ${trash.length} notas para siempre.`)) return
    for (const t of trash) store.remove(t.id)
    setNoteId(null)
  }

  if (!session) return (
    <div className="login">
      <h1><img className="logo" src="./logo.png" alt="Datheke" width="220" height="220" /></h1>
      <p>Tus notas se guardan en tu propio Google Drive.</p>
      <button className="principal" onClick={login} disabled={waiting}>Entrar con Google</button>
      {waiting && <p>Se abrió tu navegador: entra con Google ahí y luego vuelve a esta ventana.</p>}
      {error && <p className="error">{error === 'auth' ? 'Vuelve a entrar.' : error}</p>}
    </div>
  )

  return (
    <div className={appClass} style={{ '--columnas': columns } as CSSProperties}>
      <nav className="libretas" aria-label="Libretas">
        <div className="cuenta">
          <span className="avatar" aria-hidden="true">{session.email[0]?.toUpperCase()}</span>
          <span className="correo" title={session.email}>{session.email}</span>
          <button className="btn-icono" onClick={logout} title="Salir" aria-label="Salir"><LogOut size={16} /></button>
        </div>
        <button className="principal nueva-nota solo-pc" onClick={() => newNote()}><Plus size={18} /> Nota</button>
        <button className={notebookId === null && !trashView ? 'item activo' : 'item'} onClick={() => { setNotebookId(null); setTrashView(false) }}>
          <FileText size={16} /><span>Todas las notas</span><small>{regular.length}</small>
        </button>
        <div className="seccion">
          <span>Libretas</span>
          <button className="btn-icono" title="Nueva libreta" aria-label="Nueva libreta" onClick={() => {
            const name = prompt('Nombre de la nueva libreta')?.trim()
            if (name) act(() => setNotebookId(store.create({ kind: 'notebook' }, name)))
          }}><Plus size={16} /></button>
        </div>
        {notebooks.map(nb => (
          <div key={nb.id} className={notebookId === nb.id ? 'item activo' : 'item'} data-grupo="libretas">
            <button className="item-nombre" onClick={() => { setNotebookId(nb.id); setTrashView(false) }}>
              <Notebook size={16} /><span>{nb.name}</span><small>{countOf(nb.id)}</small>
            </button>
            {isPrivate(nb) && notebookId !== nb.id && <ShieldCheck size={14} className="privada-icono" aria-label="Libreta privada" />}
            {notebookId === nb.id && <>
              <button className={isPrivate(nb) ? 'btn-icono privada-icono' : 'btn-icono'} onClick={() => {
                if (isPrivate(nb) ? confirm(`¿Quitar "privada" a la libreta "${nb.name}"? Gemini podrá volver a leer sus notas (las marcadas una por una siguen privadas).`)
                  : confirm(`¿Hacer privada la libreta "${nb.name}"? Gemini no podrá leer ninguna de sus notas, tampoco las nuevas. Dictar sigue funcionando (solo envía tu voz).`))
                  setPrivate(nb, !isPrivate(nb))
              }} title={isPrivate(nb) ? 'Libreta privada (toca para quitar)' : 'Hacer privada: sin Gemini'}
                aria-label={isPrivate(nb) ? 'Quitar privada a la libreta' : 'Hacer privada la libreta'}>
                {isPrivate(nb) ? <ShieldCheck size={14} /> : <Shield size={14} />}
              </button>
              <button className="btn-icono" onClick={() => renameNotebook(nb)} title="Renombrar libreta" aria-label="Renombrar libreta"><Pencil size={14} /></button>
              <button className="btn-icono" onClick={() => deleteNotebook(nb)} title="Borrar libreta" aria-label="Borrar libreta"><Trash2 size={14} /></button>
            </>}
            <button className="agarre-lista" tabIndex={-1} title="Arrastra para ordenar" aria-label="Arrastrar para ordenar"
              onPointerDown={e => startSort(e, (from, to) => saveOrder(notebooks, from, to))}><GripVertical size={14} /></button>
          </div>
        ))}
        <button className={trashView ? 'item activo basurero' : 'item basurero'} onClick={() => { setTrashView(true); setNotebookId(null) }}>
          <Trash2 size={16} /><span>Basurero</span><small>{trash.length || ''}</small>
        </button>
      </nav>
      <Resizer className="divisor-libretas" label="Ancho de la barra de libretas" value={layout.sidebar}
        onChange={w => resize('sidebar', w)} reset={() => resize('sidebar', LAYOUT.sidebar)} />

      <section className="lista" aria-label="Notas">
        <header>
          <div className="lista-titulo">
            <h2>{trashView ? 'Basurero' : notebookName ?? 'Todas las notas'}</h2>
            <small>{list.length}</small>
            <button className="btn-icono" onClick={() => store.sync()} title="Sincronizar" aria-label="Sincronizar"><RefreshCw size={16} /></button>
            {trashView && trash.length > 0 && <button className="vaciar" onClick={emptyTrash}>Vaciar</button>}
          </div>
          <div className="lista-acciones">
            <button className="principal solo-celular" onClick={() => newNote()}><Plus size={18} /> Nota</button>
            <select value="" aria-label="Nueva nota desde plantilla" onChange={e => fromTemplate(e.target.value)}>
              <option value="">Desde plantilla…</option>
              {TEMPLATES.map(t => <option key={t.title} value={t.title}>{t.title}</option>)}
              {templates.map(t => <option key={t.id} value={t.id}>{t.name || UNTITLED}</option>)}
            </select>
            <span className={pendingCount || s.offline ? 'estado pendiente' : 'estado'} role="status">{status}</span>
          </div>
        </header>
        <div className="tarjetas">
          {!ready || (!s.synced && !files.length) ? <p className="vacio">Cargando…</p>
            : list.length === 0 ? <p className="vacio">{trashView ? 'El basurero está vacío' : 'Sin notas'}</p>
            : list.map(([n, depth]) => (
              // Se ordena entre sus hermanas: las del mismo nivel y la misma nota madre (data-grupo).
              <div key={n.id} className="nota-fila" data-grupo={shownParent(n) ?? 'raiz'} style={{ marginLeft: 8 + depth * 16 }}>
                <button className={n.id === noteId ? 'nota activa' : 'nota'} onClick={() => open(n.id)}>
                  <strong>
                    {depth > 0 && '↳ '}{s.conflicts[n.id] && '⚠️ '}{n.appProperties?.icon && `${n.appProperties.icon} `}{n.name || UNTITLED}
                  </strong>
                  {s.texts[n.id] && !(isLocked(n) && !unlocked) && <span className="resumen">{preview(s.texts[n.id].text)}</span>}
                  {isLocked(n) && !unlocked && <span className="resumen">🔐 Nota con clave</span>}
                  {trashView && <span className="resumen basurero-dias">Se elimina en {daysLeft(n)} días</span>}
                  <small>{isLocked(n) && <LockKeyhole size={12} aria-label="Con clave" />}{n.appProperties?.locked === 'true' && <Lock size={12} aria-label="Fijada" />}{shortDate(n.modifiedTime)}</small>
                </button>
                <button className="agarre-lista" tabIndex={-1} title="Arrastra para ordenar" aria-label="Arrastrar para ordenar"
                  onPointerDown={e => startSort(e, (from, to) => saveOrder(siblings(shownParent(n)), from, to))}><GripVertical size={16} /></button>
              </div>
            ))}
        </div>
      </section>
      <Resizer className="divisor-lista" label="Ancho de la lista de notas" value={layout.list}
        onChange={w => resize('list', w)} reset={() => resize('list', LAYOUT.list)} />

      <main className="editor">
        {note ? <>
          <header className="nota-barra">
            <button className="btn-icono volver" onClick={() => open(null)} aria-label="Volver" title="Volver"><ChevronLeft size={20} /></button>
            <button className="btn-icono solo-pc" disabled={layout.expanded} onClick={() => setLayout(l => ({ ...l, listHidden: !l.listHidden }))}
              title={layout.listHidden ? 'Mostrar lista de notas' : 'Ocultar lista de notas'}
              aria-label={layout.listHidden ? 'Mostrar lista de notas' : 'Ocultar lista de notas'}>
              {layout.listHidden ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <button className="btn-icono solo-pc" onClick={() => setLayout(l => ({ ...l, expanded: !l.expanded }))}
              title={layout.expanded ? 'Salir de pantalla completa' : 'Pantalla completa'}
              aria-label={layout.expanded ? 'Salir de pantalla completa' : 'Pantalla completa'}>
              {layout.expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <div className="ruta">
              <select value={note.appProperties?.notebook} onChange={e => moveNote(e.target.value)} disabled={locked}
                aria-label="Libreta de la nota" title={locked ? 'Nota fijada: toca Editar para moverla' : 'Mover a otra libreta'}>
                {notebooks.map(nb => <option key={nb.id} value={nb.id}>{nb.name}</option>)}
              </select>
              <ChevronRight size={14} aria-hidden="true" />
              <span className="ruta-nota">{note.name || UNTITLED}</span>
              {withKey ? <LockKeyhole size={14} className="privada-icono" aria-label="Nota con clave" />
                : privacy && <ShieldCheck size={14} className="privada-icono" aria-label="Privada: sin Gemini" />}
            </div>
            {!trashed && <>
            <button className={locked ? 'fijar fijada' : 'fijar'} onClick={() => store.patch(note.id, { props: { locked: locked ? null : 'true' } })}
              title={locked ? 'Cambiar la nota' : 'Fijar: solo leer y copiar, sin cambios sin querer'}>
              {locked ? <><Pencil size={16} /> Editar</> : <><Lock size={16} /> Fijar</>}
            </button>
            <button className="btn-icono" onClick={() => newNote('', '', note.id)} title="Nueva subnota" aria-label="Nueva subnota"><FilePlus size={18} /></button>
            {withKey && unlocked && <button className="btn-icono" onClick={() => store.closeVault()} title="Cerrar las notas con clave"
              aria-label="Cerrar las notas con clave"><LockKeyhole size={18} /></button>}
            <MoreMenu items={[
              withKey
                ? { label: 'Quitar clave', icon: <KeyRound size={16} />, onClick: () => unprotect(note) }
                : { label: 'Proteger con clave', icon: <LockKeyhole size={16} />, onClick: () => protect(note) },
              privacy === 'libreta'
                ? { label: 'Privada por su libreta', icon: <ShieldCheck size={16} />, onClick: () => alert(`Esta nota es privada porque está en la libreta "${noteNotebook?.name}". Para quitarlo, toca el escudo de la libreta.`) }
                : privacy === 'nota'
                  ? { label: 'Quitar privada (permitir Gemini)', icon: <ShieldOff size={16} />, onClick: () => setPrivate(note, false) }
                  : { label: 'Privada: sin Gemini', icon: <Shield size={16} />, onClick: () => setPrivate(note, true) },
              { label: 'Guardar como plantilla', icon: <LayoutTemplate size={16} />, onClick: saveAsTemplate },
              { label: 'Borrar nota', icon: <Trash2 size={16} />, onClick: deleteNote, danger: true },
            ]} />
            </>}
          </header>
          {trashed ? <div className="aviso-fijada aviso-basurero">
            🗑️ Está en el basurero: se elimina sola a los 30 días.
            <button className="principal" onClick={() => restore(note)}>Restaurar</button>
            <button className="peligro" onClick={() => deleteForever(note)}>Eliminar para siempre</button>
          </div>
            : locked && <p className="aviso-fijada">🔒 Nota fijada: puedes leerla, copiar y marcar casillas. Toca <strong>Editar</strong> para cambiarla.</p>}
          {sealedNote ? <div className="nota-scroll">
            <h1 className="titulo-cerrado">{note.name || UNTITLED}</h1>
            <Unlock verifier={verifier} onOpen={() => { store.openVault() }} onForgot={forgotKey} />
          </div> : <>
          {conflict && <div className="conflicto" role="alert">
            <p><strong>⚠️ Esta nota también se cambió en otro dispositivo.</strong> ¿Qué versión quieres conservar?</p>
            <details>
              <summary>Ver la versión del otro dispositivo</summary>
              <p className="otra"><strong>{conflict.title || UNTITLED}</strong>{'\n'}{plain(conflict.text)}</p>
            </details>
            <div>
              <button className="principal" onClick={() => store.resolve(note.id, 'mine')}>La de este dispositivo</button>
              <button onClick={() => store.resolve(note.id, 'theirs')}>La del otro dispositivo</button>
            </div>
          </div>}
          {/* Portada, título y texto bajan juntos: al bajar por la nota la portada se va y deja todo el espacio. */}
          <div className={writing ? 'nota-scroll escribiendo' : 'nota-scroll'} onInput={() => setWriting(true)}>
            {cover && <Cover id={cover} />}
            <div className="cabecera">
              {parent && <button className="enlace" onClick={() => open(parent.id)}>↑ {parent.name || UNTITLED}</button>}
              {locked ? note.appProperties?.icon && <span className="icono">{note.appProperties.icon}</span> : <>
                <button className={note.appProperties?.icon ? 'icono' : 'enlace'} aria-label="Ícono de la nota" onClick={() => setPicker(!picker)}>
                  {note.appProperties?.icon ?? 'Agregar ícono'}
                </button>
                {note.appProperties?.icon && <button className="enlace" onClick={() => store.patch(note.id, { props: { icon: null } })}>Quitar ícono</button>}
                <button className="enlace" onClick={changeCover}>{cover ? 'Cambiar portada' : 'Agregar portada'}</button>
                {cover && <button className="enlace" onClick={() => store.patch(note.id, { props: { cover: null } })}>Quitar portada</button>}
              </>}
            </div>
            {picker && !locked && <EmojiPicker onPick={icon => { store.patch(note.id, { props: { icon } }); setPicker(false) }} />}
            {doc ? <>
              <input className="titulo" value={doc.title} placeholder="Título" readOnly={locked} onChange={e => store.edit(note.id, { title: e.target.value })} />
              <Editor key={`${note.id}-${s.revs[note.id] ?? 0}`} content={doc.text} onChange={text => store.edit(note.id, { text })}
                notes={allNotes.map(n => ({ id: n.id, label: n.name || UNTITLED }))} onOpenNote={open} onError={fail} editable={!locked}
                geminiKey={geminiKey} onGeminiKey={setGeminiKey}
                privacy={privacy} onPrivate={() => setPrivate(note, true)} />
            </> : <p className="vacio">Cargando…</p>}
          </div>
          </>}
        </> : <p className="vacio">Elige o crea una nota</p>}
      </main>

      {keyDialog && <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Clave de notas">
        <div className="ventana">
          {keyDialog.mode === 'abrir'
            ? <Unlock compact verifier={verifier} onForgot={() => { setKeyDialog(null); forgotKey() }} onOpen={async () => {
              await store.openVault()
              setKeyDialog(null)
              keyDialog.then?.()
            }} />
            : <CreateKey again={keyDialog.mode === 'nueva'} onCancel={() => setKeyDialog(null)} onCreated={async v => {
              setVerifier(v)
              await store.openVault()
              setKeyDialog(null)
              keyDialog.then?.()
            }} />}
          {keyDialog.mode === 'abrir' && <button className="enlace" onClick={() => setKeyDialog(null)}>Cancelar</button>}
        </div>
      </div>}

      {error && <div className="aviso" role="alert">
        {error === 'auth' ? 'La sesión de Google venció. Tus cambios están guardados en este dispositivo.' : error}
        {error === 'auth'
          ? <button onClick={login}>Reconectar</button>
          : <button onClick={() => { setProblem(null); store.sync() }}>Reintentar</button>}
      </div>}
    </div>
  )
}
