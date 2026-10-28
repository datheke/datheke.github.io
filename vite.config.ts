import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// La versión de las apps (tauri.conf.json) también se muestra en la tarjeta de la cuenta.
const version = JSON.parse(readFileSync('./src-tauri/tauri.conf.json', 'utf8')).version

// https://vite.dev/config/
export default defineConfig({
  base: './', // rutas relativas: funciona en localhost y en GitHub Pages
  plugins: [react()],
  define: { __VERSION__: JSON.stringify(version) },
})
