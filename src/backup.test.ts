import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OLD, rotate, ZIP } from './backup.ts'

const f = (id: string, name: string, modifiedTime: string) => ({ id, name, modifiedTime })
const NOW = Date.parse('2026-11-06T12:00:00Z')

test('"Hacer ahora" seguido no borra el respaldo viejo: si el actual es de hace menos de un día, solo se reemplaza', () => {
  assert.deepEqual(rotate([f('a', ZIP, '2026-11-06T10:00:00Z'), f('b', OLD, '2026-10-30T10:00:00Z')], NOW), { remove: ['a'], rename: [] })
})

test('respaldo de la semana: el anterior se borra y el actual pasa a ser el anterior (siempre quedan 2)', () => {
  assert.deepEqual(rotate([f('a', ZIP, '2026-11-01T10:00:00Z'), f('b', OLD, '2026-10-25T10:00:00Z')], NOW), { remove: ['b'], rename: ['a'] })
  assert.deepEqual(rotate([], NOW), { remove: [], rename: [] }) // el primero de todos
})
