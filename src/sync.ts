import * as db from './db.ts'
import { deleteFile, generateIds, listFiles, OfflineError, readNote, saveFile, type DriveFile } from './drive.ts'
import * as vault from './vault.ts'

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
  const { files, base, pending, ids } = state
  // La otra versión de una nota protegida no se guarda en claro: si se cierra la app, la siguiente lectura de Drive la trae de nuevo.
  const conflicts = Object.fromEntries(Object.entries(state.conflicts).filter(([id]) => !isProtected(id)))
  db.set('meta', { files, base, pending, conflicts, ids })
}

// Notas con clave (protegida: 'true'). En el aparato van cifradas; con la caja cerrada su texto no está en memoria
// (salvo cambios aún sin subir, que la pantalla igual tapa) y no se bajan de Drive hasta abrirla.
export const isProtected = (id: string) => state.files[id]?.appProperties?.protegida === 'true'
// Con qué llave se cifra la copia local: la clave común de la nota compartida, o tu clave de notas (undefined).
const keySalt = (id: string) => vault.saltOf(state.files[id]?.appProperties?.clave_comun)
const canSeal = (id: string) => vault.hasKey(keySalt(id))
let sealed: Record<string, vault.Sealed> = {}
// Fotos de cada nota con clave (solo sus números, nada del texto): la limpieza de fotos sabe cuáles usa con la caja cerrada.
let refs: Record<string, string[]> = {}
function dropRefs(id: string) {
  if (!refs[id]) return
  delete refs[id]
  db.del(`refs:${id}`)
}

async function storeText(id: string, t: Snapshot) {
  if (!isProtected(id)) {
    delete sealed[id]
    dropRefs(id)
    return db.set(`text:${id}`, t)
  }
  if (!canSeal(id)) return // nunca en claro; enforce la quita de memoria y se vuelve a bajar al abrir
  const s = await vault.seal(t, keySalt(id))
  sealed[id] = s
  refs[id] = photoRefs(t.text)
  db.set(`refs:${id}`, refs[id])
  return db.set(`text:${id}`, s)
}

// Copia local que ya no sirve (no se puede cifrar ahora, o cifrada con otra clave): se borra y se baja de nuevo de Drive.
function dropLocal(id: string) {
  delete sealed[id]
  dropRefs(id)
  db.del(`text:${id}`)
  update({ texts: without(state.texts, id), base: without(state.base, id), revs: { ...state.revs, [id]: (state.revs[id] ?? 0) + 1 } })
}

// Pone la copia local de acuerdo con qué notas están protegidas (cambia aquí o en otro aparato).
async function enforce() {
  for (const [id, t] of Object.entries(state.texts)) {
    if (isProtected(id) && !sealed[id]) {
      if (canSeal(id)) await storeText(id, t)
      else if (!state.pending[id]?.content) dropLocal(id)
    } else if (!isProtected(id) && sealed[id]) await storeText(id, t)
  }
  for (const id of Object.keys(sealed)) if (!isProtected(id) && !state.texts[id]) dropLocal(id)
}

// Tras abrir la caja (vault.unlock/create): descifra lo guardado y baja lo que falte.
export async function openVault() {
  const opened: Record<string, Snapshot> = {}
  for (const [id, s] of Object.entries(sealed)) {
    if (state.texts[id] || !canSeal(id)) continue // su llave no está abierta (otra clave común): sigue cifrada
    const t = await vault.open(s)
    if (t) opened[id] = t
    else dropLocal(id)
  }
  const revs = { ...state.revs }
  for (const id of Object.keys(opened)) revs[id] = (revs[id] ?? 0) + 1
  update({ texts: { ...state.texts, ...opened }, revs })
  await enforce()
  sync()
}

// Tras cambiar una clave: lo que está abierto se vuelve a cifrar con la llave nueva.
export async function resealAll() {
  for (const [id, t] of Object.entries(state.texts)) if (isProtected(id)) { delete sealed[id]; await storeText(id, t) }
}

