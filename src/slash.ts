import type { Node } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { Editor, Range } from '@tiptap/react'

// Menú "/". inline: lo elegido se queda dentro del renglón (recordatorio, enlace @); lo demás es un bloque aparte.
// takesLine: con texto antes en el renglón, ese texto pasa a ser el título ("hola /desplegable").
export type Command = { label: string; run: (editor: Editor, range: Range) => void; inline?: boolean; takesLine?: boolean }

// Abre al inicio, tras un espacio o un signo ("hola.../sep"), pero no pegada a letras o números ("y/o", "12/05"),
// ni en enlaces ("https://") ni dentro de código.
export const slashAllowed = (doc: Node, from: number) =>
  !doc.resolve(from).parent.type.spec.code && !/[\p{L}\p{N}:/]/u.test(doc.textBetween(Math.max(0, from - 1), from))

// Con texto antes en el renglón, ese texto se queda y el bloque va en el renglón de abajo.
// El título de un desplegable es de un solo renglón: ahí el bloque va debajo del desplegable (dentro lo partiría en dos).
export function runSlash(editor: Editor, range: Range, item: Command) {
  const $from = editor.state.doc.resolve(range.from)
  const inSummary = $from.parent.type.name === 'detailsSummary'
  const titled = item.takesLine && !inSummary && $from.parentOffset ? lineToDetails(editor.state, range) : null
  if (titled) return editor.view.dispatch(titled.scrollIntoView())
  if (item.inline || (!$from.parentOffset && !inSummary)) return item.run(editor, range)
  const below = inSummary ? $from.after(-1) - (range.to - range.from) : 0
  const chain = editor.chain().focus().deleteRange(range)
  if (inSummary) chain.insertContentAt(below, { type: 'paragraph' }).setTextSelection(below + 1)
  else chain.splitBlock()
  chain.run()
  const at = editor.state.selection.from
  item.run(editor, { from: at, to: at })
}

// "hola /desplegable": el renglón (sin el "/…") pasa a ser el título de un desplegable abierto, con un renglón vacío adentro
// para seguir escribiendo. Un título (H1, H2…) conserva su tamaño; un párrafo nace como Título 2. null si ahí no cabe un
// desplegable (por ejemplo, el primer renglón de una lista): entonces se hace como siempre.
export function lineToDetails(state: EditorState, range: { from: number; to: number }): Transaction | null {
  const { schema } = state
  const $from = state.doc.resolve(range.from)
  const line = $from.parent
  if (!['paragraph', 'heading'].includes(line.type.name) || $from.depth < 1) return null
  const index = $from.index(-1)
  if (!$from.node(-1).canReplaceWith(index, index + 1, schema.nodes.details)) return null
  const start = $from.before()
  let cut = range.from // también el espacio antes de la "/"
  while (cut > $from.start() && state.doc.textBetween(cut - 1, cut) === ' ') cut--
  const tr = state.tr.delete(cut, range.to)
  const title = tr.doc.nodeAt(start)!.content
  if (!title.size) return null
  const level = line.type.name === 'heading' ? line.attrs.level : 2
  const details = schema.nodes.details.create({ open: true }, [
    schema.nodes.detailsSummary.create({ level }, title),
    schema.nodes.detailsContent.create(null, schema.nodes.paragraph.create()),
  ])
  tr.replaceWith(start, start + line.nodeSize - (range.to - cut), details)
  // Cursor en el renglón de adentro: details > summary (título) > detailsContent > párrafo.
  return tr.setSelection(TextSelection.create(tr.doc, start + 1 + details.child(0).nodeSize + 2))
}
