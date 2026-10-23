import { isTauri } from '@tauri-apps/api/core'
import { AuthError, getEmail, OfflineError, setRenew, setToken } from './drive.ts'

// Web: login de Google 100% en el navegador (Google Identity Services, flujo de token): sin servidor ni secreto.
// shortcut: en web Google da tokens de 1 hora sin renovación; luego un toque reconecta (sin contraseña).
// Escritorio (Tauri): login en el navegador del sistema con refresh token: la sesión queda abierta.

// Es público por diseño (va dentro de la página); se puede subir al repositorio.
const CLIENT_ID = '561260224283-pgslf9i4qll8teqtnuqhqg3ai8plmcbf.apps.googleusercontent.com'
const DESKTOP_ID = '561260224283-chjgsvuo7t5f1p9l9gk0kl8srf669u8j.apps.googleusercontent.com'
// Google no lo trata como secreto en apps instaladas, pero se pasa al compilar para no dejarlo en el repositorio público.
const DESKTOP_SECRET: string = import.meta.env.VITE_GOOGLE_DESKTOP_SECRET ?? ''
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const KEY = 'datheke-sesion'
export const desktop = isTauri()

export type Session = { email: string; token: string; expires: number; refresh?: string }

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

type Tokens = { access_token: string; expires_in: number; scope: string; refresh_token?: string }
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const DONE_PAGE = '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:48px">'
  + '<h2>Listo ✅</h2><p>Ya puedes cerrar esta pestaña y volver a Datheke.</p>'

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: DESKTOP_ID, client_secret: DESKTOP_SECRET, ...params }),
  }).catch(() => { throw new OfflineError('Sin conexión.') })
  const data = await res.json()
  if (!res.ok) throw new AuthError(data.error_description ?? data.error ?? 'Google no aceptó el inicio de sesión.')
  return data
}

// Escritorio: Google vuelve a un servidor local de la app (127.0.0.1). PKCE: solo esta app puede canjear el código.
async function desktopLogin(email?: string): Promise<Tokens> {
  const { start, cancel, onUrl } = await import('@fabianlars/tauri-plugin-oauth')
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = crypto.randomUUID()
  const port = await start({ response: DONE_PAGE })
  const redirect_uri = `http://127.0.0.1:${port}`
  let done!: (p: URLSearchParams) => void
  const answer = new Promise<URLSearchParams>(resolve => { done = resolve })
  const unlisten = await onUrl(url => {
    const p = new URL(url).searchParams
    if (p.get('state') === state) done(p)
  })
  try {
    await openUrl(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: DESKTOP_ID, redirect_uri, response_type: 'code', scope: SCOPE, state,
      code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
      ...(email ? { login_hint: email } : {}),
    })}`)
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Se acabó el tiempo para entrar. Intenta de nuevo.')), 300_000))
    const code = (await Promise.race([answer, timeout])).get('code')
    if (!code) throw new Error('No se completó el inicio de sesión.')
    return await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri })
  } finally {
    unlisten()
    cancel(port).catch(() => {})
  }
}

// Al abrir la app con una sesión guardada. En escritorio la sesión se renueva sola con el refresh token.
let renewing: Promise<string> | null = null
export function resume(session: Session) {
  setToken(session.token)
  const refresh = session.refresh
  setRenew(refresh ? () => renewing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })
    .then(t => {
      localStorage.setItem(KEY, JSON.stringify({ ...session, token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 }))
      return t.access_token
    })
    .finally(() => { renewing = null }) : undefined)
}

// Debe llamarse desde un clic. Web: Google abre una ventana (si ya conoce el correo, se cierra sola). Escritorio: abre el navegador.
export async function signIn(email?: string): Promise<Session> {
  let session: Session
  if (desktop) {
    const t = await desktopLogin(email)
    if (!t.scope.split(' ').includes(SCOPE)) throw new Error('Falta marcar el permiso de Google Drive.')
    session = { token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000, refresh: t.refresh_token, email: '' }
  } else session = { ...await requestToken(email), email: '' }
  setToken(session.token)
  session.email = await getEmail()
  // La copia local es de una cuenta: entrar con otra mezclaría las notas de dos personas.
  if (email && session.email !== email) {
    setToken('')
    throw new Error(`Entraste con ${session.email}, pero esta sesión es de ${email}. Para cambiar de cuenta usa "Salir".`)
  }
  localStorage.setItem(KEY, JSON.stringify(session))
  resume(session)
  return session
}
