import type { ResolvedPos } from '@tiptap/pm/model'

// Palabra donde está el cursor (como en Word: sin selección, el formato va a esa palabra). null si no hay palabra.
export function wordAt($pos: ResolvedPos): { from: number; to: number } | null {
  // '￼' ocupa el lugar de cada nodo sin texto (enlace @, imagen): así cada letra coincide con su posición.
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '￼')
  const isLetter = (i: number) => /[\p{L}\p{N}]/u.test(text[i] ?? '')
  let a = $pos.parentOffset
  let b = a
  while (isLetter(a - 1)) a--
  while (isLetter(b)) b++
  return a === b ? null : { from: $pos.start() + a, to: $pos.start() + b }
}
