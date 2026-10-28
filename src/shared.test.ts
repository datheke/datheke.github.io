import assert from 'node:assert/strict'
import { test } from 'node:test'
import { joinExtra, splitExtra } from './shared.ts'

test('ícono y portada viajan en un comentario al final y se separan del texto', () => {
  const body = '<p>Leche</p><p>Pan</p>'
  const full = joinExtra(body, { icono: '🛒', portada: 'data:image/jpeg;base64,AAAA' })
  assert.match(full, /<!--datheke:/)
  assert.deepEqual(splitExtra(full), { body, extra: { icono: '🛒', portada: 'data:image/jpeg;base64,AAAA' } })
  assert.equal(joinExtra(body, {}), body)
  assert.deepEqual(splitExtra(body), { body, extra: {} })
})
