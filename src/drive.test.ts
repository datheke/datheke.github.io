import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AuthError, dathekeFolder, HOME, listFiles, readNote, README, saveFile } from './drive.ts'

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
function fakeMyDrive(start: Partial<Item>[] = []) {
  const items = start.map(f => ({ parents: ['root'], created: '2026-10-01T00:00:00Z', ...f }) as Item)
  let n = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const id = url.pathname.split('/files/')[1]
    if (method === 'GET' && !id) {
      const q = url.searchParams.get('q') ?? ''
      const name = q.match(/name='((?:\\'|[^'])*)'/)?.[1].replace(/\\'/g, "'")
      const parent = q.match(/'([^']+)' in parents/)?.[1]
      const onlyFolders = q.includes("mimeType='application/vnd.google-apps.folder'")
      const found = items.filter(f => (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!onlyFolders || f.folder))
        .sort((a, b) => a.created.localeCompare(b.created))
      if (url.searchParams.get('orderBy') === 'createdTime desc') found.reverse()
      return json({ files: found.map(f => ({ id: f.id, name: f.name })) })
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
  const items = fakeMyDrive()
  const [r, c] = await Promise.all([dathekeFolder('respaldos'), dathekeFolder('compartidas')])
  const home = items.filter(f => f.name === HOME)
  assert.equal(home.length, 1)
  assert.deepEqual(items.find(f => f.id === r)?.parents, [home[0].id])
  assert.deepEqual(items.find(f => f.id === c)?.parents, [home[0].id])
  assert.equal(items.filter(f => f.name === README).length, 1)
})
