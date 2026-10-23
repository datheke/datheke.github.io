import { getEmail, setToken } from './drive.ts'

// Login de Google 100% en el navegador (Google Identity Services, flujo de token): sin servidor ni secreto.
// shortcut: en web Google da tokens de 1 hora sin renovación; luego un toque reconecta (sin contraseña).
// Las apps instalables (etapa 4) podrán dejar la sesión abierta con refresh tokens.

// Es público por diseño (va dentro de la página); se puede subir al repositorio.
const CLIENT_ID = '561260224283-pgslf9i4qll8teqtnuqhqg3ai8plmcbf.apps.googleusercontent.com'
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const KEY = 'notas-david-sesion'

export type Session = { email: string; token: string; expires: number }

type TokenResponse = { access_token: string; expires_in: number; scope: string; error?: string }
declare const google: {
  accounts: { oauth2: { initTokenClient(config: {
    client_id: string
    scope: string
    callback: (r: TokenResponse) => void
    error_callback: (e: { type: string }) => void
  }): { requestAccessToken(o: { prompt: string; login_hint?: string }): void } } }
}

export function loadSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null }
}

export const forgetSession = () => localStorage.removeItem(KEY)

function requestToken(email?: string): Promise<{ token: string; expires: number }> {
  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined') return reject(new Error('Google aún no carga, intenta de nuevo.'))
    google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: r => {
        if (r.error) reject(new Error(r.error))
        else if (!r.scope.split(' ').includes(SCOPE)) reject(new Error('Falta marcar el permiso de Google Drive.'))
        else resolve({ token: r.access_token, expires: Date.now() + (r.expires_in - 60) * 1000 })
      },
      error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : e.type)),
    }).requestAccessToken({ prompt: email ? '' : 'select_account', login_hint: email })
  })
}

// Debe llamarse desde un clic: Google abre una ventana. Si ya conoce el correo, se cierra sola.
export async function signIn(email?: string): Promise<Session> {
  const { token, expires } = await requestToken(email)
  setToken(token)
  const session = { token, expires, email: email ?? await getEmail() }
  localStorage.setItem(KEY, JSON.stringify(session))
  return session
}
