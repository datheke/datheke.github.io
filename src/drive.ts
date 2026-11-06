// Google Drive REST v3 con fetch, solo dentro de la carpeta oculta de la app (appDataFolder).
// Cada libreta y cada nota es un archivo de Drive; su id de Drive es el id fijo que siempre se sobrescribe.
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FIELDS = 'id,name,modifiedTime,mimeType,appProperties'

export type DriveFile = {
  id: string
  name: string
  modifiedTime: string
  mimeType?: string
  appProperties?: Record<string, string>
}
// id: solo al crear, con un id reservado antes (generateIds) para poder crear sin internet.
type Meta = { id?: string; name?: string; appProperties?: Record<string, string | null> }

export class AuthError extends Error {}
export class OfflineError extends Error {}

let token = ''
export const setToken = (t: string) => { token = t }
export const getToken = () => token
// En la app de escritorio la sesión se renueva sola: si Google dice "vencida", se pide un token nuevo y se reintenta.
let renew: (() => Promise<string>) | undefined
export const setRenew = (fn?: () => Promise<string>) => { renew = fn }

// También la usa calendar.ts (misma sesión de Google).
export async function call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
    .catch(() => { throw new OfflineError('Sin conexión.') })
  if (res.status === 401 && renew && retry) {
    token = await renew()
    return call(url, init, false)
  }
  if (res.status === 401) throw new AuthError('La sesión de Google venció.')
  if (!res.ok) throw Object.assign(new Error(`Google respondió ${res.status}: ${await res.text()}`), { status: res.status })
  return res
}

export const generateIds = async (count: number): Promise<string[]> =>
  (await (await call(`${API}/files/generateIds?count=${count}&space=appDataFolder&type=files`)).json()).ids

export const readBlob = async (id: string) => (await call(`${API}/files/${id}?alt=media`)).blob()

export const getEmail = async (): Promise<string> =>
  (await (await call(`${API}/about?fields=user(emailAddress)`)).json()).user.emailAddress

export async function listFiles(): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken = ''
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: `nextPageToken,files(${FIELDS})` })
    if (pageToken) q.set('pageToken', pageToken)
    const data = await (await call(`${API}/files?${q}`)).json()
    files.push(...data.files)
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return files
}

export const readFile = async (id: string) => (await call(`${API}/files/${id}?alt=media`)).text()

// Las notas de la etapa 1 se guardaron como texto plano; se convierten a HTML al abrirlas.
export async function readNote(id: string, mimeType?: string): Promise<string> {
  const body = await readFile(id)
  if (mimeType !== 'text/plain') return body
  return body.split('\n').map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('')
}

export const deleteFile = (id: string) => call(`${API}/files/${id}`, { method: 'DELETE' })

// Sin id = crear en la carpeta oculta. Sin contenido = solo datos (renombrar, mover; null borra una propiedad).
// Contenido texto = HTML de la nota; Blob = foto, en archivo aparte para que la nota solo guarde su id.
export async function saveFile(id: string | undefined, meta: Meta, content?: string | Blob): Promise<DriveFile> {
  const type = typeof content === 'string' ? 'text/html' : content?.type
  const full = type ? { ...meta, mimeType: type } : meta
  const metadata = JSON.stringify(id ? full : { ...full, parents: ['appDataFolder'] })
  const method = id ? 'PATCH' : 'POST'
  const path = id ? `/${id}` : ''
  if (content === undefined) {
    const res = await call(`${API}/files${path}?fields=${FIELDS}`, { method, headers: { 'Content-Type': 'application/json' }, body: metadata })
    return res.json()
  }
  const b = crypto.randomUUID()
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${b}\r\nContent-Type: ${type}${typeof content === 'string' ? '; charset=UTF-8' : ''}\r\n\r\n`, content, `\r\n--${b}--`])
  const res = await call(`${UPLOAD}${path}?uploadType=multipart&fields=${FIELDS}`, { method, headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body })
  return res.json()
}

// Archivos visibles en "Mi unidad" (permiso drive.file: solo los que crea Datheke). Los usa el respaldo semanal.
const FOLDER = 'application/vnd.google-apps.folder'

export async function listVisible(q: string): Promise<DriveFile[]> {
  const p = new URLSearchParams({ q: `${q} and trashed=false`, spaces: 'drive', fields: `files(${FIELDS})`, pageSize: '100' })
  return (await (await call(`${API}/files?${p}`)).json()).files
}

async function createFolder(name: string, parent?: string): Promise<string> {
  const res = await call(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) })
  return (await res.json()).id
}

// La carpeta más vieja con ese nombre (o la más nueva, para las de antes), dentro de parent si se pide.
async function findFolder(name: string, parent?: string, newest = false) {
  const p = new URLSearchParams({ q: `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and trashed=false${parent ? ` and '${parent}' in parents` : ''}`,
    spaces: 'drive', fields: 'files(id)', orderBy: newest ? 'createdTime desc' : 'createdTime', pageSize: '1' })
  return (await (await call(`${API}/files?${p}`)).json()).files[0]?.id as string | undefined
}

async function moveInto(id: string, parent: string, name: string) {
  const { parents = [] } = await (await call(`${API}/files/${id}?fields=parents`)).json()
  const p = new URLSearchParams({ addParents: parent, removeParents: parents.join(','), fields: 'id' })
  await call(`${API}/files/${id}?${p}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
}

