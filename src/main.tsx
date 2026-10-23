import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Para que la app abra sin internet (etapa 3).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
