import { useEffect, useRef, useState } from 'react'
import { forgetSession, loadSession, signIn } from './auth.ts'
import { AuthError, deleteFile, listFiles, readNote, saveFile, setToken, type DriveFile } from './drive.ts'
import Editor, { Cover, EmojiPicker } from './Editor.tsx'
import { pickImage, uploadImage } from './images.ts'
import { TEMPLATES } from './templates.ts'

type Snapshot = { title: string; text: string }
const UNTITLED = 'Sin título'
const byName = (a: DriveFile, b: DriveFile) => a.name.localeCompare(b.name)
const byDate = (a: DriveFile, b: DriveFile) => b.modifiedTime.localeCompare(a.modifiedTime)
const isTemplates = (f: DriveFile) => f.appProperties?.templates === 'true' // libreta "Plantillas"
const parentOf = (n: DriveFile) => n.appProperties?.parent

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [started, setStarted] = useState(() => !!session && session.expires > Date.now())
  const [files, setFiles] = useState<DriveFile[] | null>(null) // null = cargando
  const [notebookId, setNotebookId] = useState<string | null>(null) // null = todas
  const [noteId, setNoteId] = useState<string | null>(null)
  const [doc, setDoc] = useState<Snapshot & { id: string; rev: number } | null>(null) // nota abierta
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null) // 'auth' = sesión vencida
  const [picker, setPicker] = useState(false) // selector de ícono de la nota
  const local = useRef(new Map<string, Snapshot>()) // contenido ya cargado o editado
  const dirty = useRef(new Set<string>()) // notas con cambios sin subir
  const savingId = useRef<string | null>(null)
  const timer = useRef(0)
  const rev = useRef(0) // sube al leer de Drive: vuelve a montar el editor con el contenido nuevo

  const notebooks = (files ?? []).filter(f => f.appProperties?.kind === 'notebook').sort(byName)
  const templatesNb = notebooks.find(isTemplates)
  const allNotes = (files ?? []).filter(f => f.appProperties?.kind === 'note')
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
  const note = allNotes.find(f => f.id === noteId)
  const parent = note && allNotes.find(f => f.id === parentOf(note))
  const cover = note?.appProperties?.cover
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
    if (cached) return setDoc({ ...cached, id: noteId, rev: rev.current })
    const title = note.name === UNTITLED ? '' : note.name
    let stale = false
    readNote(noteId, note.mimeType).then(text => {
      if (stale) return
      local.current.set(noteId, { title, text })
      setDoc({ id: noteId, rev: ++rev.current, title, text })
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
    if (!noteId || doc?.id !== noteId) return
    const prev = local.current.get(noteId) ?? doc
    const snap = { title: prev.title, text: prev.text, ...changes }
    setDoc({ ...doc, ...snap })
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
    setPicker(false)
  }

  async function createNotebook(name: string, extra: Record<string, string> = {}) {
    try {
      const nb = await saveFile(undefined, { name, appProperties: { kind: 'notebook', ...extra } })
      setFiles(fs => [...fs ?? [], nb])
      return nb
    } catch (e) { fail(e) }
  }

  async function saveMeta(id: string, appProperties: Record<string, string | null>) {
    try {
      const saved = await saveFile(id, { appProperties })
      setFiles(fs => fs && fs.map(f => f.id === id ? { ...saved, name: f.name } : f))
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

  // Una subnota va en la libreta de su nota madre.
  async function newNote(title = '', html = '', parentId?: string) {
    try {
      const nbId = (parentId ? note?.appProperties?.notebook : notebookId)
        ?? notebooks.find(nb => !isTemplates(nb))?.id ?? (await createNotebook('Mis notas'))?.id
      if (!nbId) return
      const props = { kind: 'note', notebook: nbId, ...(parentId ? { parent: parentId } : {}) }
      const n = await saveFile(undefined, { name: title || UNTITLED, appProperties: props }, html)
      local.current.set(n.id, { title, text: html })
      setFiles(fs => [...fs ?? [], n])
      open(n.id)
    } catch (e) { fail(e) }
  }

  async function fromTemplate(value: string) {
    const builtIn = TEMPLATES.find(t => t.title === value)
    if (builtIn) return newNote(builtIn.title, builtIn.html)
    const tpl = allNotes.find(n => n.id === value)
    if (!tpl) return
    try {
      newNote(tpl.name === UNTITLED ? '' : tpl.name, local.current.get(tpl.id)?.text ?? await readNote(tpl.id, tpl.mimeType))
    } catch (e) { fail(e) }
  }

  async function saveAsTemplate() {
    if (!doc) return
    try {
      const nb = templatesNb ?? await createNotebook('Plantillas', { templates: 'true' })
      if (!nb) return
      const n = await saveFile(undefined, { name: doc.title.trim() || UNTITLED, appProperties: { kind: 'note', notebook: nb.id } }, doc.text)
      setFiles(fs => [...fs ?? [], n])
      alert(`Guardada como plantilla en la libreta "${nb.name}".`)
    } catch (e) { fail(e) }
  }

  // La nota se mueve con todas sus subnotas.
  async function moveNote(nbId: string) {
    if (!note) return
    for (const n of [note, ...descendants(note.id)]) await saveMeta(n.id, { notebook: nbId })
  }

  async function changeCover() {
    if (!note) return
    const file = await pickImage()
    if (!file) return
    setStatus('Subiendo portada…')
    try {
      await saveMeta(note.id, { cover: await uploadImage(file) })
      setStatus('')
    } catch (e) { fail(e) }
  }

  async function deleteNote() {
    if (!note) return
    if (descendants(note.id).length) return alert('Esta nota tiene subnotas. Bórralas primero.')
    if (!confirm(`¿Borrar "${note.name || UNTITLED}"? No se puede deshacer.`)) return
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
      <h1>Datheke</h1>
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
          if (name) createNotebook(name).then(nb => nb && setNotebookId(nb.id))
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
          <button onClick={refresh} title="Actualizar" aria-label="Actualizar">↻</button>
          <span className="estado">{status}</span>
        </header>
        {files === null ? <p className="vacio">Cargando…</p>
          : list.length === 0 ? <p className="vacio">Sin notas</p>
          : list.map(([n, depth]) => (
            <button key={n.id} className={n.id === noteId ? 'nota activa' : 'nota'} style={{ paddingLeft: 12 + depth * 16 }} onClick={() => open(n.id)}>
              <strong>{depth > 0 && '↳ '}{n.appProperties?.icon && `${n.appProperties.icon} `}{n.name || UNTITLED}</strong>
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
          {cover && <Cover id={cover} />}
          <div className="cabecera">
            {parent && <button className="enlace" onClick={() => open(parent.id)}>↑ {parent.name || UNTITLED}</button>}
            <button className={note.appProperties?.icon ? 'icono' : 'enlace'} aria-label="Ícono de la nota" onClick={() => setPicker(!picker)}>
              {note.appProperties?.icon ?? 'Agregar ícono'}
            </button>
            {note.appProperties?.icon && <button className="enlace" onClick={() => saveMeta(note.id, { icon: null })}>Quitar ícono</button>}
            <button className="enlace" onClick={changeCover}>{cover ? 'Cambiar portada' : 'Agregar portada'}</button>
            {cover && <button className="enlace" onClick={() => saveMeta(note.id, { cover: null })}>Quitar portada</button>}
          </div>
          {picker && <EmojiPicker onPick={icon => { saveMeta(note.id, { icon }); setPicker(false) }} />}
          {doc?.id === note.id ? <>
            <input className="titulo" value={doc.title} placeholder="Título" onChange={e => edit({ title: e.target.value })} />
            <Editor key={`${doc.id}-${doc.rev}`} content={doc.text} onChange={text => edit({ text })}
              notes={allNotes.map(n => ({ id: n.id, label: n.name || UNTITLED }))} onOpenNote={open} onError={fail} />
          </> : <p className="vacio">Cargando…</p>}
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
