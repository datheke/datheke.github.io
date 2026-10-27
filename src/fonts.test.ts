import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appFont } from './fonts.ts'

test('la que tenemos, escrita como venga', () => {
  assert.equal(appFont(`'Times New Roman',serif`), '"Times New Roman", serif')
  assert.equal(appFont('"Times New Roman", serif'), '"Times New Roman", serif')
  assert.equal(appFont('CALIBRI'), 'Calibri, sans-serif')
})

test('una parecida si no la tenemos', () => {
  assert.equal(appFont('Helvetica Neue, Helvetica, sans-serif'), 'Arial, sans-serif')
  assert.equal(appFont('"Segoe UI", sans-serif'), '"Inter Variable", sans-serif')
})

test('la primera conocida de la lista manda', () => {
  assert.equal(appFont('"Fuente Rara", Georgia, serif'), 'Georgia, serif')
})

test('desconocida o solo genérica: la letra de la nota', () => {
  assert.equal(appFont('"Comic Neue", sans-serif'), '')
  assert.equal(appFont('serif'), '')
  assert.equal(appFont('"Lora Variable", serif'), '')
})
