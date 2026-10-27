// Fecha corta de la lista de notas, como Evernote: la hora si es de hoy, "Ayer", "19 oct" este año, "15/5/25" antes.
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86400000)
  if (days === 0) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Ayer'
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '')
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`
}
