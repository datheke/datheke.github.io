import * as db from './db.ts'
import { readBlob } from './drive.ts'
import { addImage } from './sync.ts'

// Fotos a JPEG de máx. 1600 px (~150–350 KB) con fondo blanco (el JPEG no tiene transparencia).
// La portada es una franja: con 1200 px de ancho basta (~80–150 KB), se pone y se baja en los otros aparatos más rápido.
async function compress(file: File, max = 1600, quality = 0.8): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return new Promise((ok, ko) => canvas.toBlob(b => b ? ok(b) : ko(new Error('No se pudo leer la foto.')), 'image/jpeg', quality))
}

// La foto queda en el dispositivo al instante y se sube con lo demás (también sin internet).
// shortcut: las fotos que se borran de una nota (o de una nota borrada) quedan en Drive; se limpian en la etapa 6 (basurero).
export async function uploadImage(file: File): Promise<string> {
  return addImage(await compress(file))
}
// Nota compartida: la foto va dentro del texto (JPEG de máx. 1200 px), así la ve también la otra persona.
export async function imageDataUrl(file: File | Blob): Promise<string> {
  const blob = file instanceof File ? await compress(file, 1200, 0.75) : file
  return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(r.error); r.readAsDataURL(blob) })
}
export async function uploadCover(file: File): Promise<string> {
  return addImage(await compress(file, 1200, 0.75))
}

// Las fotos se guardan también en el dispositivo: se ven sin internet y se bajan una sola vez.
export async function imageBlob(id: string): Promise<Blob> {
  let blob = await db.get<Blob>(`img:${id}`)
  if (!blob) {
    blob = await readBlob(id)
    db.set(`img:${id}`, blob)
  }
  return blob
}

const urls = new Map<string, Promise<string>>()
export function imageUrl(id: string): Promise<string> {
  if (!urls.has(id)) urls.set(id, imageBlob(id).then(b => URL.createObjectURL(b)).catch(e => { urls.delete(id); throw e }))
  return urls.get(id)!
}

// Abre el selector de archivos (en el celular ofrece cámara o galería). Debe llamarse desde un clic o tecla.
export function pickImage(): Promise<File | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => resolve(input.files?.[0])
    input.oncancel = () => resolve(undefined)
    input.click()
  })
}
