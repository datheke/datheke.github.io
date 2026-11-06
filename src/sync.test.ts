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

const DAY = 86400_000
const NOW = Date.parse('2026-11-05T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()
const img = (id: string, extra: Record<string, string> = {}) => ({ id, name: 'foto.jpg', modifiedTime: 't', appProperties: { kind: 'image', ...extra } })
const nota = (id: string, extra: Record<string, string> = {}) => ({ id, name: id, modifiedTime: 't1', appProperties: { kind: 'note', ...extra } })
type Plan = Parameters<typeof store.photoPlan>[0]
const plan = (files: ReturnType<typeof img>[], texts: Record<string, string>, extra: Partial<Plan> = {}) => store.photoPlan({
  files: Object.fromEntries(files.map(f => [f.id, f])),
  texts: Object.fromEntries(Object.entries(texts).map(([id, text]) => [id, { title: id, text }])),
  base: Object.fromEntries(files.filter(f => f.appProperties.kind === 'note').map(f => [f.id, f.modifiedTime])),
  pending: {}, conflicts: {}, ...extra,
}, NOW)

test('fotos sin uso: se marcan, se borran al día siguiente y se desmarcan si vuelven a usarse', () => {
  const p = plan([nota('n1'), img('usada'), img('nueva'), img('vieja', { sin_uso: ago(31) }), img('ayer', { sin_uso: ago(1.1) }), img('hoy', { sin_uso: ago(0.2) }),
    img('volvio', { sin_uso: ago(40) }), img('rara', { sin_uso: 'no-es-fecha' })],
    { n1: '<p>x</p><img src="drive:usada"><img src="drive:volvio">' })
  assert.deepEqual(p, { mark: ['nueva'], unmark: ['volvio'], remove: ['vieja', 'ayer'] })
})

test('fotos que cuentan como usadas: portada, nota del basurero, la otra versión de un conflicto; la recién puesta espera', () => {
  const p = plan([nota('n1', { cover: 'portada' }), nota('n2', { borrada: ago(3) }), img('portada'), img('del-basurero'), img('del-conflicto'), img('recien')],
    { n1: '<p>a</p>', n2: '<img src="drive:del-basurero">' },
    { conflicts: { n1: { title: 'n1', text: '<img src="drive:del-conflicto">', modifiedTime: 't2' } }, pending: { recien: { create: true } } })
  assert.deepEqual(p, { mark: [], unmark: [], remove: [] })
})

test('fotos: si falta el texto de una nota (caja cerrada, aún bajando) o no está al día, no se decide nada', () => {
  assert.equal(plan([nota('n1'), nota('cerrada', { protegida: 'true' }), img('x', { sin_uso: ago(60) })], { n1: '<p>a</p>' }), null)
  assert.equal(plan([nota('n1'), img('x')], { n1: '<p>a</p>' }, { base: { n1: 't0' } }), null) // en Drive hay una más nueva sin bajar
  // la de aquí es la más nueva (cambios sin subir): sí se decide
  assert.deepEqual(plan([nota('n1'), img('x')], { n1: '<p>a</p>' }, { base: { n1: 't0' }, pending: { n1: { content: true } } }), { mark: ['x'], unmark: [], remove: [] })
})

test('foto quitada de la nota: se marca en Drive y al día siguiente se borra de Drive y del aparato', async () => {
  const db = await import('./db.ts')
  const drive = fakeDrive()
  drive.note('n1', 'Recibo', '<p>pago</p><img src="drive:p1">')
  drive.files.set('p1', { id: 'p1', name: 'foto.jpg', modifiedTime: drive.tick(), mimeType: 'image/jpeg', appProperties: { kind: 'image' }, body: 'JPG' })
  await store.start('fotos@test')
  await store.sync()
  await db.set('img:p1', 'JPG')
  store.cleanPhotos(Date.now())
  await store.sync()
  assert.equal(drive.files.get('p1')!.appProperties?.sin_uso, undefined) // en uso: no se toca
  store.edit('n1', { text: '<p>pago</p>' })
  await store.sync()
  store.cleanPhotos(Date.now())
  await store.sync()
  assert.ok(drive.files.get('p1')!.appProperties?.sin_uso, 'queda marcada sin uso')
  store.cleanPhotos(Date.now() + 0.5 * DAY)
  await store.sync()
  assert.equal(drive.files.has('p1'), true) // el mismo día todavía se puede deshacer
  store.cleanPhotos(Date.now() + 1.1 * DAY)
  await store.sync()
  assert.equal(drive.files.has('p1'), false)
  assert.equal(await db.get('img:p1'), undefined)
})

test('foto borrada en otro aparato: su copia local se queda si una nota de aquí la volvió a usar sin internet', async () => {
  const db = await import('./db.ts')
  const drive = fakeDrive()
  const foto = (id: string) => drive.files.set(id, { id, name: 'foto.jpg', modifiedTime: drive.tick(), mimeType: 'image/jpeg', appProperties: { kind: 'image' }, body: 'JPG' })
  drive.note('n1', 'Recibo', '<p>pago</p>')
  foto('p2')
  foto('p3')
  await store.start('rescate@test')
  await store.sync()
  await db.set('img:p2', 'JPG')
  await db.set('img:p3', 'JPG')
  drive.setOnline(false)
  store.edit('n1', { text: '<p>pago</p><img src="drive:p2">' }) // la vuelve a usar sin internet
  drive.files.delete('p2') // otro aparato borró las dos
  drive.files.delete('p3')
  drive.setOnline(true)
  await store.sync()
  assert.equal(await db.get('img:p2'), 'JPG') // la nota la muestra: no se pierde aquí
  assert.equal(await db.get('img:p3'), undefined) // nadie la usa: se libera el espacio
})

test('nota que sale del basurero para siempre: sus fotos se van con ella, salvo las que usa otra nota (una plantilla)', async () => {
  const drive = fakeDrive()
  const foto = (id: string) => drive.files.set(id, { id, name: 'foto.jpg', modifiedTime: drive.tick(), mimeType: 'image/jpeg', appProperties: { kind: 'image' }, body: 'JPG' })
  drive.note('n1', 'Cotización', '<p>Sr. Pérez</p><img src="drive:p4"><img src="drive:p5">')
  drive.files.get('n1')!.appProperties = { kind: 'note', borrada: new Date().toISOString(), cover: 'p6' }
  drive.note('n2', 'Plantilla', '<img src="drive:p5">')
  for (const id of ['p4', 'p5', 'p6']) foto(id)
  await store.start('basurero@test')
  await store.sync()
  store.remove('n1') // vaciar el basurero, o pasaron sus 30 días
  await store.sync()
  store.cleanPhotos(Date.now())
  await store.sync()
  assert.equal(drive.files.has('p4'), false)
  assert.equal(drive.files.has('p6'), false) // su portada también
  assert.equal(drive.files.has('p5'), true) // la plantilla la usa
  assert.equal(drive.files.get('p5')!.appProperties?.sin_uso ?? null, null)
})

test('nota con clave cerrada: la limpieza usa los números de foto que anotó el aparato, sin abrir la clave ni guardar texto', async () => {
  const vault = await import('./vault.ts')
  const db = await import('./db.ts')
  const drive = fakeDrive()
  const foto = (id: string) => drive.files.set(id, { id, name: 'foto.jpg', modifiedTime: drive.tick(), mimeType: 'image/jpeg', appProperties: { kind: 'image' }, body: 'JPG' })
  drive.note('n1', 'Cédula', '<p>número 1234</p><img src="drive:p7">')
  foto('p7')
  foto('p8')
  await store.start('cajafotos@test')
  await store.sync()
  await vault.create('clave-larga-2')
  store.patch('n1', { props: { protegida: 'true' } })
  await store.sync()
  await new Promise(r => setTimeout(r, 50))
  store.closeVault()
  assert.equal(store.getState().texts.n1, undefined) // cerrada: su texto no está en memoria
  assert.deepEqual(await db.get('refs:n1'), ['p7']) // solo el número de la foto
  assert.doesNotMatch(JSON.stringify(await db.get('refs:n1')), /1234/)
  store.cleanPhotos(Date.now())
  await store.sync()
  assert.equal(drive.files.get('p7')!.appProperties?.sin_uso, undefined) // la usa la nota con clave
  assert.ok(drive.files.get('p8')!.appProperties?.sin_uso, 'la que nadie usa sí se marca')
})

// En este Drive de mentira todo se guarda con fechas de enero: para la app, cada nota lleva más de 10 minutos quieta.
const versionText = (noteId: string) => store.getState().texts[store.versionOf(noteId)?.id ?? '']?.text
const versions = () => Object.values(store.getState().files).filter(f => f.appProperties?.kind === 'version')

test('versión anterior: al empezar a cambiar una nota quieta se guarda cómo estaba; seguir escribiendo no la cambia; la próxima vez se reemplaza', async () => {
  const drive = fakeDrive()
  drive.note('n1', 'Lista', '<p>pan</p>')
  await store.start('version@test')
  await store.sync()
  store.edit('n1', { text: '<p>pan y leche</p>' })
  assert.equal(versionText('n1'), '<p>pan</p>')
  store.edit('n1', { text: '<p>pan, leche y huevos</p>' })
  assert.equal(versionText('n1'), '<p>pan</p>') // en el mismo rato no cambia
  await store.sync()
  const v = store.versionOf('n1')!
  assert.equal(drive.files.get(v.id)?.body, '<p>pan</p>') // también queda en Drive
  assert.equal(drive.files.get(v.id)?.appProperties?.kind, 'version')
  store.edit('n1', { text: '<p>solo huevos</p>' }) // otra vez, ya guardada y quieta: se reemplaza
  assert.equal(versionText('n1'), '<p>pan, leche y huevos</p>')
  assert.equal(versions().length, 1) // una sola por nota
})

test('versión anterior: una nota cambiada hace menos de 10 minutos no guarda otra', async () => {
  fakeDrive()
  await store.start('version-reciente@test')
  await store.sync()
  const id = store.create({ kind: 'note', notebook: 'nb' }, 'Nueva', '<p>x</p>', 'text/html')
  store.edit(id, { text: '<p>xy</p>' })
  assert.equal(store.versionOf(id), undefined)
})

test('restaurar: la nota vuelve a como estaba y lo de ahora queda como versión anterior (restaurar otra vez lo deshace)', async () => {
  const drive = fakeDrive()
  drive.note('n1', 'Plan', '<p>uno</p>')
  await store.start('restaurar@test')
  await store.sync()
  store.edit('n1', { text: '<p>dos</p>' })
  const back = await store.loadVersion('n1')
  assert.equal(back?.text, '<p>uno</p>')
  store.restoreVersion('n1', back!)
  assert.equal(store.getState().texts.n1.text, '<p>uno</p>')
  assert.equal(versionText('n1'), '<p>dos</p>')
  store.restoreVersion('n1', (await store.loadVersion('n1'))!)
  assert.equal(store.getState().texts.n1.text, '<p>dos</p>')
  await store.sync()
  assert.equal(drive.files.get('n1')?.body, '<p>dos</p>')
})

test('la versión no es una nota: no protege fotos (decisión de David) y se borra con su nota', async () => {
  const drive = fakeDrive()
  drive.note('n1', 'Recibo', '<p>a</p><img src="drive:p9">')
  drive.files.set('p9', { id: 'p9', name: 'foto.jpg', modifiedTime: drive.tick(), mimeType: 'image/jpeg', appProperties: { kind: 'image' }, body: 'JPG' })
  await store.start('version-fotos@test')
  await store.sync()
  store.edit('n1', { text: '<p>a</p>' }) // se quita la foto; la versión todavía la nombra
  await store.sync()
  assert.match(versionText('n1') ?? '', /drive:p9/)
  assert.deepEqual(store.photoPlan(store.getState(), Date.now())?.mark, ['p9'])
  const v = store.versionOf('n1')!
  store.remove('n1')
  await store.sync()
  assert.equal(store.versionOf('n1'), undefined)
  assert.equal(drive.files.has(v.id), false)
})

test('nota con clave: su versión anterior también va cifrada en el aparato', async () => {
  const vault = await import('./vault.ts')
  const db = await import('./db.ts')
  const drive = fakeDrive()
  drive.note('n1', 'Banco', '<p>PIN 4321</p>')
  await store.start('version-clave@test')
  await store.sync()
  store.edit('n1', { text: '<p>PIN 9999</p>' }) // la versión guarda el PIN viejo
  await store.sync()
  await vault.create('clave-larga-3')
  store.patch('n1', { props: { protegida: 'true' } }) // al ponerle clave a la nota, su versión también la lleva
  await store.sync()
  await new Promise(r => setTimeout(r, 50))
  const v = store.versionOf('n1')!
  assert.equal(v.appProperties?.protegida, 'true')
  const local = await db.get(`text:${v.id}`)
  assert.ok(vault.isSealed(local), 'en el aparato queda cifrada')
  assert.doesNotMatch(JSON.stringify(local), /4321/)
  store.closeVault()
})

test('restaurar sin las fotos que ya se borraron', () => {
  assert.deepEqual(store.withoutMissingPhotos('<p>a</p><img src="drive:p1"><img src="drive:p2" alt="">', id => id === 'p1'),
    { html: '<p>a</p><img src="drive:p1">', removed: 1 })
})

test('fotos: se procesan de a 30 por vuelta y lo que falta sigue en la siguiente', async () => {
  const drive = fakeDrive()
  drive.note('n1', 'Sin fotos', '<p>x</p>')
  for (let i = 0; i < 35; i++) drive.files.set(`q${i}`, { id: `q${i}`, name: 'foto.jpg', modifiedTime: drive.tick(), mimeType: 'image/jpeg', appProperties: { kind: 'image' }, body: '' })
  await store.start('lote@test')
  await store.sync()
  const marked = () => Object.values(store.getState().files).filter(f => f.appProperties?.sin_uso).length
  assert.equal(store.cleanPhotos(Date.now()), false)
  assert.equal(marked(), 30)
  assert.equal(store.cleanPhotos(Date.now()), true)
  assert.equal(marked(), 35)
  await store.sync()
})

test('nota con clave: en el aparato va cifrada, con la caja cerrada no está en memoria ni se baja, y Drive queda sin cifrar', async () => {
  const vault = await import('./vault.ts')
  const db = await import('./db.ts')
  const drive = fakeDrive()
  drive.note('n1', 'Cuentas', '<p>IESS Clave: Ab#2026</p>')
  await store.start('caja@test')
  await store.sync()
  assert.match(JSON.stringify(await db.get('text:n1')), /Ab#2026/) // nota normal: en claro
  const v = await vault.create('clave-larga')
  store.patch('n1', { props: { protegida: 'true' } })
  await store.sync()
  await new Promise(r => setTimeout(r, 50))
  const local = await db.get('text:n1')
  assert.ok(vault.isSealed(local), 'en el aparato queda cifrada')
  assert.doesNotMatch(JSON.stringify(local), /Ab#2026/)
  assert.match(drive.files.get('n1')!.body, /Ab#2026/) // Drive: respaldo sin cifrar
  assert.equal(drive.files.get('n1')!.appProperties?.protegida, 'true')
  store.closeVault()
  assert.equal(store.getState().texts.n1, undefined) // cerrada: fuera de memoria
  // cambio desde otro aparato con la caja cerrada: no se baja
  drive.files.get('n1')!.body = '<p>IESS Clave: Nueva#1</p>'
  drive.files.get('n1')!.modifiedTime = drive.tick()
  await store.sync()
  assert.equal(store.getState().texts.n1, undefined)
  // al abrir: se baja lo nuevo y se guarda cifrado
  assert.equal(await vault.unlock('clave-larga', v), true)
  await store.openVault()
  await store.sync()
  assert.match(store.getState().texts.n1.text, /Nueva#1/)
  await new Promise(r => setTimeout(r, 50))
  assert.ok(vault.isSealed(await db.get('text:n1')))
  store.closeVault()
})
