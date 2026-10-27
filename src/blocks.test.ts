import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema, type Node } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { moveBlock, moveTo } from './blocks.ts'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    details: { group: 'block', content: 'detailsSummary detailsContent' },
    detailsSummary: { content: 'inline*' },
    detailsContent: { content: 'block+' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
    text: { group: 'inline' },
  },
})
const p = (t: string) => schema.node('paragraph', null, t ? [schema.text(t)] : [])
const det = (title: string, ...body: Node[]) =>
  schema.node('details', null, [schema.node('detailsSummary', null, [schema.text(title)]), schema.node('detailsContent', null, body)])
const ul = (...items: string[]) => schema.node('bulletList', null, items.map(t => schema.node('listItem', null, [p(t)])))

// Estado con el cursor dentro del texto `where` (primera vez que aparece).
function at(doc: Node, where: string) {
  let pos = -1
  doc.descendants((n, at) => { if (pos < 0 && n.isText && n.text?.includes(where)) pos = at + n.text.indexOf(where) + 1 })
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) })
}
const texts = (doc: Node) => { const out: string[] = []; doc.descendants(n => { if (n.isTextblock) out.push(n.textContent) }); return out.join(' | ') }

test('el desplegable entero sube con el cursor en su título, y el cursor se va con él', () => {
  const tr = moveBlock(at(schema.node('doc', null, [p('uno'), det('Titulo', p('adentro'))]), 'Titulo'), -1)!
  assert.equal(texts(tr.doc), 'Titulo | adentro | uno')
  assert.equal(tr.selection.$from.parent.textContent, 'Titulo')
})

test('dentro del desplegable se mueve el párrafo, no el desplegable', () => {
  const tr = moveBlock(at(schema.node('doc', null, [det('T', p('a'), p('b'))]), 'a'), 1)!
  assert.equal(texts(tr.doc), 'T | b | a')
})

test('en una lista se mueve el renglón', () => {
  const tr = moveBlock(at(schema.node('doc', null, [ul('x', 'y', 'z')]), 'z'), -1)!
  assert.equal(texts(tr.doc), 'x | z | y')
})

test('arriba del todo o abajo del todo no hay a dónde', () => {
  const doc = schema.node('doc', null, [p('uno'), p('dos')])
  assert.equal(moveBlock(at(doc, 'uno'), -1), null)
  assert.equal(moveBlock(at(doc, 'dos'), 1), null)
})

// Inicio (posición antes) del bloque que contiene el texto `where`, al nivel que se arrastra.
const startOf = (doc: Node, where: string, depthUp = 0) => {
  const $p = at(doc, where).selection.$from
  return $p.before($p.depth - depthUp)
}

test('arrastrar el desplegable al principio y un párrafo al final', () => {
  const doc = schema.node('doc', null, [p('uno'), p('dos'), det('Titulo', p('adentro'))])
  assert.equal(texts(moveTo(EditorState.create({ doc }), startOf(doc, 'Titulo', 1), 0)!.doc), 'Titulo | adentro | uno | dos')
  assert.equal(texts(moveTo(EditorState.create({ doc }), startOf(doc, 'uno'), 2)!.doc), 'dos | Titulo | adentro | uno')
})

test('arrastrar un renglón dentro de su lista', () => {
  const doc = schema.node('doc', null, [ul('x', 'y', 'z')])
  assert.equal(texts(moveTo(EditorState.create({ doc }), startOf(doc, 'x', 1), 2)!.doc), 'y | z | x')
})

test('soltarlo donde estaba no cambia nada', () => {
  const doc = schema.node('doc', null, [p('uno'), p('dos')])
  assert.equal(moveTo(EditorState.create({ doc }), startOf(doc, 'dos'), 1), null)
})
