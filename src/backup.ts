import { strToU8, zipSync } from 'fflate'
import { createFolder, deleteFile, findFolder, listVisible, readNote, renameFile, uploadVisible, type DriveFile } from './drive.ts'
import { indexPage, noteBody, notePage, plainHtml } from './exportPage.ts'
import { safeName } from './folder.ts'
import { imageBlob } from './images.ts'
import * as store from './sync.ts'

// Respaldo semanal: "Datheke – respaldo.zip" en la carpeta visible "Datheke" de Drive, con una página por nota que se
// abre en cualquier navegador (fotos y portada adentro) y "Abrir aquí.html" con la lista. Se guardan los 2 últimos:
// el anterior pasa a "Datheke – respaldo anterior.zip" y el más viejo se borra. Todo va sin cifrar, también las notas
// con clave (decisión del dueño): el respaldo se ve siempre, aunque se olvide la clave o no se tenga la app; lo protege
// la cuenta de Google. En los aparatos, en cambio, las notas con clave sí van cifradas (sync.ts, vault.ts).

export const ZIP = 'Datheke – respaldo.zip'
export const OLD = 'Datheke – respaldo anterior.zip'
const FOLDER = 'Datheke'
const ROOT = 'Datheke – respaldo/'
export const EVERY_MS = 7 * 86400_000

export class NeedsPermission extends Error {} // la sesión es de antes del permiso para la carpeta visible

const isNote = (f: DriveFile) => f.appProperties?.kind === 'note' && !f.appProperties?.borrada
const isProtected = (f: DriveFile) => f.appProperties?.protegida === 'true'

// ¿Hubo cambios en notas o libretas desde el último respaldo? (Los ajustes no cuentan.)
export function changedSince(files: DriveFile[], last: string) {
  return files.some(f => ['note', 'notebook'].includes(f.appProperties?.kind ?? '') && f.modifiedTime > last)
}

const toDataUrl = (b: Blob) => new Promise<string>((ok, ko) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result))
  r.onerror = () => ko(r.error)
  r.readAsDataURL(b)
})
const photo = (id: string) => imageBlob(id).then(toDataUrl).catch(() => '') // foto que no se pudo bajar: se omite

async function withPhotos(html: string) {
  const ids = [...new Set([...html.matchAll(/src="drive:([\w-]+)"/g)].map(m => m[1]))]
  const urls = new Map(await Promise.all(ids.map(async id => [id, await photo(id)] as const)))
  return html.replace(/src="drive:([\w-]+)"/g, (_, id: string) => `src="${urls.get(id) ?? ''}"`)
}

// Ruta de una nota vista desde otra (para los enlaces "@"): todas están en <libreta>/<nota>.html.
const relative = (from: string, to: string) =>
  (from.split('/')[0] === to.split('/')[0] ? to.split('/')[1] : `../${to}`).split('/').map(encodeURIComponent).join('/')

export async function buildZip(): Promise<Uint8Array> {
  const { files, texts } = store.getState()
  const all = Object.values(files)
  const notebooks = new Map(all.filter(f => f.appProperties?.kind === 'notebook').map(f => [f.id, f.name]))
  const notes = all.filter(isNote)
  const date = new Date().toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' })
  const bookOf = (f: DriveFile) => notebooks.get(f.appProperties?.notebook ?? '') ?? 'Sin libreta'
  notes.sort((a, b) => bookOf(a).localeCompare(bookOf(b)) || a.name.localeCompare(b.name))
  const paths = new Map<string, string>()
  const used = new Set<string>()
  for (const f of notes) {
    const dir = safeName(bookOf(f))
    const name = safeName(f.name || store.UNTITLED)
    let path = `${dir}/${name}.html`
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${dir}/${name} (${n}).html`
    used.add(path.toLowerCase())
    paths.set(f.id, path)
  }
  const out: Record<string, Uint8Array> = {}
  for (const f of notes) {
    const path = paths.get(f.id)!
    // Las que no están en este aparato (o con clave y la caja cerrada) se leen de Drive, sin guardarlas aquí.
    const title = texts[f.id]?.title ?? (f.name === store.UNTITLED ? '' : f.name)
    const html = texts[f.id]?.text ?? await readNote(f.id, f.mimeType)
    const body = await withPhotos(plainHtml(html, id => paths.has(id) ? relative(path, paths.get(id)!) : undefined))
    const cover = f.appProperties?.cover ? await photo(f.appProperties.cover) : ''
    const inner = noteBody({ title: title || store.UNTITLED, html: body, icon: f.appProperties?.icon, cover })
    out[ROOT + path] = strToU8(notePage(title || store.UNTITLED, inner, date))
  }
  const groups = [...new Set(notes.map(bookOf))].map(notebook => ({
    notebook,
    notes: notes.filter(f => bookOf(f) === notebook).map(f => ({ title: f.name || store.UNTITLED, path: paths.get(f.id)!, locked: isProtected(f) })),
  }))
  out[`${ROOT}Abrir aquí.html`] = strToU8(indexPage(groups, date))
  return zipSync(out, { level: 6 })
}

// Sube el zip nuevo y deja solo dos: el nuevo y el anterior.
export async function upload(zip: Uint8Array) {
  try {
    const folder = await findFolder(FOLDER) ?? await createFolder(FOLDER)
    const inside = await listVisible(`'${folder}' in parents`)
    for (const f of inside.filter(f => f.name === OLD)) await deleteFile(f.id)
    for (const f of inside.filter(f => f.name === ZIP)) await renameFile(f.id, OLD)
    await uploadVisible(ZIP, folder, new Blob([zip as BlobPart], { type: 'application/zip' }))
  } catch (e) {
    if ((e as { status?: number }).status === 403) throw new NeedsPermission('Falta el permiso para guardar el respaldo en tu Drive.')
    throw e
  }
}
