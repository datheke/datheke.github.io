import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupOf, nextTime, quickTimes, whenLabel } from './remind.ts'

const now = new Date(2026, 9, 27, 20, 0) // martes 27 oct 2026, 20:00

test('fecha en palabras simples', () => {
  assert.match(whenLabel(new Date(2026, 9, 27, 21, 30).toISOString(), now), /^Hoy 21:30$/)
  assert.match(whenLabel(new Date(2026, 9, 28, 9, 0).toISOString(), now), /^Mañana 09:00$/)
  assert.match(whenLabel(new Date(2026, 9, 31, 9, 0).toISOString(), now), /31 oct, 09:00$/)
})

test('grupos de la lista: vencido, hoy, próximos y hechos', () => {
  assert.equal(groupOf(new Date(2026, 9, 27, 8).toISOString(), false, now), 'vencido')
  assert.equal(groupOf(new Date(2026, 9, 27, 22).toISOString(), false, now), 'hoy')
  assert.equal(groupOf(new Date(2026, 10, 2).toISOString(), false, now), 'proximo')
  assert.equal(groupOf(new Date(2026, 9, 27, 8).toISOString(), true, now), 'hecho')
})

test('el que se repite pasa a la siguiente vez, ya en el futuro', () => {
  const lunes = new Date(2026, 9, 19, 9).toISOString() // hace 8 días
  assert.equal(new Date(nextTime(lunes, 'semana', now)).getDate(), 2) // lunes 2 nov
  assert.equal(new Date(nextTime(lunes, 'dia', now)).getDate(), 28)
  assert.equal(nextTime(lunes, '', now), lunes)
})

test('atajos: a las 20:00 ya no ofrece "esta tarde"', () => {
  assert.deepEqual(quickTimes(now).map(q => q.label), ['En 1 hora', 'Mañana, 9:00', 'El lunes, 9:00'])
})
