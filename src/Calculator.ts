import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { mergeAttributes, Node, type Editor } from '@tiptap/react'
import { addRow, calcRows, cleanFormula, evaluate, formulaPrompt, LISTS, looksLikeRow, showNumber } from './calc.ts'
import { askFormula, GeminiError, sensitive } from './gemini.ts'

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

// gemini: la clave y si la nota es privada, leídas al usarse (cambian sin volver a crear el editor).
export const Calculator = Node.create<{ gemini: () => { key: string; private: boolean } }>({
  name: 'calculadora',
  addOptions: () => ({ gemini: () => ({ key: '', private: false }) }),
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
      input.placeholder = 'Cuenta: A + B  (vacío = todo)'
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
      const toList = button('↑ Agregar a la lista', 'Pasar este gasto a la lista de arriba')
      const gemini = button('✨ Pedir a Gemini', 'Gemini convierte lo que escribiste en una cuenta')
      toList.className = gemini.className = 'calc-accion'
      presets.append(all, checked, unchecked, toList, gemini)
      const help = document.createElement('p')
      help.className = 'calc-ayuda'
      dom.append(row, presets, help)
      let note = '' // aviso de Gemini (pensando, error, palabra delicada); se borra al escribir
      let warned = '' // pedido que ya avisó de palabras delicadas: el segundo toque lo envía igual

      const here = () => {
        const pos = getPos()
        const n = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
        return n?.type.name === 'calculadora' && typeof pos === 'number' ? { pos, n } : null
      }
      const setFormula = (formula: string) => {
        const at = here()
        if (!at || !editor.isEditable) return
        editor.view.dispatch(editor.state.tr.setNodeMarkup(at.pos, undefined, { ...at.n.attrs, formula, ...compute(editor.state.doc, at.pos, formula) }))
      }
      const rowsNow = () => { const at = here(); return at ? calcRows(editor.state.doc, at.pos) : [] }
      // El gasto escrito en la cajita pasa a la lista de arriba; la cajita queda vacía (= todo) para el siguiente.
      const moveToList = () => {
        const at = here()
        if (!at || !editor.isEditable) return
        const tr = addRow(editor.state, at.pos, input.value)
        const pos = tr.mapping.map(at.pos)
        tr.setNodeMarkup(pos, undefined, { ...at.n.attrs, formula: '', ...compute(tr.doc, pos, '') })
        input.value = ''
        editor.view.dispatch(tr)
        input.focus()
      }
      const askGemini = async () => {
        const { key, private: hidden } = this.options.gemini()
        const request = input.value.trim()
        const rows = rowsNow()
        if (!key || hidden || !request || !rows.length) return
        const risky = sensitive(request + ' ' + rows.map(r => r.label).join(' '))
        if (risky.length && warned !== request) {
          warned = request
          note = `Lo que se envía a Gemini tiene: ${risky.join(', ')}. Toca otra vez "Pedir a Gemini" para enviarlo igual.`
          return paint(node)
        }
        note = 'Gemini está armando la cuenta…'
        gemini.disabled = true
        paint(node)
        try {
          const formula = cleanFormula(await askFormula(formulaPrompt(request, rows), key))
          if (!formula || 'error' in evaluate(formula, rowsNow())) throw new GeminiError('Gemini no pudo armar esa cuenta con estos renglones. Prueba con otras palabras o escribe la cuenta con letras.')
          note = `Gemini entendió: ${formula}`
          input.value = formula
          setFormula(formula)
        } catch (e) {
          note = e instanceof Error ? e.message : 'Gemini no respondió.'
        } finally {
          gemini.disabled = false
          paint(node)
        }
      }
      input.addEventListener('input', () => { note = ''; setFormula(input.value) })
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const at = here()
        if (!at) return
        if (looksLikeRow(input.value, rowsNow())) moveToList()
        else if (!gemini.hidden) askGemini()
        else belowCalc(editor, at.pos)
      })
      all.addEventListener('click', () => setFormula('todo'))
      checked.addEventListener('click', () => setFormula('marcados'))
      unchecked.addEventListener('click', () => setFormula('sin marcar'))
      toList.addEventListener('click', moveToList)
      gemini.addEventListener('click', askGemini)
      remove.addEventListener('click', () => {
        const at = here()
        if (at && editor.isEditable) editor.chain().focus().deleteRange({ from: at.pos, to: at.pos + at.n.nodeSize }).run()
      })

      const paint = (n: PMNode) => {
        const pos = getPos()
        const rows = typeof pos === 'number' ? calcRows(editor.state.doc, pos) : []
        const formula = String(n.attrs.formula)
        if (document.activeElement !== input) input.value = formula
        const editable = editor.isEditable
        input.readOnly = !editable
        remove.hidden = all.hidden = !editable
        checked.hidden = unchecked.hidden = !editable || !rows.some(r => r.checked !== null)
        const preset = formula.trim().toLowerCase() || 'todo'
        for (const [b, f] of [[all, 'todo'], [checked, 'marcados'], [unchecked, 'sin marcar']] as const) b.classList.toggle('activo', preset === f)
        // Se muestra la cuenta de ahora (lo guardado puede ser de antes, en una nota fijada o abierta en otro aparato).
        const now = typeof pos === 'number' ? compute(editor.state.doc, pos, formula) : { resultado: '', error: '' }
        const isRow = editable && looksLikeRow(formula, rows)
        const { key, private: hidden } = this.options.gemini()
        const words = editable && !!now.error && !isRow && !!rows.length // no es cuenta ni gasto: un pedido con palabras
        toList.hidden = !isRow
        gemini.hidden = !(words || (isRow && rows.length)) || !key || hidden
        result.textContent = now.error ? '' : `= ${now.resultado}`
        let text = now.error
        if (isRow) text = `"${formula.trim()}" es un gasto: toca "Agregar a la lista" (o Enter) y pasa a la lista de arriba.`
        else if (words && hidden) text = `${now.error}. Nota privada: Gemini no lee su texto.`
        else if (words && !key) text = `${now.error}. Para pedir la cuenta con palabras, vincula Gemini con el botón ✨ de la barra.`
        else if (words) text = `${now.error}. Si es un pedido con palabras, toca "Pedir a Gemini".`
        if (!rows.length && !isRow && editable) text = 'Cómo se usa: 1) Escribe tu lista ARRIBA de este cuadro, un gasto por renglón (Seguro: 85). '
          + 'También puedes escribir el gasto aquí y tocar "Agregar a la lista". 2) Aquí sale la suma; para otra cuenta escribe, por ejemplo, A + B.'
        if (note) text = note
        help.textContent = text
        help.classList.toggle('error', !!now.error && !isRow && !note.startsWith('Gemini entendió'))
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
