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
// En la app de escritorio la sesión se renueva sola: si Google dice "vencida", se pide un token nuevo y se reintenta.
let renew: (() => Promise<string>) | undefined
export const setRenew = (fn?: () => Promise<string>) => { renew = fn }

async function call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
    .catch(() => { throw new OfflineError('Sin conexión.') })
  if (res.status === 401 && renew && retry) {
    token = await renew()
    return call(url, init, false)
  }
  if (res.status === 401) throw new AuthError('La sesión de Google venció.')
  if (!res.ok) throw Object.assign(new Error(`Google Drive respondió ${res.status}: ${await res.text()}`), { status: res.status })
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
