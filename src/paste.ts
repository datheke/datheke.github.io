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
