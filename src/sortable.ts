import type { PointerEvent as ReactPointerEvent } from 'react'

// Ordenar una lista arrastrando la agarradera ⠿ de un item (mouse, dedo o lápiz). Los hermanos son los elementos del
// mismo contenedor con el mismo data-grupo; mientras se arrastra se marca dónde cae y al soltar avisa onDrop(desde,
// hasta). Sirve en columna (notas) y en fila (libretas en el celular).
export function startSort(e: ReactPointerEvent, onDrop: (from: number, to: number) => void) {
  e.preventDefault()
  e.stopPropagation()
  const item = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-grupo]')
  const list = item?.parentElement
  if (!item || !list) return
  const items = [...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.grupo === item.dataset.grupo)
  const from = items.indexOf(item)
  const first = items[0].getBoundingClientRect(), second = items[1]?.getBoundingClientRect()
  const row = !!second && Math.abs(second.top - first.top) < 4
  const marks = row ? ['soltar-izq', 'soltar-der'] : ['soltar-arriba', 'soltar-abajo']
  let to = from
  const clear = () => items.forEach(i => i.classList.remove(...marks))
  function move(ev: PointerEvent) {
    const p = row ? ev.clientX : ev.clientY
    let gap = items.findIndex(i => { const r = i.getBoundingClientRect(); return p < (row ? r.left + r.width / 2 : r.top + r.height / 2) })
    if (gap < 0) gap = items.length
    clear()
    if (gap < items.length) items[gap].classList.add(marks[0])
    else items[items.length - 1].classList.add(marks[1])
    to = gap > from ? gap - 1 : gap
    const box = list!.getBoundingClientRect()
    if (row) list!.scrollLeft += ev.clientX < box.left + 40 ? -12 : ev.clientX > box.right - 40 ? 12 : 0
    else list!.scrollTop += ev.clientY < box.top + 40 ? -12 : ev.clientY > box.bottom - 40 ? 12 : 0
  }
  const end = (drop: boolean) => () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', ok)
    window.removeEventListener('pointercancel', cancel)
    clear()
    item.classList.remove('arrastrado')
    document.body.classList.remove('arrastrando')
    if (drop && to !== from) onDrop(from, to)
  }
  const ok = end(true), cancel = end(false)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', ok)
  window.addEventListener('pointercancel', cancel)
  item.classList.add('arrastrado')
  document.body.classList.add('arrastrando')
}
