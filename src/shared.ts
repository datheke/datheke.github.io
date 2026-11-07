import { call, dathekeFolder, getEmail, getToken } from './drive.ts'

// Notas compartidas por correo. La carpeta oculta de Datheke no se puede compartir, así que una nota compartida vive
// en "Mi unidad" ("Datheke – importante, no borrar/Notas compartidas", permiso drive.file: solo lo que crea o abre Datheke) y se
// comparte con permiso de edición. Cada persona tiene además su propia nota en Datheke que apunta a ese archivo
// (appProperties: compartida = id del archivo, rol = dueño | invitado): es su copia para ver sin internet.
//  - Quien recibe: Google no deja que su Datheke vea el archivo solo; lo elige una vez en la ventana de Google (Picker).
//  - Dejar de compartir "sin copia": el archivo queda vacío y marcado; el Datheke de la otra persona lo ve, borra su
//    nota y se sale. "Con copia": se le quita el permiso y su Datheke se queda con lo último como nota suya.
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FIELDS = 'id,name,modifiedTime,trashed,appProperties,lastModifyingUser(displayName,emailAddress,me),ownedByMe,owners(displayName,emailAddress),capabilities(canEdit)'
// Públicas por diseño (van dentro de la página): solo abren la ventana de Google para elegir un archivo.
const PICKER_KEY = 'AIzaSyDZzN9tF45jb9A_8hro1JAACjopqv6kAo8'
const APP_ID = '561260224283'

export type Remote = {
  id: string; name: string; modifiedTime: string; appProperties?: Record<string, string>
  lastModifyingUser?: { displayName?: string; emailAddress?: string; me?: boolean }
  ownedByMe?: boolean; owners?: { displayName?: string; emailAddress?: string }[]
  capabilities?: { canEdit?: boolean } // false: me la compartieron para solo verla
  trashed?: boolean // el dueño la mandó a la papelera de su Drive
}
export type Person = { id: string; emailAddress?: string; displayName?: string; role: string }
export type Role = 'editar' | 'ver'
// "Solo ver" es "comentarista" en Google: ve la nota y no la puede cambiar, y sí puede dejar el aviso de que se salió
// (un "lector" no podría avisar). Quien protege de verdad es Google: con ese permiso no se cambia la nota ni con otra app.
const GOOGLE_ROLE: Record<Role, string> = { editar: 'writer', ver: 'commenter' }
export const roleOf = (p: Person): Role => p.role === 'writer' || p.role === 'owner' ? 'editar' : 'ver'

const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export const status = (e: unknown) => (e as { status?: number }).status

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
  return upload(undefined, { name: title, mimeType: 'text/html', parents: [await dathekeFolder('compartidas')], appProperties: { datheke: 'nota' } }, html)
}

export async function invite(fileId: string, emails: string[], title: string, role: Role = 'editar') {
  const how = role === 'ver' ? ' Es solo para verla: no podrás cambiarla.' : ''
  const msg = `Te compartí la nota "${title}" en Datheke.${how} Para tenerla (una sola vez): entra desde el navegador a datheke.github.io con este correo → Nota recibida → Compartida conmigo, y elígela. Después aparece sola también en la app de tu celular o tu PC. No la abras con el botón de este correo.`
  for (const emailAddress of emails) {
    const q = new URLSearchParams({ sendNotificationEmail: 'true', emailMessage: msg })
    await call(`${API}/files/${fileId}/permissions?${q}`, { method: 'POST', ...json({ type: 'user', role: GOOGLE_ROLE[role], emailAddress }) })
  }
}

export const setRole = (fileId: string, permissionId: string, role: Role) =>
  call(`${API}/files/${fileId}/permissions/${permissionId}`, { method: 'PATCH', ...json({ role: GOOGLE_ROLE[role] }) })

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

// Quien recibe se sale: se quita su propio permiso (la nota del dueño sigue igual). Si Google no se lo deja (pasa con
// "solo ver"), deja este aviso en la nota y el Datheke del dueño lo saca de la lista (whoLeft).
export const LEFT = 'Datheke: salí de esta nota.'
export async function leave(fileId: string) {
  const me = (await (await call(`${API}/about?fields=user(permissionId)`)).json()).user.permissionId as string
  try { await call(`${API}/files/${fileId}/permissions/${me}`, { method: 'DELETE' }) } catch (e) {
    if (status(e) === 404) return
    if (status(e) !== 403) throw e
    await call(`${API}/files/${fileId}/comments?fields=id`, { method: 'POST', ...json({ content: LEFT }) }).catch(() => {}) // sin aviso: sigue en la lista del dueño hasta que la quite
  }
}

export type Comment = { content?: string; createdTime?: string; author?: { permissionId?: string } }
export async function leftNotices(fileId: string): Promise<Comment[]> {
  const q = new URLSearchParams({ fields: 'comments(content,createdTime,author(permissionId))', pageSize: '100' })
  return ((await (await call(`${API}/files/${fileId}/comments?${q}`)).json()).comments ?? []).filter((c: Comment) => c.content === LEFT)
}
// Quiénes se salieron: un aviso solo cuenta para quien lo escribió (su propio permiso), si es de después de su última
// invitación (si lo volvieron a invitar, el aviso viejo ya no vale), y nunca para el dueño.
export function whoLeft(notices: Comment[], list: Person[], invitedAt: (email: string) => string | undefined) {
  return list.filter(p => p.role !== 'owner' && notices.some(c => c.content === LEFT && c.author?.permissionId === p.id
    && (c.createdTime ?? '') > (invitedAt(p.emailAddress?.toLowerCase() ?? '') ?? '')))
}

// El mismo correo aunque Google lo escriba distinto: en Gmail no cuentan los puntos, las mayúsculas ni lo que va tras "+".
export function sameEmail(a?: string, b?: string) {
  const norm = (e: string) => {
    const [user, domain = ''] = e.trim().toLowerCase().split('@')
    return /^(gmail|googlemail)\.com$/.test(domain) ? `${user.split('+')[0].replace(/\./g, '')}@gmail.com` : `${user}@${domain}`
  }
  return !!a && !!b && norm(a) === norm(b)
}
// De los correos con quienes compartí, los que ya no tienen permiso en Google: se quitaron solos ("Puede editar" sí puede).
export const gone = (emails: string[], list: Person[]) => emails.filter(e => !list.some(p => sameEmail(p.emailAddress, e)))

// Qué hacer con una compartida al sincronizar. dirty: cambió aquí; same: el texto de Drive es igual al de aquí.
// Quien solo puede ver nunca sube: sus cambios sueltos (de cuando podía editar) quedan en una nota aparte.
export type Step = 'nada' | 'subir' | 'bajar' | 'las-dos' | 'bajar-y-guardar-la-mia'
export function sharedStep({ canEdit, dirty, remoteChanged, same }: { canEdit: boolean; dirty: boolean; remoteChanged: boolean; same: boolean }): Step {
  if (!canEdit) return dirty && !same ? 'bajar-y-guardar-la-mia' : dirty || remoteChanged ? 'bajar' : 'nada'
  if (remoteChanged) return dirty && !same ? 'las-dos' : 'bajar'
  return dirty ? 'subir' : 'nada'
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
type Entry = { base: string; sent: number }
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
