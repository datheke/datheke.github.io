import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plan, safeName } from './folder.ts'

test('nombres de archivo válidos en Windows', () => {
  assert.equal(safeName('Ideas: casa/oficina?'), 'Ideas- casa-oficina-')
  assert.equal(safeName('Fin. '), 'Fin')
  assert.equal(safeName('CON'), '_CON')
  assert.equal(safeName('   '), 'Sin título')
})

test('cada nota bajada va a su libreta, sin nombres repetidos, con las fotos apuntando a fotos/', () => {
  const files = {
    nb: { id: 'nb', name: 'Mis notas', modifiedTime: '', appProperties: { kind: 'notebook' } },
    a: { id: 'a', name: 'Compras', modifiedTime: '', appProperties: { kind: 'note', notebook: 'nb' } },
    b: { id: 'b', name: 'compras', modifiedTime: '', appProperties: { kind: 'note', notebook: 'nb' } },
    c: { id: 'c', name: 'Sin bajar', modifiedTime: '', appProperties: { kind: 'note', notebook: 'nb' } },
  }
  const texts = { a: { title: 'Compras', text: '<p>pan</p><img src="drive:F1">' }, b: { title: 'compras', text: '<p>x</p>' } }
  const out = plan({ files, texts })
  assert.equal(out.get('a')?.path, 'Mis notas/Compras.html')
  assert.equal(out.get('b')?.path, 'Mis notas/compras (2).html')
  assert.equal(out.has('c'), false)
  assert.deepEqual(out.get('a')?.images, ['F1'])
  assert.match(out.get('a')!.html, /src="\.\.\/fotos\/F1\.jpg"/)
  assert.match(out.get('a')!.html, /script-src 'none'/)
})
