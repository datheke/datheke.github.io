import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OLD, upload, ZIP } from './backup.ts'
import { AuthError, dathekeFolder, HOME, listFiles, readNote, README, saveFile, setToken } from './drive.ts'

function mockFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return responses.shift()! }
  return calls
}
const json = (data: unknown) => new Response(JSON.stringify(data))
const bodyOf = (init: RequestInit) => new Response(init.body).text()

test('listFiles recorre todas las páginas', async () => {
  const calls = mockFetch(json({ files: [{ id: 'a' }], nextPageToken: 'p2' }), json({ files: [{ id: 'b' }] }))
  assert.deepEqual((await listFiles()).map(f => f.id), ['a', 'b'])
  assert.match(calls[1].url, /pageToken=p2/)
})

test('nota nueva va a la carpeta oculta; una existente se sobrescribe en el mismo archivo', async () => {
  const calls = mockFetch(json({ id: 'n1' }), json({ id: 'n1' }))
  await saveFile(undefined, { name: 'Nota' }, 'hola')
  await saveFile('n1', { name: 'Nota' }, 'chau')
  assert.equal(calls[0].init.method, 'POST')
  assert.match(await bodyOf(calls[0].init), /"mimeType":"text\/html","parents":\["appDataFolder"\][\s\S]*hola/)
  assert.equal(calls[1].init.method, 'PATCH')
  assert.match(calls[1].url, /files\/n1\?/)
  assert.doesNotMatch(await bodyOf(calls[1].init), /parents/) // Drive rechaza "parents" en un PATCH
})

test('una foto sube como archivo aparte con su tipo de imagen', async () => {
  const calls = mockFetch(json({ id: 'f1' }))
  await saveFile(undefined, { name: 'foto.jpg', appProperties: { kind: 'image' } }, new Blob(['JPG'], { type: 'image/jpeg' }))
  assert.match(await bodyOf(calls[0].init), /"mimeType":"image\/jpeg"[\s\S]*Content-Type: image\/jpeg\r\n\r\nJPG/)
})

test('notas viejas de texto plano se abren como HTML escapado; las nuevas tal cual', async () => {
  mockFetch(new Response('a < b\nhola'), new Response('<p>x</p>'))
  assert.equal(await readNote('n1', 'text/plain'), '<p>a &lt; b</p><p>hola</p>')
  assert.equal(await readNote('n2', 'text/html'), '<p>x</p>')
})

test('sesión vencida (401) se informa como AuthError', async () => {
  mockFetch(new Response('', { status: 401 }))
  await assert.rejects(listFiles(), AuthError)
})

// "Mi unidad" de mentira: carpetas y archivos con sus padres; entiende las búsquedas y movidas que hace drive.ts.
type Item = { id: string; name: string; folder?: boolean; parents: string[]; created: string }
function fakeMyDrive(start: Partial<Item>[] = [], opts: { failUploads?: boolean } = {}) {
  const items = start.map(f => ({ parents: ['root'], created: '2026-10-01T00:00:00Z', ...f }) as Item)
  let n = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const id = url.pathname.split('/files/')[1]
    if (method === 'DELETE') { items.splice(items.findIndex(f => f.id === id), 1); return new Response(null, { status: 204 }) }
    if (method === 'POST' && url.searchParams.get('uploadType') === 'multipart' && opts.failUploads) return new Response('sin internet', { status: 503 })
    if (method === 'GET' && !id) {
      const q = url.searchParams.get('q') ?? ''
      const name = q.match(/name='((?:\\'|[^'])*)'/)?.[1].replace(/\\'/g, "'")
      const parent = q.match(/'([^']+)' in parents/)?.[1]
      const onlyFolders = q.includes("mimeType='application/vnd.google-apps.folder'")
      const found = items.filter(f => (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!onlyFolders || f.folder))
        .sort((a, b) => a.created.localeCompare(b.created))
      if (url.searchParams.get('orderBy') === 'createdTime desc') found.reverse()
      return json({ files: found.map(f => ({ id: f.id, name: f.name, modifiedTime: f.created })) })
    }
    if (method === 'GET') return json({ parents: items.find(f => f.id === id)?.parents })
    if (method === 'PATCH') {
      const f = items.find(f => f.id === id)!
      const remove = url.searchParams.get('removeParents')?.split(',') ?? []
      f.parents = [...f.parents.filter(p => !remove.includes(p)), ...(url.searchParams.get('addParents') ? [url.searchParams.get('addParents')!] : [])]
      const body = JSON.parse(String(init.body ?? '{}'))
      if (body.name) f.name = body.name
      return json({ id })
    }
    const text = await new Response(init.body).text()
    const meta = JSON.parse(url.searchParams.get('uploadType') === 'multipart' ? text.split('\r\n\r\n')[1].split('\r\n')[0] : text)
    const f: Item = { id: `nuevo${n++}`, name: meta.name, folder: meta.mimeType === 'application/vnd.google-apps.folder', parents: meta.parents ?? ['root'], created: `2026-11-06T00:00:${String(n).padStart(2, '0')}Z` }
    items.push(f)
    return json({ id: f.id })
  }
  return items
}

