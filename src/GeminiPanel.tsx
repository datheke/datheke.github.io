import { getHTMLFromFragment, type Editor as TiptapEditor } from '@tiptap/react'
import { AudioLines, ClipboardPaste, ExternalLink, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { desktop } from './auth.ts'
import { OfflineError } from './drive.ts'
import { ask, askAudio, checkKey, encodeWav, KEY_URL, TASKS } from './gemini.ts'

// Panel de Gemini bajo la barra de formato. "ia": tareas sobre la nota (o lo seleccionado) y pedidos libres.
// "voz": se graba lo dictado y Gemini lo escribe ordenado. Nada llega a la nota sin que la persona lo acepte.
export type Mode = 'ia' | 'voz'
type Range = { from: number; to: number; whole: boolean }
type Result = { html: string; range: Range; replace: boolean; retry: () => void }
type Phase = { at: 'menu' } | { at: 'grabando' } | { at: 'pensando'; what: string } | ({ at: 'listo' } & Result)

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

export default function GeminiPanel({ editor, mode, geminiKey, onKey, onClose }: {
  editor: TiptapEditor; mode: Mode; geminiKey: string; onKey: (key: string) => void; onClose: () => void
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

  // Lo que se le manda: lo seleccionado o la nota entera. Se toma al pedir, no al abrir el panel.
  function target(): Range & { html: string } {
    const { from, to, empty: none } = editor.state.selection
    if (none || editor.isEmpty) return { from: 0, to: editor.state.doc.content.size, whole: true, html: editor.isEmpty ? '' : editor.getHTML() }
    return { from, to, whole: false, html: getHTMLFromFragment(editor.state.doc.slice(from, to).content, editor.schema) }
  }

  async function run(what: string, job: () => Promise<string>, range: Range, replace: boolean, retry: () => void) {
    setError('')
    setPhase({ at: 'pensando', what })
    try {
      const html = await job()
      if (live.current) setPhase({ at: 'listo', html, range, replace: replace || range.whole && editor.isEmpty, retry })
    } catch (e) {
      if (!live.current) return
      setError(geminiMessage(e))
      setPhase({ at: 'menu' })
    }
  }

  function doTask(instruction: string, replace: boolean, what: string) {
    const t = target()
    run(what, () => ask(instruction, t.html, geminiKey), t, replace, () => doTask(instruction, replace, what))
  }

  async function record() {
    setError('')
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
        // Va donde está el cursor: debajo de su renglón (o la nota entera si está vacía).
        const { to } = editor.state.selection
        const range = editor.isEmpty ? { from: 0, to: editor.state.doc.content.size, whole: true } : { from: to, to, whole: false }
        const blob = new Blob(chunks, { type: rec.mimeType })
        run('Gemini está escribiendo lo que dijiste…', async () => askAudio(await toBase64(await toWav(blob)), geminiKey), range, false, () => setPhase({ at: 'menu' }))
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

  // Reemplazar va en lugar de lo enviado; agregar va debajo del renglón donde termina (o al final de la nota).
  function apply(replace: boolean) {
    if (phase.at !== 'listo') return
    const { html, range } = phase
    const size = editor.state.doc.content.size
    const to = Math.min(range.to, size)
    const $to = editor.state.doc.resolve(to)
    const below = range.whole ? size : $to.depth >= 1 ? $to.after(1) : to
    editor.chain().focus().insertContentAt(replace ? { from: Math.min(range.from, to), to } : below, html).run()
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

  return (
    <div className="gemini" role="region" aria-label="Gemini">
      <div className="gemini-cabeza"><strong>{title}</strong>{close}</div>

      {phase.at === 'pensando' && <p className="gemini-pensando" role="status"><Sparkles size={16} aria-hidden="true" /> {phase.what}</p>}

      {phase.at === 'grabando' && <div className="gemini-grabando" role="status">
        <span className="ondas" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span>Te escucho… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
        <button type="button" className="principal" onClick={() => stop()}>Listo</button>
        <button type="button" onClick={() => stop(true)}>Cancelar</button>
      </div>}

      {phase.at === 'listo' && <>
        <div className="gemini-resultado">{preview(phase.html)}</div>
        <div className="gemini-fila">
          {phase.range.whole && empty ? <button type="button" className="principal" onClick={() => apply(true)}>Poner en la nota</button>
            : phase.replace ? <>
              <button type="button" className="principal" onClick={() => apply(true)}>Reemplazar</button>
              <button type="button" onClick={() => apply(false)}>Agregar debajo</button>
            </> : <>
              <button type="button" className="principal" onClick={() => apply(false)}>Agregar {mode === 'voz' ? 'a la nota' : 'debajo'}</button>
              {mode === 'ia' && <button type="button" onClick={() => apply(true)}>Reemplazar</button>}
            </>}
          <button type="button" onClick={phase.retry}>{mode === 'voz' ? 'Dictar otra vez' : 'Otra vez'}</button>
          <button type="button" onClick={() => setPhase({ at: 'menu' })}>Descartar</button>
        </div>
      </>}

      {phase.at === 'menu' && mode === 'voz' && <div className="gemini-fila">
        <button type="button" className="principal grande" onClick={record}><AudioLines size={18} /> Empezar a hablar</button>
        <span className="gemini-ayuda">Habla de corrido; Gemini lo escribe ordenado{empty ? '' : ' debajo del renglón donde estás'}.</span>
      </div>}

      {phase.at === 'menu' && mode === 'ia' && <>
        {!empty && <>
          <p className="gemini-ayuda">Con {selected ? 'lo que seleccionaste' : 'toda la nota'}:</p>
          <div className="gemini-tareas">
            {TASKS.map(t => <button key={t.id} type="button" onClick={() => doTask(t.ask, t.replace, `${t.label}…`)}>{t.label}</button>)}
          </div>
        </>}
        <form className="gemini-fila" onSubmit={e => {
          e.preventDefault()
          if (request.trim()) doTask(request.trim(), false, 'Gemini está pensando…')
        }}>
          <input value={request} onChange={e => setRequest(e.target.value)} aria-label="Pídele algo a Gemini"
            placeholder={empty ? 'Ej.: lista de compras para una parrillada de 10' : 'Ej.: escríbelo como correo formal'} />
          <button type="submit" className="principal" disabled={!request.trim()}>Pedir</button>
        </form>
      </>}

      {error && <p className="error">{error}</p>}
      {phase.at === 'menu' && <button type="button" className="enlace gemini-desvincular"
        onClick={() => { if (confirm('¿Desvincular Gemini en todos tus aparatos?')) onKey('') }}>Desvincular Gemini</button>}
    </div>
  )
}
