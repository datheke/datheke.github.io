import type { ResolvedPos } from '@tiptap/pm/model'
import { Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

// Qué se mueve desde una posición: el desplegable entero si está en su título, el renglón si está en una lista, y si no
// el párrafo o título. Devuelve su profundidad (0 = no hay nada que mover).
export function movableDepth($pos: ResolvedPos): number {
  let depth = $pos.depth
  if ($pos.parent.type.name === 'detailsSummary') depth -= 1
  else if (depth > 1 && ['listItem', 'taskItem'].includes($pos.node(depth - 1).type.name)) depth -= 1
  return Math.max(depth, 0)
}

// "Subir / Bajar": cambia de lugar con el de al lado, dentro del mismo contenedor, lo que tiene el cursor. null si no
// hay a dónde.
export function moveBlock(state: EditorState, dir: -1 | 1): Transaction | null {
  const { $from, from, to, anchor, head } = state.selection
  const depth = movableDepth($from)
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

// Arrastrar: lleva el bloque que empieza en `start` al lugar `to` entre sus hermanos (índice ya sin él). null si queda igual.
export function moveTo(state: EditorState, start: number, to: number): Transaction | null {
  const $start = state.doc.resolve(start)
  const container = $start.parent
  const index = $start.index()
  const node = container.child(index)
  if (to === index || to < 0 || to >= container.childCount) return null
  let at = $start.start()
  for (let i = 0, k = 0; k < to; i++) if (i !== index) { at += container.child(i).nodeSize; k++ }
  const tr = state.tr.delete(start, start + node.nodeSize)
  tr.insert(at, node)
  return tr.setSelection(Selection.near(tr.doc.resolve(at + 1))).scrollIntoView()
}

// Enter en un renglón vacío al final de un desplegable (después solo quedan renglones vacíos): sale un nivel hacia
// afuera. Así se arma principal → sub 1, sub 2… (y sub del sub) sin que cada desplegable nuevo quede dentro del anterior.
export function exitDetails(state: EditorState, dispatch: (tr: Transaction) => void) {
  const { $head } = state.selection
  if ($head.parent.type.name !== 'paragraph' || $head.parent.content.size || $head.depth < 3 || $head.node(-1).type.name !== 'detailsContent') return false
  const content = $head.node(-1)
  const idx = $head.index(-1)
  for (let i = idx; i < content.childCount; i++) if (content.child(i).type.name !== 'paragraph' || content.child(i).content.size) return false
  // El desplegable no puede quedar sin nada adentro: si es el único renglón, se queda.
  let tr = state.tr.delete(idx === 0 ? $head.after() : $head.before(), $head.end(-1))
  const after = tr.mapping.map($head.after(-2))
  const next = tr.doc.nodeAt(after)
  if (next?.type.name !== 'paragraph' || next.content.size) tr = tr.insert(after, state.schema.nodes.paragraph.create()) // si ya hay un renglón vacío, se usa ese
  dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView())
  return true
}
