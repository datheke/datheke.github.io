import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isFromApp } from './paste.ts'

test('lo copiado de otra nota de la app se reconoce', () => {
  assert.equal(isFromApp('<p data-pm-slice="1 1 []"><span style="color: red">hola</span></p>'), true)
  assert.equal(isFromApp('<p style="font-family: Calibri">hola</p>'), false)
})

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}

test('copia completa: se usa si se pega el mismo texto, aunque el teclado cambie espacios y saltos', async () => {
  const { rememberCopy, copiedHtml } = await import('./paste.ts')
  const store = memory()
  rememberCopy('<ul data-type="taskList"><li data-checked="true">Seguro: 85</li></ul><hr>', 'Seguro: 85\n\nLuz: 25', store)
  assert.match(copiedHtml('Seguro: 85\nLuz: 25', store) ?? '', /data-checked="true"/)
  assert.match(copiedHtml('  Seguro: 85\n\n\n\nLuz: 25 ', store) ?? '', /taskList/)
  assert.equal(copiedHtml('Seguro: 86\nLuz: 25', store), null)
  assert.equal(copiedHtml('otra cosa', memory()), null)
  rememberCopy('<p></p>', '  ', store) // copiar algo vacío borra la copia anterior
  assert.equal(copiedHtml('Seguro: 85\nLuz: 25', store), null)
})

test('pegar sin formato: un renglón por línea, sin renglones vacíos de más', async () => {
  const { tidyText } = await import('./paste.ts')
  assert.equal(tidyText('Seguro: 85\n\n\n\nPasaporte: 90  \r\n\r\n  \nPago tarjeta: 120\n'), 'Seguro: 85\nPasaporte: 90\nPago tarjeta: 120')
  assert.equal(tidyText('  sangría se queda'), '  sangría se queda')
})