export function closeVault() {
  vault.lock()
  const texts = { ...state.texts }
  const revs = { ...state.revs }
  for (const id of Object.keys(texts)) {
    if (!isProtected(id) || state.pending[id]?.content) continue
    delete texts[id]
    revs[id] = (revs[id] ?? 0) + 1
  }
  update({ texts, revs })
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
  storeText(id, t)
}

function forget(id: string) {
  update({
    files: without(state.files, id), texts: without(state.texts, id), base: without(state.base, id),
    pending: without(state.pending, id), conflicts: without(state.conflicts, id),
  })
  delete sealed[id]
  dropRefs(id)
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
  sealed = {}
  refs = Object.fromEntries(await db.entries<string[]>('refs:'))
  const texts: Record<string, Snapshot> = {}
  for (const [id, v] of await db.entries<Snapshot | vault.Sealed>('text:')) {
    if (vault.isSealed(v)) sealed[id] = v
    else texts[id] = v
  }
  update({ ...empty(), ...saved, texts })
  if (vault.any()) await openVault()
  else await enforce()
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
    if (Date.now() - cleaned > 3600_000 && cleanPhotos()) cleaned = Date.now()
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
  await enforce()
  // Borradas en otro dispositivo. Si aquí tenían cambios sin subir, se guardan como nota nueva para no perderlos.
  // shortcut: si en ese momento no quedan ids reservados, la nota queda solo en el dispositivo hasta la siguiente sincronización.
  for (const id of Object.keys(old)) {
    if (files[id]) continue
    const t = state.texts[id]
    if (state.pending[id]?.content && t) create(old[id].appProperties ?? {}, t.title, t.text, 'text/html')
    // Foto borrada en otro aparato: su copia local se borra, salvo que una nota de aquí la nombre (la volvió a usar sin internet).
    if (old[id].appProperties?.kind === 'image' && !Object.values(state.texts).some(x => x.text.includes(`drive:${id}`))) db.del(`img:${id}`)
    forget(id)
  }
  persist()
  // Notas cambiadas en Drive: se bajan de a una; el usuario puede seguir editando mientras tanto.
  for (const f of remote) {
    if (f.appProperties?.kind !== 'note' || !state.files[f.id] || f.modifiedTime === state.base[f.id]) continue
    if (isProtected(f.id) && !canSeal(f.id)) continue // se baja al abrir la caja
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
  f.appProperties?.kind === 'note' || f.appProperties?.kind === 'version' ? state.texts[f.id]?.text ?? ''
    : f.appProperties?.kind === 'image' ? db.get<Blob>(`img:${f.id}`) : undefined

async function push() {
  for (const id of Object.keys(state.pending)) {
    const p = state.pending[id]
    if (!p || state.conflicts[id]) continue // con conflicto se espera a que el usuario elija
    const f = state.files[id]
    const t = state.texts[id]
    if (isProtected(id) && !t && (p.content || p.create)) continue // su texto está cifrado: se sube al abrir la caja
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
  if (t) storeText(id, t)
  persist()
  schedule(500)
  return id
}

// ---- Versión anterior (decisión de David) ----
// Una por nota: cómo estaba antes de empezar a cambiarla la última vez. Se guarda al cambiar una nota que llevaba más de
// 10 minutos sin tocarse (según su último guardado en Drive: igual en todos los aparatos) y se reemplaza la próxima vez.
// Es otro archivo ("version") en la carpeta oculta: no es una nota (no se lista, no va al respaldo y no protege fotos),
// lleva la misma clave que su nota y se borra con ella.
const VERSION_GAP = 10 * 60_000
const KEY_PROPS = ['protegida', 'clave_comun'] as const
const isVersionOf = (f: DriveFile, noteId: string) => f.appProperties?.kind === 'version' && f.appProperties.nota === noteId
export const versionOf = (noteId: string) => Object.values(state.files).find(f => isVersionOf(f, noteId))

function keepVersion(noteId: string, before: Snapshot) {
  const note = state.files[noteId]
  const v = versionOf(noteId)
  if (v) {
    write(v.id, before)
    patch(v.id, { props: { del: note.modifiedTime } })
    return
  }
  const props: Record<string, string> = { kind: 'version', nota: noteId, del: note.modifiedTime }
  for (const k of KEY_PROPS) if (note.appProperties?.[k]) props[k] = note.appProperties[k]
  create(props, before.title, before.text, 'text/html')
}

export function edit(id: string, change: Partial<Snapshot>) {
  const f = state.files[id]
  const before = state.texts[id]
  // Empieza a cambiar una nota quieta: primero se guarda cómo estaba.
  if (before && f?.appProperties?.kind === 'note' && f.appProperties.solo_ver !== 'true' && !state.pending[id]?.content
    && Date.now() - Date.parse(f.modifiedTime) > VERSION_GAP) {
    try { keepVersion(id, before) } catch (e) { console.error('Versión anterior', e) } // sin internet ni ids reservados: sigue sin versión
  }
  write(id, change)
}

// La versión anterior de una nota, para verla o restaurarla. Si se guardó en otro aparato se baja (necesita internet).
export async function loadVersion(noteId: string): Promise<(Snapshot & { del: string }) | null> {
  const v = versionOf(noteId)
  if (!v || (isProtected(v.id) && !canSeal(v.id))) return null
  if (!state.texts[v.id] || (!state.pending[v.id] && state.base[v.id] !== v.modifiedTime)) {
    setText(v.id, { title: titleOf(v), text: await readNote(v.id, v.mimeType) }, v.modifiedTime)
    persist()
  }
  const t = state.texts[v.id]
  return t ? { ...t, del: v.appProperties?.del ?? v.modifiedTime } : null
}

// Restaurar: la nota vuelve a como estaba y lo de ahora pasa a ser la versión anterior (restaurar otra vez lo deshace).
export function restoreVersion(noteId: string, back: Snapshot) {
  const now = state.texts[noteId]
  const v = versionOf(noteId)
  if (!now || !v) return
  write(v.id, now)
  patch(v.id, { props: { del: new Date().toISOString() } })
  write(noteId, { title: back.title, text: back.text })
  update({ revs: { ...state.revs, [noteId]: (state.revs[noteId] ?? 0) + 1 } })
}

// Al restaurar, las fotos que ya se borraron (pasó más de un día) salen del texto: se recupera solo el texto.
export function withoutMissingPhotos(html: string, exists: (id: string) => boolean) {
  let removed = 0
  const out = html.replace(/<img[^>]*\bsrc="drive:([\w-]+)"[^>]*>/g, (tag, id: string) => exists(id) ? tag : (removed++, ''))
  return { html: out, removed }
}

function write(id: string, change: Partial<Snapshot>) {
  const t = { ...state.texts[id], ...change }
  const first = !state.pending[id]?.content
  update({
    texts: { ...state.texts, [id]: t },
    pending: markPending(id, { content: true }),
    ...(change.title !== undefined ? { files: { ...state.files, [id]: { ...state.files[id], name: t.title } } } : {}),
  })
  storeText(id, t)
  if (first || change.title !== undefined) persist()
  schedule(1500)
}

// Cambio hecho desde afuera del editor (marcar un recordatorio desde la lista): se guarda y el editor se vuelve a dibujar.
export function replaceText(id: string, text: string) {
  edit(id, { text })
  update({ revs: { ...state.revs, [id]: (state.revs[id] ?? 0) + 1 } })
}

export function patch(id: string, change: { name?: string; props?: Props }) {
  const f = state.files[id]
  update({
    files: { ...state.files, [id]: { ...f, name: change.name ?? f.name, appProperties: applyProps(f.appProperties, change.props) } },
    pending: markPending(id, change),
  })
  persist()
  if (change.props && 'protegida' in change.props) enforce()
  // La versión anterior va con la misma clave que su nota.
  const keys = KEY_PROPS.filter(k => change.props && k in change.props)
  const v = keys.length && f?.appProperties?.kind === 'note' ? versionOf(id) : undefined
  if (v) patch(v.id, { props: Object.fromEntries(keys.map(k => [k, change.props![k]])) })
  schedule(500)
}

// Nota que sale del basurero para siempre: sus fotos ya esperaron ahí y se van con ella (photoPlan no borra las que otra nota usa).
const WAITED = '2000-01-01T00:00:00.000Z'
export function remove(id: string) {
  const f = state.files[id]
  const photos = f?.appProperties?.borrada ? [...photoRefs(state.texts[id]?.text ?? ''), f.appProperties?.cover ?? ''] : []
  const inDrive = !state.pending[id]?.create
  forget(id)
  if (inDrive) update({ pending: { ...state.pending, [id]: { remove: true } } })
  for (const p of photos) if (state.files[p]?.appProperties?.kind === 'image') patch(p, { props: { sin_uso: WAITED } })
  for (const v of Object.values(state.files)) if (isVersionOf(v, id)) remove(v.id) // su versión anterior se va con ella
  persist()
  schedule(500)
}

export async function addImage(blob: Blob): Promise<string> {
  const id = takeId()
  await db.set(`img:${id}`, blob)
  return create({ kind: 'image' }, 'foto.jpg', undefined, blob.type, id)
}

// Fotos que ya no usa ninguna nota: se marcan "sin_uso" en Drive (lo ven todos los aparatos) y al día siguiente se borran.
// Si vuelven a usarse ese día (deshacer, otro aparato) se desmarcan. Sin el texto al día de todas las notas no se decide nada.
const PHOTO_WAIT = 86400_000 // un día (decisión de David)
// Cualquier mención "drive:ID" cuenta como uso: más amplio que src="drive:…", a propósito.
const photoRefs = (html: string) => [...html.matchAll(/drive:([\w-]+)/g)].map(m => m[1])
export function photoPlan(s: Pick<State, 'files' | 'texts' | 'base' | 'pending' | 'conflicts'> & { refs?: Record<string, string[]> }, now: number) {
  const files = Object.values(s.files)
  const notes = files.filter(f => f.appProperties?.kind === 'note')
  // De una nota con clave cerrada sirven los números de foto anotados (refs), si su copia está al día con Drive.
  const photosOf = (id: string) => s.texts[id] ? photoRefs(s.texts[id].text) : s.refs?.[id]
  if (notes.some(f => !photosOf(f.id) || (!s.pending[f.id]?.content && s.base[f.id] !== f.modifiedTime))) return null
  const used = new Set(files.map(f => f.appProperties?.cover).filter(Boolean))
  for (const f of notes) for (const ref of photosOf(f.id) ?? []) used.add(ref)
  for (const c of Object.values(s.conflicts)) for (const ref of photoRefs(c.text)) used.add(ref)
  const plan = { mark: [] as string[], unmark: [] as string[], remove: [] as string[] }
  for (const f of files) {
    if (f.appProperties?.kind !== 'image' || s.pending[f.id]?.create) continue
    const since = f.appProperties?.sin_uso
    if (used.has(f.id)) { if (since) plan.unmark.push(f.id) }
    else if (!since) plan.mark.push(f.id)
    else if (now - Date.parse(since) >= PHOTO_WAIT) plan.remove.push(f.id)
  }
  return plan
}

let cleaned = 0 // la limpieza corre al sincronizar, como mucho una vez por hora
const PHOTO_BATCH = 30 // de a pocas por vuelta: cientos de cambios juntos frenan la subida y el guardado en el celular
// false: no se pudo decidir, o quedan más para la siguiente vuelta.
export function cleanPhotos(now = Date.now()) {
  const plan = photoPlan({ ...state, refs }, now)
  if (!plan) return false
  let left = PHOTO_BATCH
  for (const id of plan.unmark) if (left-- > 0) patch(id, { props: { sin_uso: null } })
  for (const id of plan.mark) if (left-- > 0) patch(id, { props: { sin_uso: new Date(now).toISOString() } })
  for (const id of plan.remove) if (left-- > 0) { remove(id); db.del(`img:${id}`) }
  return left >= 0
}

// Nota que todavía no se bajó a este dispositivo (se pide al abrirla).
export async function ensureText(id: string) {
  const f = state.files[id]
  if (!f || state.texts[id] || isProtected(id) && !canSeal(id)) return
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

export const clearLocal = () => { sealed = {}; return db.clearAccount() }
