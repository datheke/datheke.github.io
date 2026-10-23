import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as store from './sync.ts'

type F = { id: string; name: string; modifiedTime: string; mimeType?: string; appProperties?: Record<string, string>; body: string }

// Drive de mentira en memoria: entiende las llamadas que hace drive.ts.
function fakeDrive() {
  const files = new Map<string, F>()
  let clock = 0
  let next = 0
  let online = true
  const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString()
  const meta = (f: F) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, mimeType: f.mimeType, appProperties: f.appProperties })
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
  globalThis.fetch = async (input, init = {}) => {
    if (!online) throw new TypeError('Failed to fetch')
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const id = url.pathname.split('/files/')[1]
    if (id === 'generateIds') return json({ ids: Array.from({ length: Number(url.searchParams.get('count')) }, () => `gen${next++}`) })
    if (!id && method === 'GET') return json({ files: [...files.values()].map(meta) })
    if (method === 'GET') return new Response(files.get(id)!.body)
    if (method === 'DELETE') return files.delete(id) ? new Response(null, { status: 204 }) : json({}, 404)
    const text = await new Response(init.body).text()
    let m: Partial<F>
    let body: string | undefined
    if (url.searchParams.get('uploadType') === 'multipart') {
      const b = (init.headers as Record<string, string>)['Content-Type'].split('boundary=')[1]
      const [, head, content] = text.split(`--${b}`).map(p => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''))
      m = JSON.parse(head)
      body = content
    } else m = JSON.parse(text)
    if (method === 'POST') {
      const f = { id: m.id ?? `srv${next++}`, name: m.name ?? '', modifiedTime: tick(), mimeType: m.mimeType, appProperties: m.appProperties ?? {}, body: body ?? '' }
      files.set(f.id, f)
      return json(meta(f))
    }
    const f = files.get(id)
    if (!f) return json({}, 404)
    Object.assign(f, { name: m.name ?? f.name, appProperties: { ...f.appProperties, ...m.appProperties }, body: body ?? f.body, modifiedTime: tick() })
    return json(meta(f))
  }
  const note = (id: string, name: string, body: string) =>
    files.set(id, { id, name, modifiedTime: tick(), mimeType: 'text/html', appProperties: { kind: 'note' }, body })
  return { files, tick, note, setOnline: (v: boolean) => { online = v } }
}

const notesIn = (files: Map<string, F>) => [...files.values()].filter(f => f.appProperties?.kind === 'note')

test('sin internet: la nota se crea con un id reservado y se sube sola al volver, sin duplicados', async () => {
  const drive = fakeDrive()
  await store.start('a@test')
  await store.sync()
  assert.equal(store.getState().ids.length, 20)
  drive.setOnline(false)
  const id = store.create({ kind: 'note', notebook: 'nb' }, 'Viaje', '<p>sin señal</p>', 'text/html')
  await store.sync()
  assert.equal(store.getState().offline, true)
  assert.equal(Object.keys(store.getState().pending).length, 1)
  drive.setOnline(true)
  await store.sync()
  assert.equal(drive.files.get(id)?.body, '<p>sin señal</p>')
  assert.equal(notesIn(drive.files).length, 1)
  assert.deepEqual(store.getState().pending, {})
})

test('misma nota cambiada aquí y en otro dispositivo: avisa, no pisa nada y respeta lo que elija el usuario', async () => {
  const drive = fakeDrive()
  drive.note('n1', 'Compras', '<p>pan</p>')
  await store.start('b@test')
  await store.sync()
  assert.equal(store.getState().texts.n1.text, '<p>pan</p>')
  store.edit('n1', { text: '<p>pan y leche</p>' })
  Object.assign(drive.files.get('n1')!, { body: '<p>pan y huevos</p>', modifiedTime: drive.tick() }) // el otro dispositivo
  await store.sync()
  assert.equal(store.getState().conflicts.n1?.text, '<p>pan y huevos</p>')
  assert.equal(drive.files.get('n1')!.body, '<p>pan y huevos</p>')
  store.resolve('n1', 'mine')
  await store.sync()
  assert.equal(drive.files.get('n1')!.body, '<p>pan y leche</p>')
  assert.deepEqual(store.getState().conflicts, {})
  assert.deepEqual(store.getState().pending, {})
})

test('borrada en otro dispositivo con cambios sin subir aquí: se guarda como nota nueva', async () => {
  const drive = fakeDrive()
  drive.note('n1', 'Idea', '<p>a</p>')
  await store.start('c@test')
  await store.sync()
  store.edit('n1', { text: '<p>a mejorada</p>' })
  drive.files.delete('n1')
  await store.sync()
  await store.sync()
  const saved = notesIn(drive.files)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].body, '<p>a mejorada</p>')
  assert.equal(store.getState().files.n1, undefined)
})

test('borrar sin internet: no reaparece al leer Drive y se borra de Drive al volver', async () => {
  const drive = fakeDrive()
  drive.note('n1', 'Vieja', '<p>x</p>')
  await store.start('d@test')
  await store.sync()
  drive.setOnline(false)
  store.remove('n1')
  await store.sync()
  assert.equal(store.getState().files.n1, undefined)
  drive.setOnline(true)
  await store.sync()
  assert.equal(drive.files.has('n1'), false)
  assert.equal(store.getState().files.n1, undefined)
  assert.deepEqual(store.getState().pending, {})
})
