import { desktop } from './auth.ts'
import { newer } from './version.ts'

declare const __VERSION__: string // vite.config.ts

// ¿Hay una versión más nueva? Siempre se mira la última publicada: con la 3 instalada y ya salidas la 4 y la 5, ofrece la 5.
// Apps (Android y Windows): la última "release" de GitHub, con su archivo para este aparato (.apk o .exe).
// Web (Mac, iPhone, PC): version.json del sitio; actualizar es recargar la página.
const LATEST = 'https://api.github.com/repos/datheke/datheke.github.io/releases/latest'
const android = desktop && /android/i.test(navigator.userAgent)
export const CURRENT = __VERSION__

export type Update = { version: string; url: string } // url vacía: es la web, se actualiza recargando

export async function checkUpdate(): Promise<Update | null> {
  try {
    if (!desktop) {
      const { version } = await (await fetch('./version.json', { cache: 'no-store' })).json()
      return newer(version, CURRENT) ? { version, url: '' } : null
    }
    const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const release: { tag_name: string; assets: { name: string; browser_download_url: string }[] } = await res.json()
    const version = release.tag_name.replace(/^v/, '')
    const file = release.assets.find(a => a.name.endsWith(android ? '.apk' : '.exe'))
    return file && newer(version, CURRENT) ? { version, url: file.browser_download_url } : null
  } catch { return null } // sin internet o GitHub no responde: se intenta más tarde
}

export async function getUpdate(u: Update) {
  if (!u.url) return location.reload()
  if (desktop) (await import('@tauri-apps/plugin-opener')).openUrl(u.url)
  else window.open(u.url, '_blank', 'noopener')
}
