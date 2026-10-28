import { Fingerprint, KeyRound, LockKeyhole } from 'lucide-react'
import { useEffect, useState } from 'react'
import { desktop } from './auth.ts'
import * as vault from './vault.ts'

// Pantallas de la caja fuerte (notas con clave): crear la clave, abrir con la clave o la huella, y "olvidé la clave".
// La huella (solo Android) guarda la llave cifrada por el propio teléfono: sin el dedo no se puede leer.

const HUELLA = 'datheke-huella'
const android = desktop && /android/i.test(navigator.userAgent)
const savedPrint = () => { try { return localStorage.getItem(HUELLA) ?? '' } catch { return '' } }
const forgetPrint = () => { try { localStorage.removeItem(HUELLA) } catch { /* nada guardado */ } }

async function printAvailable() {
  if (!android) return false
  try { return (await (await import('@tauri-apps/plugin-biometric')).checkStatus()).isAvailable } catch { return false }
}

async function savePrint() {
  const { biometricCipher } = await import('@tauri-apps/plugin-biometric')
  const r = await biometricCipher('Usar tu huella para abrir las notas con clave', { dataToEncrypt: vault.keyBits(), title: 'Datheke' })
  localStorage.setItem(HUELLA, r.data)
}

async function openWithPrint(verifier: string) {
  const { biometricCipher } = await import('@tauri-apps/plugin-biometric')
  const r = await biometricCipher('Abrir tus notas con clave', { dataToDecrypt: savedPrint(), title: 'Datheke' })
  return vault.unlockWithBits(r.data, verifier)
}

// Abrir: en lugar de la nota cuando está cerrada, y en la ventana antes de proteger otra nota.
export function Unlock({ verifier, onOpen, onForgot, compact }: {
  verifier: string; onOpen: () => void; onForgot: () => void; compact?: boolean
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [print, setPrint] = useState(false) // hay huella guardada y el teléfono la tiene
  const [offerPrint, setOfferPrint] = useState(false) // tras abrir con la clave: ofrecer la huella
  const [canPrint, setCanPrint] = useState(false) // el teléfono tiene huella (para avisar que se puede activar)
  const [printError, setPrintError] = useState('')


  async function withPrint() {
    setError('')
    try {
      if (await openWithPrint(verifier)) return onOpen()
      forgetPrint() // la clave se cambió (aquí o en otro aparato): la huella guardada ya no sirve
      setPrint(false)
      setError('La clave cambió: escríbela una vez y vuelve a activar la huella.')
    } catch { /* canceló o no reconoció el dedo: queda la clave */ }
  }

  // Con huella guardada en este teléfono, se pide el dedo apenas aparece la nota cerrada.
  useEffect(() => {
    printAvailable().then(ok => {
      setCanPrint(ok)
      if (!ok || !savedPrint()) return
      setPrint(true)
      if (!compact) withPrint()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function activatePrint() {
    setPrintError('')
    try {
      await savePrint()
      onOpen()
    } catch (e) {
      // Cancelar no es error; otro problema sí se muestra (antes se perdía en silencio).
      const msg = e instanceof Error ? e.message : String(e)
      if (/cancel/i.test(msg)) onOpen()
      else setPrintError(`No se pudo activar la huella: ${msg}`)
    }
  }

  async function submit() {
    if (!password) return
    setBusy(true)
    setError('')
    const ok = await vault.unlock(password, verifier)
    setBusy(false)
    if (!ok) { setError('Esa no es la clave.'); return }
    setPassword('')
    if (!savedPrint() && await printAvailable()) setOfferPrint(true)
    else onOpen()
  }

  if (offerPrint) return (
    <div className={compact ? 'caja' : 'caja caja-grande'}>
      <Fingerprint size={36} className="caja-icono" aria-hidden="true" />
      <p><strong>¿Abrir con tu huella la próxima vez?</strong></p>
      <p className="caja-nota">Tu clave sigue sirviendo igual. La huella solo funciona en este teléfono.</p>
      <div className="caja-fila">
        <button className="principal" onClick={activatePrint}><Fingerprint size={16} /> Sí, usar huella</button>
        <button onClick={onOpen}>{printError ? 'Continuar' : 'Ahora no'}</button>
      </div>
      {printError && <p className="error">{printError}</p>}
    </div>
  )

  return (
    <form className={compact ? 'caja' : 'caja caja-grande'} onSubmit={e => { e.preventDefault(); submit() }}>
      <LockKeyhole size={36} className="caja-icono" aria-hidden="true" />
      <p><strong>Nota con clave</strong></p>
      <div className="caja-fila">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Tu clave de notas"
          aria-label="Clave de notas" autoComplete="current-password" autoFocus={!print} />
        <button type="submit" className="principal" disabled={!password || busy}>{busy ? 'Abriendo…' : 'Abrir'}</button>
      </div>
      {print && <button type="button" onClick={withPrint}><Fingerprint size={16} /> Usar huella</button>}
      {canPrint && !print && <p className="caja-nota"><Fingerprint size={14} aria-hidden="true" /> Escribe tu clave una vez y podrás activar la huella.</p>}
      {error && <p className="error">{error}</p>}
      <button type="button" className="enlace" onClick={onForgot}>¿Olvidaste la clave?</button>
    </form>
  )
}

// Crear la clave: la primera vez que se protege una nota, y después de "olvidé la clave" (ya entró de nuevo con Google).
// onNoKey (solo tras "olvidé la clave"): en vez de una clave nueva, quitarles la clave a las notas.
export function Create({ again, onCreated, onCancel, onNoKey }: {
  again?: boolean; onCreated: (verifier: string) => void; onCancel: () => void; onNoKey?: () => void
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
      const verifier = await vault.create(one)
      forgetPrint()
      onCreated(verifier)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <form className="caja" onSubmit={e => { e.preventDefault(); submit() }}>
      <KeyRound size={36} className="caja-icono" aria-hidden="true" />
      <p><strong>{again ? 'Escribe tu clave nueva' : 'Crea tu clave de notas'}</strong></p>
      <p className="caja-nota">Una sola clave para todas tus notas protegidas, en todos tus aparatos. En este aparato se guardan
        cifradas; en tu Drive queda el respaldo, así que si la olvidas la recuperas volviendo a entrar con Google.</p>
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
