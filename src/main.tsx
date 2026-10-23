import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
