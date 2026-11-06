// Inventario de todo lo que la app muestra: botones, menús, opciones del "/", títulos de ayuda y campos.
// Sirve para el diseño nuevo: antes de cambiar, se guarda la lista; después, se compara y nada puede faltar.
//   node scripts/inventario.mjs                → imprime la lista por archivo
//   node scripts/inventario.mjs --guardar      → la guarda en scripts/inventario.txt
//   node scripts/inventario.mjs --comparar     → dice qué falta respecto de scripts/inventario.txt
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const OUT = fileURLToPath(new URL('./inventario.txt', import.meta.url))
const L = 'A-Za-zÁÉÍÓÚÑáéíóúñ¿¡📌🕘⚠👁🔔✨🧮💡❗'
const patterns = [
  /\blabel: ['"`]([^'"`]{2,})['"`]/g, // menús y comandos
  /\blabel="([^"]{2,})"/g, // botones de la barra (Btn)
  /\b(?:title|aria-label|placeholder)="([^"]{2,})"/g,
  new RegExp(`>\\s*([${L}][^<>{}]{1,100}?)\\s*<`, 'gu'), // textos que se ven (botones, títulos, opciones)
  new RegExp(`\\?\\s*'([${L}][^']{2,60})'\\s*:\\s*'([${L}][^']{2,60})'`, 'gu'), // los que cambian: 'Editar' o 'Fijar'
]
const items = []
for (const file of readdirSync(SRC).filter(f => f.endsWith('.tsx'))) {
  const code = readFileSync(join(SRC, file), 'utf8')
  for (const re of patterns) for (const m of code.matchAll(re)) {
    const before = code.slice(Math.max(0, m.index - 80), m.index + (m[0].startsWith('>') ? 1 : 0))
    const cls = before.lastIndexOf('className')
    if (cls >= 0 && !before.slice(cls).includes('>')) continue // dentro de un className: estilos, no textos
    for (const g of m.slice(1).filter(Boolean)) {
      const text = g.trim().replace(/\s+/g, ' ')
      if (/[=();]|=>|\b(return|const|Promise|new)\b/.test(text) || /^[a-z]+$/.test(text)) continue // código o palabras internas
      items.push(`${file} · ${text}`)
    }
  }
}
const list = [...new Set(items)].sort((a, b) => a.localeCompare(b, 'es'))

if (process.argv.includes('--guardar')) {
  writeFileSync(OUT, list.join('\n') + '\n')
  console.log(`Guardadas ${list.length} cosas en scripts/inventario.txt`)
} else if (process.argv.includes('--comparar')) {
  if (!existsSync(OUT)) throw new Error('Primero: node scripts/inventario.mjs --guardar')
  const now = new Set(list.map(x => x.split(' · ')[1]))
  const missing = readFileSync(OUT, 'utf8').trim().split('\n').filter(x => !now.has(x.split(' · ')[1]))
  console.log(missing.length ? `FALTAN ${missing.length}:\n${missing.join('\n')}` : 'Nada falta: todo lo de antes sigue en la app.')
  process.exitCode = missing.length ? 1 : 0
} else console.log(`${list.join('\n')}\n\nTotal: ${list.length}`)
