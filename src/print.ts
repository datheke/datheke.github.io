import { desktop } from './auth.ts'
import * as vault from './vault.ts'

// Huella (solo Android): la llave de la caja fuerte se guarda cifrada por el propio teléfono (Android Keystore) y
// solo se puede leer poniendo el dedo. Sin huella guardada, la clave sigue siendo el único camino.
const HUELLA = 'datheke-huella'
const android = desktop && /android/i.test(navigator.userAgent)
export const savedPrint = () => { try { return localStorage.getItem(HUELLA) ?? '' } catch { return '' } }
export const forgetPrint = () => { try { localStorage.removeItem(HUELLA) } catch { /* nada guardado */ } }

// ¿Este teléfono puede usar huella y todavía no la tiene guardada? (para ofrecerla al crear la clave)
export const canOfferPrint = async () => !savedPrint() && await printAvailable()

export async function printAvailable() {
  if (!android) return false
  try { return (await (await import('@tauri-apps/plugin-biometric')).checkStatus()).isAvailable } catch { return false }
}

export async function savePrint() {
  const { biometricCipher } = await import('@tauri-apps/plugin-biometric')
  const r = await biometricCipher('Usar tu huella para abrir las notas con clave', { dataToEncrypt: vault.keyBits(), title: 'Datheke' })
  localStorage.setItem(HUELLA, r.data)
}

export async function openWithPrint(verifier: string) {
  const { biometricCipher } = await import('@tauri-apps/plugin-biometric')
  const r = await biometricCipher('Abrir tus notas con clave', { dataToDecrypt: savedPrint(), title: 'Datheke' })
  return vault.unlockWithBits(r.data, verifier)
}

