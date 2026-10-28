import { call, createFolder, findFolder, getEmail, getToken } from './drive.ts'

// Notas compartidas por correo. La carpeta oculta de Datheke no se puede compartir, así que una nota compartida vive
// en "Mi unidad" (carpeta "Datheke – notas compartidas", permiso drive.file: solo lo que crea o abre Datheke) y se
// comparte con permiso de edición. Cada persona tiene además su propia nota en Datheke que apunta a ese archivo
// (appProperties: compartida = id del archivo, rol = dueño | invitado): es su copia para ver sin internet.
//  - Quien recibe: Google no deja que su Datheke vea el archivo solo; lo elige una vez en la ventana de Google (Picker).
//  - Dejar de compartir "sin copia": el archivo queda vacío y marcado; el Datheke de la otra persona lo ve, borra su
//    nota y se sale. "Con copia": se le quita el permiso y su Datheke se queda con lo último como nota suya.
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FIELDS = 'id,name,modifiedTime,appProperties,lastModifyingUser(displayName,emailAddress,me),ownedByMe,owners(displayName,emailAddress)'
const FOLDER_NAME = 'Datheke – notas compartidas'
// Públicas por diseño (van dentro de la página): solo abren la ventana de Google para elegir un archivo.
const PICKER_KEY = 'AIzaSyDZzN9tF45jb9A_8hro1JAACjopqv6kAo8'
const APP_ID = '561260224283'

export type Remote = {
  id: string; name: string; modifiedTime: string; appProperties?: Record<string, string>
  lastModifyingUser?: { displayName?: string; emailAddress?: string; me?: boolean }
  ownedByMe?: boolean; owners?: { displayName?: string; emailAddress?: string }[]
}
export type Person = { id: string; emailAddress?: string; displayName?: string; role: string }

const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export const status = (e: unknown) => (e as { status?: number }).status

let folderId: Promise<string> | undefined
const folder = () => folderId ??= findFolder(FOLDER_NAME).then(id => id ?? createFolder(FOLDER_NAME)).catch(e => { folderId = undefined; throw e })

