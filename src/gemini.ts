import { OfflineError } from './drive.ts'

// Gemini (opcional, apagado hasta poner una clave): tareas simples sobre la nota con la clave gratis de cada persona,
// sacada de Google AI Studio. Costo cero: la app llama directo a Google, sin servidor propio.
// Aviso: en el plan gratis Google puede usar y revisar lo enviado para mejorar sus productos.
const API = 'https://generativelanguage.googleapis.com/v1beta/models'
// Alias que Google mueve al modelo más nuevo: Flash-Lite primero (el que más usos gratis da por día), luego Flash.
export const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest']
const KEY = 'datheke-gemini'
const MODEL_KEY = 'datheke-gemini-modelo'
export const KEY_URL = 'https://aistudio.google.com/apikey'

// La clave queda solo en este aparato (no va a Drive ni a ningún otro lado).
export function getKey(): string {
  try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
}
export function setKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY, key.trim())
    else { localStorage.removeItem(KEY); localStorage.removeItem(MODEL_KEY) }
  } catch { /* sin guardar: habrá que pegarla de nuevo */ }
}
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
    ask: 'Saca las tareas o pendientes del texto como lista de casillas, con este formato exacto: '
      + '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>tarea</p></li></ul>. '
      + 'Si no hay tareas, responde <p>No encontré tareas pendientes.</p>' },
  { id: 'traducir', label: 'Traducir (español ⇄ inglés)', replace: true,
    ask: 'Traduce el texto al inglés; si ya está en inglés, tradúcelo al español. Conserva todo el formato y las etiquetas.' },
]

const RULES = 'Trabajas dentro de una app de notas. Responde SOLO con el resultado en HTML simple '
  + '(p, h2, h3, strong, em, u, s, ul, ol, li, blockquote, table, tr, th, td, br), sin explicaciones, sin saludos y sin ```. '
  + 'Escribe en el idioma del texto, salvo que se pida traducir. Deja cada etiqueta <img> exactamente como viene.'

// A veces el modelo envuelve la respuesta en ```html ... ```.
export const clean = (s: string) => s.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()

export class GeminiError extends Error {}

async function call(model: string, key: string, instruction: string, html: string): Promise<Response> {
  return fetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: RULES }] },
      contents: [{ role: 'user', parts: [{ text: `${instruction}\n\nTexto de la nota:\n${html}` }] }],
      generationConfig: { temperature: 0.3 },
    }),
  }).catch(() => { throw new OfflineError('Sin conexión.') })
}

async function failure(res: Response): Promise<GeminiError> {
  const msg = await res.json().then(d => String(d?.error?.message ?? ''), () => '')
  if (res.status === 429) return new GeminiError('Se acabó el uso gratis de Gemini por ahora (Google pone un límite por minuto y por día). Espera un rato o intenta mañana.')
  if (res.status === 400 && /api key/i.test(msg) || res.status === 401 || res.status === 403)
    return new GeminiError('Google no aceptó la clave de Gemini. Revísala o crea otra.')
  if (/location|region|country/i.test(msg)) return new GeminiError('Gemini gratis no está disponible en tu país.')
  if (res.status >= 500) return new GeminiError('Gemini está ocupado. Intenta en un momento.')
  return new GeminiError(`Gemini respondió ${res.status}${msg ? `: ${msg}` : ''}`)
}

// Pide la tarea sobre el HTML de la nota (o de lo seleccionado) y devuelve HTML para el editor.
export async function ask(instruction: string, html: string, key = getKey()): Promise<string> {
  if (!key) throw new GeminiError('Falta la clave de Gemini.')
  const saved = savedModel()
  const models = saved ? [saved, ...MODELS.filter(m => m !== saved)] : MODELS
  for (const model of models) {
    const res = await call(model, key, instruction, html)
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
