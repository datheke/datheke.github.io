import type { Node } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { fold } from './search.ts'

// Calculadora de la nota: toma los números de los renglones de arriba (A, B, C…) y hace la cuenta que se escriba.
export type Row = { letter: string; label: string; value: number; checked: boolean | null; at: number }
export type Result = { value: number } | { error: string }

// Un número escrito como en Ecuador o en inglés: "1.000" y "1,000" son mil; "2,5" y "2.5" son dos y medio; "1.000,50".
export function toNumber(s: string): number | null {
  const neg = s.startsWith('-')
  let t = s.replace(/^-/, '')
  if (!/^\d[\d.,]*$/.test(t) || /[.,]$/.test(t)) return null
  const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','))
  if (last >= 0) {
    const mixed = t.includes('.') && t.includes(',')
    const repeated = t.split(t[last]).length > 2
    const thousands = !mixed && (repeated || t.length - last - 1 === 3)
    t = thousands ? t.replace(/[.,]/g, '') : t.slice(0, last).replace(/[.,]/g, '') + '.' + t.slice(last + 1)
  }
  const n = Number(t)
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

// El último número del renglón es su valor; lo de antes es el nombre ("Pago tarjeta: 120"). El "-" cuenta como
// negativo solo pegado al número ("Devolución: -20"), no en "Médicos - 90".
export function numberIn(text: string): { label: string; value: number } | null {
  const all = [...text.matchAll(/(?:^|(?<=[\s:=$(]))-(?=\d)|\d[\d.,]*/g)]
  let m = all.at(-1)
  if (!m) return null
  let raw = m[0].replace(/[.,]+$/, '')
  let start = m.index
  const prev = all.at(-2)
  if (m[0] === '-') return null
  if (prev?.[0] === '-' && prev.index + 1 === m.index) { raw = '-' + raw; start = prev.index }
  const value = toNumber(raw)
  if (value === null) return null
  const label = text.slice(0, start).replace(/[\s:=$\-–]+$/, '').trim()
  return { label, value }
}

export const letterOf = (i: number): string => (i >= 26 ? letterOf(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))

export const LISTS = ['bulletList', 'orderedList', 'taskList']

// Los renglones que lee la calculadora que está en `pos`: la lista justo encima (sin contar renglones vacíos) o, si no
// hay lista, los párrafos seguidos de encima. Los que no tienen número no llevan letra.
export function calcRows(doc: Node, pos: number): Row[] {
  const $pos = doc.resolve(pos)
  const parent = $pos.parent
  let index = $pos.index() - 1
  let at = pos
  const step = () => { at -= parent.child(index).nodeSize; index-- }
  while (index >= 0 && parent.child(index).type.name === 'paragraph' && !parent.child(index).textContent.trim()) step()
  const lines: { text: string; checked: boolean | null; at: number }[] = []
  if (index >= 0 && LISTS.includes(parent.child(index).type.name)) {
    const list = parent.child(index)
    let itemAt = at - list.nodeSize + 1
    list.forEach(item => {
      const first = item.firstChild
      if (first?.isTextblock) lines.push({ text: first.textContent, checked: item.type.name === 'taskItem' ? !!item.attrs.checked : null, at: itemAt + 2 })
      itemAt += item.nodeSize
    })
  } else {
    while (index >= 0 && parent.child(index).type.name === 'paragraph' && parent.child(index).textContent.trim()) {
      step()
      lines.unshift({ text: parent.child(index + 1).textContent, checked: null, at: at + 1 })
    }
  }
  const rows: Row[] = []
  for (const line of lines) {
    const found = numberIn(line.text)
    if (found) rows.push({ ...found, letter: letterOf(rows.length), checked: line.checked, at: line.at })
  }
  return rows
}

const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.value, 0)
const WORDS: Record<string, (rows: Row[]) => number> = {
  todo: sum, total: sum,
  marcados: rows => sum(rows.filter(r => r.checked)), marcado: rows => sum(rows.filter(r => r.checked)),
  'sin marcar': rows => sum(rows.filter(r => r.checked === false)), pendientes: rows => sum(rows.filter(r => r.checked === false)),
}
const name = (s: string) => fold(s).replace(/\s+/g, ' ').trim()

class CalcError extends Error {}

