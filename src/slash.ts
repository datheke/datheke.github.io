import type { Node } from '@tiptap/pm/model'
import type { Editor, Range } from '@tiptap/react'

// Menú "/". inline: lo elegido se queda dentro del renglón (recordatorio, enlace @); lo demás es un bloque aparte.
export type Command = { label: string; run: (editor: Editor, range: Range) => void; inline?: boolean }

// Abre al inicio, tras un espacio o un signo ("hola.../sep"), pero no pegada a letras o números ("y/o", "12/05"),
// ni en enlaces ("https://") ni dentro de código.
export const slashAllowed = (doc: Node, from: number) =>
  !doc.resolve(from).parent.type.spec.code && !/[\p{L}\p{N}:/]/u.test(doc.textBetween(Math.max(0, from - 1), from))

// Con texto antes en el renglón, ese texto se queda y el bloque va en el renglón de abajo.
// El título de un desplegable es de un solo renglón: ahí el bloque va debajo del desplegable (dentro lo partiría en dos).
export function runSlash(editor: Editor, range: Range, item: Command) {
  const $from = editor.state.doc.resolve(range.from)
  const inSummary = $from.parent.type.name === 'detailsSummary'
  if (item.inline || (!$from.parentOffset && !inSummary)) return item.run(editor, range)
  const below = inSummary ? $from.after(-1) - (range.to - range.from) : 0
  const chain = editor.chain().focus().deleteRange(range)
  if (inSummary) chain.insertContentAt(below, { type: 'paragraph' }).setTextSelection(below + 1)
  else chain.splitBlock()
  chain.run()
  const at = editor.state.selection.from
  item.run(editor, { from: at, to: at })
}
