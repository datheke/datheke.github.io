import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as vault from './vault.ts'

test('clave nueva: abre, cifra y descifra; el verificador no lleva la clave', async () => {
  const v = await vault.create('mi clave segura')
  assert.match(v, /^1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/)
  assert.doesNotMatch(v, /segura/)
  assert.ok(vault.unlocked())
  const sealed = await vault.seal({ title: 'Cuentas', text: '<p>IESS Clave: Ab#2026</p>' })
  assert.ok(vault.isSealed(sealed))
  assert.doesNotMatch(JSON.stringify(sealed), /Ab#2026|IESS/)
  assert.deepEqual(await vault.open(sealed), { title: 'Cuentas', text: '<p>IESS Clave: Ab#2026</p>' })
  vault.lock()
  assert.equal(vault.unlocked(), false)
  assert.equal(await vault.open(sealed), null) // cerrada: no se puede leer
})

test('clave equivocada no abre; la correcta sí, también con la llave guardada tras la huella', async () => {
  const v = await vault.create('correcta1')
  const bits = vault.keyBits()
  const sealed = await vault.seal({ title: 't', text: 'x' })
  vault.lock()
  assert.equal(await vault.unlock('otra-cosa', v), false)
  assert.equal(vault.unlocked(), false)
  assert.equal(await vault.unlock('correcta1', v), true)
  assert.equal((await vault.open(sealed))?.text, 'x')
  vault.lock()
  assert.equal(await vault.unlockWithBits(bits, v), true)
  vault.lock()
})

test('si la clave se cambió (otro aparato), lo cifrado con la vieja no se abre: se vuelve a bajar', async () => {
  await vault.create('vieja-clave')
  const old = await vault.seal({ title: 't', text: 'x' })
  const v2 = await vault.create('nueva-clave')
  assert.equal(await vault.open(old), null)
  vault.lock()
  assert.equal(await vault.unlock('vieja-clave', v2), false)
})

test('clave muy corta se rechaza', async () => {
  await assert.rejects(vault.create('123'), /al menos 6/)
})

test('clave común de una compartida: convive con tu clave y se abre por separado', async () => {
  const mine = await vault.create('mi-clave-1')
  const comun = await vault.create('clave-de-los-dos', false)
  const sm = vault.saltOf(mine)!, sc = vault.saltOf(comun)!
  const a = await vault.seal({ title: 'mía', text: '1' })
  const b = await vault.seal({ title: 'compartida', text: '2' }, sc)
  assert.equal(vault.unlocked(), true)
  vault.lock()
  assert.equal(await vault.unlock('clave-de-los-dos', comun, false), true)
  assert.equal(vault.unlocked(), false) // tu clave sigue cerrada
  assert.equal(vault.hasKey(sc), true)
  assert.deepEqual(await vault.open(b), { title: 'compartida', text: '2' })
  assert.equal(await vault.open(a), null)
  assert.equal(vault.hasKey(sm), false)
  vault.lock()
})
