import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isFromApp } from './paste.ts'

test('lo copiado de otra nota de la app se reconoce', () => {
  assert.equal(isFromApp('<p data-pm-slice="1 1 []"><span style="color: red">hola</span></p>'), true)
  assert.equal(isFromApp('<p style="font-family: Calibri">hola</p>'), false)
})
