import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agenda, fireId, type Source } from './agenda.ts'
import type { Reminder } from './remind.ts'

const now = new Date(2026, 9, 27, 20, 0).getTime() // martes 27 oct 2026, 20:00
const src = (r: Partial<Reminder>, extra: Partial<Source> = {}): Source => ({
  r: { id: 'x', at: '', rep: '', insist: false, done: false, hist: [], ...r }, label: 'Pago agua David', noteId: 'n1', noteTitle: 'Pagos', locked: false, ...extra,
})

test('uno futuro suena una vez; uno hecho o vencido sin insistir no suena', () => {
  assert.equal(agenda([src({ at: new Date(2026, 9, 28, 9).toISOString() })], now).length, 1)
  assert.equal(agenda([src({ at: new Date(2026, 9, 20, 9).toISOString() })], now).length, 0)
  assert.equal(agenda([src({ at: new Date(2026, 9, 28, 9).toISOString(), done: true })], now).length, 0)
})

test('el que se repite deja programadas las próximas 3 veces, aunque el anterior siga pendiente', () => {
  const fires = agenda([src({ at: new Date(2026, 9, 20, 10).toISOString(), rep: 'mes:20' })], now)
  assert.deepEqual(fires.map(f => new Date(f.at).toDateString()),
    [new Date(2026, 10, 20).toDateString(), new Date(2026, 11, 20).toDateString(), new Date(2027, 0, 20).toDateString()])
})

test('insistir: avisa cada día a la misma hora mientras siga pendiente', () => {
  const fires = agenda([src({ at: new Date(2026, 9, 25, 9).toISOString(), insist: true })], now)
  assert.equal(fires.length, 7)
  assert.equal(new Date(fires[0].at).toDateString(), new Date(2026, 9, 28).toDateString())
  assert.equal(new Date(fires[0].at).getHours(), 9)
  assert.match(fires[0].body, /Sigue pendiente/)
})

test('nota con clave: la notificación no muestra nada del contenido', () => {
  const [f] = agenda([src({ at: new Date(2026, 9, 28, 9).toISOString() }, { locked: true })], now)
  assert.doesNotMatch(f.title + f.body, /David|Pagos/)
})

test('cada aviso tiene siempre el mismo número', () => {
  assert.equal(fireId('n1:x:a'), fireId('n1:x:a'))
  assert.notEqual(fireId('n1:x:a'), fireId('n1:x:r1'))
})
