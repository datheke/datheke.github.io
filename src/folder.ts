import { imageBlob } from './images.ts'
import * as store from './sync.ts'

// Escritorio: copia visible de las notas en Documentos/Datheke/<cuenta>/<Libreta>/<Título>.html, con sus fotos en fotos/.
// Solo de ida: se actualiza sola desde la app; lo que se edite a mano en esos archivos no se sube.

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

// Nombre de archivo válido en Windows, Mac y Android.
export function safeName(s: string) {
  // eslint-disable-next-line no-control-regex
  const name = s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().replace(/[. ]+$/, '').slice(0, 80) || store.UNTITLED
  return RESERVED.test(name) ? `_${name}` : name
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// script-src 'none': el archivo se abre en el navegador y nunca ejecuta nada de lo que traiga la nota.
const page = (title: string, body: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.6}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style>
</head><body><h1>${esc(title)}</h1>
${body}
</body></html>
`

// Qué archivo le toca a cada nota bajada (sin repetir nombres dentro de una libreta) y qué fotos usa.
export function plan({ files, texts }: Pick<store.State, 'files' | 'texts'>) {
  const out = new Map<string, { path: string; html: string; images: string[] }>()
  const used = new Set<string>()
  const notes = Object.values(files).filter(f => f.appProperties?.kind === 'note').sort((a, b) => a.id.localeCompare(b.id))
  for (const f of notes) {
    const t = texts[f.id]
    if (!t) continue
    const dir = safeName(files[f.appProperties?.notebook ?? '']?.name ?? 'Sin libreta')
    const title = t.title || store.UNTITLED
    let path = `${dir}/${safeName(title)}.html`
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${dir}/${safeName(title)} (${n}).html`
    used.add(path.toLowerCase())
    const images: string[] = []
    const body = t.text.replace(/src="drive:([\w-]+)"/g, (_, id: string) => { images.push(id); return `src="../fotos/${id}.jpg"` })
    out.set(f.id, { path, html: page(title, body), images })
  }
  return out
}

let root = ''
let written = new Map<string, string>() // nota → archivo que escribió la app (se guarda en .datheke.json)
const lastHtml = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | undefined
let busy = false
let again = false

export function startFolder(email: string) {
  root = `Datheke/${safeName(email)}`
  mirror()
  return store.subscribe(() => { clearTimeout(timer); timer = setTimeout(mirror, 2000) })
}

async function mirror() {
  if (busy) { again = true; return }
  busy = true
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const opt = { baseDir: fs.BaseDirectory.Document }
    const manifest = `${root}/.datheke.json`
    // Si alguien borró la carpeta, se vuelve a escribir entera.
    if (!await fs.exists(root, opt)) { written.clear(); lastHtml.clear() }
    if (!written.size && await fs.exists(manifest, opt)) written = new Map(Object.entries(JSON.parse(await fs.readTextFile(manifest, opt))))
    const want = plan(store.getState())
    // Nota borrada o renombrada: se quita su archivo viejo (solo archivos que escribió la app) y la carpeta si quedó vacía.
    for (const [id, path] of written) {
      if (want.get(id)?.path === path) continue
      await fs.remove(`${root}/${path}`, opt).catch(() => {})
      await fs.remove(`${root}/${path.split('/')[0]}`, opt).catch(() => {})
      written.delete(id)
      lastHtml.delete(id)
    }
    for (const [id, note] of want) {
      if (lastHtml.get(id) === note.html) continue
      await fs.mkdir(`${root}/${note.path.split('/')[0]}`, { ...opt, recursive: true })
      await fs.writeTextFile(`${root}/${note.path}`, note.html, opt)
      let photosOk = true
      for (const img of note.images) {
        const file = `${root}/fotos/${img}.jpg`
        if (await fs.exists(file, opt)) continue
        await fs.mkdir(`${root}/fotos`, { ...opt, recursive: true })
        // Una foto que aún no se puede bajar (sin internet) se intenta en la próxima vuelta.
        await imageBlob(img).then(async b => fs.writeFile(file, new Uint8Array(await b.arrayBuffer()), opt)).catch(() => { photosOk = false })
      }
      written.set(id, note.path)
      if (photosOk) lastHtml.set(id, note.html)
    }
    await fs.writeTextFile(manifest, JSON.stringify(Object.fromEntries(written)), opt)
  } catch (e) {
    console.error('No se pudo actualizar la carpeta Documentos/Datheke', e) // la copia visible nunca debe frenar la app
  } finally {
    busy = false
    if (again) { again = false; mirror() }
  }
}
