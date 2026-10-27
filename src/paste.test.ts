import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanStyle, isFromApp } from './paste.ts'

test('lo copiado de otra nota de la app se reconoce', () => {
  assert.equal(isFromApp('<p data-pm-slice="1 1 []"><span style="color: red">hola</span></p>'), true)
  assert.equal(isFromApp('<p style="font-family: Calibri">hola</p>'), false)
})

test('quita fuente, tamaño y colores; deja negrita, cursiva y subrayado', () => {
  assert.equal(
    cleanStyle('font-family: "Times New Roman", serif; font-size:12.0pt; COLOR: red; font-weight: 700; font-style:italic; text-decoration: underline'),
    'font-weight: 700; font-style:italic; text-decoration: underline',
  )
})

test('un ; dentro de comillas no corta la declaración', () => {
  assert.equal(cleanStyle(`font-family:'Fuente; rara'; font-weight:bold`), 'font-weight:bold')
})

test('basura de Word y fondos fuera; vacío si no queda nada', () => {
  assert.equal(cleanStyle('mso-bidi-font-size:11pt; background-color: yellow; line-height:107%'), '')
  assert.equal(cleanStyle(''), '')
})
