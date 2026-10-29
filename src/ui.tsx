import { useBack } from './back.ts'
import { Ellipsis } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'

// Línea entre dos columnas para cambiar el ancho arrastrando (mouse, dedo o lápiz) o con las flechas del teclado.
// Doble clic vuelve al ancho de siempre. onChange recibe el ancho pedido; quien lo usa le pone los límites.
export function Resizer({ label, value, onChange, reset, className }: {
  label: string; value: number; onChange: (width: number) => void; reset: () => void; className: string
}) {
  function drag(e: ReactPointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const move = (ev: PointerEvent) => onChange(value + ev.clientX - startX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('arrastrando', 'cambiando-ancho')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.classList.add('arrastrando', 'cambiando-ancho') // que el texto no se seleccione mientras se arrastra
  }
  return <div className={`divisor ${className}`} role="separator" aria-orientation="vertical" aria-label={label}
    aria-valuenow={value} tabIndex={0} title={`${label} (doble clic: ancho normal)`}
    onPointerDown={drag} onDoubleClick={reset}
    onKeyDown={e => {
      if (e.key === 'ArrowLeft') onChange(value - 16)
      else if (e.key === 'ArrowRight') onChange(value + 16)
    }} />
}

type Item = { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }

// Botón "⋯" con las acciones que no se usan siempre. Se cierra al elegir, al tocar afuera o con Escape.
export function MoreMenu({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false)
  useBack(open, () => setOpen(false))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => { if (!ref.current?.contains(e.target as globalThis.Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="mas" ref={ref}>
      <button className="btn-icono" title="Más opciones" aria-label="Más opciones" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)}><Ellipsis size={18} /></button>
      {open && <div className="mas-menu" role="menu">
        {items.map(i => (
          <button key={i.label} role="menuitem" className={i.danger ? 'peligro' : undefined}
            onClick={() => { setOpen(false); i.onClick() }}>{i.icon}{i.label}</button>
        ))}
      </div>}
    </div>
  )
}
