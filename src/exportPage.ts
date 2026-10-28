// Páginas HTML que se abren en cualquier navegador sin Datheke y se ven como en la app: portada, ícono, fotos,
// casillas, tablas, colores, recuadros y desplegables. Las usan el respaldo (.zip en Drive) y la copia visible de la PC.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// El estilo de la nota en la app (index.css, .tiptap), sin lo que solo sirve para editar.
export const STYLE = `
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1f2328;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:0 0 48px}
.portada{display:block;width:100%;height:180px;object-fit:cover}
.cabeza{padding:16px 32px 0}
.icono{font-size:44px;line-height:1}
h1.titulo{font-size:2em;margin:8px 0 12px;line-height:1.2}
.nota{padding:0 32px;font-family:"Lora",Georgia,"Times New Roman",serif;font-size:16px;line-height:1.6;overflow-wrap:anywhere}
.nota p{margin:0 0 .5em}
.nota h1,.nota h2,.nota h3{line-height:1.25;margin:.8em 0 .4em;font-family:system-ui,sans-serif}
.nota h1{font-size:1.8em}.nota h2{font-size:1.45em}.nota h3{font-size:1.2em}
.nota a{color:#2f9e5b}
.nota blockquote{border-left:3px solid #e5e7eb;margin:0 0 .5em;padding-left:12px;color:#6b7280}
.nota ul[data-type="taskList"]{list-style:none;padding-left:4px}
.nota ul[data-type="taskList"] li{display:flex;gap:8px;align-items:flex-start}
.nota ul[data-type="taskList"] li>label{margin-top:.25em}
.nota ul[data-type="taskList"] li>label span{display:none}
.nota ul[data-type="taskList"] li>div{flex:1}
.nota ul[data-type="taskList"] li[data-checked="true"]>div{text-decoration:line-through;color:#6b7280}
.nota table{border-collapse:collapse;width:100%;margin:8px 0}
.nota td,.nota th{border:1px solid #d1d5db;padding:4px 8px;vertical-align:top}
.nota th{background:#f7f7f5;text-align:left}
.nota td>p,.nota th>p{margin:0}
.nota img{max-width:100%;height:auto;border-radius:6px;display:block;margin:8px 0}
.nota hr{border:none;border-top:1px solid #e5e7eb;margin:16px 0}
.nota .enlace-nota{color:#2f9e5b;background:#2f9e5b14;border-radius:4px;padding:0 3px;text-decoration:none}
.nota div[data-type="callout"]{position:relative;background:#eef2ff;border-radius:8px;padding:10px 12px 10px 42px;margin:8px 0}
.nota div[data-type="callout"]::before{content:attr(data-emoji);position:absolute;left:12px;top:10px}
.nota div[data-type="callout"][data-emoji="⚠️"]{background:#fef3c7}
.nota div[data-type="callout"][data-emoji="❗"]{background:#fee2e2}
.nota details{border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;margin:8px 0}
.nota summary{cursor:pointer}
.nota summary[data-level="1"]{font-size:1.8em;font-weight:700}.nota summary[data-level="2"]{font-size:1.45em;font-weight:700}
.nota summary[data-level="3"]{font-size:1.2em;font-weight:600}
.nota .rec{display:inline-block;margin-left:4px;padding:0 8px;border-radius:999px;background:#eaf6ef;color:#1f5135;font:600 12px system-ui,sans-serif}
.pie{padding:24px 32px 0;color:#9ca3af;font-size:12px;font-family:system-ui,sans-serif}
@media (max-width:600px){.cabeza,.nota,.nota .rec{display:inline-block;margin-left:4px;padding:0 8px;border-radius:999px;background:#eaf6ef;color:#1f5135;font:600 12px system-ui,sans-serif}
.pie{padding-left:16px;padding-right:16px}.portada{height:120px}}
@media print{.portada{height:140px}}
`

// Lo propio del editor pasa a HTML normal: el desplegable a <details> (se abre y cierra sin programas), y los
// enlaces "@" a otras notas a un enlace al archivo de esa nota. Sin DOMParser (pruebas) queda como viene.
export function plainHtml(html: string, linkTo: (id: string) => string | undefined = () => undefined) {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('div[data-type="details"]').forEach(div => {
    const details = doc.createElement('details')
    if (div.hasAttribute('open')) details.setAttribute('open', '')
    const summary = div.querySelector(':scope > summary')
    const content = div.querySelector(':scope > div[data-type="detailsContent"]')
    if (summary) details.append(summary)
    if (content) details.append(...content.childNodes)
    div.replaceWith(details)
  })
  doc.querySelectorAll('span[data-type="mention"]').forEach(span => {
    const href = linkTo(span.getAttribute('data-id') ?? '')
    if (!href) return
    const a = doc.createElement('a')
    a.className = 'enlace-nota'
    a.href = href
    a.textContent = span.textContent
    span.replaceWith(a)
  })
  return doc.body.innerHTML
}

// Lo de adentro de <main>: portada, ícono, título y texto. Es lo que se cifra en una nota con clave.
export function noteBody({ title, html, icon, cover }: { title: string; html: string; icon?: string; cover?: string }) {
  return (cover ? `<img class="portada" src="${esc(cover)}" alt="">` : '')
    + `<div class="cabeza">${icon ? `<div class="icono">${esc(icon)}</div>` : ''}<h1 class="titulo">${esc(title)}</h1></div>`
    + `<div class="nota">${html}</div>`
}

const head = (title: string, csp: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(title)}</title><style>${STYLE}</style></head>`

const footer = (date: string) => `<p class="pie">Copia de Datheke · ${esc(date)}</p>`

// script-src 'none': se abre en el navegador y nunca ejecuta nada de lo que traiga la nota.
export const notePage = (title: string, body: string, date = '') =>
  `${head(title, "script-src 'none'")}<body><main>${body}${date ? footer(date) : ''}</main></body></html>\n`

// "Abrir aquí.html": las libretas y sus notas, con enlace a cada archivo.
export function indexPage(groups: { notebook: string; notes: { title: string; path: string; locked: boolean }[] }[], date: string) {
  const list = groups.map(g => `<h2>${esc(g.notebook)}</h2><ul>${g.notes.map(n =>
    `<li><a href="${esc(n.path.split('/').map(encodeURIComponent).join('/'))}">${n.locked ? '🔐 ' : ''}${esc(n.title)}</a></li>`).join('')}</ul>`).join('')
  return `${head('Datheke – respaldo', "script-src 'none'")}<body><main><div class="cabeza"><h1 class="titulo">Datheke – respaldo</h1>
<p style="color:#6b7280">${esc(date)} · Toca una nota para abrirla. 🔐 = con clave en la app.</p></div>
<div class="nota" style="font-family:system-ui,sans-serif">${list || '<p>Sin notas.</p>'}</div></main></body></html>
`
}
