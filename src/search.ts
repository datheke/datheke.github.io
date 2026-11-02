import type { Node } from '@tiptap/pm/model'

// Buscador de notas: sin importar tildes ni mayúsculas. Busca en la copia del aparato, así funciona sin internet.
export type Part = { text: string; hit: boolean }

export const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export const searchWords = (query: string) => fold(query).split(/\s+/).filter(Boolean)

// Se guarda por texto: la lista se vuelve a dibujar en cada tecla.
const foldedTexts = new Map<string, string>()
function folded(s: string) {
  let f = foldedTexts.get(s)
  if (f === undefined) {
    if (foldedTexts.size > 5000) foldedTexts.clear()
    f = fold(s)
    foldedTexts.set(s, f)
  }
  return f
}

// Todas las palabras tienen que estar, en el título o en el texto.
export function matches(title: string, text: string, words: string[]) {
  const t = folded(title), x = folded(text)
  return words.every(w => t.includes(w) || x.includes(w))
}

// El texto sin tildes y, por cada letra, dónde estaba en el original (casi siempre es el mismo lugar).
function foldMap(text: string) {
  const out = fold(text)
  if (out.length === text.length) return { out, at: (i: number) => i }
  const from: number[] = []
  let built = ''
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    const f = fold(ch)
    for (let k = 0; k < f.length; k++) from.push(i)
    built += f
    i += ch.length
  }
  from.push(text.length)
  return { out: built, at: (i: number) => from[i] }
}

// Dónde están las palabras en el texto original, en orden y sin pisarse.
export function findRanges(text: string, words: string[]): [number, number][] {
  const { out, at } = foldMap(text)
  const found: [number, number][] = []
  for (const w of words) {
    for (let i = out.indexOf(w); i >= 0; i = out.indexOf(w, i + w.length)) found.push([at(i), at(i + w.length)])
  }
  found.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of found) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

// Las palabras dentro de una nota abierta, en posiciones del editor.
export function findInDoc(doc: Node, words: string[]) {
  const found: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach(child => { text += child.isText ? child.text : '￼'.repeat(child.nodeSize) }) // una letra por posición
    for (const [from, to] of findRanges(text, words)) found.push({ from: pos + 1 + from, to: pos + 1 + to })
    return false
  })
  return found
}

// Los desplegables cerrados que esconden esa posición (su título siempre se ve).
export function closedDetails(doc: Node, pos: number) {
  const $pos = doc.resolve(pos)
  const closed: number[] = []
  for (let d = 1; d < $pos.depth; d++) {
    if ($pos.node(d).type.name === 'details' && !$pos.node(d).attrs.open && $pos.node(d + 1).type.name === 'detailsContent') closed.push($pos.before(d))
  }
  return closed
}

function split(text: string, ranges: [number, number][]): Part[] {
  const parts: Part[] = []
  let pos = 0
  for (const [from, to] of ranges) {
    if (from > pos) parts.push({ text: text.slice(pos, from), hit: false })
    parts.push({ text: text.slice(from, to), hit: true })
    pos = to
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false })
  return parts
}

export const highlight = (text: string, words: string[]) => split(text, findRanges(text, words))

// El pedacito de la nota alrededor de la primera palabra encontrada (o su inicio, si estaba solo en el título).
export function snippet(text: string, words: string[], size = 130): Part[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  const ranges = findRanges(clean, words)
  const first = ranges[0]?.[0] ?? 0
  let start = Math.max(0, first - 40)
  if (start) {
    const space = clean.indexOf(' ', start)
    if (space >= 0 && space < first) start = space + 1
  }
  const end = Math.min(clean.length, start + size)
  const inside = ranges.filter(r => r[0] < end).map(([a, b]): [number, number] => [a - start, Math.min(b, end) - start])
  const parts = split(clean.slice(start, end), inside)
  if (start) parts.unshift({ text: '…', hit: false })
  if (end < clean.length) parts.push({ text: '…', hit: false })
  return parts
}
