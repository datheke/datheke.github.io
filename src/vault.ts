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

// Llaves abiertas, por su sal: la de tus notas (principal) y las claves comunes de notas compartidas.
// bits: la llave en base64, solo mientras está abierta (para guardarla tras la huella, en Android).
const ring = new Map<string, { key: CryptoKey; bits: string }>()
let mainSalt = ''
let ver = 0
const listeners = new Set<() => void>()
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const changed = () => { ver++; listeners.forEach(fn => fn()) }
export const version = () => ver
export const unlocked = () => !!mainSalt && ring.has(mainSalt) // tu clave de notas
export const any = () => ring.size > 0
export const hasKey = (s?: string) => s ? ring.has(s) : unlocked() // sin sal: la principal
export const keyBits = (s = mainSalt) => ring.get(s)?.bits ?? ''
export const saltOf = (verifier?: string | null) => parseVault(verifier)?.salt
export function forget(s: string) { if (ring.delete(s)) { if (s === mainSalt) mainSalt = ''; changed() } }

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

function open_(k: CryptoKey, s: string, all: Uint8Array, main: boolean) {
  if (main && mainSalt && mainSalt !== s) ring.delete(mainSalt) // clave nueva: la vieja ya no sirve
  ring.set(s, { key: k, bits: b64(all) })
  if (main) mainSalt = s
  touch()
  changed()
}

// Clave nueva (primera vez o "olvidé la clave"): devuelve el verificador para guardar en Drive. Queda abierta.
// main = false: clave común de una nota compartida (no cambia tu clave de notas).
export async function create(password: string, main = true): Promise<string> {
  if (password.length < MIN_LENGTH) throw new Error(`La clave debe tener al menos ${MIN_LENGTH} caracteres.`)
  const s = b64(random(16))
  const all = await derive(password, s)
  const { k, check } = await fromBits(all)
  open_(k, s, all, main)
  return `1.${s}.${check}`
}

export async function unlock(password: string, vault: string, main = true): Promise<boolean> {
  const v = parseVault(vault)
  if (!v) return false
  const all = await derive(password, v.salt)
  const { k, check } = await fromBits(all)
  if (check !== v.check) return false
  open_(k, v.salt, all, main)
  return true
}

// Con la llave guardada tras la huella: también se compara con el verificador (si la clave cambió, ya no sirve).
export async function unlockWithBits(saved: string, vault: string, main = true): Promise<boolean> {
  const v = parseVault(vault)
  if (!v) return false
  const all = unb64(saved)
  const { k, check } = await fromBits(all)
  if (check !== v.check) return false
  open_(k, v.salt, all, main)
  return true
}

export function lock() {
  if (!ring.size) return
  ring.clear()
  mainSalt = ''
  changed()
}

export async function seal(t: Snapshot, salt = mainSalt): Promise<Sealed> {
  const key = ring.get(salt)?.key
  if (!key) throw new Error('La caja fuerte está cerrada.')
  const iv = random(12)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(t))))
  return { sealed: 1, salt, iv: b64(iv), data: b64(data) }
}

// null: cerrada, o cifrada con otra clave (cambiada en otro aparato) o dañada. Esa nota se vuelve a bajar de Drive.
export async function open(s: Sealed): Promise<Snapshot | null> {
  const key = ring.get(s.salt)?.key
  if (!key) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, key, unb64(s.data))
    return JSON.parse(dec.decode(plain))
  } catch { return null }
}

// Se cierra sola tras AUTO_LOCK_MS sin tocar la app (App avisa cada toque o tecla).
let last = Date.now()
export const touch = () => { last = Date.now() }
export const idleFor = () => Date.now() - last
