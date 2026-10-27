import { getHTMLFromFragment, type Editor as TiptapEditor } from '@tiptap/react'
import { AudioLines, ClipboardPaste, ExternalLink, ShieldCheck, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { desktop } from './auth.ts'
import { OfflineError } from './drive.ts'
import { ask, askAudio, checkKey, encodeWav, KEY_URL, sensitive, TASKS } from './gemini.ts'

// Panel de Gemini bajo la barra de formato. "ia": tareas sobre la nota (o lo seleccionado) y pedidos libres.
// "voz": se graba lo dictado y Gemini lo escribe ordenado (o cumple lo pedido). Nada llega a la nota sin aceptarlo.
// Qué se envía a Google: las tareas mandan la nota o lo seleccionado; un pedido sin selección y el dictado mandan
// solo el pedido o la voz. En una nota privada nunca se manda su texto.
export type Mode = 'ia' | 'voz'
export type Privacy = 'nota' | 'libreta' | null
type Sel = { from: number; to: number; empty: boolean }
type Choice = { label: string; from: number; to: number } // from === to: se inserta ahí
type Phase = { at: 'menu' } | { at: 'grabando' } | { at: 'pensando'; what: string }
  | { at: 'aviso'; hits: string[]; go: () => void }
  | { at: 'listo'; html: string; choices: Choice[]; retry: () => void }

const MAX_SECONDS = 180 // ~6 MB de WAV a 16 kHz: entra holgado en un pedido a Gemini
const RATE = 16000

const geminiMessage = (e: unknown) => e instanceof OfflineError ? 'Sin conexión: Gemini necesita internet.'
  : e instanceof DOMException && e.name === 'NotAllowedError' ? 'Datheke no tiene permiso para el micrófono. Actívalo en los ajustes del aparato.'
  : e instanceof DOMException && e.name === 'NotFoundError' ? 'No se encontró un micrófono.'
  : e instanceof Error ? e.message : String(e)

// Vista previa en texto (DOMParser no ejecuta nada): casillas como ☐, viñetas como •.
function preview(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('li').forEach(li => li.prepend(li.closest('[data-type="taskList"]') ? '☐ ' : '• '))
  doc.querySelectorAll('p, li, h1, h2, h3, tr, br, blockquote').forEach(el => el.append('\n'))
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

// Dónde puede ir el resultado. Nunca toca lo que no se eligió: sin selección va donde está el cursor (o, si la tarea
// fue sobre toda la nota, al final o en su lugar); con selección, en lugar de lo seleccionado o debajo.
function placements(editor: TiptapEditor, sel: Sel, prefer: 'replace' | 'add', whole: boolean): Choice[] {
  const doc = editor.state.doc
  const size = doc.content.size
  if (editor.isEmpty) return [{ label: 'Poner en la nota', from: 0, to: size }]
  if (whole) {
    const end = { label: 'Agregar al final', from: size, to: size }
    return prefer === 'replace' ? [{ label: 'Reemplazar la nota', from: 0, to: size }, end] : [end]
  }
  if (sel.empty) return [{ label: 'Poner donde está el cursor', from: sel.from, to: sel.from }]
  const $to = doc.resolve(Math.min(sel.to, size))
  const after = $to.depth >= 1 ? $to.after(1) : sel.to
  const replace = { label: 'Reemplazar lo seleccionado', from: sel.from, to: sel.to }
  const below = { label: 'Agregar debajo', from: after, to: after }
  return prefer === 'replace' ? [replace, below] : [below, replace]
}

const textOf = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''

async function openKeyPage() {
  if (desktop) (await import('@tauri-apps/plugin-opener')).openUrl(KEY_URL)
  else window.open(KEY_URL, '_blank', 'noopener')
}

const toBase64 = (bytes: Uint8Array) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
  r.onerror = () => reject(r.error)
  r.readAsDataURL(new Blob([bytes as BlobPart]))
})

// Lo grabado (webm, mp4… según el aparato) pasa a WAV mono de 16 kHz, que Gemini lee siempre.
async function toWav(blob: Blob) {
  const ctx = new AudioContext()
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * RATE)), RATE)
    const src = off.createBufferSource()
    src.buffer = audio
    src.connect(off.destination)
    src.start()
    return encodeWav((await off.startRendering()).getChannelData(0), RATE)
  } finally { ctx.close() }
}

