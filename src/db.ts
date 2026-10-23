// Copia local en IndexedDB (clave → valor), separada por cuenta de Google.
// Sin IndexedDB (pruebas en Node) usa memoria: la app funciona pero no recuerda al cerrar.
let prefix = ''
export const setAccount = (email: string) => { prefix = `${email}:` }

const memory = new Map<string, unknown>()
let dbp: Promise<IDBDatabase> | undefined
const open = () => new Promise<IDBDatabase>((ok, ko) => {
  const r = indexedDB.open('datheke', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('kv')
  r.onsuccess = () => ok(r.result)
  r.onerror = () => ko(r.error)
})

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await (dbp ??= open())
  return new Promise((ok, ko) => {
    const r = fn(db.transaction('kv', mode).objectStore('kv'))
    r.onsuccess = () => ok(r.result)
    r.onerror = () => ko(r.error)
  })
}

const hasIdb = typeof indexedDB !== 'undefined'
const range = (start: string) => IDBKeyRange.bound(prefix + start, `${prefix + start}￿`)

export const get = async <T>(key: string): Promise<T | undefined> =>
  hasIdb ? run('readonly', s => s.get(prefix + key)) : memory.get(prefix + key) as T

export const set = async (key: string, value: unknown) => {
  if (hasIdb) await run('readwrite', s => s.put(value, prefix + key))
  else memory.set(prefix + key, value)
}

export const del = async (key: string) => {
  if (hasIdb) await run('readwrite', s => s.delete(prefix + key))
  else memory.delete(prefix + key)
}

// Todas las entradas cuya clave empieza con `start` (ej. 'text:'), sin el prefijo.
export async function entries<T>(start: string): Promise<[string, T][]> {
  const cut = prefix.length + start.length
  if (!hasIdb) return [...memory].filter(([k]) => k.startsWith(prefix + start)).map(([k, v]) => [k.slice(cut), v as T])
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>('readonly', s => s.getAllKeys(range(start))),
    run<T[]>('readonly', s => s.getAll(range(start))),
  ])
  return keys.map((k, i) => [String(k).slice(cut), values[i]])
}

// Al salir de la cuenta: borra la copia local de esa cuenta.
export const clearAccount = async () => {
  if (hasIdb) await run('readwrite', s => s.delete(range('')))
  else for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k)
}
