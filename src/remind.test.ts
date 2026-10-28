import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chipText, groupOf, markDone, nextTime, quickTimes, repeatFor, repeatText, sortReminders, type Reminder } from './remind.ts'

const now = new Date(2026, 9, 27, 20, 0) // martes 27 oct 2026, 20:00
const r = (at: Date, extra: Partial<Reminder> = {}): Reminder => ({ id: 'x', at: at.toISOString(), rep: '', insist: false, done: false, hist: [], ...extra })

test('repeticiones en palabras', () => {
  assert.equal(repeatText('dia'), 'cada día')
  assert.equal(repeatText('sem:4,1'), 'cada lun y jue')
  assert.equal(repeatText('mes:15'), 'el 15 de cada mes')
  assert.equal(repeatText('ano:3-10'), 'cada 10 de marzo')
  assert.equal(repeatFor('mes', new Date(2026, 10, 15)), 'mes:15')
  assert.equal(repeatFor('ano', new Date(2027, 2, 10)), 'ano:3-10')
})

test('siguiente vez: día del mes, fecha del año, días de la semana; día 31 en mes de 30', () => {
  const at = new Date(2026, 9, 15, 9).toISOString() // 15 oct 9:00
  assert.equal(new Date(nextTime(at, 'mes:15', now)).toDateString(), new Date(2026, 10, 15).toDateString())
  assert.equal(new Date(nextTime(at, 'ano:3-10', now)).toDateString(), new Date(2027, 2, 10).toDateString())
  assert.equal(new Date(nextTime(at, 'sem:1,4', now)).toDateString(), new Date(2026, 9, 29).toDateString()) // jueves 29
  const d31 = new Date(2026, 9, 31, 9).toISOString()
  assert.equal(new Date(nextTime(d31, 'mes:31', new Date(2026, 10, 1))).toDateString(), new Date(2026, 10, 30).toDateString())
  assert.equal(new Date(nextTime(d31, 'mes:31', new Date(2026, 11, 1))).toDateString(), new Date(2026, 11, 31).toDateString())
})

test('cerrar la notificación no lo marca: queda pendiente; al marcar, el que se repite pasa al próximo mes', () => {
  const pago = r(new Date(2026, 9, 15, 9), { rep: 'mes:15' })
  assert.equal(groupOf(pago, now), 'pendiente')
  assert.equal(chipText(pago, now), 'Pendiente desde 15 oct')
  const hecho = markDone(pago, now)
  assert.equal(groupOf(hecho, now), 'proximo')
  assert.equal(hecho.hist.length, 1)
  assert.match(chipText(hecho, now), /^✓ oct · 15 nov · 09:00$/)
  const unaVez = markDone(r(new Date(2026, 9, 20, 9)), now)
  assert.equal(groupOf(unaVez, now), 'hecho')
})

test('la lista va por lo que falta', () => {
  const items = [
    { n: 'próximo lejos', r: r(new Date(2027, 2, 10)) },
    { n: 'hecho', r: r(new Date(2026, 9, 20), { done: true, hist: [new Date(2026, 9, 24).toISOString()] }) },
    { n: 'próximo cerca', r: r(new Date(2026, 10, 15)) },
    { n: 'atrasado', r: r(new Date(2026, 9, 1)) },
    { n: 'hoy', r: r(new Date(2026, 9, 27, 23)) },
    { n: 'menos atrasado', r: r(new Date(2026, 9, 20)) },
  ]
  assert.deepEqual(sortReminders(items, now).map(i => i.n), ['atrasado', 'menos atrasado', 'hoy', 'próximo cerca', 'próximo lejos', 'hecho'])
})

test('atajos: a las 20:00 ya no ofrece "esta tarde"', () => {
  assert.deepEqual(quickTimes(now).map(q => q.label), ['En 1 hora', 'Mañana, 9:00', 'El lunes, 9:00'])
})
