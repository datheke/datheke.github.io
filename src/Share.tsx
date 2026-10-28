import { Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { people, type Person } from './shared.ts'

// Ventana "Compartir": a quién (correos de Google) y quiénes ya la tienen. Quien recibe ve quién la compartió y "Salir".
export function ShareDialog({ title, fileId, owner, ownerName, myEmail, onShare, onRemove, onLeave, onClose }: {
  title: string; fileId?: string; owner: boolean; ownerName?: string; myEmail: string
  onShare: (emails: string[]) => Promise<void>; onRemove: (p: Person) => Promise<boolean>; onLeave: () => void; onClose: () => void
}) {
  const [text, setText] = useState('')
  const [list, setList] = useState<Person[] | null>(fileId ? null : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = () => { if (fileId) people(fileId).then(setList, () => setList([])) }
  useEffect(reload, [fileId])
  const emails = text.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean)
  const bad = emails.filter(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
  const others = (list ?? []).filter(p => p.role !== 'owner' && p.emailAddress?.toLowerCase() !== myEmail.toLowerCase())

  async function share() {
    if (!emails.length || bad.length) return setError(bad.length ? `Revisa: ${bad.join(', ')}` : 'Escribe el correo de Google de la persona.')
    setBusy(true); setError('')
    try { await onShare(emails); setText(''); reload() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Compartir nota" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ventana compartir">
        <button className="btn-icono cerrar" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <Users size={30} className="caja-icono" aria-hidden="true" />
        <h2>{owner ? 'Compartir' : 'Nota compartida'}: {title}</h2>
        {owner ? <>
          <p className="caja-nota">La otra persona la ve y la edita en su Datheke, y ves quién la cambió. Le llega un correo de Google con cómo abrirla.</p>
          <label className="compartir-correo">Correo de Google (Gmail) de la persona
            <input type="email" inputMode="email" autoCapitalize="off" placeholder="nombre@gmail.com" value={text}
              onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') share() }} disabled={busy} />
          </label>
          {error && <p className="caja-error" role="alert">{error}</p>}
          <button className="principal" onClick={share} disabled={busy || !emails.length}>{busy ? 'Compartiendo…' : 'Compartir'}</button>
        </> : <p className="caja-nota">Te la compartió <strong>{ownerName || 'otra persona'}</strong>. Lo que cambies le llega, y lo que cambie te llega a ti.</p>}
        {fileId && <div className="compartir-lista">
          <h3>La tienen</h3>
          {list === null ? <p className="caja-nota">Cargando…</p> : <ul>
            {(list ?? []).filter(p => p.role === 'owner').map(p => <li key={p.id}><span>{p.displayName || p.emailAddress}</span><small>dueño</small></li>)}
            {others.map(p => <li key={p.id}><span>{p.displayName ? `${p.displayName} · ${p.emailAddress}` : p.emailAddress}</span>
              {owner && <button className="btn-icono" title="Dejar de compartir con esta persona" aria-label={`Dejar de compartir con ${p.emailAddress}`}
                onClick={async () => { if (await onRemove(p)) reload() }}><X size={16} /></button>}</li>)}
            {!others.length && <li className="vacio-lista">Aún nadie más.</li>}
          </ul>}
        </div>}
        {!owner && <button className="peligro-texto" onClick={onLeave}>Salir de esta nota compartida</button>}
      </div>
    </div>
  )
}

// Al dejar de compartir (borrar la nota o quitar a alguien): ¿se le deja una copia a la otra persona?
export function CopyDialog({ who, onPick }: { who: string; onPick: (v: 'copia' | 'quitar' | null) => void }) {
  return (
    <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Dejar de compartir">
      <div className="ventana compartir">
        <Users size={30} className="caja-icono" aria-hidden="true" />
        <h2>Dejar de compartir</h2>
        <p className="caja-nota">Esta nota está compartida con <strong>{who}</strong>. ¿Le dejas una copia?</p>
        <ul className="compartir-opciones">
          <li><strong>Dejarle una copia:</strong> se queda con la nota como está ahora, como nota suya. Ya no le llegan tus cambios.</li>
          <li><strong>Quitársela:</strong> desaparece de su Datheke (si está sin internet, al conectarse).</li>
        </ul>
        <div className="caja-fila">
          <button className="principal" onClick={() => onPick('copia')}>Dejarle una copia</button>
          <button className="peligro" onClick={() => onPick('quitar')}>Quitársela</button>
          <button onClick={() => onPick(null)}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

// "Nota recibida": un archivo .datheke (WhatsApp, correo…) o una nota compartida contigo por Google.
export function ReceiveDialog({ onFile, onShared, onClose }: { onFile: () => void; onShared: () => void; onClose: () => void }) {
  return (
    <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Nota recibida" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ventana compartir">
        <button className="btn-icono cerrar" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <h2>Nota recibida</h2>
        <button className="recibir-opcion" onClick={onShared}><strong>👥 Compartida conmigo</strong><span>Alguien te la compartió por correo de Google: la ven y la editan los dos.</span></button>
        <button className="recibir-opcion" onClick={onFile}><strong>📄 Archivo .datheke</strong><span>Te mandaron una copia por WhatsApp, correo… Queda como nota tuya.</span></button>
      </div>
    </div>
  )
}
