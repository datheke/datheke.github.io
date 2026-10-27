import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

// "Subir / Bajar": cambia de lugar con el de al lado, dentro del mismo contenedor, lo que tiene el cursor: el desplegable
// entero si está en su título, el renglón si está en una lista, y si no el párrafo o título. null si no hay a dónde.
export function moveBlock(state: EditorState, dir: -1 | 1): Transaction | null {
  const { $from, from, to, anchor, head } = state.selection
  let depth = $from.depth
  if ($from.parent.type.name === 'detailsSummary') depth -= 1
  else if (depth > 1 && ['listItem', 'taskItem'].includes($from.node(depth - 1).type.name)) depth -= 1
  if (depth < 1) return null
  const node = $from.node(depth)
  const sibling = $from.node(depth - 1).maybeChild($from.index(depth - 1) + dir)
  if (!sibling) return null
  const start = $from.before(depth)
  const shift = dir * sibling.nodeSize
  const tr = state.tr.delete(start, start + node.nodeSize).insert(dir < 0 ? start - sibling.nodeSize : start + sibling.nodeSize, node)
  // El cursor (o lo marcado) se va con el bloque; si lo marcado salía del bloque, queda solo el cursor.
  const inside = to <= start + node.nodeSize
  return tr.setSelection(TextSelection.create(tr.doc, (inside ? anchor : from) + shift, (inside ? head : from) + shift)).scrollIntoView()
}
