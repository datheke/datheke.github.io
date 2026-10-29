import { useEffect, useRef } from 'react'

// Botón o gesto "regresar" del celular (Android): cierra lo último que se abrió (una ventana, un menú, un panel),
// y si no hay nada abierto, App decide (de la nota a la lista, de una libreta a Todas las notas, y recién ahí sale).
const stack: (() => void)[] = []

export function useBack(active: boolean, close: () => void) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!active) return
    const fn = () => ref.current()
    stack.push(fn)
    return () => { const i = stack.lastIndexOf(fn); if (i >= 0) stack.splice(i, 1) }
  }, [active])
}

// Cierra lo de más arriba. false: no había nada abierto.
export function closeTop(): boolean {
  const fn = stack.pop()
  if (!fn) return false
  fn()
  return true
}
