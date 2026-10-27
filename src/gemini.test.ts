import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OfflineError } from './drive.ts'
import { ask, askAudio, checkKey, clean, encodeWav, GeminiError, MODELS } from './gemini.ts'

function mockFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses.shift()!
    if (r instanceof Error) throw r
    return r
  }
  return calls
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const answer = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }] })

test('pide la tarea con la clave en la cabecera (no en la dirección) y devuelve el HTML', async () => {
  const calls = mockFetch(answer('<p>Hola</p>'))
  assert.equal(await ask('Corrige', '<p>ola</p>', 'clave1'), '<p>Hola</p>')
  assert.match(calls[0].url, new RegExp(`${MODELS[0]}:generateContent$`))
  assert.equal((calls[0].init.headers as Record<string, string>)['x-goog-api-key'], 'clave1')
  assert.match(String(calls[0].init.body), /Corrige[\s\S]*<p>ola<\/p>/)
})

test('si un modelo ya no existe prueba el siguiente', async () => {
  const calls = mockFetch(json({}, 404), answer('<p>ok</p>'))
  assert.equal(await ask('x', 'y', 'k'), '<p>ok</p>')
  assert.match(calls[1].url, new RegExp(MODELS[1]))
})

test('quita los ``` con que a veces viene envuelta la respuesta', () => {
  assert.equal(clean('```html\n<p>a</p>\n```'), '<p>a</p>')
  assert.equal(clean('<p>b</p>'), '<p>b</p>')
})

test('errores en palabras simples: límite gratis, clave mala, sin internet', async () => {
  mockFetch(json({ error: { message: 'Quota exceeded' } }, 429))
  await assert.rejects(ask('x', 'y', 'k'), (e: Error) => e instanceof GeminiError && /límite/.test(e.message))
  mockFetch(json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400))
  await assert.rejects(ask('x', 'y', 'k'), (e: Error) => e instanceof GeminiError && /clave/.test(e.message))
  mockFetch(new TypeError('Failed to fetch'))
  await assert.rejects(ask('x', 'y', 'k'), OfflineError)
})

test('sin clave no llama a Google', async () => {
  const calls = mockFetch()
  await assert.rejects(ask('x', 'y', ''), GeminiError)
  assert.equal(calls.length, 0)
})

test('respuesta bloqueada o vacía avisa', async () => {
  mockFetch(json({ promptFeedback: { blockReason: 'SAFETY' } }))
  await assert.rejects(ask('x', 'y', 'k'), /no quiso/)
  mockFetch(json({ candidates: [{ content: { parts: [] } }] }))
  await assert.rejects(ask('x', 'y', 'k'), /no devolvió/)
})

test('el dictado va como WAV junto con la instrucción', async () => {
  const calls = mockFetch(answer('<p>Comprar pan</p>'))
  assert.equal(await askAudio('QUJD', 'k'), '<p>Comprar pan</p>')
  const parts = JSON.parse(String(calls[0].init.body)).contents[0].parts
  assert.equal(parts[1].inlineData.mimeType, 'audio/wav')
  assert.equal(parts[1].inlineData.data, 'QUJD')
})

test('con la nota vacía el pedido va solo (Gemini crea desde cero)', async () => {
  const calls = mockFetch(answer('<p>x</p>'))
  await ask('Lista de compras', '', 'k')
  assert.equal(JSON.parse(String(calls[0].init.body)).contents[0].parts[0].text, 'Lista de compras')
})

test('WAV: cabecera correcta, mono de 16 bits', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1]), 16000)
  const v = new DataView(wav.buffer)
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF')
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), 'WAVE')
  assert.equal(v.getUint16(22, true), 1) // un canal
  assert.equal(v.getUint32(24, true), 16000)
  assert.equal(v.getUint32(40, true), 6) // 3 muestras x 2 bytes
  assert.equal(v.getInt16(46, true), 0x7fff)
  assert.equal(v.getInt16(48, true), -0x8000)
})

test('checkKey: clave mala avisa en palabras simples', async () => {
  mockFetch(json({ error: { message: 'API key not valid.' } }, 400))
  await assert.rejects(checkKey('mala'), /clave/)
  mockFetch(json({ models: [] }))
  await checkKey('buena')
})
