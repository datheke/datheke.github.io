import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eventBody, eventId, plan, rrule, type CalEvent, type Item } from './calendar.ts'
import type { Reminder } from './remind.ts'

const tz = 'America/Guayaquil'
const item = (r: Partial<Reminder> = {}, extra: Partial<Item> = {}): Item => ({
  noteId: 'n1', label: 'Pago agua', noteTitle: 'Pagos', locked: false,
  r: { id: 'r1', at: '2026-11-15T14:00:00.000Z', rep: '', insist: false, done: false, hist: [], ...r }, ...extra,
})
const opts = (o: Partial<Parameters<typeof plan>[2]> = {}) => ({ known: new Set(['n1']), live: new Set(['n1']), synced: true, removedByUs: new Set<string>(), tz, ...o })
const asEvent = (x: Item, change: Partial<CalEvent> = {}): CalEvent => {
  const b = eventBody(x, tz) as { id: string; start: { dateTime: string }; extendedProperties: CalEvent['extendedProperties'] }
  return { id: b.id, status: 'confirmed', start: b.start, extendedProperties: b.extendedProperties, ...change }
}

test('el id del evento es válido para Calendar y siempre el mismo', () => {
  assert.match(eventId('1AbC_x-9', 'r1'), /^[0-9a-v]{5,}$/)
  assert.equal(eventId('n1', 'r1'), eventId('n1', 'r1'))
})

test('repeticiones de Datheke en reglas de Calendar', () => {
  assert.equal(rrule(''), undefined)
  assert.equal(rrule('dia'), 'RRULE:FREQ=DAILY')
  assert.equal(rrule('sem:1,4'), 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH')
  assert.equal(rrule('mes:15'), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15')
  assert.equal(rrule('mes:31'), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1')
  assert.equal(rrule('ano:3-10'), 'RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=10')
})

test('uno nuevo se crea; uno igual no se toca; uno cambiado en Datheke se actualiza', () => {
  assert.equal(plan([item()], [], opts()).put.length, 1)
  assert.deepEqual(plan([item()], [asEvent(item())], opts()), { put: [], remove: [], pull: [] })
  const p = plan([item({ at: '2026-11-16T14:00:00.000Z' })], [asEvent(item())], opts())
  assert.equal(p.put.length, 1)
  assert.equal(p.pull.length, 0)
})

test('movido en Calendar: la nota toma la nueva hora', () => {
  const ev = asEvent(item(), { start: { dateTime: '2026-11-15T20:30:00-05:00' } })
  const p = plan([item()], [ev], opts())
  assert.equal(p.pull[0].r.at, new Date('2026-11-16T01:30:00.000Z').toISOString())
})

test('borrado en Calendar cuenta como hecho; borrado por Datheke (nota restaurada) vuelve', () => {
  const ev = asEvent(item(), { status: 'cancelled' })
  const p = plan([item()], [ev], opts())
  assert.equal(p.pull[0].r.done, true)
  const q = plan([item()], [ev], opts({ removedByUs: new Set([ev.id]) }))
  assert.equal(q.pull.length, 0)
  assert.equal(q.put[0].exists, true)
})

test('hecho, quitado de la nota o nota al basurero: se borra de Calendar', () => {
  assert.deepEqual(plan([item({ done: true })], [asEvent(item())], opts()).remove, [eventId('n1', 'r1')])
  assert.equal(plan([], [asEvent(item())], opts()).remove.length, 1) // quitado de la nota
  assert.equal(plan([], [asEvent(item())], opts({ known: new Set(), live: new Set() })).remove.length, 1) // basurero
})

test('nota con clave cerrada: no se toca; y su evento no dice nada del contenido', () => {
  assert.equal(plan([], [asEvent(item())], opts({ known: new Set() })).remove.length, 0)
  const b = eventBody(item({}, { locked: true }), tz) as { summary: string; description: string }
  assert.doesNotMatch(b.summary + b.description, /Pago|Pagos/)
})
