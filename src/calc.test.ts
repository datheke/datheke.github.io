import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { calcRows, evaluate, letterOf, numberIn, showNumber, toNumber, type Row } from './calc.ts'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    taskList: { group: 'block', content: 'taskItem+' },
    taskItem: { content: 'paragraph block*', attrs: { checked: { default: false } } },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
    horizontalRule: { group: 'block' },
    calculadora: { group: 'block', atom: true, attrs: { formula: { default: '' } } },
    text: {},
  },
})
const p = (t = '') => schema.node('paragraph', null, t ? [schema.text(t)] : [])
const task = (t: string, checked = false) => schema.node('taskItem', { checked }, [p(t)])
const calc = schema.node('calculadora')
const posOf = (doc: ReturnType<typeof schema.node>) => {
  let at = -1
  doc.descendants((n, pos) => { if (n.type.name === 'calculadora') at = pos })
  return at
}
const rowsOf = (...blocks: ReturnType<typeof schema.node>[]) => {
  const doc = schema.node('doc', null, blocks)
  return { doc, rows: calcRows(doc, posOf(doc)) }
}

// La lista de la captura de David.
const desglose = [['Seguro: 85'], ['Pasaporte: 90'], ['Pago tarjeta: 120'], ['Viaje: 1000'], ['Pago tarjeta: 90'], ['Pago Claude: 23'],
  ['Médicos: 90'], ['Luz:25'], ['Dientes:30'], ['Agua:10']]

test('números como se escriben en Ecuador y en inglés', () => {
  assert.equal(toNumber('85'), 85)
  assert.equal(toNumber('1.000'), 1000)
  assert.equal(toNumber('1,000'), 1000)
  assert.equal(toNumber('2,5'), 2.5)
  assert.equal(toNumber('2.50'), 2.5)
  assert.equal(toNumber('1.000,50'), 1000.5)
  assert.equal(toNumber('1,000.50'), 1000.5)
  assert.equal(toNumber('1.000.000'), 1000000)
  assert.equal(toNumber('-20'), -20)
  assert.equal(toNumber('abc'), null)
})

test('el valor es el último número del renglón y lo de antes su nombre', () => {
  assert.deepEqual(numberIn('Seguro: 85'), { label: 'Seguro', value: 85 })
  assert.deepEqual(numberIn('Luz:25'), { label: 'Luz', value: 25 })
  assert.deepEqual(numberIn('Pago tarjeta: $120.'), { label: 'Pago tarjeta', value: 120 })
  assert.deepEqual(numberIn('Médicos - 90'), { label: 'Médicos', value: 90 })
  assert.deepEqual(numberIn('Devolución: -20'), { label: 'Devolución', value: -20 })
  assert.deepEqual(numberIn('1508'), { label: '', value: 1508 })
  assert.equal(numberIn('Desglose:'), null)
})

test('letras A…Z y luego AA, AB…', () => {
  assert.equal(letterOf(0), 'A')
  assert.equal(letterOf(25), 'Z')
  assert.equal(letterOf(26), 'AA')
  assert.equal(letterOf(27), 'AB')
})

test('lee la lista de casillas de encima, con su marca y saltando renglones vacíos', () => {
  const { doc, rows } = rowsOf(p('Desglose:'), schema.node('taskList', null, desglose.map(([t], i) => task(t, i < 2))), p(), calc)
  assert.equal(rows.length, 10)
  assert.deepEqual(rows.slice(0, 2).map(r => [r.letter, r.label, r.value, r.checked]), [['A', 'Seguro', 85, true], ['B', 'Pasaporte', 90, true]])
  assert.equal(rows[2].checked, false)
  // `at` apunta al inicio del texto del renglón (ahí va la letra).
  assert.equal(doc.textBetween(rows[1].at, rows[1].at + 9), 'Pasaporte')
})

test('sin lista encima lee los párrafos seguidos; los que no tienen número no llevan letra', () => {
  const { doc, rows } = rowsOf(p('Otra cosa: 5'), schema.node('horizontalRule'), p('Arriendo: 300'), p('Nota sin número'), p('Comida: 150'), calc)
  assert.deepEqual(rows.map(r => [r.letter, r.label, r.value]), [['A', 'Arriendo', 300], ['B', 'Comida', 150]])
  assert.equal(doc.textBetween(rows[1].at, rows[1].at + 6), 'Comida')
})

test('sin nada encima no hay renglones', () => {
  assert.deepEqual(rowsOf(calc).rows, [])
  assert.deepEqual(rowsOf(schema.node('horizontalRule'), calc).rows, [])
})

const rows: Row[] = desglose.map(([t], i) => ({ ...numberIn(t)!, letter: letterOf(i), checked: i < 3, at: 0 }))
const value = (f: string) => {
  const r = evaluate(f, rows)
  if ('error' in r) throw new Error(r.error)
  return r.value
}

test('todo, marcados y sin marcar', () => {
  assert.equal(value(''), 1563)
  assert.equal(value('todo'), 1563)
  assert.equal(value('Marcados'), 295)
  assert.equal(value('sin marcar'), 1268)
  assert.equal(value('todo - marcados'), 1268)
})

test('operaciones combinadas con letras, nombres y números', () => {
  assert.equal(value('A + B'), 175)
  assert.equal(value('(A + B) - C'), 55)
  assert.equal(value('A + B - (B + C)'), -35)
  assert.equal(value('a+b'), 175)
  assert.equal(value('Seguro + Pasaporte - Luz'), 150)
  assert.equal(value('medicos + LUZ'), 115) // sin tildes ni mayúsculas
  assert.equal(value('2 + 3 * 4'), 14)
  assert.equal(value('(2 + 3) × 4'), 20)
  assert.equal(value('D ÷ 3'), 333.33)
  assert.equal(value('-A + 100'), 15)
  assert.equal(value('0,1 + 0,2'), 0.3)
  assert.equal(value('todo / 2'), 781.5)
})

test('errores claros en vez de un resultado equivocado', () => {
  assert.deepEqual(evaluate('Pago tarjeta + 1', rows), { error: 'Hay 2 renglones "Pago tarjeta": usa sus letras' })
  assert.deepEqual(evaluate('Gasolina', rows), { error: 'No encuentro "Gasolina"' })
  assert.deepEqual(evaluate('A / 0', rows), { error: 'No se puede dividir para cero' })
  assert.deepEqual(evaluate('(A + B', rows), { error: 'Falta cerrar un paréntesis' })
  assert.deepEqual(evaluate('A +', rows), { error: 'Falta un número al final' })
  assert.deepEqual(evaluate('A + B)', rows), { error: 'Sobra ")"' })
  assert.deepEqual(evaluate('* A', rows), { error: 'Sobra "*"' })
})

test('resultado con coma decimal', () => {
  assert.equal(showNumber(1563), '1.563')
  assert.equal(showNumber(2.5), '2,5')
  assert.equal(showNumber(333.333), '333,33')
})
