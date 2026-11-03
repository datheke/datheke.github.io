import { appFont } from './fonts.ts'

// Lo pegado de otro lado (Word, web, correo) entra como solo texto, con el formato de la nota (Editor.tsx). Con
// "Mantener formato original" va todo: negrita, cursiva, colores, tamaños, tablas…, y la fuente si la tenemos (appFonts).

// Copiado de otra nota de la app (el editor marca lo que copia con data-pm-slice): ya tiene el formato de la app.
export const isFromApp = (html: string) => html.includes('data-pm-slice')

// Cada fuente pasada a una de la app (la misma o una parecida); si no tenemos ninguna, la letra de la nota. Para lo pegado
// con su formato original y para lo que ya estaba en las notas: lo desconocido nunca sale con la letra del aparato.
export function appFonts(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.body.querySelectorAll<HTMLElement>('[style]')) {
    if (!el.style.fontFamily) continue
    const font = appFont(el.style.fontFamily)
    if (font) el.style.fontFamily = font
    else el.style.removeProperty('font-family')
    if (!el.getAttribute('style')) el.removeAttribute('style')
  }
  return doc.body.innerHTML
}

// Copia completa de lo último copiado en la app (casillas marcadas, separadores, desplegables, colores…). El teclado del
// celular guarda solo el texto: al pegar, si el texto es el mismo, se usa esta copia y queda igual. Solo en este aparato.
const COPY = 'datheke-copia'
const MAX_COPY = 2_000_000 // fotos dentro de la nota (compartidas) pueden pesar: más grande no se guarda
const bare = (s: string) => s.replace(/\s+/g, '')

export function rememberCopy(html: string, text: string, store: Pick<Storage, 'setItem' | 'removeItem'> = localStorage) {
  try {
    if (!bare(text) || html.length > MAX_COPY) store.removeItem(COPY)
    else store.setItem(COPY, JSON.stringify({ html, text: bare(text) }))
  } catch { /* sin espacio o bloqueado: se pega solo el texto */ }
}

// La copia completa si `text` es lo mismo que se copió (sin contar espacios ni saltos, que el teclado puede cambiar).
export function copiedHtml(text: string, store: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    const saved: { html?: string; text?: string } = JSON.parse(store.getItem(COPY) ?? '{}')
    return saved.html && saved.text && saved.text === bare(text) ? saved.html : null
  } catch { return null }
}

// "Pegar sin formato": un renglón por línea, sin los renglones vacíos de más ni espacios sueltos al final.
export const tidyText = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t ]+$/, '')).filter(l => l.trim()).join('\n')
