import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanReminders, fileName, pack, photoIds, unpack } from './share.ts'

test('la nota viaja completa: texto con formato, ícono, portada y fotos', () => {
  const html = '<h2>Pagos</h2><p style="color: red">Agua <img src="drive:F1"></p>'
  const bytes = pack({ title: 'Pagos servicios básicos', html, icon: '💡', cover: 'C1', photos: { F1: new Uint8Array([1, 2, 3]), C1: new Uint8Array([9]) } })
  const back = unpack(bytes)
  assert.equal(back.title, 'Pagos servicios básicos')
  assert.equal(back.html, html)
  assert.equal(back.icon, '💡')
  assert.equal(back.cover, 'C1')
  assert.deepEqual([...back.photos.F1], [1, 2, 3])
  assert.deepEqual(photoIds(html), ['F1'])
})

test('los recordatorios van, pero sin historial ni "hecho"', () => {
  const html = '<p>Agua <span data-type="recordatorio" data-id="r1" data-at="2026-11-15T14:00:00.000Z" data-rep="mes:15" data-hecho="true" data-historial="2026-10-14T00:00:00.000Z"></span></p>'
  const out = cleanReminders(html)
  assert.match(out, /data-rep="mes:15"/)
  assert.doesNotMatch(out, /historial|hecho/)
})

test('un archivo que no es de Datheke se rechaza con un mensaje claro', () => {
  assert.throws(() => unpack(new Uint8Array([1, 2, 3])), /no es una nota de Datheke/)
})

test('nombre de archivo válido', () => {
  assert.equal(fileName('Pagos: agua/luz'), 'Pagos- agua-luz.datheke')
  assert.equal(fileName('  '), 'Nota.datheke')
})
