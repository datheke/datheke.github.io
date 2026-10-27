import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shortDate } from './format.ts'

const now = new Date(2026, 9, 26, 22, 30) // 26/10/2026 22:30

test('hoy la hora, ayer "Ayer"', () => {
  assert.match(shortDate(new Date(2026, 9, 26, 9, 5).toISOString(), now), /09:05/)
  assert.equal(shortDate(new Date(2026, 9, 25, 23, 59).toISOString(), now), 'Ayer')
})

test('este año día y mes; antes la fecha corta', () => {
  assert.match(shortDate(new Date(2026, 0, 19).toISOString(), now), /^19 ene/)
  assert.equal(shortDate(new Date(2025, 4, 15).toISOString(), now), '15/5/25')
})
