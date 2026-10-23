import { useEffect, useState, useSyncExternalStore } from 'react'
import { desktop, forgetSession, loadSession, resume, signIn } from './auth.ts'
import { AuthError, OfflineError, readNote, type DriveFile } from './drive.ts'
import Editor, { Cover, EmojiPicker } from './Editor.tsx'
import { startFolder } from './folder.ts'
import { pickImage, uploadImage } from './images.ts'
import * as store from './sync.ts'
import { TEMPLATES } from './templates.ts'

const UNTITLED = store.UNTITLED
const byName = (a: DriveFile, b: DriveFile) => a.name.localeCompare(b.name)
const byDate = (a: DriveFile, b: DriveFile) => b.modifiedTime.localeCompare(a.modifiedTime)
const isTemplates = (f: DriveFile) => f.appProperties?.templates === 'true' // libreta "Plantillas"
const parentOf = (n: DriveFile) => n.appProperties?.parent
const messageOf = (e: unknown) => e instanceof AuthError ? 'auth'
  : e instanceof OfflineError ? 'Sin conexión: esto necesita internet.' : e instanceof Error ? e.message : String(e)
// Vista previa en texto de la otra versión (DOMParser no ejecuta nada de lo que lee).
const plain = (html: string) =>
  new DOMParser().parseFromString(html.replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, '\n'), 'text/html').body.textContent ?? ''

