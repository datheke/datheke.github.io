import { useEffect, useRef, useState } from 'react'
import { forgetSession, loadSession, signIn } from './auth.ts'
import { AuthError, deleteFile, listFiles, readFile, saveFile, setToken, type DriveFile } from './drive.ts'

type Snapshot = { title: string; text: string }
const UNTITLED = 'Sin título'
const byName = (a: DriveFile, b: DriveFile) => a.name.localeCompare(b.name)
const byDate = (a: DriveFile, b: DriveFile) => b.modifiedTime.localeCompare(a.modifiedTime)

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [started, setStarted] = useState(() => !!session && session.expires > Date.now())
  const [files, setFiles] = useState<DriveFile[] | null>(null) // null = cargando
  const [notebookId, setNotebookId] = useState<string | null>(null) // null = todas
  const [noteId, setNoteId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState<string | null>(null) // null = cargando
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null) // 'auth' = sesión vencida
  const local = useRef(new Map<string, Snapshot>()) // contenido ya cargado o editado
  const dirty = useRef(new Set<string>()) // notas con cambios sin subir
  const savingId = useRef<string | null>(null)
  const timer = useRef(0)

  const notebooks = (files ?? []).filter(f => f.appProperties?.kind === 'notebook').sort(byName)
  const allNotes = (files ?? []).filter(f => f.appProperties?.kind === 'note')
  const notes = allNotes.filter(f => !notebookId || f.appProperties?.notebook === notebookId).sort(byDate)
  const note = allNotes.find(f => f.id === noteId)
  const modified = note?.modifiedTime

  function fail(e: unknown) {
    setStatus('')
    setError(e instanceof AuthError ? 'auth' : e instanceof Error ? e.message : String(e))
  }

  async function refresh() {
    try {
      const fresh = await listFiles()
      // Lo no editado se vuelve a leer de Drive por si cambió en otro dispositivo.
      for (const id of local.current.keys()) if (!dirty.current.has(id) && id !== savingId.current) local.current.delete(id)
      setFiles(fresh.map(f => local.current.has(f.id) ? { ...f, name: local.current.get(f.id)!.title } : f))
    } catch (e) { fail(e) }
  }

  // Sube los cambios pendientes de a una nota; si falla, quedan pendientes para reintentar.
  async function flush() {
    clearTimeout(timer.current)
    const id = dirty.current.values().next().value
    if (!id || savingId.current) return
    dirty.current.delete(id)
    savingId.current = id
    setStatus('Guardando…')
    const snap = local.current.get(id)!
    try {
      const saved = await saveFile(id, { name: snap.title.trim() || UNTITLED }, snap.text)
      setFiles(fs => fs && fs.map(f => f.id === id ? { ...saved, name: local.current.get(id)?.title ?? saved.name } : f))
    } catch (e) {
      savingId.current = null
      if (!local.current.has(id)) return flush() // la nota se borró mientras se guardaba
      dirty.current.add(id)
      return fail(e)
    }
    savingId.current = null
    if (dirty.current.size) flush()
    else setStatus('Guardado')
  }

  useEffect(() => {
    if (!started || !session) return
    setToken(session.token)
    refresh()
    // Al volver a la app se actualiza la lista; al salir se sube lo pendiente.
    const onVisibility = () => document.visibilityState === 'visible' ? refresh() : flush()
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty.current.size || savingId.current) e.preventDefault() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [started, session])

  useEffect(() => {
    if (!noteId || !note) return
    const cached = local.current.get(noteId)
    if (cached) { setTitle(cached.title); setText(cached.text); return }
    const name = note.name === UNTITLED ? '' : note.name
    let stale = false
    setText(null)
    readFile(noteId).then(t => {
      if (stale) return
      local.current.set(noteId, { title: name, text: t })
      setTitle(name)
      setText(t)
    }, fail)
    return () => { stale = true }
  // Solo recarga si cambia la nota o su versión en Drive, no con cada letra del título.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, modified, session])

  async function login() {
    try {
      const s = await signIn(session?.email)
      setSession(s)
      setStarted(true)
      setError(null)
      flush()
    } catch (e) { fail(e) }
  }

  function logout() {
    if (dirty.current.size && !confirm('Hay cambios sin subir a Drive. ¿Salir igual?')) return
    forgetSession()
    location.reload()
  }

  function edit(changes: Partial<Snapshot>) {
    if (!noteId || text === null) return
    const snap = { title, text, ...changes }
    setTitle(snap.title)
    setText(snap.text)
    local.current.set(noteId, snap)
    dirty.current.add(noteId)
    if (changes.title !== undefined) setFiles(fs => fs && fs.map(f => f.id === noteId ? { ...f, name: snap.title } : f))
    setStatus('Sin guardar')
    clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 1500)
  }

  function open(id: string | null) {
    flush()
    setNoteId(id)
  }

  async function createNotebook(name: string) {
    try {
      const nb = await saveFile(undefined, { name, appProperties: { kind: 'notebook' } })
      setFiles(fs => [...fs ?? [], nb])
      setNotebookId(nb.id)
      return nb
    } catch (e) { fail(e) }
  }

  async function renameNotebook(nb: DriveFile) {
    const name = prompt('Nuevo nombre de la libreta', nb.name)?.trim()
    if (!name) return
    try {
      const saved = await saveFile(nb.id, { name })
      setFiles(fs => fs && fs.map(f => f.id === nb.id ? saved : f))
    } catch (e) { fail(e) }
  }

  async function deleteNotebook(nb: DriveFile) {
    if (allNotes.some(n => n.appProperties?.notebook === nb.id)) return alert('La libreta tiene notas. Muévelas o bórralas primero.')
    if (!confirm(`¿Borrar la libreta "${nb.name}"?`)) return
    try {
      await deleteFile(nb.id)
      setFiles(fs => fs && fs.filter(f => f.id !== nb.id))
      setNotebookId(null)
    } catch (e) { fail(e) }
  }

  async function newNote() {
    try {
      const nbId = notebookId ?? notebooks[0]?.id ?? (await createNotebook('Mis notas'))?.id
      if (!nbId) return
      const n = await saveFile(undefined, { name: UNTITLED, appProperties: { kind: 'note', notebook: nbId } }, '')
      local.current.set(n.id, { title: '', text: '' })
      setFiles(fs => [...fs ?? [], n])
      open(n.id)
    } catch (e) { fail(e) }
  }

  async function moveNote(nbId: string) {
    if (!note) return
    try {
      const saved = await saveFile(note.id, { appProperties: { notebook: nbId } })
      setFiles(fs => fs && fs.map(f => f.id === saved.id ? { ...saved, name: f.name } : f))
    } catch (e) { fail(e) }
  }

  async function deleteNote() {
    if (!note || !confirm(`¿Borrar "${note.name || UNTITLED}"? No se puede deshacer.`)) return
    try {
      await deleteFile(note.id)
      dirty.current.delete(note.id)
      local.current.delete(note.id)
      setFiles(fs => fs && fs.filter(f => f.id !== note.id))
      setNoteId(null)
    } catch (e) { fail(e) }
  }

  if (!started) return (
    <div className="login">
      <h1>Notas David</h1>
      <p>Tus notas se guardan en tu propio Google Drive.</p>
      <button className="principal" onClick={login}>{session ? `Continuar como ${session.email}` : 'Entrar con Google'}</button>
      {session && <button className="enlace" onClick={logout}>Usar otra cuenta</button>}
      {error && <p className="error">{error === 'auth' ? 'Vuelve a entrar.' : error}</p>}
    </div>
  )

  return (
    <div className={noteId ? 'app con-nota' : 'app'}>
      <nav className="libretas">
        <div className="cuenta">
          <span title={session?.email}>{session?.email}</span>
          <button className="enlace" onClick={logout}>Salir</button>
        </div>
        <button className={notebookId === null ? 'libreta activa' : 'libreta'} onClick={() => setNotebookId(null)}>
          Todas las notas <small>{allNotes.length}</small>
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
          if (name) createNotebook(name)
        }}>+ Libreta</button>
      </nav>

      <section className="lista">
        <header>
          <button className="principal" onClick={newNote}>+ Nota</button>
          <button onClick={refresh} title="Actualizar" aria-label="Actualizar">↻</button>
          <span className="estado">{status}</span>
        </header>
        {files === null ? <p className="vacio">Cargando…</p>
          : notes.length === 0 ? <p className="vacio">Sin notas</p>
          : notes.map(n => (
            <button key={n.id} className={n.id === noteId ? 'nota activa' : 'nota'} onClick={() => open(n.id)}>
              <strong>{n.name || UNTITLED}</strong>
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
            <button onClick={deleteNote}>Borrar</button>
          </header>
          <input className="titulo" value={title} placeholder="Título" disabled={text === null}
            onChange={e => edit({ title: e.target.value })} />
          <textarea value={text ?? ''} placeholder={text === null ? 'Cargando…' : 'Escribe aquí…'} disabled={text === null}
            onChange={e => edit({ text: e.target.value })} />
        </> : <p className="vacio">Elige o crea una nota</p>}
      </main>

      {error && <div className="aviso" role="alert">
        {error === 'auth' ? 'La sesión de Google venció. Tus cambios siguen aquí.' : error}
        {error === 'auth'
          ? <button onClick={login}>Reconectar</button>
          : <button onClick={() => { setError(null); refresh(); flush() }}>Reintentar</button>}
      </div>}
    </div>
  )
}