// Todo lo visible de Datheke va en una sola carpeta de "Mi unidad" (las notas siguen en la carpeta escondida). Las carpetas
// de antes ("Datheke" con los respaldos y "Datheke – notas compartidas") se mueven ahí la primera vez, con lo que tengan
// adentro: las notas compartidas siguen compartidas (el permiso va en cada archivo). Nada se borra.
export const HOME = 'Datheke – importante, no borrar'
export const README = 'LÉEME – no borrar.txt'
const SUBFOLDERS = { respaldos: 'Respaldos', compartidas: 'Notas compartidas' }
const BEFORE: Record<keyof typeof SUBFOLDERS, string> = { respaldos: 'Datheke', compartidas: 'Datheke – notas compartidas' }
const README_TEXT = `Esta carpeta es de Datheke, tu app de notas. Es importante: no la borres ni le cambies el nombre.

- Respaldos: una copia de todas tus notas, una vez por semana (se guardan las 2 últimas). Se abre en cualquier navegador, aunque no tengas Datheke.
- Notas compartidas: las notas que compartes con otras personas. Si borras una, deja de llegarles.

Tus notas no están aquí: viven en una carpeta escondida de Datheke en tu Drive, que no aparece en esta lista. Para verlas, abre Datheke (la app o datheke.github.io).

Nunca toques "Eliminar datos de app ocultos" en Configuración > Administrar aplicaciones (Datheke puede salir ahí como "Notas David"): borraría todas tus notas.

Si borras algo de aquí por error, abre Datheke: el respaldo se vuelve a hacer con "Hacer ahora", y Datheke te avisa si una nota compartida perdió su archivo.
`
async function ensure(sub: keyof typeof SUBFOLDERS) {
  const home = await findFolder(HOME) ?? await createFolder(HOME)
  if (!(await listVisible(`name='${README}' and '${home}' in parents`)).length) await uploadVisible(README, home, new Blob([README_TEXT], { type: 'text/plain;charset=utf-8' }))
  const name = SUBFOLDERS[sub]
  const found = await findFolder(name, home)
  if (found) return found
  const before = await findFolder(BEFORE[sub], undefined, true)
  if (before) { await moveInto(before, home, name); return before }
  return createFolder(name, home)
}
// De a una: si se piden dos a la vez (respaldo y compartir al abrir), no se crea la carpeta dos veces.
// shortcut: dos aparatos abiertos justo a la vez podrían crearla dos veces; se usa siempre la más vieja.
let queue: Promise<unknown> = Promise.resolve()
export function dathekeFolder(sub: keyof typeof SUBFOLDERS): Promise<string> {
  const run = queue.then(() => ensure(sub))
  queue = run.catch(() => {})
  return run
}

export async function uploadVisible(name: string, parent: string, content: Blob): Promise<string> {
  const b = crypto.randomUUID()
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n`,
    `--${b}\r\nContent-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`, content, `\r\n--${b}--`])
  const res = await call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body })
  return (await res.json()).id
}

export const renameFile = (id: string, name: string) =>
  call(`${API}/files/${id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
