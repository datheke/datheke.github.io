import { OfflineError } from './drive.ts'

// Gemini (opcional, apagado hasta vincularlo): tareas simples sobre la nota y dictado, con la clave gratis de cada
// persona sacada de Google AI Studio. Costo cero: la app llama directo a Google, sin servidor propio.
// La clave se guarda en la carpeta oculta del Drive de esa persona (App): se vincula una vez y sirve en todos sus aparatos.
// Aviso: en el plan gratis Google puede usar y revisar lo enviado para mejorar sus productos.
const API = 'https://generativelanguage.googleapis.com/v1beta/models'
// Alias que Google mueve al modelo más nuevo: Flash-Lite primero (el que más usos gratis da por día), luego Flash.
export const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest']
const MODEL_KEY = 'datheke-gemini-modelo'
export const KEY_URL = 'https://aistudio.google.com/apikey'

const savedModel = () => { try { return localStorage.getItem(MODEL_KEY) ?? '' } catch { return '' } }
const saveModel = (m: string) => { try { localStorage.setItem(MODEL_KEY, m) } catch { /* se vuelve a buscar */ } }

// replace: el resultado va en lugar del texto. Si no, va debajo.
export type Task = { id: string; label: string; ask: string; replace: boolean }
export const TASKS: Task[] = [
  { id: 'resumir', label: 'Resumir', replace: false,
    ask: 'Resume el texto en pocas viñetas (ul) con lo más importante. Empieza con <p><strong>Resumen</strong></p>.' },
  { id: 'corregir', label: 'Corregir ortografía', replace: true,
    ask: 'Corrige ortografía, tildes, puntuación y gramática. No cambies el estilo, el orden ni el contenido. Conserva todo el formato y las etiquetas.' },
  { id: 'mejorar', label: 'Mejorar redacción', replace: true,
    ask: 'Mejora la redacción para que sea clara, ordenada y fácil de leer, sin inventar datos ni quitar información. Conserva el formato.' },
  { id: 'tareas', label: 'Sacar tareas pendientes', replace: false,
    ask: 'Saca las tareas o pendientes del texto como lista de casillas. Si no hay tareas, responde <p>No encontré tareas pendientes.</p>' },
  { id: 'traducir', label: 'Traducir (español ⇄ inglés)', replace: true,
    ask: 'Traduce el texto al inglés; si ya está en inglés, tradúcelo al español. Conserva todo el formato y las etiquetas.' },
]

export const DICTATION = 'Este audio es una nota dictada. Escríbela ordenada: quita muletillas ("eh", "este"), repeticiones y '
  + 'arrepentimientos, corrige la puntuación y no inventes nada. Si menciona cosas por hacer, ponlas como lista de casillas; '
  + 'si es una lista (compras, pasos), como lista. Si el audio está vacío o no se entiende, responde <p>No se entendió el audio.</p>'

const RULES = 'Trabajas dentro de una app de notas. Responde SOLO con el resultado en HTML simple '
  + '(p, h2, h3, strong, em, u, s, ul, ol, li, blockquote, table, tr, th, td, br), sin explicaciones, sin saludos y sin ```. '
  + 'Las listas de casillas van con este formato exacto: '
  + '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>tarea</p></li></ul>. '
  + 'Escribe en el idioma del texto, salvo que se pida traducir. Deja cada etiqueta <img> exactamente como viene.'

// A veces el modelo envuelve la respuesta en ```html ... ```.
export const clean = (s: string) => s.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()

export class GeminiError extends Error {}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

const post = (url: string, key: string, body?: unknown) => fetch(url, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  body: body ? JSON.stringify(body) : undefined,
}).catch(() => { throw new OfflineError('Sin conexión.') })

async function failure(res: Response): Promise<GeminiError> {
  const msg = await res.json().then(d => String(d?.error?.message ?? ''), () => '')
  if (res.status === 429) return new GeminiError('Se acabó el uso gratis de Gemini por ahora (Google pone un límite por minuto y por día). Espera un rato o intenta mañana.')
  if (res.status === 400 && /api key/i.test(msg) || res.status === 401 || res.status === 403)
    return new GeminiError('Google no aceptó la clave de Gemini. Revísala o crea otra.')
  if (/location|region|country/i.test(msg)) return new GeminiError('Gemini gratis no está disponible en tu país.')
  if (res.status >= 500) return new GeminiError('Gemini está ocupado. Intenta en un momento.')
  return new GeminiError(`Gemini respondió ${res.status}${msg ? `: ${msg}` : ''}`)
}

// Antes de guardar la clave: Google dice si sirve (y de paso si hay internet).
export async function checkKey(key: string) {
  const res = await post(`${API}?pageSize=1`, key.trim())
  if (!res.ok) throw await failure(res)
}

async function generate(parts: Part[], key: string): Promise<string> {
  if (!key) throw new GeminiError('Falta vincular Gemini.')
  const saved = savedModel()
  const models = saved ? [saved, ...MODELS.filter(m => m !== saved)] : MODELS
  for (const model of models) {
    const res = await post(`${API}/${model}:generateContent`, key, {
      systemInstruction: { parts: [{ text: RULES }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.3 },
    })
    // Modelo que ya no existe o no está en el plan gratis: se prueba el siguiente.
    if (res.status === 404) continue
    if (!res.ok) throw await failure(res)
    saveModel(model)
    const data = await res.json()
    if (data.promptFeedback?.blockReason) throw new GeminiError('Gemini no quiso responder a este texto.')
    const text: string = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
    if (!text.trim()) throw new GeminiError('Gemini no devolvió nada. Intenta de nuevo.')
    return clean(text)
  }
  throw new GeminiError('No encontré un modelo de Gemini disponible con tu clave.')
}

// La tarea sobre el HTML de la nota (o de lo seleccionado); con la nota vacía, Gemini crea desde cero.
export const ask = (instruction: string, html: string, key: string) =>
  generate([{ text: html.trim() ? `${instruction}\n\nTexto de la nota:\n${html}` : instruction }], key)

// Dictado: el audio (WAV) va a Gemini, que lo escribe ya ordenado.
export const askAudio = (wavBase64: string, key: string) =>
  generate([{ text: DICTATION }, { inlineData: { mimeType: 'audio/wav', data: wavBase64 } }], key)

// WAV mono de 16 bits: lo lee Gemini en todos lados (lo que graba cada navegador, webm o mp4, no siempre).
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const str = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)))
  str(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true)
  str(36, 'data'); out.setUint32(40, samples.length * 2, true)
  samples.forEach((v, i) => { const x = Math.max(-1, Math.min(1, v)); out.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true) })
  return new Uint8Array(out.buffer)
}
