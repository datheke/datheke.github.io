import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findRanges, highlight, matches, searchWords, snippet } from './search.ts'

const hits = (parts: { text: string; hit: boolean }[]) => parts.filter(p => p.hit).map(p => p.text)

test('busca sin importar tildes ni mayúsculas, en el título o en el texto', () => {
  assert.equal(matches('Reunión', '', searchWords('REUNION')), true)
  assert.equal(matches('Compras', 'comprar jamón', searchWords('jamon')), true)
  assert.equal(matches('Compras', 'comprar jamón', searchWords('chorizo')), false)
})

test('tienen que estar todas las palabras, sin importar dónde ni en qué orden', () => {
  assert.equal(matches('Lista', 'frutas y carne', searchWords('carne lista')), true)
  assert.equal(matches('Lista', 'frutas y carne', searchWords('carne pan')), false)
})

test('una nota con clave se pasa sin texto: solo se encuentra por el título', () => {
  assert.equal(matches('Banco', '', searchWords('clave')), false)
  assert.equal(matches('Banco', '', searchWords('banco')), true)
})

test('marca la palabra exacta del texto original', () => {
  assert.deepEqual(hits(highlight('Mañana en Pátzcuaro', searchWords('patzcuaro'))), ['Pátzcuaro'])
  assert.deepEqual(hits(highlight('casa CASA', searchWords('casa'))), ['casa', 'CASA'])
  assert.deepEqual(highlight('sin nada', searchWords('hola')), [{ text: 'sin nada', hit: false }])
})

test('el lugar es correcto aunque el original no ocupe lo mismo sin tildes', () => {
  assert.deepEqual(hits(highlight('café rico', searchWords('rico'))), ['rico'])
  assert.deepEqual(hits(highlight('café rico', searchWords('cafe'))), ['café'])
  assert.deepEqual(hits(highlight('a^b fin', searchWords('fin'))), ['fin'])
})

test('palabras que se pisan se marcan como una sola', () => {
  assert.deepEqual(findRanges('casa', searchWords('ca as')), [[0, 3]])
})

test('el pedacito muestra la palabra aunque esté lejos, y avisa lo que corta', () => {
  const text = `${'uno dos tres '.repeat(30)}aquí está la palabra jamón y algo más ${'fin '.repeat(60)}`
  const parts = snippet(text, searchWords('jamon'))
  assert.deepEqual(hits(parts), ['jamón'])
  assert.equal(parts[0].text, '…')
  assert.equal(parts[parts.length - 1].text, '…')
})

test('si estaba solo en el título, el pedacito es el inicio de la nota', () => {
  assert.deepEqual(snippet('hola\n  mundo', searchWords('banco')), [{ text: 'hola mundo', hit: false }])
  assert.deepEqual(snippet('', searchWords('banco')), [])
})
