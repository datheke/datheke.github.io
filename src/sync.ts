import * as db from './db.ts'
import { deleteFile, generateIds, listFiles, OfflineError, readNote, saveFile, type DriveFile } from './drive.ts'

// Copia local primero: cada cambio se guarda en el dispositivo (IndexedDB) y se sube a Drive unos segundos después.
// Sin internet se sigue trabajando y al volver la conexión se sube solo. App lee este estado con useSyncExternalStore.

export const UNTITLED = 'Sin título'
export type Snapshot = { title: string; text: string }
export type Props = Record<string, string | null> // null borra la propiedad
export type Conflict = Snapshot & { modifiedTime: string }
// Lo que falta subir de cada archivo. Cada cambio local reemplaza el objeto: así push sabe si hubo cambios mientras subía.
type Pending = { create?: boolean; content?: boolean; name?: string; props?: Props; remove?: boolean }
type Saved = {
  files: Record<string, DriveFile> // libretas, notas y fotos, ya con los cambios locales
  base: Record<string, string> // modifiedTime de Drive en que se basa la copia local de cada nota
  pending: Record<string, Pending>
  conflicts: Record<string, Conflict> // versión de otro dispositivo, hasta que el usuario elija
  ids: string[] // ids reservados en Drive para crear sin internet
}
export type State = Saved & {
  texts: Record<string, Snapshot> // contenido de las notas
  revs: Record<string, number> // sube cuando el contenido llega de afuera: App vuelve a montar el editor
  synced: boolean // ya se leyó Drive al menos una vez
  offline: boolean
  error: unknown
}

const empty = (): State => ({
  files: {}, base: {}, pending: {}, conflicts: {}, ids: [], texts: {}, revs: {}, synced: false, offline: false, error: null,
})
let state = empty()
const listeners = new Set<() => void>()
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const getState = () => state

function update(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}

function persist() {
  const { files, base, pending, conflicts, ids } = state
  db.set('meta', { files, base, pending, conflicts, ids })
}

const without = <T>(rec: Record<string, T>, id: string) => {
  const rest = { ...rec }
  delete rest[id]
  return rest
}

function applyProps(props: Record<string, string> = {}, patch: Props = {}) {
  const out = { ...props }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = v
  }
  return out
}

const titleOf = (f: DriveFile) => f.name === UNTITLED ? '' : f.name

// Metadatos de Drive + lo que aún no se subió.
function withPending(f: DriveFile, p = state.pending[f.id], t = state.texts[f.id]): DriveFile {
  if (!p) return f
  return { ...f, name: p.content && t ? t.title : p.name ?? f.name, appProperties: applyProps(f.appProperties, p.props) }
}

function markPending(id: string, change: Pending) {
  const cur = state.pending[id] ?? {}
  return { ...state.pending, [id]: { ...cur, ...change, props: change.props ? { ...cur.props, ...change.props } : cur.props } }
}

function setText(id: string, t: Snapshot, modifiedTime: string) {
  update({
    texts: { ...state.texts, [id]: t },
    base: { ...state.base, [id]: modifiedTime },
    revs: { ...state.revs, [id]: (state.revs[id] ?? 0) + 1 },
  })
  db.set(`text:${id}`, t)
}

function forget(id: string) {
  update({
    files: without(state.files, id), texts: without(state.texts, id), base: without(state.base, id),
    pending: without(state.pending, id), conflicts: without(state.conflicts, id),
  })
  db.del(`text:${id}`)
}

let timer: ReturnType<typeof setTimeout> | undefined
const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(sync, ms) }

let account = ''
export async function start(email: string) {
  if (account === email) return void sync() // ya cargada (React puede montar dos veces)
  account = email
  db.setAccount(email)
  const saved = await db.get<Saved>('meta')
  update({ ...empty(), ...saved, texts: Object.fromEntries(await db.entries<Snapshot>('text:')) })
  sync()
}

let running: Promise<void> | null = null
let queued: Promise<void> | null = null

// Si ya hay una sincronización en curso, se hace otra completa al terminar (con los cambios de ahora).
export function sync(): Promise<void> {
  clearTimeout(timer)
  if (running) return queued ??= running.then(() => { queued = null; return sync() })
  running = run().finally(() => { running = null })
  return running
}

// Primero lee Drive (para ver conflictos) y después sube lo pendiente.
async function run() {
  try {
    await pull()
    await push()
    if (state.ids.length < 10) {
      update({ ids: [...state.ids, ...await generateIds(20)] })
      persist()
    }
    update({ offline: false, error: null })
  } catch (e) {
    update(e instanceof OfflineError ? { offline: true } : { error: e })
  }
}

async function pull() {
  const remote = await listFiles()
  const old = state.files
  const files: Record<string, DriveFile> = {}
  for (const f of remote) if (!state.pending[f.id]?.remove) files[f.id] = withPending(f)
  for (const f of Object.values(old)) if (!files[f.id] && state.pending[f.id]?.create) files[f.id] = f // creado aquí, sin subir aún
  update({ files, synced: true })
  // Borradas en otro dispositivo. Si aquí tenían cambios sin subir, se guardan como nota nueva para no perderlos.
  // shortcut: si en ese momento no quedan ids reservados, la nota queda solo en el dispositivo hasta la siguiente sincronización.
  for (const id of Object.keys(old)) {
    if (files[id]) continue
    const t = state.texts[id]
    if (state.pending[id]?.content && t) create(old[id].appProperties ?? {}, t.title, t.text, 'text/html')
    forget(id)
  }
  persist()
  // Notas cambiadas en Drive: se bajan de a una; el usuario puede seguir editando mientras tanto.
  for (const f of remote) {
    if (f.appProperties?.kind !== 'note' || !state.files[f.id] || f.modifiedTime === state.base[f.id]) continue
    if (state.conflicts[f.id]?.modifiedTime === f.modifiedTime) continue
    const theirs = { title: titleOf(f), text: await readNote(f.id, f.mimeType) }
    if (!state.files[f.id]) continue // se borró aquí mientras bajaba
    if (!state.pending[f.id]?.content) setText(f.id, theirs, f.modifiedTime)
    else if (state.texts[f.id]?.text === theirs.text) update({ base: { ...state.base, [f.id]: f.modifiedTime } }) // mismo contenido
    else update({ conflicts: { ...state.conflicts, [f.id]: { ...theirs, modifiedTime: f.modifiedTime } } })
    persist()
  }
}

