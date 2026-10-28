import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// La versión de las apps (tauri.conf.json) también se muestra en la tarjeta de la cuenta.
const version = JSON.parse(readFileSync('./src-tauri/tauri.conf.json', 'utf8')).version

// https://vite.dev/config/
export default defineConfig({
  base: './', // rutas relativas: funciona en localhost y en GitHub Pages
  // version.json: la web abierta (Mac, iPhone) lo mira para avisar que hay una versión nueva (update.ts).
  plugins: [react(), { name: 'version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) }) } }],
  define: { __VERSION__: JSON.stringify(version) },
})
