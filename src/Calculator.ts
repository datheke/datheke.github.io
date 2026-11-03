import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { mergeAttributes, Node, type Editor } from '@tiptap/react'
import { calcRows, evaluate, LISTS, showNumber } from './calc.ts'

// Bloque "Calculadora": suma (o la cuenta que se escriba) los números de los renglones de encima. El resultado se
// guarda en la nota, así se ve también en la copia de Drive, al imprimir y para Gemini.
const attr = (name: string) => ({ default: '', parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? '', renderHTML: (a: Record<string, string>) => a[name] ? { [`data-${name}`]: a[name] } : {} })

function compute(doc: PMNode, pos: number, formula: string) {
  const r = evaluate(formula, calcRows(doc, pos))
  return 'error' in r ? { resultado: '', error: r.error } : { resultado: showNumber(r.value), error: '' }
}

const lettersKey = new PluginKey<DecorationSet>('calcLetras')
function letters(doc: PMNode) {
  const marks: Decoration[] = []
  doc.descendants((n, pos) => {
    if (n.type.name !== 'calculadora') return
    for (const r of calcRows(doc, pos)) marks.push(Decoration.widget(r.at, () => {
      const s = document.createElement('span')
      s.className = 'calc-letra'
      s.textContent = r.letter
      return s
    }, { side: -1, key: `calc-${r.letter}`, ignoreSelection: true }))
    return false
  })
  return DecorationSet.create(doc, marks)
}

// Cursor al renglón de abajo de la calculadora (se crea si no hay uno vacío): así un borrar no se la lleva y se sigue
// escribiendo debajo.
export function belowCalc(editor: Editor, pos: number) {
  const n = editor.state.doc.nodeAt(pos)
  if (!n) return
  const after = pos + n.nodeSize
  const next = editor.state.doc.nodeAt(after)
  const tr = editor.state.tr
  if (next?.type.name !== 'paragraph' || next.content.size) tr.insert(after, editor.schema.nodes.paragraph.create())
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView())
  editor.view.focus()
}

// Desde "/": en un renglón vacío lo reemplaza; dentro de una lista va debajo de la lista entera (el renglón vacío que
// dejó "/" se quita), así lee toda la lista; si no, va debajo del renglón.
export function insertCalc(editor: Editor) {
  const { $from } = editor.state.selection
  const calc = editor.schema.nodes.calculadora.create()
  const tr = editor.state.tr
  const empty = $from.parent.type.name === 'paragraph' && !$from.parent.content.size
  let list = 0
  for (let d = 1; d <= $from.depth && !list; d++) if (LISTS.includes($from.node(d).type.name)) list = d
  let at: number
  if (list) {
    const item = $from.depth - 1
    if (empty && $from.index(item) === 0 && $from.node(item).childCount === 1 && $from.node(item - 1).childCount > 1) tr.delete($from.before(item), $from.after(item))
    at = tr.mapping.map($from.after(list))
    tr.insert(at, calc)
  } else if (empty) {
    at = $from.before()
    tr.replaceWith(at, $from.after(), calc)
  } else {
    at = $from.after()
    tr.insert(at, calc)
  }
  editor.view.dispatch(tr)
  belowCalc(editor, at)
}

const button = (label: string, title = label) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.title = title
  return b
}

