// Fuentes incluidas en la app (main.tsx, fonts.css): se ven igual en PC, celular y web, también sin internet.
// Sin elegir, el texto va con la letra de la nota (Lora, index.css). Cada una lleva los nombres de las parecidas que
// trae lo pegado de otro lado.
export const FONTS: [value: string, label: string, similar: string[]][] = [
  ['', 'Lora', ['lora', 'lora variable']],
  ['Arial, sans-serif', 'Arial', ['arial', 'helvetica', 'helvetica neue', 'arimo', 'liberation sans']],
  ['Calibri, sans-serif', 'Calibri', ['calibri', 'calibri light', 'carlito', 'aptos']],
  ['Cambria, serif', 'Cambria', ['cambria', 'caladea']],
  ['"Courier New", monospace', 'Courier New', ['courier new', 'courier', 'cousine', 'liberation mono']],
  ['Garamond, serif', 'Garamond', ['garamond', 'eb garamond']],
  ['Georgia, serif', 'Georgia', ['georgia', 'gelasio']],
  ['"Times New Roman", serif', 'Times New Roman', ['times new roman', 'times', 'tinos', 'liberation serif']],
  ['"Inter Variable", sans-serif', 'Moderna', ['inter', 'inter variable', 'segoe ui', 'roboto', 'system-ui', '-apple-system']],
  ['"JetBrains Mono Variable", monospace', 'Monoespaciada', ['jetbrains mono', 'jetbrains mono variable', 'consolas', 'menlo', 'monaco']],
  ['"Caveat Variable", cursive', 'Manuscrita', ['caveat', 'caveat variable']],
]

// La fuente de la app para un font-family de afuera: la primera que tengamos o una parecida; si ninguna, '' (la letra
// de la nota). 'sans-serif' y demás genéricas no cuentan: si no, lo desconocido saldría con la letra del aparato.
export function appFont(fontFamily: string): string {
  for (const name of fontFamily.split(',').map(n => n.replace(/["']/g, '').trim().toLowerCase())) {
    const font = FONTS.find(([, , similar]) => similar.includes(name))
    if (font) return font[0]
  }
  return ''
}
