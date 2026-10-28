import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

// "Enviar copia": una nota en un archivo .datheke (un zip con nota.json y sus fotos) para mandar por WhatsApp, correo,
// etc. Quien lo recibe lo abre en Datheke y queda como una nota suya, independiente: en su Drive, con su letra, colores,
// portada, fotos, desplegables y recordatorios (que empiezan a sonar en sus aparatos). Va sin clave y sin el historial
// de recordatorios (eso es de quien la envía).
export const EXT = '.datheke'
const FORMAT = 'datheke-nota'

export type Packed = { title: string; html: string; icon?: string; cover?: string; photos: Record<string, Uint8Array> }

// Sin historial ni "hecho" en los recordatorios: quien la recibe empieza de cero.
export function cleanReminders(html: string) {
  return html.replace(/<span([^>]*data-type="recordatorio"[^>]*)>/g, (_, a: string) =>
    `<span${a.replace(/\s*data-(historial|hecho)="[^"]*"/g, '')}>`)
}

export const photoIds = (html: string) => [...new Set([...html.matchAll(/src="drive:([\w-]+)"/g)].map(m => m[1]))]

export function pack(p: Packed): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'nota.json': strToU8(JSON.stringify({ formato: FORMAT, version: 1, titulo: p.title, html: p.html, icono: p.icon, portada: p.cover })),
  }
  for (const [id, bytes] of Object.entries(p.photos)) files[`fotos/${id}.jpg`] = bytes
  return zipSync(files, { level: 6 })
}

export function unpack(bytes: Uint8Array): Packed {
  let files: Record<string, Uint8Array>
  try { files = unzipSync(bytes) } catch { throw new Error('Este archivo no es una nota de Datheke.') }
  const raw = files['nota.json']
  const meta = raw ? JSON.parse(strFromU8(raw)) : null
  if (meta?.formato !== FORMAT) throw new Error('Este archivo no es una nota de Datheke.')
  if (meta.version > 1) throw new Error('Esta nota viene de una versión más nueva de Datheke: actualiza la app para abrirla.')
  const photos: Record<string, Uint8Array> = {}
  for (const [name, b] of Object.entries(files)) {
    const m = name.match(/^fotos\/([\w-]+)\.jpg$/)
    if (m) photos[m[1]] = b
  }
  return { title: String(meta.titulo ?? ''), html: String(meta.html ?? ''), icon: meta.icono || undefined, cover: meta.portada || undefined, photos }
}

// Nombre de archivo válido en todos lados.
export const fileName = (title: string) =>
  // eslint-disable-next-line no-control-regex
  `${(title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().slice(0, 60) || 'Nota')}${EXT}`

// Abrir el menú de compartir del aparato (WhatsApp, correo, Drive…). Devuelve dónde quedó si no se pudo compartir.
export async function send(bytes: Uint8Array, name: string): Promise<'compartido' | 'descargado' | string> {
  const { desktop } = await import('./auth.ts')
  const android = desktop && /android/i.test(navigator.userAgent)
  if (desktop) {
    const fs = await import('@tauri-apps/plugin-fs')
    const { join, appCacheDir, documentDir } = await import('@tauri-apps/api/path')
    if (android) {
      // El menú de compartir copia el archivo a la carpeta temporal de la app y lo entrega desde ahí. Se escribe en una
      // subcarpeta: si estuviera en la misma ruta, la copia lo vaciaba (llegaba de 0 kB a WhatsApp).
      const dir = await join(await appCacheDir(), 'enviar')
      await fs.mkdir(dir, { recursive: true }).catch(() => {})
      const path = await join(dir, name)
      await fs.writeFile(path, bytes)
      const { shareFile } = await import('@choochmeque/tauri-plugin-sharekit-api')
      try { await shareFile(path, { mimeType: 'application/octet-stream', title: name }) } catch (e) {
        // Android avisa "cancelado" también cuando ya se compartió (WhatsApp no devuelve nada): no es un error.
        if (!/cancel/i.test(String(e))) throw e
      }
      return 'compartido'
    }
    // Windows: queda en Documentos/Datheke/Enviadas para adjuntarlo en WhatsApp o un correo.
    const rel = `Datheke/Enviadas/${name}`
    await fs.mkdir('Datheke/Enviadas', { baseDir: fs.BaseDirectory.Document, recursive: true })
    await fs.writeFile(rel, bytes, { baseDir: fs.BaseDirectory.Document })
    return await join(await documentDir(), rel)
  }
  const file = new File([bytes as BlobPart], name, { type: 'application/octet-stream' })
  // Celular y Mac/iPhone en el navegador: el menú de compartir del sistema, si lo tiene.
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'compartido' } catch (e) {
      if ((e as Error).name === 'AbortError') return 'compartido'
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = name
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  return 'descargado'
}

// Elegir un archivo .datheke recibido (de Descargas, de los documentos de WhatsApp, etc.).
export function pickFile(): Promise<File | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `${EXT},application/octet-stream,application/zip`
    input.onchange = () => resolve(input.files?.[0])
    input.oncancel = () => resolve(undefined)
    input.click()
  })
}

// "Abrir con Datheke" (Android: tocar el archivo en WhatsApp, Descargas…; Windows: doble clic): la app lo deja en la
// carpeta temporal "recibidas" (MainActivity / lib.rs). Se toma el más antiguo y se borra de ahí.
export async function takeReceived(): Promise<{ bytes: Uint8Array; name: string } | undefined> {
  const { desktop } = await import('./auth.ts')
  if (!desktop) return
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const { join, appCacheDir } = await import('@tauri-apps/api/path')
    const dir = await join(await appCacheDir(), 'recibidas')
    if (!await fs.exists(dir)) return
    const files = (await fs.readDir(dir)).filter(f => f.isFile).map(f => f.name).sort()
    if (!files.length) return
    const path = await join(dir, files[0])
    const bytes = await fs.readFile(path)
    await fs.remove(path).catch(() => {})
    return { bytes, name: files[0].replace(/^\d+-/, '') }
  } catch (e) { console.error('Nota recibida', e); return }
}