const contentOf = async (f: DriveFile) =>
  f.appProperties?.kind === 'note' ? state.texts[f.id]?.text ?? ''
    : f.appProperties?.kind === 'image' ? db.get<Blob>(`img:${f.id}`) : undefined

async function push() {
  for (const id of Object.keys(state.pending)) {
    const p = state.pending[id]
    if (!p || state.conflicts[id]) continue // con conflicto se espera a que el usuario elija
    const f = state.files[id]
    const t = state.texts[id]
    let saved: DriveFile | undefined
    if (p.remove) await deleteFile(id).catch(e => { if (e.status !== 404) throw e })
    else if (p.create) saved = await saveFile(undefined, { id, name: f.name || UNTITLED, appProperties: f.appProperties }, await contentOf(f))
    else if (p.content && t) saved = await saveFile(id, { name: t.title.trim() || UNTITLED, appProperties: p.props }, t.text)
    else saved = await saveFile(id, { name: p.name, appProperties: p.props })
    const cur = state.pending[id]
    const pending = { ...state.pending }
    if (cur === p || p.remove) delete pending[id]
    else pending[id] = cur ? { ...cur, create: false } : { remove: true } // sin cur: se borró aquí mientras se creaba
    const changes: Partial<State> = { pending }
    if (saved && state.files[id]) {
      changes.files = { ...state.files, [id]: withPending(saved, pending[id], state.texts[id]) }
      changes.base = { ...state.base, [id]: saved.modifiedTime }
    }
    update(changes)
    persist()
  }
}

function takeId() {
  const [id, ...ids] = state.ids
  if (!id) throw new Error('Para crear más cosas sin internet, conéctate un momento.')
  update({ ids })
  return id
}

// Libretas, notas (con text) y fotos. Se crean al instante en el dispositivo con un id ya reservado en Drive.
export function create(props: Record<string, string>, name: string, text?: string, mimeType?: string, id = takeId()): string {
  const t = text === undefined ? undefined : { title: name, text }
  update({
    files: { ...state.files, [id]: { id, name, modifiedTime: new Date().toISOString(), mimeType, appProperties: props } },
    pending: { ...state.pending, [id]: { create: true } },
    ...(t ? { texts: { ...state.texts, [id]: t } } : {}),
  })
  if (t) db.set(`text:${id}`, t)
  persist()
  schedule(500)
  return id
}

export function edit(id: string, change: Partial<Snapshot>) {
  const t = { ...state.texts[id], ...change }
  const first = !state.pending[id]?.content
  update({
    texts: { ...state.texts, [id]: t },
    pending: markPending(id, { content: true }),
    ...(change.title !== undefined ? { files: { ...state.files, [id]: { ...state.files[id], name: t.title } } } : {}),
  })
  db.set(`text:${id}`, t)
  if (first || change.title !== undefined) persist()
  schedule(1500)
}

export function patch(id: string, change: { name?: string; props?: Props }) {
  const f = state.files[id]
  update({
    files: { ...state.files, [id]: { ...f, name: change.name ?? f.name, appProperties: applyProps(f.appProperties, change.props) } },
    pending: markPending(id, change),
  })
  persist()
  schedule(500)
}

export function remove(id: string) {
  const inDrive = !state.pending[id]?.create
  forget(id)
  if (inDrive) update({ pending: { ...state.pending, [id]: { remove: true } } })
  persist()
  schedule(500)
}

export async function addImage(blob: Blob): Promise<string> {
  const id = takeId()
  await db.set(`img:${id}`, blob)
  return create({ kind: 'image' }, 'foto.jpg', undefined, blob.type, id)
}

// Nota que todavía no se bajó a este dispositivo (se pide al abrirla).
export async function ensureText(id: string) {
  const f = state.files[id]
  if (!f || state.texts[id]) return
  const text = await readNote(id, f.mimeType)
  if (state.texts[id]) return
  setText(id, { title: titleOf(f), text }, f.modifiedTime)
  persist()
}

export function resolve(id: string, keep: 'mine' | 'theirs') {
  const c = state.conflicts[id]
  if (!c) return
  update({ conflicts: without(state.conflicts, id) })
  if (keep === 'mine') update({ base: { ...state.base, [id]: c.modifiedTime } }) // se sube la de aquí encima de la otra
  else {
    setText(id, { title: c.title, text: c.text }, c.modifiedTime)
    const rest: Pending = { ...state.pending[id], content: false }
    const left = rest.create || rest.name !== undefined || rest.props
    update({
      pending: left ? { ...state.pending, [id]: rest } : without(state.pending, id),
      files: { ...state.files, [id]: { ...state.files[id], name: c.title } },
    })
  }
  persist()
  schedule(0)
}

export const clearLocal = () => db.clearAccount()