// Cuenta con + - * / × ÷ y paréntesis. Cada parte puede ser una letra (A), un nombre (Seguro), un número o
// todo / marcados / sin marcar. Vacía = todo.
export function evaluate(formula: string, rows: Row[]): Result {
  const tokens = formula.split(/([+\-*/×÷()])/).map(t => t.trim()).filter(Boolean)
  if (!tokens.length) return { value: round(sum(rows)) }
  let i = 0
  const operand = (t: string): number => {
    const word = WORDS[name(t)]
    if (word) return word(rows)
    const byLetter = rows.find(r => r.letter === t.toUpperCase())
    if (byLetter) return byLetter.value
    const n = toNumber(t)
    if (n !== null) return n
    const named = rows.filter(r => name(r.label) === name(t))
    if (named.length > 1) throw new CalcError(`Hay ${named.length} renglones "${t}": usa sus letras`)
    if (!named.length) throw new CalcError(`No encuentro "${t}"`)
    return named[0].value
  }
  const factor = (): number => {
    const t = tokens[i++]
    if (t === undefined) throw new CalcError('Falta un número al final')
    if (t === '-') return -factor()
    if (t === '+') return factor()
    if (t === '(') {
      const v = expr()
      if (tokens[i++] !== ')') throw new CalcError('Falta cerrar un paréntesis')
      return v
    }
    if ('*/×÷)'.includes(t)) throw new CalcError(`Sobra "${t}"`)
    return operand(t)
  }
  const term = (): number => {
    let v = factor()
    while (['*', '/', '×', '÷'].includes(tokens[i])) {
      const op = tokens[i++]
      const b = factor()
      if ((op === '/' || op === '÷') && b === 0) throw new CalcError('No se puede dividir para cero')
      v = op === '/' || op === '÷' ? v / b : v * b
    }
    return v
  }
  const expr = (): number => {
    let v = term()
    while (tokens[i] === '+' || tokens[i] === '-') v = tokens[i++] === '+' ? v + term() : v - term()
    return v
  }
  try {
    const value = expr()
    if (i < tokens.length) throw new CalcError(`Sobra "${tokens[i]}"`)
    return { value: round(value) }
  } catch (e) {
    if (e instanceof CalcError) return { error: e.message }
    throw e
  }
}

// Sin errores de coma flotante (0,1 + 0,2 = 0,3) y con máximo 2 decimales.
const round = (n: number) => Math.round(n * 100) / 100 + 0

export const showNumber = (n: number) => n.toLocaleString('es-EC', { maximumFractionDigits: 2 })

// "Seguro: 85" escrito en la cajita de la cuenta: es un gasto, no una cuenta (tiene nombre y número, y no se puede calcular).
export const looksLikeRow = (text: string, rows: Row[]) => !!numberIn(text)?.label && 'error' in evaluate(text, rows)

// Pasa ese gasto a la lista de encima de la calculadora (al final, con el mismo tipo de renglón) o, si no hay lista,
// como párrafo justo encima (antes de los renglones vacíos).
export function addRow(state: EditorState, pos: number, text: string): Transaction {
  const { schema } = state
  const $pos = state.doc.resolve(pos)
  const parent = $pos.parent
  let index = $pos.index() - 1
  let at = pos
  while (index >= 0 && parent.child(index).type.name === 'paragraph' && !parent.child(index).textContent.trim()) at -= parent.child(index--).nodeSize
  const para = schema.nodes.paragraph.create(null, schema.text(text.trim()))
  const list = index >= 0 && LISTS.includes(parent.child(index).type.name) ? parent.child(index) : null
  if (!list) return state.tr.insert(at, para)
  const item = list.type.name === 'taskList' ? schema.nodes.taskItem.create({ checked: false }, para) : schema.nodes.listItem.create(null, para)
  return state.tr.insert(at - 1, item)
}

// Para Gemini: los renglones con su letra y el pedido; responde solo la cuenta.
export const formulaPrompt = (request: string, rows: Row[]) =>
  'Convierte el pedido en una cuenta para una calculadora.\nRenglones (letra: nombre = valor):\n'
  + rows.map(r => `${r.letter}: ${r.label || '(sin nombre)'} = ${r.value}`).join('\n')
  + (rows.some(r => r.checked !== null) ? '\nTambién puedes usar: todo, marcados, sin marcar.' : '\nTambién puedes usar: todo.')
  + '\nResponde SOLO la cuenta en una línea, con las letras, números, + - * / y paréntesis. Sin "=", sin el resultado y sin explicar.'
  + ' Si el pedido no se puede hacer con estos renglones, responde NO.'
  + `\nPedido: ${request.trim()}`

// La respuesta de Gemini, limpia: la primera línea, sin "Cuenta:", sin "=" ni el resultado. Vacía si dijo NO.
export function cleanFormula(answer: string) {
  const line = answer.replace(/```[a-z]*/gi, '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  const f = line.replace(/^(cuenta|f[oó]rmula)\s*:\s*/i, '').replace(/^=\s*/, '').replace(/\s*=.*$/, '').replace(/[`.]+$/, '').trim()
  return /^no$/i.test(f) ? '' : f
}

// Gemini (dictado o pedido) puede contestar que es una cuenta: así la app pone una calculadora en vez de escribir la frase.
// Solo se manda el pedido o la voz; los renglones de la nota no van en este paso.
export const CALC_HINT = '\nOtro caso: si es un pedido de CUENTA con los números que la persona ya tiene en la nota (sumar, restar, total, '
  + '"cuánto es…", "cuánto me falta"), responde SOLO una línea: CUENTA: y luego "todo" si pide sumar todo, "marcados" o '
  + '"sin marcar" si pide lo marcado o lo que falta, o si no el pedido en pocas palabras (ej.: CUENTA: seguro más luz). '
  + 'Si dicta gastos o datos para anotar ("seguro 85, luz 25"), eso NO es una cuenta: escríbelos, uno por renglón.'

export function calcRequest(answer: string): string | null {
  const m = answer.trim().match(/^CUENTA\s*:\s*([^\n]+)/i)
  return m ? m[1].replace(/[.`"]+$/, '').trim() || null : null
}
