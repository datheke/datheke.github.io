import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { slashAllowed } from './slash.ts'

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'text*' },
  codeBlock: { group: 'block', content: 'text*', code: true },
  text: {},
} })
// La última "/" del texto, como la que se acaba de escribir.
const opens = (text: string, type = 'paragraph') =>
  slashAllowed(schema.node('doc', null, [schema.node(type, null, [schema.text(text)])]), 1 + text.lastIndexOf('/'))

test('el menú / abre al inicio, tras un espacio o tras un signo', () => {
  assert.equal(opens('/sep'), true)
  assert.equal(opens('hola /sep'), true)
  assert.equal(opens('hola...../sep'), true)
})

test('el menú / no molesta al escribir normal', () => {
  assert.equal(opens('y/o'), false)
  assert.equal(opens('12/05'), false)
  assert.equal(opens('https://datheke.github.io'), false)
  assert.equal(opens('https:/'), false)
  assert.equal(opens('ls ./src', 'codeBlock'), false)
})
