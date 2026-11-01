import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuentes dentro de la app: el texto se ve igual en Windows, Android, iPhone y la web, también sin internet.
import '@fontsource-variable/inter'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/lora'
import '@fontsource-variable/lora/wght-italic.css'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/caveat'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { desktop } from './auth.ts'

// Para que la web abra sin internet (etapa 3). La app de escritorio ya trae sus archivos.
if ('serviceWorker' in navigator && !desktop) navigator.serviceWorker.register('./sw.js')

// Apps: los enlaces de las notas (páginas, correos, teléfonos) se abren en el navegador, el correo o el marcador del
// aparato. Si no, la app misma iba al enlace y con un correo quedaba en "Página web no disponible".
if (desktop) {
  const open = (url: string) => { import('@tauri-apps/plugin-opener').then(o => o.openUrl(url)).catch(() => {}) }
  window.open = url => { if (url) open(String(url)); return null }
  document.addEventListener('click', e => {
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || a.href.startsWith(location.origin) || a.closest('[contenteditable="true"]')) return // editando: lo abre window.open
    e.preventDefault()
    open(a.href)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
