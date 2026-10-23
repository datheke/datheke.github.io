import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AuthError, listFiles, saveFile } from './drive.ts'

function mockFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return responses.shift()! }
  return calls
}
const json = (data: unknown) => new Response(JSON.stringify(data))

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
  assert.match(String(calls[0].init.body), /"parents":\["appDataFolder"\][\s\S]*hola/)
  assert.equal(calls[1].init.method, 'PATCH')
  assert.match(calls[1].url, /files\/n1\?/)
  assert.doesNotMatch(String(calls[1].init.body), /parents/) // Drive rechaza "parents" en un PATCH
})

test('sesión vencida (401) se informa como AuthError', async () => {
  mockFetch(new Response('', { status: 401 }))
  await assert.rejects(listFiles(), AuthError)
})
