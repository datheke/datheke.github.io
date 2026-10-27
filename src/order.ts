// Orden propio de notas y libretas (arrastrando): cada una guarda su número en Drive (appProperties.orden), así se ve
// igual en todos los aparatos. Las que todavía no tienen número van como siempre.
type Item = { id: string; appProperties?: Record<string, string> }

export const ordenOf = (f: Item) => {
  const n = Number(f.appProperties?.orden)
  return f.appProperties?.orden !== undefined && Number.isFinite(n) ? n : undefined
}

// Las sin número primero (con `rest`, ej. la más nueva arriba) y después las ordenadas: una nota nueva aparece arriba.
export const firstUnordered = <T extends Item>(rest: (a: T, b: T) => number) => (a: T, b: T) => {
  const oa = ordenOf(a), ob = ordenOf(b)
  return oa === undefined ? (ob === undefined ? rest(a, b) : -1) : ob === undefined ? 1 : oa - ob
}

// Las ordenadas primero y las sin número al final (con `rest`): una libreta nueva aparece abajo.
export const lastUnordered = <T extends Item>(rest: (a: T, b: T) => number) => (a: T, b: T) => {
  const oa = ordenOf(a), ob = ordenOf(b)
  return oa === undefined ? (ob === undefined ? rest(a, b) : 1) : ob === undefined ? -1 : oa - ob
}

// Qué números cambiar al llevar items[from] al lugar `to`. La primera vez (alguna sin número) se numeran todas como
// quedan; después solo la movida, entre sus vecinas: un solo cambio que subir.
export function reorder(items: Item[], from: number, to: number): { id: string; orden: string }[] {
  if (from === to) return []
  const moved = [...items]
  const [item] = moved.splice(from, 1)
  moved.splice(to, 0, item)
  if (moved.some(i => ordenOf(i) === undefined)) return moved.map((f, k) => ({ id: f.id, orden: String((k + 1) * 1000) }))
  const prev = to > 0 ? ordenOf(moved[to - 1])! : undefined
  const next = to < moved.length - 1 ? ordenOf(moved[to + 1])! : undefined
  const orden = prev === undefined ? next! - 1000 : next === undefined ? prev + 1000 : (prev + next) / 2
  return [{ id: item.id, orden: String(orden) }]
}
