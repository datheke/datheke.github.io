import assert from 'node:assert/strict'
import { test } from 'node:test'
import { firstUnordered, lastUnordered, reorder } from './order.ts'

const it = (id: string, orden?: number) => ({ id, appProperties: orden === undefined ? {} : { orden: String(orden) } })
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)

test('la primera vez se numeran todas como quedan', () => {
  assert.deepEqual(reorder([it('a'), it('b'), it('c')], 2, 0), [
    { id: 'c', orden: '1000' }, { id: 'a', orden: '2000' }, { id: 'b', orden: '3000' },
  ])
})

test('después solo la movida, entre sus vecinas', () => {
  const items = [it('a', 1000), it('b', 2000), it('c', 3000)]
  assert.deepEqual(reorder(items, 0, 1), [{ id: 'a', orden: '2500' }])
  assert.deepEqual(reorder(items, 2, 0), [{ id: 'c', orden: '0' }])
  assert.deepEqual(reorder(items, 0, 2), [{ id: 'a', orden: '4000' }])
  assert.deepEqual(reorder(items, 1, 1), [])
})

test('notas sin número arriba, libretas sin número abajo', () => {
  const lista = [it('z', 2000), it('y'), it('x', 1000), it('w')]
  assert.deepEqual([...lista].sort(firstUnordered(byId)).map(i => i.id), ['w', 'y', 'x', 'z'])
  assert.deepEqual([...lista].sort(lastUnordered(byId)).map(i => i.id), ['x', 'z', 'w', 'y'])
})