export default function GeminiPanel({ editor, mode, geminiKey, onKey, onClose, privacy, onPrivate }: {
  editor: TiptapEditor; mode: Mode; geminiKey: string; onKey: (key: string) => void; onClose: () => void
  privacy: Privacy; onPrivate: () => void
}) {
  const [phase, setPhase] = useState<Phase>({ at: 'menu' })
  const [error, setError] = useState('')
  const [request, setRequest] = useState('')
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const cancelled = useRef(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false; cancelled.current = true; recorder.current?.stop() }, [])

  const empty = editor.isEmpty
  const selected = !editor.state.selection.empty
  const sel = (): Sel => { const { from, to, empty } = editor.state.selection; return { from, to, empty } }

  async function run(what: string, job: () => Promise<string>, choices: Choice[], retry: () => void) {
    setError('')
    setPhase({ at: 'pensando', what })
    try {
      const html = await job()
      if (live.current) setPhase({ at: 'listo', html, choices, retry })
    } catch (e) {
      if (!live.current) return
      setError(geminiMessage(e))
      setPhase({ at: 'menu' })
    }
  }

  // Antes de mandar texto de la nota: si parece tener claves o cuentas, se pregunta.
  function guard(html: string, go: () => void) {
    const hits = sensitive(textOf(html))
    if (hits.length) setPhase({ at: 'aviso', hits, go })
    else go()
  }

  // Tareas (resumir, corregir…): con lo seleccionado o con toda la nota. No en notas privadas.
  function doTask(instruction: string, replace: boolean, what: string) {
    if (privacy) return
    const s = sel()
    const whole = s.empty
    const html = whole ? editor.getHTML() : getHTMLFromFragment(editor.state.doc.slice(s.from, s.to).content, editor.schema)
    const choices = placements(editor, s, replace ? 'replace' : 'add', whole)
    const go = () => run(what, () => ask(instruction, html, geminiKey), choices, () => doTask(instruction, replace, what))
    guard(html, go)
  }

  // Pedido libre. Con selección (y nota no privada) va con lo seleccionado ("hazlo más formal"); si no, solo el pedido.
  function doRequest(text: string) {
    const s = sel()
    const withSelection = !s.empty && !privacy
    const html = withSelection ? getHTMLFromFragment(editor.state.doc.slice(s.from, s.to).content, editor.schema) : ''
    const choices = placements(editor, s, withSelection ? 'replace' : 'add', false)
    const go = () => run('Gemini está pensando…', () => ask(text, html, geminiKey), choices, () => doRequest(text))
    if (withSelection) guard(html, go)
    else go()
  }

  // Dictado: solo se manda la voz. Va donde estaba el cursor al empezar, o en lugar de lo seleccionado.
  async function record() {
    setError('')
    const s = sel()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks: Blob[] = []
      cancelled.current = false
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        recorder.current = null
        if (cancelled.current) { if (live.current) setPhase({ at: 'menu' }); return }
        const blob = new Blob(chunks, { type: rec.mimeType })
        run('Gemini está escribiendo lo que dijiste…', async () => askAudio(await toBase64(await toWav(blob)), geminiKey),
          placements(editor, s, 'replace', false), () => setPhase({ at: 'menu' }))
      }
      recorder.current = rec
      rec.start()
      setSeconds(0)
      setPhase({ at: 'grabando' })
    } catch (e) { setError(geminiMessage(e)) }
  }
  const stop = (cancel = false) => { cancelled.current = cancel; recorder.current?.stop() }

  useEffect(() => {
    if (phase.at !== 'grabando') return
    const tick = setInterval(() => setSeconds(s => {
      if (s + 1 >= MAX_SECONDS) recorder.current?.stop()
      return s + 1
    }), 1000)
    return () => clearInterval(tick)
  }, [phase.at])

  // Si la nota cambió mientras Gemini pensaba (otro aparato), las posiciones se ajustan al largo actual.
  function apply(c: Choice) {
    if (phase.at !== 'listo') return
    const size = editor.state.doc.content.size
    const from = Math.min(c.from, size)
    const to = Math.min(c.to, size)
    editor.chain().focus().insertContentAt(from === to ? from : { from, to }, phase.html).run()
    onClose()
  }

  async function saveKey(key: string) {
    key = key.trim()
    if (!key) return
    setChecking(true)
    setError('')
    try {
      await checkKey(key)
      onKey(key)
      setDraft('')
    } catch (e) { setError(geminiMessage(e)) } finally { setChecking(false) }
  }

  async function pasteKey() {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (text) { setDraft(text); saveKey(text) }
      else setError('No hay nada copiado. Copia la clave en la página de Google y vuelve a tocar Pegar.')
    } catch { setError('No pude leer lo copiado: pega la clave en el recuadro (mantén presionado → Pegar).') }
  }

  const close = <button type="button" className="btn-icono" aria-label="Cerrar" title="Cerrar" onClick={onClose}><X size={16} /></button>
  const title = mode === 'voz' ? <><AudioLines size={16} aria-hidden="true" /> Dictar a Gemini</> : <><Sparkles size={16} aria-hidden="true" /> Gemini</>

  if (!geminiKey) return (
    <div className="gemini" role="region" aria-label="Vincular Gemini">
      <div className="gemini-cabeza"><strong>{title}</strong>{close}</div>
      <p>Vincula tu Gemini <strong>gratis</strong> una sola vez y funciona en todos tus aparatos con esta cuenta.</p>
      <ol>
        <li><button type="button" className="principal" onClick={openKeyPage}><ExternalLink size={16} /> Abrir Google</button> y entra con tu cuenta.</li>
        <li>Toca <strong>Crear clave de API</strong> (Create API key) y cópiala.</li>
        <li>Vuelve aquí y toca <button type="button" onClick={pasteKey} disabled={checking}><ClipboardPaste size={16} /> Pegar</button></li>
      </ol>
      <div className="gemini-fila">
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="…o pega la clave aquí" aria-label="Clave de Gemini"
          autoComplete="off" spellCheck={false} />
        <button type="button" className="principal" disabled={!draft.trim() || checking} onClick={() => saveKey(draft)}>
          {checking ? 'Revisando…' : 'Vincular'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="gemini-nota">En el plan gratis, Google puede revisar lo que le envíes para mejorar sus productos. No lo uses con datos delicados (claves, cuentas bancarias, salud).</p>
    </div>
  )

  const where = empty ? 'en la nota' : selected ? 'en lugar de lo seleccionado' : 'donde está el cursor'

  return (
    <div className="gemini" role="region" aria-label="Gemini">
      <div className="gemini-cabeza"><strong>{title}</strong>{close}</div>

      {phase.at === 'pensando' && <p className="gemini-pensando" role="status"><Sparkles size={16} aria-hidden="true" /> {phase.what}</p>}

      {phase.at === 'aviso' && <div className="gemini-aviso" role="alert">
        <p><ShieldCheck size={16} aria-hidden="true" /> <strong>Esta nota parece tener datos privados</strong> ({phase.hits.join(', ')}).
          Si sigues, ese texto se envía a Google y en el plan gratis puede revisarlo.</p>
        <div className="gemini-fila">
          <button type="button" className="principal" onClick={() => { onPrivate(); setPhase({ at: 'menu' }) }}>
            <ShieldCheck size={16} /> Marcarla privada
          </button>
          <button type="button" onClick={phase.go}>Enviar igual</button>
          <button type="button" onClick={() => setPhase({ at: 'menu' })}>Cancelar</button>
        </div>
      </div>}

      {phase.at === 'grabando' && <div className="gemini-grabando" role="status">
        <span className="ondas" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span>Te escucho… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
        <button type="button" className="principal" onClick={() => stop()}>Listo</button>
        <button type="button" onClick={() => stop(true)}>Cancelar</button>
      </div>}

      {phase.at === 'listo' && <>
        <div className="gemini-resultado">{preview(phase.html)}</div>
        <div className="gemini-fila">
          {phase.choices.map((c, i) => <button key={c.label} type="button" className={i ? undefined : 'principal'} onClick={() => apply(c)}>{c.label}</button>)}
          <button type="button" onClick={phase.retry}>{mode === 'voz' ? 'Dictar otra vez' : 'Otra vez'}</button>
          <button type="button" onClick={() => setPhase({ at: 'menu' })}>Descartar</button>
        </div>
      </>}

      {phase.at === 'menu' && privacy && <p className="gemini-privada">
        <ShieldCheck size={16} aria-hidden="true" /> {privacy === 'libreta' ? 'Esta libreta es privada' : 'Nota privada'}: Gemini no lee su texto.
        {mode === 'ia' ? ' Puedes pedirle cosas nuevas (solo se envía tu pedido) o dictar.' : ' Al dictar solo se envía tu voz.'}
      </p>}

      {phase.at === 'menu' && mode === 'voz' && <div className="gemini-fila">
        <button type="button" className="principal grande" onClick={record}><AudioLines size={18} /> Empezar a hablar</button>
        <span className="gemini-ayuda">Dicta algo para anotar o pídele algo ("créame la lista de…"). Va {where}. Solo se envía tu voz.</span>
      </div>}

      {phase.at === 'menu' && mode === 'ia' && <>
        {!empty && !privacy && <>
          <p className="gemini-ayuda">Con {selected ? 'lo que seleccionaste' : 'toda la nota'}:</p>
          <div className="gemini-tareas">
            {TASKS.map(t => <button key={t.id} type="button" onClick={() => doTask(t.ask, t.replace, `${t.label}…`)}>{t.label}</button>)}
          </div>
        </>}
        <form className="gemini-fila" onSubmit={e => {
          e.preventDefault()
          if (request.trim()) doRequest(request.trim())
        }}>
          <input value={request} onChange={e => setRequest(e.target.value)} aria-label="Pídele algo a Gemini"
            placeholder={selected && !privacy ? 'Ej.: escríbelo como correo formal' : 'Ej.: lista de compras para una parrillada de 10'} />
          <button type="submit" className="principal" disabled={!request.trim()}>Pedir</button>
        </form>
        <p className="gemini-ayuda">{selected && !privacy ? 'El pedido va con lo seleccionado y el resultado puede reemplazarlo.'
          : `Solo se envía tu pedido; el resultado va ${where === 'en lugar de lo seleccionado' ? 'en lugar de lo seleccionado o debajo' : where}.`}</p>
      </>}

      {error && <p className="error">{error}</p>}
      {phase.at === 'menu' && <button type="button" className="enlace gemini-desvincular"
        onClick={() => { if (confirm('¿Desvincular Gemini en todos tus aparatos?')) onKey('') }}>Desvincular Gemini</button>}
    </div>
  )
}
