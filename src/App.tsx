import {
  ChevronLeft, ChevronRight, FilePlus, FileText, GripVertical, LayoutTemplate, Lock, LogOut, Maximize2, Minimize2, Notebook,
  PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Trash2,
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

const UNTITLED = store.UNTITLED
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
  const [noteId, setNoteId] = useState<string | null>(null)
  const [picker, setPicker] = useState(false) // selector de ícono de la nota
  const [problem, setProblem] = useState<string | null>(null) // error de una acción ('auth' = sesión vencida)
  const [waiting, setWaiting] = useState(false) // escritorio: esperando que termine el login en el navegador
  const [layout, setLayout] = useState(loadLayout)
  // Al escribir en la nota (título o texto) la portada se esconde, y vuelve al abrirla de nuevo.
  const [writing, setWriting] = useState(false)
  useEffect(() => {
    try { localStorage.setItem('datheke-diseno', JSON.stringify(layout)) } catch { /* sin guardar: el diseño de siempre */ }
  }, [layout])

  const files = Object.values(s.files)
  const notebooks = files.filter(f => f.appProperties?.kind === 'notebook').sort(lastUnordered(byName))
  const templatesNb = notebooks.find(isTemplates)
  const allNotes = files.filter(f => f.appProperties?.kind === 'note')
  const regular = allNotes.filter(n => n.appProperties?.notebook !== templatesNb?.id) // "Todas las notas" sin plantillas
  const visible = notebookId ? allNotes.filter(n => n.appProperties?.notebook === notebookId) : regular
  // Subnotas debajo de su nota y con sangría; si la nota madre no está a la vista, la subnota va arriba. En cada nivel,
  // el orden que se les dio arrastrando; las que no tienen, arriba y la más nueva primero.
  const ids = new Set(visible.map(n => n.id))
  const shownParent = (n: DriveFile) => ids.has(parentOf(n) ?? '') ? parentOf(n) : undefined
  const siblings = (parent?: string) => visible.filter(n => shownParent(n) === parent).sort(firstUnordered(byDate))
  const tree = (parent?: string, depth = 0): [DriveFile, number][] =>
    siblings(parent).flatMap(n => [[n, depth] as [DriveFile, number], ...tree(n.id, depth + 1)])
  const list = tree()
  const saveOrder = (items: DriveFile[], from: number, to: number) =>
    reorder(items, from, to).forEach(({ id, orden }) => store.patch(id, { props: { orden } }))
  const descendants = (id: string): DriveFile[] => allNotes.filter(n => parentOf(n) === id).flatMap(n => [n, ...descendants(n.id)])
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
  const locked = note?.appProperties?.locked === 'true'
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
  }, [noteId, hasNote, hasDoc])

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

  function deleteNote() {
    if (!note) return
    if (descendants(note.id).length) return alert('Esta nota tiene subnotas. Bórralas primero.')
    if (!confirm(`¿Borrar "${note.name || UNTITLED}"? No se puede deshacer.`)) return
    store.remove(note.id)
    setNoteId(null)
  }

  if (!session) return (
    <div className="login">
      <h1>Datheke</h1>
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
        <button className={notebookId === null ? 'item activo' : 'item'} onClick={() => setNotebookId(null)}>
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
            <button className="item-nombre" onClick={() => setNotebookId(nb.id)}>
              <Notebook size={16} /><span>{nb.name}</span><small>{countOf(nb.id)}</small>
            </button>
            {notebookId === nb.id && <>
              <button className="btn-icono" onClick={() => renameNotebook(nb)} title="Renombrar libreta" aria-label="Renombrar libreta"><Pencil size={14} /></button>
              <button className="btn-icono" onClick={() => deleteNotebook(nb)} title="Borrar libreta" aria-label="Borrar libreta"><Trash2 size={14} /></button>
            </>}
            <button className="agarre-lista" tabIndex={-1} title="Arrastra para ordenar" aria-label="Arrastrar para ordenar"
              onPointerDown={e => startSort(e, (from, to) => saveOrder(notebooks, from, to))}><GripVertical size={14} /></button>
          </div>
        ))}
      </nav>
      <Resizer className="divisor-libretas" label="Ancho de la barra de libretas" value={layout.sidebar}
        onChange={w => resize('sidebar', w)} reset={() => resize('sidebar', LAYOUT.sidebar)} />

      <section className="lista" aria-label="Notas">
        <header>
          <div className="lista-titulo">
            <h2>{notebookName ?? 'Todas las notas'}</h2>
            <small>{list.length}</small>
            <button className="btn-icono" onClick={() => store.sync()} title="Sincronizar" aria-label="Sincronizar"><RefreshCw size={16} /></button>
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
            : list.length === 0 ? <p className="vacio">Sin notas</p>
            : list.map(([n, depth]) => (
              // Se ordena entre sus hermanas: las del mismo nivel y la misma nota madre (data-grupo).
              <div key={n.id} className="nota-fila" data-grupo={shownParent(n) ?? 'raiz'} style={{ marginLeft: 8 + depth * 16 }}>
                <button className={n.id === noteId ? 'nota activa' : 'nota'} onClick={() => open(n.id)}>
                  <strong>
                    {depth > 0 && '↳ '}{s.conflicts[n.id] && '⚠️ '}{n.appProperties?.icon && `${n.appProperties.icon} `}{n.name || UNTITLED}
                  </strong>
                  {s.texts[n.id] && <span className="resumen">{preview(s.texts[n.id].text)}</span>}
                  <small>{n.appProperties?.locked === 'true' && <Lock size={12} aria-label="Fijada" />}{shortDate(n.modifiedTime)}</small>
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
            </div>
            <button className={locked ? 'fijar fijada' : 'fijar'} onClick={() => store.patch(note.id, { props: { locked: locked ? null : 'true' } })}
              title={locked ? 'Cambiar la nota' : 'Fijar: solo leer y copiar, sin cambios sin querer'}>
              {locked ? <><Pencil size={16} /> Editar</> : <><Lock size={16} /> Fijar</>}
            </button>
            <button className="btn-icono" onClick={() => newNote('', '', note.id)} title="Nueva subnota" aria-label="Nueva subnota"><FilePlus size={18} /></button>
            <MoreMenu items={[
              { label: 'Guardar como plantilla', icon: <LayoutTemplate size={16} />, onClick: saveAsTemplate },
              { label: 'Borrar nota', icon: <Trash2 size={16} />, onClick: deleteNote, danger: true },
            ]} />
          </header>
          {locked && <p className="aviso-fijada">🔒 Nota fijada: puedes leerla y copiar. Toca <strong>Editar</strong> para cambiarla.</p>}
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
                notes={allNotes.map(n => ({ id: n.id, label: n.name || UNTITLED }))} onOpenNote={open} onError={fail} editable={!locked} />
            </> : <p className="vacio">Cargando…</p>}
          </div>
        </> : <p className="vacio">Elige o crea una nota</p>}
      </main>

      {error && <div className="aviso" role="alert">
        {error === 'auth' ? 'La sesión de Google venció. Tus cambios están guardados en este dispositivo.' : error}
        {error === 'auth'
          ? <button onClick={login}>Reconectar</button>
          : <button onClick={() => { setProblem(null); store.sync() }}>Reintentar</button>}
      </div>}
    </div>
  )
}