export const Calculator = Node.create({
  name: 'calculadora',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({ formula: attr('formula'), resultado: attr('resultado'), error: attr('error') }),
  parseHTML: () => [{ tag: 'div[data-type="calculadora"]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'calculadora' }),
    `🧮 ${node.attrs.formula || 'todo'} = ${node.attrs.error || node.attrs.resultado}`],

  addProseMirrorPlugins() {
    return [
      // Cualquier cambio en la nota vuelve a hacer las cuentas (va en el mismo paso de deshacer que el cambio).
      new Plugin({
        appendTransaction: (trs, _old, state) => {
          if (!trs.some(t => t.docChanged)) return null
          const tr = state.tr
          state.doc.descendants((n, pos) => {
            if (n.type.name !== 'calculadora') return
            const next = compute(state.doc, pos, n.attrs.formula)
            if (next.resultado !== n.attrs.resultado || next.error !== n.attrs.error) tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...next })
            return false
          })
          return tr.docChanged ? tr : null
        },
      }),
      // Letra pequeña (A, B, C…) al inicio de cada renglón que entra en la cuenta. Solo se ve; no se guarda.
      new Plugin<DecorationSet>({
        key: lettersKey,
        state: { init: (_, state) => letters(state.doc), apply: (tr, old) => tr.docChanged ? letters(tr.doc) : old },
        props: { decorations: state => lettersKey.getState(state) },
      }),
    ]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div')
      dom.className = 'calc'
      dom.dataset.type = 'calculadora'
      dom.contentEditable = 'false'
      const row = document.createElement('div')
      row.className = 'calc-fila'
      const input = document.createElement('input')
      input.placeholder = 'todo  ·  o una cuenta: A + B - C'
      input.setAttribute('aria-label', 'Cuenta de la calculadora')
      input.enterKeyHint = 'done'
      input.autocomplete = 'off'
      input.spellcheck = false
      const result = document.createElement('output')
      result.className = 'calc-res'
      const remove = button('×', 'Quitar la calculadora')
      remove.className = 'calc-quitar'
      row.append('🧮', input, result, remove)
      const presets = document.createElement('div')
      presets.className = 'calc-botones'
      const all = button('Todo', 'Sumar todos los renglones')
      const checked = button('Marcados', 'Sumar solo los que tienen visto')
      const unchecked = button('Sin marcar', 'Sumar los que faltan por marcar')
      presets.append(all, checked, unchecked)
      const help = document.createElement('p')
      help.className = 'calc-ayuda'
      dom.append(row, presets, help)

      const setFormula = (formula: string) => {
        const pos = getPos()
        if (typeof pos !== 'number' || !editor.isEditable) return
        const n = editor.state.doc.nodeAt(pos)
        if (n?.type.name !== 'calculadora') return
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, formula, ...compute(editor.state.doc, pos, formula) })
        editor.view.dispatch(tr)
      }
      input.addEventListener('input', () => setFormula(input.value))
      input.addEventListener('keydown', e => {
        const pos = getPos()
        if (e.key === 'Enter' && typeof pos === 'number') { e.preventDefault(); belowCalc(editor, pos) }
      })
      all.addEventListener('click', () => setFormula('todo'))
      checked.addEventListener('click', () => setFormula('marcados'))
      unchecked.addEventListener('click', () => setFormula('sin marcar'))
      remove.addEventListener('click', () => {
        const pos = getPos()
        if (typeof pos === 'number' && editor.isEditable) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
      })

      const paint = (n: PMNode) => {
        const pos = getPos()
        const rows = typeof pos === 'number' ? calcRows(editor.state.doc, pos) : []
        const formula = String(n.attrs.formula)
        if (document.activeElement !== input) input.value = formula
        const editable = editor.isEditable
        input.readOnly = !editable
        for (const b of [all, checked, unchecked, remove]) b.hidden = !editable
        const tasks = rows.some(r => r.checked !== null)
        checked.hidden = unchecked.hidden = !editable || !tasks
        const preset = formula.trim().toLowerCase() || 'todo'
        for (const [b, f] of [[all, 'todo'], [checked, 'marcados'], [unchecked, 'sin marcar']] as const) b.classList.toggle('activo', preset === f)
        // Se muestra la cuenta de ahora (lo guardado puede ser de antes, en una nota fijada o abierta en otro aparato).
        const now = typeof pos === 'number' ? compute(editor.state.doc, pos, formula) : { resultado: '', error: '' }
        result.textContent = now.error ? '' : `= ${now.resultado}`
        help.textContent = now.error || (rows.length ? '' : 'Escribe justo encima una lista con números (por ejemplo "Luz: 25") y aquí sale la suma.')
        help.classList.toggle('error', !!now.error)
      }
      paint(node)
      // Lo de encima cambia aunque el resultado no (aparecen casillas, se borra la lista): se vuelve a dibujar.
      const repaint = () => paint(node)
      editor.on('update', repaint)
      return {
        dom,
        update: n => { if (n.type.name !== 'calculadora') return false; node = n; paint(n); return true },
        destroy: () => { editor.off('update', repaint) },
        stopEvent: e => e.target instanceof HTMLElement && !!e.target.closest('input, button'),
        ignoreMutation: () => true,
      }
    }
  },
})
