// Lo pegado de otro lado (Word, web, correo) entra con la letra de la nota: se le quitan fuente, tamaño y colores, y se
// deja negrita, cursiva, subrayado, tachado, listas, tablas y enlaces. Con "Mantener formato original" va tal cual.
const DROP = /^(font|font-family|font-size|color|background|background-color|line-height|mso-.*)$/

// Las declaraciones de un style="..." sin las de fuente, tamaño y colores. Respeta los ; dentro de comillas.
export function cleanStyle(style: string): string {
  const parts: string[] = []
  let cur = ''
  let quote = ''
  for (const ch of style) {
    if (quote) { if (ch === quote) quote = '' }
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === ';') { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  return parts
    .filter(p => p.includes(':') && !DROP.test(p.slice(0, p.indexOf(':')).trim().toLowerCase()))
    .map(p => p.trim())
    .join('; ')
}

// Copiado de otra nota de la app (el editor marca lo que copia con data-pm-slice): ya tiene el formato que se quiere.
export const isFromApp = (html: string) => html.includes('data-pm-slice')

export function cleanPaste(html: string): string {
  if (isFromApp(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.body.querySelectorAll('[style]')) {
    const style = cleanStyle(el.getAttribute('style') ?? '')
    if (style) el.setAttribute('style', style)
    else el.removeAttribute('style')
  }
  for (const el of doc.body.querySelectorAll('font')) for (const a of ['face', 'size', 'color']) el.removeAttribute(a)
  return doc.body.innerHTML
}