export default function App() {
  const [session, setSession] = useState(loadSession)
  const s = useSyncExternalStore(store.subscribe, store.getState)
  const [ready, setReady] = useState(false) // copia local cargada
  const [notebookId, setNotebookId] = useState<string | null>(null) // null = todas
  const [noteId, setNoteId] = useState<string | null>(null)
  const [picker, setPicker] = useState(false) // selector de ícono de la nota
  const [problem, setProblem] = useState<string | null>(null) // error de una acción ('auth' = sesión vencida)
  const [waiting, setWaiting] = useState(false) // escritorio: esperando que termine el login en el navegador

  const files = Object.values(s.files)
  const notebooks = files.filter(f => f.appProperties?.kind === 'notebook').sort(byName)
  const templatesNb = notebooks.find(isTemplates)
  const allNotes = files.filter(f => f.appProperties?.kind === 'note')
  const regular = allNotes.filter(n => n.appProperties?.notebook !== templatesNb?.id) // "Todas las notas" sin plantillas
  const visible = notebookId ? allNotes.filter(n => n.appProperties?.notebook === notebookId) : regular
  // Subnotas debajo de su nota y con sangría; si la nota madre no está a la vista, la subnota va arriba.
  const ids = new Set(visible.map(n => n.id))
  const tree = (parent?: string, depth = 0): [DriveFile, number][] => visible
    .filter(n => (ids.has(parentOf(n) ?? '') ? parentOf(n) : undefined) === parent).sort(byDate)
    .flatMap(n => [[n, depth] as [DriveFile, number], ...tree(n.id, depth + 1)])
  const list = tree()
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

  const fail = (e: unknown) => setProblem(messageOf(e))
  // Crear necesita un id reservado; sin internet y sin ids avisa en vez de fallar en silencio.
  const act = (fn: () => void) => { try { fn() } catch (e) { fail(e) } }

  useEffect(() => { if (session) resume(session) }, [session])

  useEffect(() => {
    if (!email) return
    store.start(email).then(() => setReady(true), e => setProblem(messageOf(e)))
    const stopFolder = desktop ? startFolder(email) : undefined // copia visible en Documentos/Datheke
    // Al volver a la app o recuperar internet se sincroniza; con cambios pendientes se reintenta cada 30 s.
    const sync = () => { store.sync() }
    const retry = setInterval(() => { if (Object.keys(store.getState().pending).length) sync() }, 30000)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('online', sync)
    return () => {
      clearInterval(retry)
      stopFolder?.()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('online', sync)
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
    <div className={noteId ? 'app con-nota' : 'app'}>
      <nav className="libretas">
        <div className="cuenta">
          <span title={session.email}>{session.email}</span>
          <button className="enlace" onClick={logout}>Salir</button>
        </div>
        <button className={notebookId === null ? 'libreta activa' : 'libreta'} onClick={() => setNotebookId(null)}>
          Todas las notas <small>{regular.length}</small>
        </button>
        {notebooks.map(nb => (
          <div key={nb.id} className={notebookId === nb.id ? 'libreta activa' : 'libreta'}>
            <button onClick={() => setNotebookId(nb.id)}>{nb.name}</button>
            {notebookId === nb.id && <>
              <button onClick={() => renameNotebook(nb)} title="Renombrar libreta" aria-label="Renombrar libreta">✎</button>
              <button onClick={() => deleteNotebook(nb)} title="Borrar libreta" aria-label="Borrar libreta">✕</button>
            </>}
          </div>
        ))}
        <button className="libreta nueva" onClick={() => {
          const name = prompt('Nombre de la nueva libreta')?.trim()
          if (name) act(() => setNotebookId(store.create({ kind: 'notebook' }, name)))
        }}>+ Libreta</button>
      </nav>

      <section className="lista">
        <header>
          <button className="principal" onClick={() => newNote()}>+ Nota</button>
          <select value="" aria-label="Nueva nota desde plantilla" onChange={e => fromTemplate(e.target.value)}>
            <option value="">Plantilla…</option>
            {TEMPLATES.map(t => <option key={t.title} value={t.title}>{t.title}</option>)}
            {templates.map(t => <option key={t.id} value={t.id}>{t.name || UNTITLED}</option>)}
          </select>
          <button onClick={() => store.sync()} title="Sincronizar" aria-label="Sincronizar">↻</button>
          <span className={pendingCount || s.offline ? 'estado pendiente' : 'estado'} role="status">{status}</span>
        </header>
        {!ready || (!s.synced && !files.length) ? <p className="vacio">Cargando…</p>
          : list.length === 0 ? <p className="vacio">Sin notas</p>
          : list.map(([n, depth]) => (
            <button key={n.id} className={n.id === noteId ? 'nota activa' : 'nota'} style={{ paddingLeft: 12 + depth * 16 }} onClick={() => open(n.id)}>
              <strong>
                {depth > 0 && '↳ '}{s.conflicts[n.id] && '⚠️ '}{n.appProperties?.icon && `${n.appProperties.icon} `}{n.name || UNTITLED}
              </strong>
              <small>{new Date(n.modifiedTime).toLocaleString()}</small>
            </button>
          ))}
      </section>

      <main className="editor">
        {note ? <>
          <header>
            <button className="volver" onClick={() => open(null)} aria-label="Volver">←</button>
            <select value={note.appProperties?.notebook} onChange={e => moveNote(e.target.value)} aria-label="Libreta">
              {notebooks.map(nb => <option key={nb.id} value={nb.id}>{nb.name}</option>)}
            </select>
            <button onClick={() => newNote('', '', note.id)}>+ Subnota</button>
            <button onClick={saveAsTemplate}>Guardar como plantilla</button>
            <button onClick={deleteNote}>Borrar</button>
          </header>
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
          {cover && <Cover id={cover} />}
          <div className="cabecera">
            {parent && <button className="enlace" onClick={() => open(parent.id)}>↑ {parent.name || UNTITLED}</button>}
            <button className={note.appProperties?.icon ? 'icono' : 'enlace'} aria-label="Ícono de la nota" onClick={() => setPicker(!picker)}>
              {note.appProperties?.icon ?? 'Agregar ícono'}
            </button>
            {note.appProperties?.icon && <button className="enlace" onClick={() => store.patch(note.id, { props: { icon: null } })}>Quitar ícono</button>}
            <button className="enlace" onClick={changeCover}>{cover ? 'Cambiar portada' : 'Agregar portada'}</button>
            {cover && <button className="enlace" onClick={() => store.patch(note.id, { props: { cover: null } })}>Quitar portada</button>}
          </div>
          {picker && <EmojiPicker onPick={icon => { store.patch(note.id, { props: { icon } }); setPicker(false) }} />}
          {doc ? <>
            <input className="titulo" value={doc.title} placeholder="Título" onChange={e => store.edit(note.id, { title: e.target.value })} />
            <Editor key={`${note.id}-${s.revs[note.id] ?? 0}`} content={doc.text} onChange={text => store.edit(note.id, { text })}
              notes={allNotes.map(n => ({ id: n.id, label: n.name || UNTITLED }))} onOpenNote={open} onError={fail} />
          </> : <p className="vacio">Cargando…</p>}
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
