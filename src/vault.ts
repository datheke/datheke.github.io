// Caja fuerte: notas con clave. Una sola clave para todas, igual en todos los aparatos de la cuenta.
// En el aparato (IndexedDB) las notas protegidas se guardan cifradas (AES-GCM con una llave sacada de la clave con
// PBKDF2); en Drive quedan sin cifrar, en la carpeta oculta de la app: es el respaldo si se olvida la clave, y se
// recupera volviendo a entrar con Google. En Drive va solo un verificador ("1.sal.control") para saber si la clave
// escrita es la correcta, también sin internet. La llave vive solo en memoria y se borra al bloquear.
import type { Snapshot } from './sync.ts'

const ITERATIONS = 310_000
const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

// salt: con qué clave se cifró. Si la clave se cambió en otro aparato, lo guardado aquí ya no se abre y se vuelve a bajar.
export type Sealed = { sealed: 1; salt: string; iv: string; data: string }
export const isSealed = (v: unknown): v is Sealed => !!v && typeof v === 'object' && (v as Sealed).sealed === 1

export const MIN_LENGTH = 6
export const AUTO_LOCK_MS = 5 * 60_000

let key: CryptoKey | null = null
let salt = ''
let bits = '' // la llave en base64, solo mientras está abierta: para guardarla tras la huella (Android)
const listeners = new Set<() => void>()
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const changed = () => listeners.forEach(fn => fn())
export const unlocked = () => key !== null
export const keyBits = () => bits

type Vault = { salt: string; check: string }
export const parseVault = (s?: string | null): Vault | null => {
  const m = s?.match(/^1\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)$/)
  return m ? { salt: m[1], check: m[2] } : null
}

async function derive(password: string, saltB64: string) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: ITERATIONS }, base, 512))
}

// 64 bytes: los primeros 32 son la llave; los otros 32, resumidos, son el control que va a Drive (no sirve para descifrar).
async function fromBits(all: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', all.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const check = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', all.slice(32))).slice(0, 16))
  return { k, check }
}

function open_(k: CryptoKey, s: string, all: Uint8Array) {
  key = k
  salt = s
  bits = b64(all)
  touch()
  changed()
}

// Clave nueva (primera vez o "olvidé la clave"): devuelve el verificador para guardar en Drive. Queda abierta.
export async function create(password: string): Promise<string> {
  if (password.length < MIN_LENGTH) throw new Error(`La clave debe tener al menos ${MIN_LENGTH} caracteres.`)
  const s = b64(random(16))
  const all = await derive(password, s)
  const { k, check } = await fromBits(all)
  open_(k, s, all)
  return `1.${s}.${check}`
}

export async function unlock(password: string, vault: string): Promise<boolean> {
  const v = parseVault(vault)
  if (!v) return false
  const all = await derive(password, v.salt)
  const { k, check } = await fromBits(all)
  if (check !== v.check) return false
  open_(k, v.salt, all)
  return true
}

// Con la llave guardada tras la huella: también se compara con el verificador (si la clave cambió, ya no sirve).
export async function unlockWithBits(saved: string, vault: string): Promise<boolean> {
  const v = parseVault(vault)
  if (!v) return false
  const all = unb64(saved)
  const { k, check } = await fromBits(all)
  if (check !== v.check) return false
  open_(k, v.salt, all)
  return true
}

export function lock() {
  if (!key) return
  key = null
  bits = ''
  changed()
}

export async function seal(t: Snapshot): Promise<Sealed> {
  if (!key) throw new Error('La caja fuerte está cerrada.')
  const iv = random(12)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(t))))
  return { sealed: 1, salt, iv: b64(iv), data: b64(data) }
}

// null: cerrada, o cifrada con otra clave (cambiada en otro aparato) o dañada. Esa nota se vuelve a bajar de Drive.
export async function open(s: Sealed): Promise<Snapshot | null> {
  if (!key || s.salt !== salt) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, key, unb64(s.data))
    return JSON.parse(dec.decode(plain))
  } catch { return null }
}

// Se cierra sola tras AUTO_LOCK_MS sin tocar la app (App avisa cada toque o tecla).
let last = Date.now()
export const touch = () => { last = Date.now() }
export const idleFor = () => Date.now() - last
