import { Fingerprint, KeyRound, LockKeyhole } from 'lucide-react'
import { useEffect, useState } from 'react'
import { forgetPrint, openWithPrint, printAvailable, savedPrint, savePrint } from './print.ts'
import * as vault from './vault.ts'

// Pantallas de la caja fuerte (notas con clave): crear la clave, abrir con la clave o la huella, y "olvidé la clave".
// La huella (solo Android) guarda la llave cifrada por el propio teléfono: sin el dedo no se puede leer.

// Abrir: en lugar de la nota cuando está cerrada, y en la ventana antes de proteger otra nota.
// onOpen(true): se abrió con la clave y este teléfono puede usar huella pero aún no la tiene: App ofrece activarla
// en su propia ventana (esta pantalla desaparece apenas se abre la caja).
// common: clave común de una nota compartida (la misma para todos los que la tienen).
export function Unlock({ verifier, onOpen, onForgot, compact, common }: {
  verifier: string; onOpen: (offerPrint: boolean) => void; onForgot: () => void; compact?: boolean; common?: boolean
}) {
  const salt = common ? vault.saltOf(verifier) : undefined
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [print, setPrint] = useState(false) // hay huella guardada y el teléfono la tiene
  const [canPrint, setCanPrint] = useState(false) // el teléfono tiene huella

  async function withPrint() {
    setError('')
    try {
      if (await openWithPrint(verifier, common)) return onOpen(false)
      forgetPrint(salt) // la clave se cambió (aquí o en otro aparato): la huella guardada ya no sirve
      setPrint(false)
      setError('La clave cambió: escríbela una vez y vuelve a activar la huella.')
    } catch { /* canceló o no reconoció el dedo: queda la clave */ }
  }

  // Con huella guardada en este teléfono, se pide el dedo apenas aparece la nota cerrada.
  useEffect(() => {
    printAvailable().then(ok => {
      setCanPrint(ok)
      if (!ok || !savedPrint(salt)) return
      setPrint(true)
      if (!compact) withPrint()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!password) return
    const offer = canPrint && !savedPrint(salt) // se decide antes: al abrir, esta pantalla se va
    setBusy(true)
    setError('')
    const ok = await vault.unlock(password, verifier, !common)
    setBusy(false)
    if (!ok) { setError('Esa no es la clave.'); return }
    setPassword('')
    onOpen(offer)
  }

  return (
    <form className={compact ? 'caja' : 'caja caja-grande'} onSubmit={e => { e.preventDefault(); submit() }}>
      <LockKeyhole size={36} className="caja-icono" aria-hidden="true" />
      <p><strong>{common ? 'Nota compartida con clave común' : 'Nota con clave'}</strong></p>
      {common && <p className="caja-nota">Se abre con la clave que pusieron para esta nota (la misma para todos los que la tienen).</p>}
      <div className="caja-fila">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={common ? 'Clave de esta nota' : 'Tu clave de notas'}
          aria-label={common ? 'Clave de esta nota' : 'Clave de notas'} autoComplete="current-password" autoFocus={!print} />
        <button type="submit" className="principal" disabled={!password || busy}>{busy ? 'Abriendo…' : 'Abrir'}</button>
      </div>
      {print && <button type="button" onClick={withPrint}><Fingerprint size={16} /> Usar huella</button>}
      {canPrint && !print && <p className="caja-nota"><Fingerprint size={14} aria-hidden="true" /> Escribe tu clave una vez y podrás activar la huella.</p>}
      {error && <p className="error">{error}</p>}
      <button type="button" className="enlace" onClick={onForgot}>{common ? '¿Nadie recuerda la clave?' : '¿Olvidaste la clave?'}</button>
    </form>
  )
}

// Activar la huella (ventana aparte, con la caja ya abierta): guarda la llave cifrada por el teléfono.
export function PrintOffer({ onDone, salt }: { onDone: () => void; salt?: string }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function activate() {
    setError('')
    setBusy(true)
    try {
      await savePrint(salt)
      onDone()
    } catch (e) {
      // Cancelar no es error; otro problema se muestra para poder arreglarlo.
      const msg = e instanceof Error ? e.message : String(e)
      if (/cancel/i.test(msg)) onDone()
      else setError(`No se pudo activar la huella: ${msg}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="caja">
      <Fingerprint size={36} className="caja-icono" aria-hidden="true" />
      <p><strong>¿Abrir con tu huella la próxima vez?</strong></p>
      <p className="caja-nota">Tu clave sigue sirviendo igual. La huella solo funciona en este teléfono.</p>
      <div className="caja-fila">
        <button className="principal" onClick={activate} disabled={busy}><Fingerprint size={16} /> Sí, usar huella</button>
        <button onClick={onDone}>{error ? 'Continuar' : 'Ahora no'}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

// Crear la clave: la primera vez que se protege una nota, y después de "olvidé la clave" (ya entró de nuevo con Google).
// onNoKey (solo tras "olvidé la clave"): en vez de una clave nueva, quitarles la clave a las notas.
// common: la clave común de una nota compartida (se la dices a las otras personas).
export function Create({ again, onCreated, onCancel, onNoKey, common }: {
  again?: boolean; onCreated: (verifier: string) => void; onCancel: () => void; onNoKey?: () => void; common?: boolean
}) {
  const [one, setOne] = useState('')
  const [two, setTwo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (one.length < vault.MIN_LENGTH) return setError(`Usa al menos ${vault.MIN_LENGTH} caracteres.`)
    if (one !== two) return setError('Las dos claves no son iguales.')
    setBusy(true)
    try {
      const verifier = await vault.create(one, !common)
      if (!common) forgetPrint()
      onCreated(verifier)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <form className="caja" onSubmit={e => { e.preventDefault(); submit() }}>
      <KeyRound size={36} className="caja-icono" aria-hidden="true" />
      <p><strong>{common ? 'Clave común para esta nota compartida' : again ? 'Escribe tu clave nueva' : 'Crea tu clave de notas'}</strong></p>
      {common
        ? <p className="caja-nota">La misma clave para todos los que tienen esta nota: díselas tú (no la mandes en la misma nota).
          No es tu clave de notas: esa sigue siendo solo tuya.</p>
        : <p className="caja-nota">Una sola clave para todas tus notas protegidas, en todos tus aparatos. En este aparato se guardan
        cifradas; en tu Drive queda el respaldo, así que si la olvidas la recuperas volviendo a entrar con Google.</p>}
      <input type="password" value={one} onChange={e => setOne(e.target.value)} placeholder={`Clave (mínimo ${vault.MIN_LENGTH})`}
        aria-label="Clave nueva" autoComplete="new-password" autoFocus />
      <input type="password" value={two} onChange={e => setTwo(e.target.value)} placeholder="Repite la clave"
        aria-label="Repite la clave" autoComplete="new-password" />
      {error && <p className="error">{error}</p>}
      <div className="caja-fila">
        <button type="submit" className="principal" disabled={busy}>{busy ? 'Guardando…' : 'Guardar clave'}</button>
        <button type="button" onClick={onCancel}>Cancelar</button>
      </div>
      {onNoKey && <button type="button" className="enlace" onClick={() => { forgetPrint(); onNoKey() }}>
        No quiero clave: quitarla a mis notas
      </button>}
    </form>
  )
}

// Cambiar clave: la actual, y la nueva dos veces. Devuelve el verificador nuevo (la llave vieja se olvida).
// prepare: con la clave actual ya abierta, antes de crear la nueva (App descifra todo lo guardado).
export function ChangeKey({ verifier, common, prepare, onChanged, onCancel }: {
  verifier: string; common?: boolean; prepare: () => Promise<void>; onChanged: (newVerifier: string, oldSalt: string) => Promise<void>; onCancel: () => void
}) {
  const [now, setNow] = useState('')
  const [one, setOne] = useState('')
  const [two, setTwo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (one.length < vault.MIN_LENGTH) return setError(`La nueva debe tener al menos ${vault.MIN_LENGTH} caracteres.`)
    if (one !== two) return setError('Las dos claves nuevas no son iguales.')
    if (one === now) return setError('La nueva es igual a la actual.')
    setBusy(true)
    setError('')
    try {
      if (!await vault.unlock(now, verifier, !common)) { setBusy(false); return setError('La clave actual no es esa.') }
      const oldSalt = vault.saltOf(verifier) ?? ''
      await prepare()
      await onChanged(await vault.create(one, !common), oldSalt)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <form className="caja" onSubmit={e => { e.preventDefault(); submit() }}>
      <KeyRound size={36} className="caja-icono" aria-hidden="true" />
      <p><strong>{common ? 'Cambiar la clave común de esta nota' : 'Cambiar tu clave de notas'}</strong></p>
      <p className="caja-nota">{common
        ? 'Las otras personas tendrán que usar la clave nueva: díselas.'
        : 'Todas tus notas con clave pasan a abrirse con la nueva, también en tus otros aparatos.'} La huella hay que volver a activarla.</p>
      <input type="password" value={now} onChange={e => setNow(e.target.value)} placeholder="Clave actual" aria-label="Clave actual" autoComplete="current-password" autoFocus />
      <input type="password" value={one} onChange={e => setOne(e.target.value)} placeholder={`Clave nueva (mínimo ${vault.MIN_LENGTH})`} aria-label="Clave nueva" autoComplete="new-password" />
      <input type="password" value={two} onChange={e => setTwo(e.target.value)} placeholder="Repite la clave nueva" aria-label="Repite la clave nueva" autoComplete="new-password" />
      {error && <p className="error">{error}</p>}
      <div className="caja-fila">
        <button type="submit" className="principal" disabled={busy || !now}>{busy ? 'Cambiando…' : 'Cambiar clave'}</button>
        <button type="button" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  )
}
