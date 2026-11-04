import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newer } from './version.ts'

// Con una versión vieja instalada se ofrece directo la última publicada, no la siguiente: basta con que la última sea más nueva.
test('una versión vieja (varias atrás) ve la última como más nueva', () => {
  assert.equal(newer('0.17.3', '0.16.5'), true)
  assert.equal(newer('0.17.3', '0.15.6'), true)
  assert.equal(newer('0.17.10', '0.17.9'), true) // números, no texto
  assert.equal(newer('1.0.0', '0.17.3'), true)
  assert.equal(newer('0.17.3', '0.17.3'), false) // al día: no avisa
  assert.equal(newer('0.17.2', '0.17.3'), false)
})
