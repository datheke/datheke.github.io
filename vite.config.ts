import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './', // rutas relativas: funciona en localhost y en GitHub Pages
  plugins: [react()],
})
