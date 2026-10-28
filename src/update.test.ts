import assert from 'node:assert/strict'
import { test } from 'node:test'

test('compara versiones por números, no como texto', async () => {
  const { newer } = await import('./version.ts')
  assert.equal(newer('0.7.4', '0.7.3'), true)
  assert.equal(newer('0.7.10', '0.7.9'), true)
  assert.equal(newer('0.8.0', '0.7.99'), true)
  assert.equal(newer('0.7.3', '0.7.3'), false)
  assert.equal(newer('0.7.2', '0.7.3'), false)
})
