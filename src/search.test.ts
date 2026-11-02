import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { closedDetails, findInDoc, findRanges, highlight, matches, searchWords, snippet } from './search.ts'

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

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'inline*' },
  details: { group: 'block', content: 'detailsSummary detailsContent', attrs: { open: { default: false } } },
  detailsSummary: { content: 'inline*' },
  detailsContent: { content: 'block+' },
  chip: { group: 'inline', inline: true, atom: true },
  text: { group: 'inline' },
} })
const { node, text: t } = { node: schema.node.bind(schema), text: schema.text.bind(schema) }
const textAt = (doc: ReturnType<typeof node>, r: { from: number; to: number }) => doc.textBetween(r.from, r.to)

test('dentro de la nota encuentra cada palabra en su lugar, aunque haya cosas en medio del renglón', () => {
  const doc = node('doc', null, [node('paragraph', null, [t('pan y '), node('chip'), t(' más Pan')]), node('paragraph', null, [t('sin nada')])])
  const found = findInDoc(doc, searchWords('pan'))
  assert.equal(found.length, 2)
  assert.deepEqual(found.map(r => textAt(doc, r)), ['pan', 'Pan'])
})

test('dice qué desplegables cerrados esconden la palabra, y no los que no', () => {
  const inner = node('details', { open: false }, [node('detailsSummary', null, [t('título')]), node('detailsContent', null, [node('paragraph', null, [t('adentro')])])])
  const doc = node('doc', null, [node('details', { open: false }, [node('detailsSummary', null, [t('afuera')]), node('detailsContent', null, [inner])])])
  const [title] = findInDoc(doc, searchWords('afuera'))
  const [deep] = findInDoc(doc, searchWords('adentro'))
  const [middle] = findInDoc(doc, searchWords('titulo'))
  assert.deepEqual(closedDetails(doc, title.from), [])
  assert.equal(closedDetails(doc, middle.from).length, 1)
  assert.equal(closedDetails(doc, deep.from).length, 2)
  const open = node('doc', null, [node('details', { open: true }, [node('detailsSummary', null, [t('a')]), node('detailsContent', null, [node('paragraph', null, [t('adentro')])])])])
  assert.deepEqual(closedDetails(open, findInDoc(open, searchWords('adentro'))[0].from), [])
})

test('si estaba solo en el título, el pedacito es el inicio de la nota', () => {
  assert.deepEqual(snippet('hola\n  mundo', searchWords('banco')), [{ text: 'hola mundo', hit: false }])
  assert.deepEqual(snippet('', searchWords('banco')), [])
})
