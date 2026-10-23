// Google Drive REST v3 con fetch, solo dentro de la carpeta oculta de la app (appDataFolder).
// Cada libreta y cada nota es un archivo de Drive; su id de Drive es el id fijo que siempre se sobrescribe.
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FIELDS = 'id,name,modifiedTime,appProperties'

export type DriveFile = {
  id: string
  name: string
  modifiedTime: string
  appProperties?: Record<string, string>
}
type Meta = { name?: string; appProperties?: Record<string, string> }

export class AuthError extends Error {}

let token = ''
export const setToken = (t: string) => { token = t }

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new AuthError('La sesión de Google venció.')
  if (!res.ok) throw new Error(`Google Drive respondió ${res.status}: ${await res.text()}`)
  return res
}

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

export const deleteFile = (id: string) => call(`${API}/files/${id}`, { method: 'DELETE' })

// Sin id = crear en la carpeta oculta. Sin contenido = solo datos (renombrar, mover).
export async function saveFile(id: string | undefined, meta: Meta, content?: string): Promise<DriveFile> {
  const metadata = JSON.stringify(id ? meta : { ...meta, parents: ['appDataFolder'] })
  const method = id ? 'PATCH' : 'POST'
  const path = id ? `/${id}` : ''
  if (content === undefined) {
    const res = await call(`${API}/files${path}?fields=${FIELDS}`, { method, headers: { 'Content-Type': 'application/json' }, body: metadata })
    return res.json()
  }
  const b = crypto.randomUUID()
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${b}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${b}--`
  const res = await call(`${UPLOAD}${path}?uploadType=multipart&fields=${FIELDS}`, { method, headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body })
  return res.json()
}
