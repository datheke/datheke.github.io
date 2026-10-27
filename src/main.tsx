import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuentes dentro de la app: el texto se ve igual en Windows, Android, iPhone y la web, también sin internet.
import '@fontsource-variable/inter'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/lora'
import '@fontsource-variable/lora/wght-italic.css'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/caveat'
import './index.css'
import App from './App.tsx'
import { desktop } from './auth.ts'

// Para que la web abra sin internet (etapa 3). La app de escritorio ya trae sus archivos.
if ('serviceWorker' in navigator && !desktop) navigator.serviceWorker.register('./sw.js')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
