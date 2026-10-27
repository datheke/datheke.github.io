import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { wordAt } from './word.ts'

const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, text: { group: 'inline' } } })

const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hola señor 42')])])

test('sin selección, el formato va a la palabra del cursor (con tildes y ñ)', () => {
  assert.deepEqual(wordAt(doc.resolve(3)), { from: 1, to: 5 }) // ho|la → "hola"
  assert.deepEqual(wordAt(doc.resolve(8)), { from: 6, to: 11 }) // se|ñor → "señor"
  assert.deepEqual(wordAt(doc.resolve(1)), { from: 1, to: 5 }) // |hola
  assert.equal(wordAt(doc.resolve(5)) !== null, true) // hola| (al final de la palabra también)
  assert.equal(wordAt(doc.resolve(doc.content.size - 1))?.to, 14) // 42| al final
  const empty = schema.node('doc', null, [schema.node('paragraph')])
  assert.equal(wordAt(empty.resolve(1)), null) // línea vacía: no hay palabra
})
