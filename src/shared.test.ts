import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gone, invite, joinExtra, LEFT, leave, sameEmail, setRole, sharedStep, splitExtra, whoLeft } from './shared.ts'

test('ícono y portada viajan en un comentario al final y se separan del texto', () => {
  const body = '<p>Leche</p><p>Pan</p>'
  const full = joinExtra(body, { icono: '🛒', portada: 'data:image/jpeg;base64,AAAA' })
  assert.match(full, /<!--datheke:/)
  assert.deepEqual(splitExtra(full), { body, extra: { icono: '🛒', portada: 'data:image/jpeg;base64,AAAA' } })
  assert.equal(joinExtra(body, {}), body)
  assert.deepEqual(splitExtra(body), { body, extra: {} })
})

// Google de mentira: guarda cada llamada y responde lo que diga `reply` (por defecto 200 con {}).
type Req = { method: string; url: URL; body: Record<string, unknown> | undefined }
function fakeGoogle(reply: (r: Req) => Response | undefined = () => undefined) {
  const reqs: Req[] = []
  globalThis.fetch = async (input, init = {}) => {
    const r = { method: init.method ?? 'GET', url: new URL(String(input)), body: init.body ? JSON.parse(String(init.body)) : undefined }
    reqs.push(r)
    return reply(r) ?? new Response('{}', { status: 200 })
  }
  return reqs
}

test('compartir para ver o para editar: Google recibe el permiso elegido y el correo lo dice', async () => {
  const reqs = fakeGoogle()
  await invite('F1', ['ana@gmail.com'], 'Pedidos', 'ver')
  await invite('F1', ['luis@gmail.com'], 'Pedidos', 'editar')
  assert.equal(reqs[0].body?.role, 'commenter') // "solo ver": Google no la deja cambiar
  assert.equal(reqs[0].body?.emailAddress, 'ana@gmail.com')
  assert.match(reqs[0].url.searchParams.get('emailMessage') ?? '', /solo para verla/)
  assert.equal(reqs[1].body?.role, 'writer')
  assert.doesNotMatch(reqs[1].url.searchParams.get('emailMessage') ?? '', /solo para verla/)
})

test('cambiar el permiso de una persona: de editar a solo ver y al revés', async () => {
  const reqs = fakeGoogle()
  await setRole('F1', 'P9', 'ver')
  await setRole('F1', 'P9', 'editar')
  assert.equal(reqs[0].method, 'PATCH')
  assert.match(reqs[0].url.pathname, /\/files\/F1\/permissions\/P9$/)
  assert.deepEqual(reqs[0].body, { role: 'commenter' })
  assert.deepEqual(reqs[1].body, { role: 'writer' })
})

test('salir de una nota: se quita su propio permiso; si Google no lo deja, deja el aviso para el dueño', async () => {
  const me = (r: Req) => r.url.pathname.endsWith('/about') ? new Response(JSON.stringify({ user: { permissionId: 'P7' } })) : undefined
  let reqs = fakeGoogle(r => me(r) ?? (r.method === 'DELETE' ? new Response('no', { status: 403 }) : undefined))
  await leave('F1')
  const del = reqs.find(r => r.method === 'DELETE')
  assert.match(del?.url.pathname ?? '', /\/files\/F1\/permissions\/P7$/)
  const note = reqs.find(r => r.method === 'POST')
  assert.match(note?.url.pathname ?? '', /\/files\/F1\/comments$/)
  assert.equal(note?.body?.content, LEFT)
  reqs = fakeGoogle(r => me(r) ?? (r.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined))
  await leave('F1')
  assert.equal(reqs.some(r => r.method === 'POST'), false) // Google lo dejó salir: no hace falta aviso
})

test('aviso de salida: solo saca a quien lo escribió, después de su última invitación, y nunca al dueño', () => {
  const people = [
    { id: 'P0', emailAddress: 'david@gmail.com', role: 'owner' },
    { id: 'P1', emailAddress: 'ana@gmail.com', role: 'commenter' },
    { id: 'P2', emailAddress: 'luis@gmail.com', role: 'commenter' },
    { id: 'P3', emailAddress: 'eva@gmail.com', role: 'writer' },
  ]
  const comments = [
    { content: LEFT, createdTime: '2026-11-06T10:00:00Z', author: { permissionId: 'P1' } }, // ana se salió
    { content: LEFT, createdTime: '2026-11-01T10:00:00Z', author: { permissionId: 'P2' } }, // luis se salió, pero lo volvieron a invitar después
    { content: 'Qué buena lista', createdTime: '2026-11-06T10:00:00Z', author: { permissionId: 'P3' } }, // no es un aviso
    { content: LEFT, createdTime: '2026-11-06T10:00:00Z', author: { permissionId: 'P0' } }, // el dueño no se saca solo
  ]
  const invited = { 'luis@gmail.com': '2026-11-03T10:00:00Z', 'ana@gmail.com': '2026-11-02T10:00:00Z' }
  assert.deepEqual(whoLeft(comments, people, email => invited[email as keyof typeof invited]).map(p => p.id), ['P1'])
})

test('sincronizar una compartida: quien solo puede ver nunca sube; sus cambios sueltos quedan aparte y recibe la del dueño', () => {
  const ver = { canEdit: false }
  assert.equal(sharedStep({ ...ver, dirty: false, remoteChanged: true, same: false }), 'bajar')
  assert.equal(sharedStep({ ...ver, dirty: true, remoteChanged: false, same: false }), 'bajar-y-guardar-la-mia')
  assert.equal(sharedStep({ ...ver, dirty: true, remoteChanged: true, same: false }), 'bajar-y-guardar-la-mia')
  assert.equal(sharedStep({ ...ver, dirty: true, remoteChanged: false, same: true }), 'bajar')
  assert.equal(sharedStep({ ...ver, dirty: false, remoteChanged: false, same: true }), 'nada')
  const editar = { canEdit: true }
  assert.equal(sharedStep({ ...editar, dirty: true, remoteChanged: false, same: false }), 'subir')
  assert.equal(sharedStep({ ...editar, dirty: true, remoteChanged: true, same: false }), 'las-dos')
  assert.equal(sharedStep({ ...editar, dirty: false, remoteChanged: true, same: false }), 'bajar')
  assert.equal(sharedStep({ ...editar, dirty: false, remoteChanged: false, same: true }), 'nada')
})

test('se salió quien ya no tiene permiso en Google (con "Puede editar" se quita solo, sin dejar aviso)', () => {
  const people = [
    { id: 'P0', emailAddress: 'david@gmail.com', role: 'owner' },
    { id: 'P1', emailAddress: 'kary.morales@gmail.com', role: 'writer' }, // Google lo escribe con punto
  ]
  assert.deepEqual(gone(['KaryMorales@gmail.com', 'karina@gmail.com', 'luis@empresa.com'], people), ['karina@gmail.com', 'luis@empresa.com'])
  assert.deepEqual(gone([], people), [])
  assert.ok(sameEmail('ana.paz+datheke@googlemail.com', 'anapaz@gmail.com'))
  assert.ok(!sameEmail('ana.paz@empresa.com', 'anapaz@empresa.com')) // fuera de Gmail el punto sí cuenta
  assert.ok(!sameEmail(undefined, 'ana@gmail.com'))
})
