import { saveFile } from './drive.ts'

// Fotos a JPEG de máx. 1600 px (~150–350 KB) con fondo blanco (el JPEG no tiene transparencia).
async function compress(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return new Promise((ok, ko) => canvas.toBlob(b => b ? ok(b) : ko(new Error('No se pudo leer la foto.')), 'image/jpeg', 0.8))
}

// shortcut: las fotos que se borran de una nota (o de una nota borrada) quedan en Drive; se limpian en la etapa 6 (basurero).
export async function uploadImage(file: File): Promise<string> {
  return (await saveFile(undefined, { name: 'foto.jpg', appProperties: { kind: 'image' } }, await compress(file))).id
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