test('cuenta que ya tenía carpetas: se juntan en «Datheke – importante, no borrar» con su LÉEME, sin borrar ni mover lo de adentro', async () => {
  setToken('cuenta-con-carpetas')
  const items = fakeMyDrive([
    { id: 'R', name: 'Datheke', folder: true }, { id: 'Z', name: 'Datheke – respaldo.zip', parents: ['R'] },
    { id: 'C', name: 'Datheke – notas compartidas', folder: true }, { id: 'N1', name: 'Pedidos', parents: ['C'] },
  ])
  assert.equal(await dathekeFolder('respaldos'), 'R')
  assert.equal(await dathekeFolder('compartidas'), 'C')
  const home = items.filter(f => f.name === HOME)
  assert.equal(home.length, 1)
  assert.deepEqual(items.find(f => f.id === 'R'), { id: 'R', name: 'Respaldos', folder: true, parents: [home[0].id], created: '2026-10-01T00:00:00Z' })
  assert.deepEqual(items.find(f => f.id === 'C')?.parents, [home[0].id])
  assert.equal(items.find(f => f.id === 'C')?.name, 'Notas compartidas')
  assert.deepEqual(items.find(f => f.id === 'Z')?.parents, ['R']) // el respaldo sigue en su carpeta
  assert.deepEqual(items.find(f => f.id === 'N1')?.parents, ['C']) // la nota compartida también
  assert.equal(items.filter(f => f.name === README && f.parents.includes(home[0].id)).length, 1)
  const count = items.length
  assert.equal(await dathekeFolder('respaldos'), 'R') // la segunda vez no crea ni mueve nada
  assert.equal(items.length, count)
})

test('cuenta nueva: la carpeta, sus dos subcarpetas y el LÉEME se crean una sola vez, aunque se pidan a la vez', async () => {
  setToken('cuenta-nueva')
  const items = fakeMyDrive()
  const [r, c] = await Promise.all([dathekeFolder('respaldos'), dathekeFolder('compartidas')])
  const home = items.filter(f => f.name === HOME)
  assert.equal(home.length, 1)
  assert.deepEqual(items.find(f => f.id === r)?.parents, [home[0].id])
  assert.deepEqual(items.find(f => f.id === c)?.parents, [home[0].id])
  assert.equal(items.filter(f => f.name === README).length, 1)
})

test('carpeta de antes que creó otro aparato con la versión vieja: va adentro, para que nada quede suelto', async () => {
  setToken('cuenta-con-aparato-viejo')
  const items = fakeMyDrive([
    { id: 'H', name: HOME, folder: true }, { id: 'R', name: 'Respaldos', folder: true, parents: ['H'] }, { id: 'L', name: README, parents: ['H'] },
    { id: 'S', name: 'Datheke', folder: true }, { id: 'Z', name: ZIP, parents: ['S'] },
  ])
  assert.equal(await dathekeFolder('respaldos'), 'R')
  assert.deepEqual(items.find(f => f.id === 'S'), { id: 'S', name: 'Datheke (de otro aparato)', folder: true, parents: ['R'], created: '2026-10-01T00:00:00Z' })
  assert.deepEqual(items.find(f => f.id === 'Z')?.parents, ['S']) // su respaldo sigue adentro
})

test('respaldo sin internet a medias: si no se pudo subir el nuevo, los que había siguen ahí', async () => {
  setToken('cuenta-respaldo')
  const start = [
    { id: 'H', name: HOME, folder: true }, { id: 'R', name: 'Respaldos', folder: true, parents: ['H'] }, { id: 'L', name: README, parents: ['H'] },
    { id: 'A', name: ZIP, parents: ['R'], created: '2026-10-30T10:00:00Z' }, { id: 'B', name: OLD, parents: ['R'], created: '2026-10-23T10:00:00Z' },
  ]
  let items = fakeMyDrive(start.map(f => ({ ...f })), { failUploads: true })
  await assert.rejects(upload(new Uint8Array([1])))
  assert.deepEqual(items.filter(f => f.parents.includes('R')).map(f => `${f.id}:${f.name}`), [`A:${ZIP}`, `B:${OLD}`])
  items = fakeMyDrive(start.map(f => ({ ...f })))
  await upload(new Uint8Array([1]))
  const inside = items.filter(f => f.parents.includes('R'))
  assert.deepEqual(inside.filter(f => f.name === OLD).map(f => f.id), ['A']) // el de la semana pasada pasa a anterior
  assert.equal(inside.filter(f => f.name === ZIP).length, 1) // y queda un solo actual, el nuevo
  assert.equal(inside.length, 2)
})
