import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { lineToDetails, slashAllowed } from './slash.ts'

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

const full = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'inline*' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
  details: { group: 'block', content: 'detailsSummary detailsContent', attrs: { open: { default: false } } },
  detailsSummary: { content: 'inline*', attrs: { level: { default: 2 } } },
  detailsContent: { content: 'block+' },
  bulletList: { group: 'block', content: 'listItem+' },
  listItem: { content: 'paragraph block*' },
  text: { group: 'inline' },
}, marks: { bold: {} } })
const title = (block: ReturnType<typeof full.node>, query = '/desplegable') => {
  const doc = full.node('doc', null, [block, full.node('paragraph', null, [full.text('después')])])
  const text = doc.child(0).textContent
  const from = 1 + text.lastIndexOf(query)
  const tr = lineToDetails(EditorState.create({ doc }), { from, to: from + query.length })
  return tr && { doc: tr.doc, sel: tr.selection }
}

test('"hola /desplegable": hola pasa a ser el título, abierto y con el cursor adentro', () => {
  const r = title(full.node('paragraph', null, [full.text('hola '), full.text('mundo', [full.mark('bold')]), full.text(' /desplegable')]))!
  const d = r.doc.child(0)
  assert.equal(d.type.name, 'details')
  assert.equal(d.attrs.open, true)
  assert.equal(d.child(0).textContent, 'hola mundo')
  assert.equal(d.child(0).attrs.level, 2)
  assert.equal(d.child(0).child(1).marks[0]?.type.name, 'bold') // el formato del texto se queda
  assert.equal(d.child(1).textContent, '')
  assert.equal(r.sel.$from.parent.type.name, 'paragraph')
  assert.equal(r.sel.$from.node(-1).type.name, 'detailsContent')
  assert.equal(r.doc.child(1).textContent, 'después') // lo de abajo no se toca
})

test('un título conserva su tamaño; sin texto o en el primer renglón de una lista se hace como siempre', () => {
  assert.equal(title(full.node('heading', { level: 1 }, [full.text('Gastos /desplegable')]))!.doc.child(0).child(0).attrs.level, 1)
  assert.equal(title(full.node('paragraph', null, [full.text('/desplegable')])), null)
  assert.equal(title(full.node('bulletList', null, [full.node('listItem', null, [full.node('paragraph', null, [full.text('uno /desp')])])]), '/desp'), null)
})