async function upload(id: string | undefined, meta: Record<string, unknown>, html: string): Promise<Remote> {
  const b = crypto.randomUUID()
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${b}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n`, html, `\r\n--${b}--`])
  const res = await call(`${UPLOAD}${id ? `/${id}` : ''}?uploadType=multipart&fields=${FIELDS}`,
    { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body })
  return res.json()
}

// La nota pasa a "Mi unidad" (la crea quien comparte) y se comparte con cada correo (Google les manda un aviso).
export async function create(title: string, html: string): Promise<Remote> {
  return upload(undefined, { name: title, mimeType: 'text/html', parents: [await folder()], appProperties: { datheke: 'nota' } }, html)
}

export async function invite(fileId: string, emails: string[], title: string) {
  const msg = `Te compartí la nota "${title}" en Datheke. Para verla y editarla: abre Datheke (datheke.github.io o la app) → Nota recibida → Compartida conmigo, y elígela.`
  for (const emailAddress of emails) {
    const q = new URLSearchParams({ sendNotificationEmail: 'true', emailMessage: msg })
    await call(`${API}/files/${fileId}/permissions?${q}`, { method: 'POST', ...json({ type: 'user', role: 'writer', emailAddress }) })
  }
}

export async function people(fileId: string): Promise<Person[]> {
  const data = await (await call(`${API}/files/${fileId}/permissions?fields=permissions(id,emailAddress,displayName,role)`)).json()
  return data.permissions ?? []
}

export async function uninvite(fileId: string, permissionId: string) {
  try { await call(`${API}/files/${fileId}/permissions/${permissionId}`, { method: 'DELETE' }) } catch (e) { if (status(e) !== 404) throw e }
}

export const get = async (fileId: string): Promise<Remote> => (await call(`${API}/files/${fileId}?fields=${FIELDS}`)).json()
export const read = async (fileId: string): Promise<string> => (await call(`${API}/files/${fileId}?alt=media`)).text()
export const write = (fileId: string, html: string, title: string, props?: Record<string, string | null>) =>
  upload(fileId, { name: title, ...(props ? { appProperties: props } : {}) }, html)
export const setProps = async (fileId: string, props: Record<string, string | null>): Promise<Remote> =>
  (await call(`${API}/files/${fileId}?fields=${FIELDS}`, { method: 'PATCH', ...json({ appProperties: props }) })).json()

export async function remove(fileId: string) {
  try { await call(`${API}/files/${fileId}`, { method: 'DELETE' }) } catch (e) { if (status(e) !== 404 && status(e) !== 403) throw e }
}

// Quien recibe se sale: se quita su propio permiso (la nota del dueño sigue igual).
export async function leave(fileId: string, myEmail: string) {
  const me = (await people(fileId).catch(() => [])).find(p => p.emailAddress?.toLowerCase() === myEmail.toLowerCase() && p.role !== 'owner')
  if (me) await uninvite(fileId, me.id)
}

// Correos a los que se les quitó la nota "sin copia" (su Datheke la borra y se sale).
export const removedList = (r?: Remote) => (r?.appProperties?.quitados ?? '').split(',').filter(Boolean)

// Para saber si la nota cambió en este aparato desde lo último que se subió o bajó.
export function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

// Lo último que este aparato subió o bajó de cada nota compartida (base: fecha en Drive; sent: huella del texto).
const STATE = 'datheke-compartidas'
type Entry = { base: string; sent: number; k?: boolean } // k: la última vez la nota tenía clave para todos
type St = Record<string, Entry>
export const readState = (): St => { try { return JSON.parse(localStorage.getItem(STATE) ?? '{}') } catch { return {} } }
export function saveState(fileId: string, v: Entry | null) {
  const all = readState()
  if (v) all[fileId] = v
  else delete all[fileId]
  try { localStorage.setItem(STATE, JSON.stringify(all)) } catch { /* se vuelve a bajar */ }
}

// Ventana de Google para elegir una nota que te compartieron (así tu Datheke puede abrirla). Devuelve su id.
declare const gapi: { load(name: string, cb: () => void): void }
type PickerNs = {
  PickerBuilder: new () => PickerBuilder
  DocsView: new (id?: string) => { setOwnedByMe(v: boolean): unknown; setMimeTypes(m: string): unknown; setIncludeFolders(v: boolean): unknown; setMode(m: string): unknown }
  ViewId: { DOCS: string }; Action: { PICKED: string; CANCEL: string }; DocsViewMode: { LIST: string }
}
type PickerBuilder = Record<'addView' | 'setOAuthToken' | 'setDeveloperKey' | 'setAppId' | 'setCallback' | 'setTitle' | 'setLocale' | 'setOrigin' | 'setSize', (v: unknown) => PickerBuilder> & { build(): { setVisible(v: boolean): void } }

let pickerReady: Promise<PickerNs> | undefined
function loadPicker(): Promise<PickerNs> {
  return pickerReady ??= new Promise<PickerNs>((resolve, reject) => {
    const done = () => gapi.load('picker', () => resolve((window as unknown as { google: { picker: PickerNs } }).google.picker))
    if (typeof gapi !== 'undefined') return done()
    const s = document.createElement('script')
    s.src = 'https://apis.google.com/js/api.js'
    s.onload = done
    s.onerror = () => { pickerReady = undefined; reject(new Error('No se pudo abrir la ventana de Google. Revisa tu internet.')) }
    document.head.append(s)
  })
}

export async function pick(): Promise<string | undefined> {
  await getEmail() // que la sesión esté vigente antes de pasarle el token a Google
  const picker = await loadPicker()
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
    view.setOwnedByMe(false)
    view.setMimeTypes('text/html')
    view.setMode(picker.DocsViewMode.LIST)
    new picker.PickerBuilder()
      .addView(view)
      .setTitle('Elige la nota que te compartieron')
      .setLocale('es')
      .setOAuthToken(getToken())
      .setDeveloperKey(PICKER_KEY)
      .setAppId(APP_ID) // así Google le da a Datheke permiso para esa nota
      .setCallback((d: unknown) => {
        const data = d as { action: string; docs?: { id: string }[] }
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id)
        else if (data.action === picker.Action.CANCEL) resolve(undefined)
      })
      .build().setVisible(true)
  })
}

// Ícono y portada viajan al final del archivo compartido, en un comentario que el editor no ve:
// <!--datheke:{"icono":"💡","portada":"data:image/jpeg;base64,…"}-->
export type Extra = { icono?: string; portada?: string }
const EXTRA = /<!--datheke:(\{[\s\S]*?\})-->\s*$/
export function splitExtra(html: string): { body: string; extra: Extra } {
  const m = html.match(EXTRA)
  if (!m) return { body: html, extra: {} }
  try { return { body: html.slice(0, m.index).replace(/\s+$/, ''), extra: JSON.parse(m[1]) } } catch { return { body: html, extra: {} } }
}
export const joinExtra = (body: string, extra: Extra) =>
  extra.icono || extra.portada ? `${body}\n<!--datheke:${JSON.stringify(extra)}-->` : body
