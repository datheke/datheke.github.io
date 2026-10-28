import { desktop } from './auth.ts'
import * as vault from './vault.ts'

// Huella (solo Android): la llave de la caja fuerte se guarda cifrada por el propio teléfono (Android Keystore) y
// solo se puede leer poniendo el dedo. Sin huella guardada, la clave sigue siendo el único camino.
const HUELLA = 'datheke-huella'
const android = desktop && /android/i.test(navigator.userAgent)
// salt: la huella de una clave común (nota compartida); sin salt, la de tu clave de notas.
const slot = (salt?: string) => salt ? `${HUELLA}-${salt}` : HUELLA
export const savedPrint = (salt?: string) => { try { return localStorage.getItem(slot(salt)) ?? '' } catch { return '' } }
export const forgetPrint = (salt?: string) => { try { localStorage.removeItem(slot(salt)) } catch { /* nada guardado */ } }

// ¿Este teléfono puede usar huella y todavía no la tiene guardada? (para ofrecerla al crear la clave)
export const canOfferPrint = async (salt?: string) => !savedPrint(salt) && await printAvailable()

export async function printAvailable() {
  if (!android) return false
  try { return (await (await import('@tauri-apps/plugin-biometric')).checkStatus()).isAvailable } catch { return false }
}

export async function savePrint(salt?: string) {
  const { biometricCipher } = await import('@tauri-apps/plugin-biometric')
  const r = await biometricCipher('Usar tu huella para abrir las notas con clave', { dataToEncrypt: vault.keyBits(salt), title: 'Datheke' })
  localStorage.setItem(slot(salt), r.data)
}

export async function openWithPrint(verifier: string, common = false) {
  const { biometricCipher } = await import('@tauri-apps/plugin-biometric')
  const salt = common ? vault.saltOf(verifier) : undefined
  const r = await biometricCipher('Abrir tus notas con clave', { dataToDecrypt: savedPrint(salt), title: 'Datheke' })
  return vault.unlockWithBits(r.data, verifier, !common)
}

