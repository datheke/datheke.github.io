import {
  Bell, Users, Check, CheckSquare, ChevronLeft, CircleCheck, Circle, X as XIcon, FolderInput, RotateCcw, FileDown, Send, ChevronRight, FilePlus, FileText, GripVertical, KeyRound, LayoutTemplate, Lock, LockKeyhole, Maximize2, Minimize2, Notebook,
  PanelLeftClose, PanelLeftOpen, Pencil, Plus, RefreshCw, Shield, ShieldCheck, ShieldOff, Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { connectCalendar, desktop, forgetSession, hasCalendar, loadSession, resume, signIn } from './auth.ts'
import { deleteCalendar, ensureCalendar, syncCalendar, type Item as CalItem } from './calendar.ts'
import { AuthError, OfflineError, readNote, type DriveFile } from './drive.ts'
import Editor, { Cover, EmojiPicker } from './Editor.tsx'
import { startFolder } from './folder.ts'
import { shortDate } from './format.ts'
import { imageBlob, imageDataUrl, pickImage, uploadCover } from './images.ts'
import * as shared from './shared.ts'
import { CopyDialog, ReceiveDialog, ShareDialog } from './Share.tsx'
import { cleanReminders, fileName, pack, photoIds, pickFile, send, takeReceived, unpack, type Packed } from './share.ts'
import * as store from './sync.ts'
import { TEMPLATES } from './templates.ts'
import { firstUnordered, lastUnordered, reorder } from './order.ts'
import { startSort } from './sortable.ts'
import { MoreMenu, Resizer } from './ui.tsx'
import { Account, UpdateToast } from './Account.tsx'
import { checkUpdate, type Update } from './update.ts'
import { ReminderHelp, type ReminderMode } from './Reminders.tsx'
import { ReminderDialog } from './ReminderDialog.tsx'
import { agenda, type Source } from './agenda.ts'
import * as notify from './notify.ts'
import { chipText, groupOf, markDone, remindersIn, repeatText, sortReminders, updateIn, type Group, type Reminder } from './remind.ts'
import * as vault from './vault.ts'
import { buildZip, changedSince, EVERY_MS, NeedsPermission, upload as uploadBackup } from './backup.ts'
import { canOfferPrint, forgetPrint } from './print.ts'
import { ChangeKey, Create as CreateKey, PrintOffer, Unlock } from './Vault.tsx'

const UNTITLED = store.UNTITLED
// Basurero: días que le quedan a una nota borrada, y la fecha que se le pone al borrarla.
const TRASH_DAYS = 30
const daysLeft = (f: DriveFile) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - Date.parse(f.appProperties?.borrada ?? '')) / 86400_000))
const nowIso = () => new Date().toISOString()
const backupOld = (last: string) => !last || Date.parse(last) + EVERY_MS < Date.now()
const byName = (a: DriveFile, b: DriveFile) => a.name.localeCompare(b.name)
const byDate = (a: DriveFile, b: DriveFile) => b.modifiedTime.localeCompare(a.modifiedTime)
const isTemplates = (f: DriveFile) => f.appProperties?.templates === 'true' // libreta "Plantillas"
const parentOf = (n: DriveFile) => n.appProperties?.parent
const messageOf = (e: unknown) => e instanceof AuthError ? 'auth'
  : e instanceof OfflineError ? 'Sin conexión: esto necesita internet.' : e instanceof Error ? e.message : String(e)
// Vista previa en texto de la otra versión (DOMParser no ejecuta nada de lo que lee).
const plain = (html: string) =>
  new DOMParser().parseFromString(html.replace(/<\/(p|li|h\d|div|summary)>|<br\s*\/?>/gi, '\n'), 'text/html').body.textContent ?? ''
// Recordatorios de una nota (remind.ts). Se guardan por texto, como las vistas previas: no se leen en cada tecla.
const reminderCache = new Map<string, ReturnType<typeof remindersIn>>()
function remindersOf(html: string) {
  if (!html.includes('data-type="recordatorio"')) return []
  let r = reminderCache.get(html)
  if (!r) {
    if (reminderCache.size > 300) reminderCache.clear()
    r = remindersIn(html)
    reminderCache.set(html, r)
  }
  return r
}
// Las primeras palabras de la nota para su tarjeta. Se guardan por texto: la lista se vuelve a dibujar en cada tecla.
const previews = new Map<string, string>()
function preview(html = '') {
  let p = previews.get(html)
  if (p === undefined) {
    if (previews.size > 500) previews.clear()
    p = plain(html).replace(/\s+/g, ' ').trim().slice(0, 160)
    previews.set(html, p)
  }
  return p
}

// Ancho de las columnas, lista oculta y pantalla completa: son de cada aparato (las pantallas no son iguales) y solo
// valen en pantallas anchas; en el celular se ve una columna a la vez. Sin poder guardar, va el diseño de siempre.
type Layout = { sidebar: number; list: number; listHidden: boolean; expanded: boolean }
const LAYOUT: Layout = { sidebar: 240, list: 320, listHidden: false, expanded: false }
const LIMITS = { sidebar: [180, 360], list: [240, 480] } as const
const MIN_EDITOR = 380
function loadLayout(): Layout {
  try { return { ...LAYOUT, ...JSON.parse(localStorage.getItem('datheke-diseno') ?? '{}') } } catch { return LAYOUT }
}

export default function App() {
  const [session, setSession] = useState(loadSession)
  const s = useSyncExternalStore(store.subscribe, store.getState)
  const [ready, setReady] = useState(false) // copia local cargada
  const [notebookId, setNotebookId] = useState<string | null>(null) // null = todas
  const [trashView, setTrashView] = useState(false) // la lista muestra el basurero
  const [selected, setSelected] = useState<Set<string> | null>(null) // seleccionar varias notas (null: no se está seleccionando)
  const [remindView, setRemindView] = useState(false) // la lista muestra los recordatorios
  // Ventana de un recordatorio: uno que ya está en una línea (id) o uno nuevo (insert lo pone en la línea del cursor).
  const [received, setReceived] = useState<{ p: Packed; notebook: string } | null>(null) // nota .datheke recibida, por agregar
  const [shareOpen, setShareOpen] = useState(false) // ventana "Compartir"
  const [recvMenu, setRecvMenu] = useState(false) // "Nota recibida": archivo o compartida conmigo
  const [copyAsk, setCopyAsk] = useState<{ who: string; resolve: (v: 'copia' | 'quitar' | null) => void } | null>(null)
  const [toast, setToast] = useState<string | null>(null) // aviso corto abajo (se va solo)
  const [remDlg, setRemDlg] = useState<{ noteId: string; id?: string; label: string; insert?: (r: Reminder) => void } | null>(null)
  const [focusRem, setFocusRem] = useState<string>() // al abrir una nota desde la lista: ir a esa línea
  const [noteId, setNoteId] = useState<string | null>(null)
  const [picker, setPicker] = useState(false) // selector de ícono de la nota
  const [problem, setProblem] = useState<string | null>(null) // error de una acción ('auth' = sesión vencida)
  const [waiting, setWaiting] = useState(false) // escritorio: esperando que termine el login en el navegador
  const [layout, setLayout] = useState(loadLayout)
  // Al escribir en la nota (título o texto) la portada se esconde, y vuelve al abrirla de nuevo.
  const [writing, setWriting] = useState(false)
  // Ventana de la caja fuerte: crear la clave, abrirla antes de proteger una nota, o la clave nueva tras "olvidé la clave".
  // comun: clave común de una nota compartida (noteId). salt: de qué clave es la huella que se ofrece.
  const [keyDialog, setKeyDialog] = useState<{ mode: 'crear' | 'abrir' | 'nueva' | 'huella' | 'comun' | 'cambiar' | 'cambiar-comun'; then?: () => void; noteId?: string; salt?: string } | null>(null)
  const vaultVersion = useSyncExternalStore(vault.subscribe, vault.version) // cambia al abrir o cerrar una llave
  // Respaldo semanal (backup.ts): estado del último intento en este aparato.
  const [backup, setBackup] = useState<{ busy?: boolean; msg?: string; needsLogin?: boolean }>({})
  const backingUp = useRef(false)
  const [update, setUpdate] = useState<Update | null>(null) // versión más nueva disponible (update.ts)
  const [reminderHelp, setReminderHelp] = useState<ReminderMode | null>(null) // ventana que explica un modo de aviso
  useEffect(() => {
    try { localStorage.setItem('datheke-diseno', JSON.stringify(layout)) } catch { /* sin guardar: el diseño de siempre */ }
  }, [layout])

  const files = Object.values(s.files)
  const notebooks = files.filter(f => f.appProperties?.kind === 'notebook').sort(lastUnordered(byName))
  const templatesNb = notebooks.find(isTemplates)
  // Basurero: una nota borrada lleva la fecha en "borrada" y se elimina de verdad a los 30 días (ver efecto más abajo).
  const inTrash = (f?: DriveFile) => !!f?.appProperties?.borrada
  const allNotes = files.filter(f => f.appProperties?.kind === 'note' && !inTrash(f))
  const trash = files.filter(f => f.appProperties?.kind === 'note' && inTrash(f))
    .sort((a, b) => (b.appProperties?.borrada ?? '').localeCompare(a.appProperties?.borrada ?? ''))
  const regular = allNotes.filter(n => n.appProperties?.notebook !== templatesNb?.id) // "Todas las notas" sin plantillas
  const visible = trashView ? trash : notebookId ? allNotes.filter(n => n.appProperties?.notebook === notebookId) : regular
  // Subnotas debajo de su nota y con sangría; si la nota madre no está a la vista, la subnota va arriba. En cada nivel,
  // el orden que se les dio arrastrando; las que no tienen, arriba y la más nueva primero.
  const ids = new Set(visible.map(n => n.id))
  const shownParent = (n: DriveFile) => ids.has(parentOf(n) ?? '') ? parentOf(n) : undefined
  const siblings = (parent?: string) => visible.filter(n => shownParent(n) === parent).sort(firstUnordered(byDate))
  const tree = (parent?: string, depth = 0): [DriveFile, number][] =>
    siblings(parent).flatMap(n => [[n, depth] as [DriveFile, number], ...tree(n.id, depth + 1)])
  const list = trashView ? trash.map(n => [n, 0] as [DriveFile, number]) : tree()
  const saveOrder = (items: DriveFile[], from: number, to: number) =>
    reorder(items, from, to).forEach(({ id, orden }) => store.patch(id, { props: { orden } }))
  const descendants = (id: string): DriveFile[] => allNotes.filter(n => parentOf(n) === id).flatMap(n => [n, ...descendants(n.id)])
  // Ajustes de la cuenta (por ahora la clave de Gemini): un archivo sin contenido en la carpeta oculta de Drive,
  // así se vincula una vez y sirve en todos los aparatos de esa persona.
  const settings = files.find(f => f.appProperties?.kind === 'ajustes')
  const geminiKey = settings?.appProperties?.gemini ?? ''
  const setGeminiKey = (key: string) => act(() => {
    if (settings) store.patch(settings.id, { props: { gemini: key || null } })
    else if (key) store.create({ kind: 'ajustes', gemini: key }, 'Ajustes')
  })
  // Verificador de la clave de notas (no es la clave): va en Drive para que sirva igual en todos los aparatos.
  const verifier = settings?.appProperties?.boveda ?? ''
  const setVerifier = (v: string) => act(() => {
    if (settings) store.patch(settings.id, { props: { boveda: v } })
    else store.create({ kind: 'ajustes', boveda: v }, 'Ajustes')
  })
  const isLocked = (n?: DriveFile) => n?.appProperties?.protegida === 'true' // nota con clave
  const commonKey = (n?: DriveFile) => n?.appProperties?.clave_comun || '' // verificador de la clave común (compartida)
  const isClosed = (n?: DriveFile) => isLocked(n) && !vault.hasKey(vault.saltOf(commonKey(n))) // con clave y su llave cerrada
  // Recordatorios de todas las notas que están en este aparato (las con clave, solo con la caja abierta), por lo que falta.
  const reminders = sortReminders(allNotes.flatMap(n => {
    const t = s.texts[n.id]
    if (!t || isClosed(n)) return []
    return remindersOf(t.text).map(x => ({ ...x, note: n }))
  }).filter(x => !x.r.solo || x.r.solo.toLowerCase() === (session?.email ?? '').toLowerCase())) // "solo para" otra persona: no me suena
  const pendingReminders = reminders.filter(x => groupOf(x.r) !== 'hecho').length
  const overdue = reminders.some(x => groupOf(x.r) === 'pendiente')
  const lockedHidden = allNotes.some(n => isClosed(n))
  const nextOf = (n: DriveFile) => reminders.find(x => x.note.id === n.id && groupOf(x.r) !== 'hecho') // el más urgente de la nota
  // Cambia (o quita) un recordatorio dentro del texto de su nota; el editor se vuelve a dibujar si está abierta.
  const changeReminder = (noteId: string, id: string, r: Reminder | null) => {
    const t = s.texts[noteId]
    if (t) store.replaceText(noteId, updateIn(t.text, id, r))
  }
  const lastBackup = settings?.appProperties?.respaldo ?? ''
  // Quién avisa los recordatorios: Datheke o Google Calendar. Uno solo para toda la cuenta (en Ajustes): nunca suenan dos.
  const reminderMode: ReminderMode = settings?.appProperties?.avisos === 'calendar' ? 'calendar' : 'datheke'
  const calendarId = settings?.appProperties?.calendario
  const setSettings = (props: Record<string, string | null>) => act(() => {
    if (settings) store.patch(settings.id, { props })
    else store.create({ kind: 'ajustes', ...Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null)) as Record<string, string> }, 'Ajustes')
  })
  const [calendarHere, setCalendarHere] = useState(hasCalendar) // este aparato tiene el permiso de Calendar
  const setLastBackup = (when: string) => act(() => {
    if (settings) store.patch(settings.id, { props: { respaldo: when } })
    else store.create({ kind: 'ajustes', respaldo: when }, 'Ajustes')
  })
  const templates = templatesNb ? allNotes.filter(n => n.appProperties?.notebook === templatesNb.id).sort(byName) : []
  const note = noteId ? s.files[noteId] : undefined
  const doc = noteId ? s.texts[noteId] : undefined
  const conflict = noteId ? s.conflicts[noteId] : undefined
  const parent = note && allNotes.find(f => f.id === parentOf(note))
  const cover = note?.appProperties?.cover
  const pendingCount = Object.keys(s.pending).length
  const status = [s.offline && 'Sin conexión',
    pendingCount ? `${pendingCount} ${pendingCount === 1 ? 'cambio pendiente' : 'cambios pendientes'} de subir` : !s.offline && 'Guardado',
  ].filter(Boolean).join(' · ')
  const error = problem ?? (s.error ? messageOf(s.error) : null)
  const email = session?.email
  const hasNote = !!note
  const hasDoc = !!doc
  // Nota fijada: se lee y se copia, pero no se escribe ni se cambia de libreta. Va en Drive: igual en todos los aparatos.
  // Una nota en el basurero se ve igual: solo leer, hasta restaurarla.
  const trashed = inTrash(note)
  const locked = note?.appProperties?.locked === 'true' || trashed
  // Privada (sin Gemini): la nota sola, o todas las de una libreta (también las que se creen después).
  const isPrivate = (f?: DriveFile) => f?.appProperties?.privada === 'true'
  const noteNotebook = notebooks.find(nb => nb.id === note?.appProperties?.notebook)
  const withKey = isLocked(note)
  const sealedNote = withKey && isClosed(note) // con clave y la caja cerrada: se pide la clave en lugar de la nota
  // Una nota con clave también es privada: Gemini nunca la lee.
  const privacy = isPrivate(noteNotebook) ? 'libreta' as const : isPrivate(note) || withKey ? 'nota' as const : null
  const setPrivate = (f: DriveFile, on: boolean) => store.patch(f.id, { props: { privada: on ? 'true' : null } })
  const notebookName = notebooks.find(nb => nb.id === notebookId)?.name
  const countOf = (nbId: string) => allNotes.filter(n => n.appProperties?.notebook === nbId).length
  const columns = layout.expanded ? 'minmax(0, 1fr)'
    : `${layout.sidebar}px 6px ${layout.listHidden ? '' : `${layout.list}px 6px `}minmax(0, 1fr)`
  const appClass = ['app', noteId && 'con-nota', layout.expanded && 'expandida', layout.listHidden && 'sin-lista'].filter(Boolean).join(' ')

  // Cada columna entre su mínimo y su máximo, y la nota con al menos MIN_EDITOR de ancho.
  function resize(which: 'sidebar' | 'list', width: number) {
    setLayout(l => {
      const other = which === 'sidebar' ? (l.listHidden ? 0 : l.list) : l.sidebar
      const max = Math.min(LIMITS[which][1], window.innerWidth - other - MIN_EDITOR - 12)
      return { ...l, [which]: Math.round(Math.max(LIMITS[which][0], Math.min(max, width))) }
    })
  }

  const fail = (e: unknown) => setProblem(messageOf(e))
  // Crear necesita un id reservado; sin internet y sin ids avisa en vez de fallar en silencio.
  const act = (fn: () => void) => { try { fn() } catch (e) { fail(e) } }

  useEffect(() => { if (session) resume(session) }, [session])

  useEffect(() => {
    if (!email) return
    store.start(email).then(() => setReady(true), e => setProblem(messageOf(e)))
    const stopFolder = desktop ? startFolder(email) : undefined // copia visible en Documentos/Datheke
    // Al volver a la app, al recuperar internet y cada 30 s mientras está a la vista (o con cambios pendientes): así lo
    // cambiado en otro dispositivo llega solo, aunque esta ventana nunca se haya escondido (PC con la nota abierta).
    const sync = () => { store.sync() }
    const retry = setInterval(() => {
      if (document.visibilityState === 'visible' || Object.keys(store.getState().pending).length) sync()
    }, 30000)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    return () => {
      clearInterval(retry)
      stopFolder?.()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('online', sync)
      window.removeEventListener('focus', sync)
    }
  }, [email])

  // Nota que aún no se bajó a este dispositivo.
  useEffect(() => {
    if (noteId && hasNote && !hasDoc) store.ensureText(noteId).catch(e => setProblem(messageOf(e)))
  }, [noteId, hasNote, hasDoc, vaultVersion])

  // Lo que lleva más de 30 días en el basurero se elimina (en cualquier aparato que esté abierto, ya sincronizado).
  useEffect(() => {
    if (!ready || !s.synced) return
    for (const t of trash) if (daysLeft(t) === 0) store.remove(t.id)
  }, [ready, s.synced, trash])

  // Respaldo: a mano ("Hacer ahora") o solo, una vez por semana y solo si hubo cambios. Va sin cifrar (backup.ts).
  async function doBackup(manual: boolean) {
    if (backingUp.current) return
    backingUp.current = true
    setBackup({ busy: true, msg: 'Haciendo el respaldo…' })
    try {
      await uploadBackup(await buildZip())
      setLastBackup(nowIso())
      setBackup({ msg: manual ? 'Listo: está en tu Drive, carpeta "Datheke".' : undefined })
    } catch (e) {
      if (e instanceof NeedsPermission) setBackup({ needsLogin: true, msg: 'Para guardar el respaldo en tu Drive, Datheke necesita un permiso más.' })
      else setBackup({ msg: `No se pudo hacer el respaldo: ${messageOf(e) === 'auth' ? 'la sesión venció' : messageOf(e)}` })
    } finally { backingUp.current = false }
  }

  const backupDue = ready && s.synced && !s.offline && !backup.needsLogin
    && backupOld(lastBackup) && changedSince(files, lastBackup)
  useEffect(() => { if (backupDue) queueMicrotask(() => doBackup(false)) }, [backupDue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Versión nueva: se mira al abrir la app y luego cada hora (cada 10 minutos mientras no haya nada nuevo).
  useEffect(() => {
    let last = 0
    const check = () => {
      if (Date.now() - last < 3600_000) return
      last = Date.now()
      // Si no hay nada (o la versión del celular aún se está publicando), se vuelve a mirar en 10 minutos.
      checkUpdate().then(u => { setUpdate(u); if (!u) last = Date.now() - 3000_000 })
    }
    const first = setTimeout(check, 3000)
    const every = setInterval(check, 10 * 60_000)
    const back = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', back)
    return () => { clearTimeout(first); clearInterval(every); document.removeEventListener('visibilitychange', back) }
  }, [])

  // La caja fuerte se cierra sola tras 5 minutos sin tocar la app (también si quedó en segundo plano).
  useEffect(() => {
    const touch = () => vault.touch()
    const check = () => { if (vault.any() && vault.idleFor() > vault.AUTO_LOCK_MS) store.closeVault() }
    const every = setInterval(check, 15000)
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(every)
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  // Compartida y activa (no dejada de compartir): su clave es común para todos (ver protect).
  const activeShare = (n?: DriveFile) => n?.appProperties?.compartida && n.appProperties.fin !== 'true' && !n.appProperties.estado ? n.appProperties.compartida : ''

  // Proteger: la primera vez se crea la clave; si la caja está cerrada, se abre primero.
  // En una compartida es una clave común: la misma para todos los que la tienen (se dice en persona).
  function protect(n: DriveFile) {
    if (activeShare(n)) return setKeyDialog({ mode: 'comun', noteId: n.id })
    const go = () => store.patch(n.id, { props: { protegida: 'true' } })
    if (!verifier) setKeyDialog({ mode: 'crear', then: go })
    else if (!vault.unlocked()) setKeyDialog({ mode: 'abrir', then: go })
    else go()
  }
  async function setCommonKey(n: DriveFile, v: string) {
    const fileId = activeShare(n)
    store.patch(n.id, { props: { protegida: 'true', clave_comun: v } })
    await store.resealAll()
    if (fileId) await shared.setProps(fileId, { clave: v })
  }

  function unprotect(n: DriveFile) {
    const fileId = activeShare(n)
    if (!confirm(`¿Quitar la clave a "${n.name || UNTITLED}"? Se podrá ver sin clave en este y tus otros aparatos${fileId ? ', y también para las personas con quienes la compartes' : ''}.`)) return
    store.patch(n.id, { props: { protegida: null, clave_comun: null } })
    if (fileId) shared.setProps(fileId, { clave: null }).catch(fail)
  }

  // Cambiar clave (la tuya o la común de una compartida): todo lo abierto se cifra con la nueva y la huella se vuelve a ofrecer.
  async function changedKey(v: string, oldSalt: string, noteId?: string) {
    if (noteId) {
      const n = s.files[noteId]
      if (n) await setCommonKey(n, v)
    } else {
      setVerifier(v)
      await store.resealAll()
    }
    forgetPrint(noteId ? oldSalt : undefined)
    vault.forget(oldSalt)
    const salt = noteId ? vault.saltOf(v) : undefined
    setToast(noteId ? 'Listo: clave común cambiada. Dile la nueva a las otras personas.' : 'Listo: tu clave de notas cambió en todos tus aparatos.')
    if (await canOfferPrint(salt)) setKeyDialog({ mode: 'huella', salt })
    else setKeyDialog(null)
  }

  // Nadie recuerda la clave común: se vuelve a entrar con Google y se le quita la clave a la nota (para todos).
  async function forgotCommonKey(n: DriveFile) {
    if (!confirm('Para quitarle la clave a esta nota (para todos los que la tienen) tienes que volver a entrar con tu cuenta de Google. ¿Seguir?')) return
    try {
      setSession(await signIn(session?.email))
      store.patch(n.id, { props: { protegida: null, clave_comun: null } })
      const fileId = activeShare(n)
      if (fileId) await shared.setProps(fileId, { clave: null })
      setToast('Listo: la nota ya no tiene clave. Puedes ponerle una nueva desde ⋯.')
    } catch (e) { fail(e) }
  }

  // Tras "olvidé la clave", sin clave nueva: todas las notas quedan sin clave (en todos los aparatos) y la copia de
  // cada aparato se vuelve a bajar de Drive sin cifrar. Para volver a protegerlas se crea una clave nueva.
  function removeAllKeys() {
    const withKeyNotes = files.filter(n => isLocked(n) && !commonKey(n)) // las de clave común no dependen de tu clave
    if (!confirm(`¿Quitar la clave a ${withKeyNotes.length} nota(s)? Se verán sin clave en todos tus aparatos.`)) return
    for (const n of withKeyNotes) store.patch(n.id, { props: { protegida: null } })
    if (settings) store.patch(settings.id, { props: { boveda: null } })
    store.closeVault()
    setKeyDialog(null)
  }

  // Olvidé la clave: se vuelve a entrar con Google (prueba que es el dueño) y se pone una clave nueva. Las notas se
  // vuelven a bajar de Drive, donde están sin cifrar; en los otros aparatos se abren con la clave nueva.
  async function forgotKey() {
    if (!confirm('Para poner una clave nueva tienes que volver a entrar con tu cuenta de Google (necesita internet). ¿Seguir?')) return
    try {
      setSession(await signIn(session?.email))
      setKeyDialog({ mode: 'nueva' })
    } catch (e) { fail(e) }
  }

  async function login() {
    if (desktop) setProblem(null)
    setWaiting(desktop)
    try {
      setSession(await signIn(session?.email))
      setProblem(null)
      store.sync()
    } catch (e) { fail(e) } finally { setWaiting(false) }
  }

  async function logout() {
    if (pendingCount && !confirm(`Hay ${pendingCount} cambios sin subir a Drive; si sales se pierden. ¿Salir igual?`)) return
    await store.clearLocal()
    forgetSession()
    location.reload()
  }

  function open(id: string | null) {
    setNoteId(id)
    setFocusRem(undefined)
    setPicker(false)
    setWriting(false)
  }

  // Avisos de los recordatorios (notify.ts): se programan de nuevo cada vez que cambian.
  const sources: Source[] = reminders.map(x => ({ r: x.r, label: x.label, noteId: x.note.id, noteTitle: x.note.name || UNTITLED, locked: isLocked(x.note) }))
  const knownNotes = allNotes.filter(n => s.texts[n.id] && !isClosed(n)).map(n => n.id)
  const agendaKey = JSON.stringify(sources.map(x => [x.noteId, x.r, x.label, x.locked])) + knownNotes.join()
  useEffect(() => {
    if (!ready) return
    if (reminderMode === 'calendar') notify.clear()
    else notify.schedule(agenda(sources), new Set(knownNotes))
  }, [ready, agendaKey, reminderMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Google Calendar: copia los recordatorios al calendario "Datheke" y trae lo que se cambió o borró allá.
  // Al cambiar algo (a los 3 s), al volver a la app y cada 5 minutos. Solo en aparatos con el permiso de Calendar.
  const calRef = useRef<() => Promise<void>>(async () => {})
  calRef.current = async () => {
    if (reminderMode !== 'calendar' || !calendarHere || !ready) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const cal = await ensureCalendar(calendarId, tz)
    if (cal !== calendarId) setSettings({ calendario: cal })
    const items: CalItem[] = reminders.map(x => ({ noteId: x.note.id, r: x.r, label: x.label, noteTitle: x.note.name || UNTITLED, locked: isLocked(x.note) }))
    const pulls = await syncCalendar(cal, items, { known: new Set(knownNotes), live: new Set(allNotes.map(n => n.id)), synced: s.synced })
    // Lo que se cambió en Calendar va a la nota (todas las de una nota juntas).
    const byNote = new Map<string, typeof pulls>()
    for (const p of pulls) byNote.set(p.noteId, [...byNote.get(p.noteId) ?? [], p])
    for (const [noteId, ps] of byNote) {
      const t = store.getState().texts[noteId]
      if (t) store.replaceText(noteId, ps.reduce((html, p) => updateIn(html, p.rid, p.r), t.text))
    }
  }
  const calBusy = useRef(false)
  const calWarned = useRef(false)
  const runCalendar = async () => {
    if (calBusy.current) return
    calBusy.current = true
    try { await calRef.current() } catch (e) {
      const st = (e as { status?: number }).status
      if (st === 403 && !calWarned.current) {
        calWarned.current = true
        setToast('Google Calendar no respondió: falta activar la API de Google Calendar en el proyecto de Datheke (lo hace una vez el dueño de la app).')
      } else console.error('Google Calendar', e)
    } finally { calBusy.current = false }
  }
  useEffect(() => {
    if (!ready || reminderMode !== 'calendar' || !calendarHere) return
    const t = setTimeout(runCalendar, 3000)
    return () => clearTimeout(t)
  }, [ready, agendaKey, reminderMode, calendarHere, calendarId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (reminderMode !== 'calendar' || !calendarHere) return
    const every = setInterval(runCalendar, 5 * 60_000)
    const back = () => { if (document.visibilityState === 'visible') runCalendar() }
    document.addEventListener('visibilitychange', back)
    return () => { clearInterval(every); document.removeEventListener('visibilitychange', back) }
  }, [reminderMode, calendarHere]) // eslint-disable-line react-hooks/exhaustive-deps
  // De vuelta a avisos de Datheke: se borra el calendario "Datheke" (desde un aparato con el permiso).
  useEffect(() => {
    if (!ready || reminderMode !== 'datheke' || !calendarId || !calendarHere) return
    deleteCalendar(calendarId).then(() => setSettings({ calendario: null })).catch(e => console.error('Borrar el calendario', e))
  }, [ready, reminderMode, calendarId, calendarHere]) // eslint-disable-line react-hooks/exhaustive-deps

  // Elegir quién avisa (ventana de ayuda → botón). Calendar pide el permiso de Google en este aparato (desde un clic).
  async function pickMode(m: ReminderMode) {
    setReminderHelp(null)
    if (m === 'datheke') {
      setSettings({ avisos: null })
      setToast(calendarId && !calendarHere
        ? 'Listo: avisa Datheke. El calendario «Datheke» se borrará al abrir Datheke en un aparato conectado a Calendar.'
        : 'Listo: los recordatorios los avisa Datheke.')
      return
    }
    try {
      const ok = await connectCalendar(session!.email)
      setCalendarHere(ok)
      if (!ok) return setToast('No se marcó el permiso de Google Calendar. Inténtalo de nuevo y marca la casilla del calendario.')
      if (reminderMode !== 'calendar') setSettings({ avisos: 'calendar' })
      setToast('Listo: tus recordatorios van a Google Calendar (calendario «Datheke») y Calendar es quien avisa.')
    } catch (e) { fail(e) }
  }

  // Botones de la notificación (Android) y tocarla: abrir la nota en esa línea o marcar hecho.
  const notifyRef = useRef({ open: (_n: string, _r: string) => {}, done: (_n: string, _r: string) => {} })
  useEffect(() => {
    notifyRef.current = {
      open: (noteId, rid) => { setTrashView(false); open(noteId); setFocusRem(rid) },
      done: (noteId, rid) => {
        const x = reminders.find(y => y.note.id === noteId && y.r.id === rid)
        if (x) changeReminder(noteId, rid, markDone(x.r))
        else { open(noteId); setFocusRem(rid) } // con clave y la caja cerrada: se abre para marcarlo ahí
      },
    }
  })
  useEffect(() => {
    let stop: (() => void) | undefined
    notify.start({ open: (n, r) => notifyRef.current.open(n, r), done: (n, r) => notifyRef.current.done(n, r),
      snoozed: at => setToast(`Listo: te lo vuelvo a recordar a las ${new Date(at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}.`) }).then(f => { stop = f })
    notify.autostart()
    return () => stop?.()
  }, [])

  function renameNotebook(nb: DriveFile) {
    const name = prompt('Nuevo nombre de la libreta', nb.name)?.trim()
    if (name) store.patch(nb.id, { name })
  }

  function deleteNotebook(nb: DriveFile) {
    if (allNotes.some(n => n.appProperties?.notebook === nb.id)) return alert('La libreta tiene notas. Muévelas o bórralas primero.')
    if (!confirm(`¿Borrar la libreta "${nb.name}"?`)) return
    store.remove(nb.id)
    setNotebookId(null)
  }

  // Una subnota va en la libreta de su nota madre.
  function newNote(title = '', html = '', parentId?: string) {
    act(() => {
      const nbId = (parentId ? note?.appProperties?.notebook : notebookId)
        ?? notebooks.find(nb => !isTemplates(nb))?.id ?? store.create({ kind: 'notebook' }, 'Mis notas')
      open(store.create({ kind: 'note', notebook: nbId, ...(parentId ? { parent: parentId } : {}) }, title, html, 'text/html'))
    })
  }

  async function fromTemplate(value: string) {
    const builtIn = TEMPLATES.find(t => t.title === value)
    if (builtIn) return newNote(builtIn.title, builtIn.html)
    const tpl = s.files[value]
    if (!tpl) return
    try {
      newNote(tpl.name === UNTITLED ? '' : tpl.name, s.texts[tpl.id]?.text ?? await readNote(tpl.id, tpl.mimeType))
    } catch (e) { fail(e) }
  }

  // Enviar copia (share.ts): la nota en un archivo .datheke por WhatsApp, correo, etc.
  async function sendCopy() {
    if (!note || !doc) return
    if (sealedNote) return setKeyDialog({ mode: 'abrir', then: () => { sendCopy() } })
    if (withKey && !confirm('Esta nota tiene clave. La copia va SIN clave: quien la reciba podrá leerla. ¿Enviarla igual?')) return
    try {
      setToast('Preparando la copia…')
      const html = cleanReminders(doc.text)
      const cover = note.appProperties?.cover
      const photos: Record<string, Uint8Array> = {}
      for (const id of [...photoIds(html), ...(cover ? [cover] : [])])
        photos[id] = new Uint8Array(await (await imageBlob(id)).arrayBuffer())
      const r = await send(pack({ title: doc.title || UNTITLED, html, icon: note.appProperties?.icon, cover, photos }), fileName(doc.title || UNTITLED))
      setToast(r === 'compartido' ? null : r === 'descargado' ? 'La copia se descargó: adjúntala en WhatsApp o en un correo.' : `La copia quedó en ${r}`)
    } catch (e) { setToast(null); fail(e) }
  }

  // Abrir una nota recibida: se elige el archivo y se pregunta en qué libreta va.
  async function openReceived() {
    const file = await pickFile()
    if (!file) return
    try {
      const p = unpack(new Uint8Array(await file.arrayBuffer()))
      setReceived({ p, notebook: notebookId ?? notebooks.find(nb => !isTemplates(nb))?.id ?? '' })
    } catch (e) { fail(e) }
  }

  // ---- Notas compartidas (shared.ts) ----
  const shareOf = (n?: DriveFile) => {
    const p = n?.appProperties ?? {}
    return p.compartida ? { id: p.compartida, owner: p.rol === 'dueño', fin: p.fin === 'true', estado: p.estado, dueno: p.dueno, por: p.por, en: p.en,
      con: Object.keys(p).filter(k => /^con\d+$/.test(k)).sort().map(k => p[k]) } : undefined
  }
  const conProps = (n: DriveFile, emails: string[]) => {
    const props: Record<string, string | null> = {}
    for (const k of Object.keys(n.appProperties ?? {})) if (/^con\d+$/.test(k)) props[k] = null
    ;[...new Set(emails.map(e => e.toLowerCase()))].forEach((e, i) => { props[`con${i}`] = e })
    return props
  }
  const askCopy = (who: string) => new Promise<'copia' | 'quitar' | null>(resolve => setCopyAsk({ who, resolve: v => { setCopyAsk(null); resolve(v) } }))
  const docText = (id: string) => store.getState().texts[id]?.text ?? ''
  // Las fotos de Datheke de la nota pasan a ir dentro del texto (la otra persona no puede ver tu carpeta oculta).
  async function inlinePhotos(html: string) {
    let out = html
    for (const id of photoIds(html)) out = out.split(`src="drive:${id}"`).join(`src="${await imageDataUrl(await imageBlob(id))}"`)
    return out
  }

  // Compartir la nota abierta con uno o más correos (la primera vez la nota pasa a "Mi unidad").
  async function startShare(emails: string[]) {
    if (!note || !doc) return
    if (isLocked(note)) throw new Error('Primero quita la clave a esta nota: las notas con clave no se comparten.')
    const sh = shareOf(note)
    if (sh && !sh.owner) throw new Error('Solo quien la compartió puede invitar a más personas.')
    const title = doc.title || UNTITLED
    let fileId = sh?.id
    if (!fileId) {
      const html = await inlinePhotos(doc.text)
      const full = await fullOf(note, html)
      const remote = await shared.create(title, full)
      fileId = remote.id
      if (html !== doc.text) store.replaceText(note.id, html)
      shared.saveState(fileId, { base: remote.modifiedTime, sent: shared.hash(full + title) })
    }
    await shared.invite(fileId, emails, title)
    store.patch(note.id, { props: { compartida: fileId, rol: 'dueño', ...conProps(note, [...(sh?.con ?? []), ...emails]) } })
    setToast(`Listo: compartida con ${emails.join(', ')}. Le llegó un correo de Google con cómo abrirla.`)
  }

  // Quitar a una persona (desde la ventana Compartir): con copia se le quita el permiso; sin copia, su Datheke la borra.
  async function removePerson(p: shared.Person): Promise<boolean> {
    const sh = shareOf(note)
    if (!note || !sh) return false
    const choice = await askCopy(p.emailAddress ?? 'esta persona')
    if (!choice) return false
    try {
      if (choice === 'copia') await shared.uninvite(sh.id, p.id)
      else await shared.setProps(sh.id, { [`q${Math.abs(shared.hash(p.emailAddress ?? ''))}`]: p.emailAddress ?? '' })
      store.patch(note.id, { props: conProps(note, sh.con.filter(e => e !== p.emailAddress?.toLowerCase())) })
      setToast(choice === 'copia' ? `${p.emailAddress} se quedó con una copia.` : `Se le quitará a ${p.emailAddress} al sincronizar su Datheke.`)
      return true
    } catch (e) { fail(e); return false }
  }

  // Antes de mandar notas al basurero: las con clave no se borran; las compartidas preguntan qué pasa con la otra persona.
  // Devuelve null si se canceló, o si ya se preguntó (para no preguntar dos veces).
  async function beforeDelete(ns: DriveFile[]): Promise<'ok' | 'preguntado' | null> {
    const keyed = ns.filter(n => isLocked(n))
    if (keyed.length) {
      setToast(`Primero quita la clave a ${keyed.map(n => `«${n.name || UNTITLED}»`).join(', ')}: las notas con clave no se pueden borrar.`)
      return null
    }
    const mine = ns.filter(n => { const sh = shareOf(n); return sh?.owner && !sh.estado })
    const theirs = ns.filter(n => { const sh = shareOf(n); return sh && !sh.owner && !sh.fin })
    if (!mine.length && !theirs.length) return 'ok'
    let choice: 'copia' | 'quitar' | null = null
    if (mine.length) {
      const who = [...new Set(mine.flatMap(n => shareOf(n)!.con))].join(', ') || 'otras personas'
      choice = await askCopy(who)
      if (!choice) return null
    }
    if (theirs.length && !confirm(`Saldrás de ${theirs.length === 1 ? `«${theirs[0].name || UNTITLED}»` : `${theirs.length} notas compartidas`}: la nota de quien la compartió sigue igual. ¿Salir y borrarla de tus notas?`)) return null
    try {
      setToast('Dejando de compartir…')
      for (const n of mine) {
        const sh = shareOf(n)!
        if (choice === 'copia') {
          for (const p of await shared.people(sh.id)) if (p.role !== 'owner') await shared.uninvite(sh.id, p.id)
        } else await shared.write(sh.id, '', n.name || UNTITLED, { estado: 'quitada' })
        store.patch(n.id, { props: { estado: choice === 'copia' ? 'pausada' : 'quitada' } })
      }
      for (const n of theirs) {
        await shared.leave(shareOf(n)!.id, session!.email)
        store.patch(n.id, { props: { fin: 'true' } })
      }
      setToast(null)
      return 'preguntado'
    } catch (e) { setToast(null); fail(e); return null }
  }

  // Al restaurar del basurero una nota que era compartida (dueño): se vuelve a compartir con las mismas personas.
  async function reshare(n: DriveFile) {
    const sh = shareOf(n)
    if (!sh?.owner || !sh.estado) return
    try {
      if (sh.estado === 'quitada') await shared.write(sh.id, await fullOf(n), n.name || UNTITLED, { estado: null })
      const have = new Set((await shared.people(sh.id)).map(p => p.emailAddress?.toLowerCase()))
      const missing = sh.con.filter(e => !have.has(e))
      if (missing.length) await shared.invite(sh.id, missing, n.name || UNTITLED)
      const remote = await shared.get(sh.id)
      shared.saveState(sh.id, { base: remote.modifiedTime, sent: shared.hash(await fullOf(n) + (n.name || UNTITLED)) })
      store.patch(n.id, { props: { estado: null } })
      setToast(`«${n.name || UNTITLED}» se volvió a compartir con ${sh.con.join(', ')}.`)
    } catch (e) { fail(e) }
  }

  // Nota compartida conmigo: se elige en la ventana de Google y queda en mis notas (o vuelve, si ya estaba).
  async function addShared() {
    setRecvMenu(false)
    try {
      const fileId = await shared.pick()
      if (!fileId) return
      const meta = await shared.get(fileId)
      if (meta.appProperties?.datheke !== 'nota') throw new Error('Ese archivo no es una nota compartida de Datheke.')
      const remoteFull = await shared.read(fileId)
      const { body: html, extra } = shared.splitExtra(remoteFull)
      const title = meta.name || UNTITLED
      const owner = meta.owners?.[0]
      const existing = allNotes.find(n => n.appProperties?.compartida === fileId)
      let id: string
      if (existing) {
        id = existing.id
        store.patch(id, { props: { fin: null } })
        store.edit(id, { title })
        store.replaceText(id, html)
      } else {
        const nbId = notebookId ?? notebooks.find(nb => !isTemplates(nb))?.id ?? store.create({ kind: 'notebook' }, 'Mis notas')
        id = store.create({ kind: 'note', notebook: nbId, compartida: fileId, rol: 'invitado', dueno: owner?.displayName || owner?.emailAddress || '' }, title, html, 'text/html')
      }
      const added = store.getState().files[id]
      if (added) await applyExtra(added, extra)
      const remoteKey = meta.appProperties?.clave?.startsWith('1.') ? meta.appProperties.clave : ''
      if (remoteKey) store.patch(id, { props: { protegida: 'true', clave_comun: remoteKey } })
      shared.saveState(fileId, { base: meta.modifiedTime, sent: shared.hash(remoteFull + title) })
      setTrashView(false); setRemindView(false)
      open(id)
      setToast(`«${title}» está en tus notas: lo que cambies le llega a ${owner?.displayName || 'quien la compartió'}.`)
    } catch (e) {
      const st = shared.status(e)
      fail(st === 403 || st === 404 ? new Error('Google no dejó abrir esa nota. Pide que te la compartan de nuevo, o agrégala desde datheke.github.io.') : e)
    }
  }

  // Ícono y portada de una nota compartida (van al final del archivo, ver shared.ts).
  const coverUrls = useRef(new Map<string, string>())
  async function coverUrl(id: string) {
    let u = coverUrls.current.get(id)
    if (!u) { u = await imageDataUrl(await imageBlob(id)); coverUrls.current.set(id, u) }
    return u
  }
  const fullOf = async (n: DriveFile, body = docText(n.id)) => {
    const cover = n.appProperties?.cover
    return shared.joinExtra(body, { icono: n.appProperties?.icon, portada: cover ? await coverUrl(cover).catch(() => undefined) : undefined })
  }
  async function applyExtra(n: DriveFile, extra: shared.Extra) {
    const props: Record<string, string | null> = {}
    if ((extra.icono ?? '') !== (n.appProperties?.icon ?? '')) props.icon = extra.icono || null
    const cover = n.appProperties?.cover
    const mine = cover ? await coverUrl(cover).catch(() => '') : ''
    if (extra.portada && extra.portada !== mine) {
      const id = await store.addImage(await (await fetch(extra.portada)).blob())
      coverUrls.current.set(id, extra.portada)
      props.cover = id
    } else if (!extra.portada && cover) props.cover = null
    if (Object.keys(props).length) store.patch(n.id, { props })
  }

  // Sincronizar las notas compartidas: bajar lo que cambió la otra persona y subir lo de aquí.
  const shBusy = useRef(false)
  async function syncShared(only?: string) {
    if (shBusy.current || !session) return
    shBusy.current = true
    const state = shared.readState()
    const me = session.email.toLowerCase()
    try {
      for (const n of allNotes) {
        const sh = shareOf(n)
        if (!sh || sh.fin || sh.estado || (only && n.id !== only)) continue
        const title = store.getState().texts[n.id]?.title ?? n.name ?? ''
        const st = state[sh.id]
        let meta: shared.Remote
        try { meta = await shared.get(sh.id) } catch (e) {
          const code = shared.status(e)
          // En este aparato nunca se pudo abrir (se agregó desde la web y Google aún no da acceso aquí): no se toca.
          if (!st) continue
          if (!sh.owner && (code === 404 || code === 403)) { // te la dejaron de compartir: queda tu copia
            store.patch(n.id, { props: { fin: 'true' } })
            setToast(`${sh.dueno || 'Quien la compartió'} dejó de compartir «${title || UNTITLED}». Te quedó una copia como nota tuya.`)
          }
          continue
        }
        if (!sh.owner && (meta.appProperties?.estado === 'quitada' || Object.entries(meta.appProperties ?? {}).some(([k, v]) => /^q\d+$/.test(k) && v.toLowerCase() === me))) {
          await shared.leave(sh.id, session.email).catch(() => {})
          store.remove(n.id)
          shared.saveState(sh.id, null)
          if (noteId === n.id) setNoteId(null)
          setToast(`${sh.dueno || 'Quien la compartió'} dejó de compartir «${title || UNTITLED}».`)
          continue
        }
        // Clave común: la puso, la cambió o la quitó alguien (todos la abren con la misma clave).
        const remoteKey = meta.appProperties?.clave?.startsWith('1.') ? meta.appProperties.clave : ''
        if (remoteKey !== commonKey(n)) {
          store.patch(n.id, { props: remoteKey ? { protegida: 'true', clave_comun: remoteKey } : { protegida: null, clave_comun: null } })
          setToast(remoteKey
            ? `«${title || UNTITLED}» ${commonKey(n) ? 'cambió de clave común' : 'ahora tiene una clave común'}: pídesela a quien la puso.`
            : `«${title || UNTITLED}» ya no tiene clave: se la quitaron para todos.`)
          continue
        }
        const hasText = !!store.getState().texts[n.id]
        if (!hasText) continue // su texto aún no está en este aparato (o tiene clave cerrada): no se toca
        const local = docText(n.id)
        const localFull = await fullOf(n, local)
        const dirty = !!st && shared.hash(localFull + title) !== st.sent
        let next = st
        if (meta.modifiedTime !== st?.base) {
          const remoteFull = await shared.read(sh.id)
          const { body, extra } = shared.splitExtra(remoteFull)
          if (dirty && body !== local) {
            // Los dos cambiaron a la vez: lo de la otra persona queda en una nota aparte, nada se pierde.
            const who = meta.lastModifyingUser?.displayName || 'la otra persona'
            store.create({ kind: 'note', notebook: n.appProperties?.notebook ?? '' }, `${meta.name || UNTITLED} (versión de ${who})`, body, 'text/html')
            setToast(`«${title}» cambió aquí y en el aparato de ${who} a la vez: su versión quedó en una nota aparte.`)
            const saved = await shared.write(sh.id, localFull, title || UNTITLED)
            next = { base: saved.modifiedTime, sent: shared.hash(localFull + title) }
          } else {
            if (meta.name && meta.name !== title) store.edit(n.id, { title: meta.name })
            if (body !== local) store.replaceText(n.id, body)
            await applyExtra(n, extra)
            next = { base: meta.modifiedTime, sent: shared.hash(remoteFull + (meta.name || title)) }
          }
        } else if (dirty) {
          meta = await shared.write(sh.id, localFull, title || UNTITLED)
          next = { base: meta.modifiedTime, sent: shared.hash(localFull + title) }
        }
        if (next) shared.saveState(sh.id, next)
        // "Modificado por": cuando el último cambio es de otra persona.
        const u = meta.lastModifyingUser
        const por = u && !u.me && u.emailAddress?.toLowerCase() !== me ? (u.displayName || u.emailAddress || '') : ''
        if ((n.appProperties?.por ?? '') !== por) store.patch(n.id, { props: { por: por || null, en: por ? meta.modifiedTime : null } })
      }
    } catch (e) { console.error('Notas compartidas', e) } finally { shBusy.current = false }
  }
  const syncSharedRef = useRef(syncShared)
  syncSharedRef.current = syncShared
  const hasShared = allNotes.some(n => n.appProperties?.compartida && n.appProperties?.fin !== 'true')
  useEffect(() => {
    if (!ready || !hasShared) return
    syncSharedRef.current()
    const every = setInterval(() => { if (document.visibilityState === 'visible') syncSharedRef.current() }, 20_000)
    const back = () => { if (document.visibilityState === 'visible') syncSharedRef.current() }
    document.addEventListener('visibilitychange', back)
    return () => { clearInterval(every); document.removeEventListener('visibilitychange', back) }
  }, [ready, hasShared])
  // Lo que escribes en una nota compartida se sube a los 2 segundos.
  const openShared = note?.appProperties?.compartida ? note.id : undefined
  const openText = openShared ? s.texts[openShared]?.text + (s.texts[openShared]?.title ?? '') + (note?.appProperties?.icon ?? '') + (note?.appProperties?.cover ?? '') : ''
  useEffect(() => {
    if (!openShared || !ready) return
    const t = setTimeout(() => syncSharedRef.current(openShared), 2000)
    return () => clearTimeout(t)
  }, [openShared, openText, ready])

  // Abrir con Datheke: al abrir la app o volver a ella, si llegó un archivo .datheke desde otra app (WhatsApp, doble clic…).
  const takeRef = useRef((_b: Uint8Array) => {})
  takeRef.current = bytes => {
    try { setReceived({ p: unpack(bytes), notebook: notebookId ?? notebooks.find(nb => !isTemplates(nb))?.id ?? '' }) } catch (e) { fail(e) }
  }
  useEffect(() => {
    if (!ready || !desktop) return
    let busy = false, stop = false
    const check = async () => {
      if (busy) return
      busy = true
      try { const r = await takeReceived(); if (r && !stop) takeRef.current(r.bytes) } finally { busy = false }
    }
    check()
    const vis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('focus', check)
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event').then(e => e.listen('recibida', check)).then(u => { if (stop) u(); else unlisten = u }).catch(() => {})
    return () => { stop = true; document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', check); unlisten?.() }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Queda como una nota propia: sus fotos se suben a tu Drive y sus recordatorios empiezan a sonar en tus aparatos.
  async function addReceived() {
    if (!received) return
    const { p } = received
    try {
      const nbId = received.notebook || store.create({ kind: 'notebook' }, 'Mis notas')
      const ids: Record<string, string> = {}
      for (const [old, bytes] of Object.entries(p.photos)) ids[old] = await store.addImage(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
      const html = p.html.replace(/src="drive:([\w-]+)"/g, (m, id: string) => ids[id] ? `src="drive:${ids[id]}"` : m)
      const props: Record<string, string> = { kind: 'note', notebook: nbId }
      if (p.icon) props.icon = p.icon
      if (p.cover && ids[p.cover]) props.cover = ids[p.cover]
      const id = store.create(props, p.title, html, 'text/html')
      setReceived(null)
      setTrashView(false); setRemindView(false); setNotebookId(nbId)
      open(id)
      setToast(`"${p.title || UNTITLED}" se agregó a tus notas.`)
    } catch (e) { fail(e) }
  }

  // El aviso corto se va solo.
  useEffect(() => {
    if (!toast || toast.endsWith('…')) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  function saveAsTemplate() {
    if (!doc) return
    act(() => {
      const nbId = templatesNb?.id ?? store.create({ kind: 'notebook', templates: 'true' }, 'Plantillas')
      store.create({ kind: 'note', notebook: nbId }, doc.title, doc.text, 'text/html')
      alert(`Guardada como plantilla en la libreta "${templatesNb?.name ?? 'Plantillas'}".`)
    })
  }

  // La nota se mueve con todas sus subnotas.
  function moveNote(nbId: string) {
    if (note) for (const n of [note, ...descendants(note.id)]) store.patch(n.id, { props: { notebook: nbId } })
  }

  async function changeCover() {
    if (!note) return
    const file = await pickImage()
    if (!file) return
    try {
      setToast('Poniendo la portada…')
      store.patch(note.id, { props: { cover: await uploadCover(file) } })
      setToast(null)
    } catch (e) { setToast(null); fail(e) }
  }


  // Borrar manda al basurero (con sus subnotas); se puede restaurar durante 30 días.
  async function deleteNote() {
    if (!note) return
    const subs = descendants(note.id)
    const pre = await beforeDelete([note, ...subs])
    if (!pre) return
    if (pre === 'ok' && !confirm(`¿Mandar "${note.name || UNTITLED}"${subs.length ? ` y sus ${subs.length} subnotas` : ''} al basurero? Puedes restaurarla durante 30 días.`)) return
    const when = nowIso()
    for (const n of [note, ...subs]) store.patch(n.id, { props: { borrada: when } })
    setNoteId(null)
  }

  // Notas del basurero que se borraron junto con esta (sus subnotas, con la misma fecha).
  const trashedWith = (n: DriveFile): DriveFile[] => trash.filter(t => parentOf(t) === n.id && t.appProperties?.borrada === n.appProperties?.borrada)
    .flatMap(t => [t, ...trashedWith(t)])

  function restoreOne(n: DriveFile) {
    // Si su libreta ya no existe, vuelve a la primera.
    const home = notebooks.some(nb => nb.id === n.appProperties?.notebook) ? undefined
      : notebooks.find(nb => !isTemplates(nb))?.id
    for (const t of [n, ...trashedWith(n)]) {
      store.patch(t.id, { props: { borrada: null, ...(home ? { notebook: home } : {}) } })
      reshare(t)
    }
  }
  function restore(n: DriveFile) {
    restoreOne(n)
    setTrashView(false)
    setNotebookId(null)
  }

  // Eliminar para siempre: si era una nota que compartí, se borra también de "Mi unidad".
  function forget(t: DriveFile) {
    const sh = shareOf(t)
    if (sh?.owner) shared.remove(sh.id).catch(e => console.error('Borrar la compartida', e))
    if (sh) shared.saveState(sh.id, null)
    store.remove(t.id)
  }
  function deleteForever(n: DriveFile) {
    if (!confirm(`¿Eliminar "${n.name || UNTITLED}" para siempre? Esto no se puede deshacer.`)) return
    for (const t of [n, ...trashedWith(n)]) forget(t)
    setNoteId(null)
  }

  function emptyTrash() {
    if (!confirm(`¿Vaciar el basurero? Se eliminan ${trash.length} notas para siempre.`)) return
    for (const t of trash) forget(t)
    setNoteId(null)
  }

  // Seleccionar varias notas: mantener presionada una (celular), Ctrl+clic o el botón "Seleccionar" (PC).
  // Luego borrar (al basurero), mover a otra libreta o, en el basurero, restaurar o eliminar para siempre.
  useEffect(() => { setSelected(null) }, [notebookId, trashView, remindView])
  useEffect(() => {
    if (!selected) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [selected])
  const toggle = (id: string) => setSelected(sel => {
    const next = new Set(sel ?? [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; fired?: boolean; x?: number; y?: number }>({})
  const pressStart = (e: React.PointerEvent, id: string) => {
    if (e.pointerType === 'mouse') return
    press.current = { x: e.clientX, y: e.clientY, fired: false, timer: setTimeout(() => {
      press.current.fired = true
      navigator.vibrate?.(30)
      setSelected(sel => new Set([...(sel ?? []), id]))
    }, 500) }
  }
  const pressMove = (e: React.PointerEvent) => {
    const p = press.current
    if (p.timer && (Math.abs(e.clientX - (p.x ?? 0)) > 10 || Math.abs(e.clientY - (p.y ?? 0)) > 10)) { clearTimeout(p.timer); p.timer = undefined }
  }
  const pressEnd = () => { clearTimeout(press.current.timer); press.current.timer = undefined }
  const clickNote = (e: React.MouseEvent, id: string) => {
    if (press.current.fired) { press.current.fired = false; return } // fue un toque largo: ya quedó seleccionada
    if (selected) return toggle(id)
    if (e.ctrlKey || e.metaKey) return setSelected(new Set([id]))
    open(id)
  }
  const chosen = list.map(([n]) => n).filter(n => selected?.has(n.id))
  const withSubs = (ns: DriveFile[]) => [...new Map(ns.flatMap(n => [n, ...descendants(n.id)]).map(n => [n.id, n])).values()]
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`

  async function deleteSelected() {
    const all = withSubs(chosen)
    const subs = all.length - chosen.length
    const pre = all.length ? await beforeDelete(all) : null
    if (!pre) return
    if (pre === 'ok' && !confirm(`¿Mandar ${plural(chosen.length, 'nota', 'notas')}${subs ? ` (y ${plural(subs, 'subnota', 'subnotas')})` : ''} al basurero? Puedes restaurarlas durante 30 días.`)) return
    const when = nowIso()
    for (const n of all) store.patch(n.id, { props: { borrada: when } })
    if (noteId && all.some(n => n.id === noteId)) setNoteId(null)
    setSelected(null)
    setToast(`${plural(all.length, 'nota', 'notas')} al basurero. Puedes restaurarlas desde el Basurero durante 30 días.`)
  }
  function moveSelected(nbId: string) {
    const nb = notebooks.find(x => x.id === nbId)
    if (!nb) return
    const all = withSubs(chosen)
    for (const n of all) store.patch(n.id, { props: { notebook: nbId } })
    setSelected(null)
    setToast(`${plural(all.length, 'nota movida', 'notas movidas')} a "${nb.name}".`)
  }
  function restoreSelected() {
    const k = chosen.length
    for (const n of chosen) restoreOne(n)
    setSelected(null)
    setToast(`${plural(k, 'nota restaurada', 'notas restauradas')}.`)
  }
  function deleteSelectedForever() {
    const all = [...new Map(chosen.flatMap(n => [n, ...trashedWith(n)]).map(n => [n.id, n])).values()]
    if (!all.length || !confirm(`¿Eliminar ${plural(all.length, 'nota', 'notas')} para siempre? Esto no se puede deshacer.`)) return
    for (const t of all) forget(t)
    if (noteId && all.some(n => n.id === noteId)) setNoteId(null)
    setSelected(null)
  }

  // La lista de recordatorios: pendientes, hoy, próximos y hechos (cerrado). Tocar uno abre su nota en esa línea.
  const GROUPS: [Group, string][] = [['pendiente', 'Pendientes'], ['hoy', 'Hoy'], ['proximo', 'Próximos'], ['hecho', 'Hechos']]
  function remindersList() {
    const hint = <>
      <button className="enlace como-suenan" onClick={() => setReminderHelp(reminderMode)}>¿Cómo suenan los recordatorios en cada aparato?</button>
      {lockedHidden && <p className="vacio pequeño">🔐 Los recordatorios de tus notas con clave aparecen al abrirlas (igual suenan).</p>}
    </>
    if (!reminders.length) return <>{hint}<p className="vacio">Sin recordatorios. En una nota, ponte en una línea y toca la 🔔 de la barra.</p></>
    const row = (x: (typeof reminders)[number], g: Group) => (
      <div key={x.note.id + x.r.id} className="nota-fila">
        <button className="nota" onClick={() => { open(x.note.id); setFocusRem(x.r.id) }}>
          <strong>{x.label}</strong>
          <small className="en-nota">en {x.note.appProperties?.icon && `${x.note.appProperties.icon} `}{x.note.name || UNTITLED}</small>
          <span className={`tarjeta-recordatorio ${g}`}>{g === 'pendiente' ? '⏰' : g === 'hecho' ? '✓' : '🔔'} {chipText(x.r)}{x.r.rep && ` · ${repeatText(x.r.rep)}`}</span>
        </button>
        {g !== 'hecho' && <button className="btn-icono marcar-hecho" onClick={() => changeReminder(x.note.id, x.r.id, markDone(x.r))}
          title="Marcar hecho" aria-label="Marcar hecho"><Check size={18} /></button>}
      </div>
    )
    return <>{hint}{GROUPS.map(([g, label]) => {
      const items = reminders.filter(x => groupOf(x.r) === g)
      if (!items.length) return null
      if (g === 'hecho') return <details key={g} className={`grupo-recordatorios ${g}`}><summary><h3>{label} <small>{items.length}</small></h3></summary>{items.map(x => row(x, g))}</details>
      return <section key={g} className={`grupo-recordatorios ${g}`}><h3>{label} <small>{items.length}</small></h3>{items.map(x => row(x, g))}</section>
    })}</>
  }

  if (!session) return (
    <div className="login">
      <h1><img className="logo" src="./logo.png" alt="Datheke" width="220" height="220" /></h1>
      <p>Tus notas se guardan en tu propio Google Drive.</p>
      <button className="principal" onClick={login} disabled={waiting}>Entrar con Google</button>
      {waiting && <p>Se abrió tu navegador: entra con Google ahí y luego vuelve a esta ventana.</p>}
      {error && <p className="error">{error === 'auth' ? 'Vuelve a entrar.' : error}</p>}
    </div>
  )

  return (
    <div className={appClass} style={{ '--columnas': columns } as CSSProperties}>
      <nav className="libretas" aria-label="Libretas">
        <Account email={session.email} onLogout={logout} update={update} mode={reminderMode} calendarHere={calendarHere}
          onPickMode={m => setReminderHelp(m)} onConnect={() => setReminderHelp('calendar')} />
        <button className="principal nueva-nota solo-pc" onClick={() => newNote()}><Plus size={18} /> Nota</button>
        <button className={notebookId === null && !trashView && !remindView ? 'item activo' : 'item'} onClick={() => { setNotebookId(null); setTrashView(false); setRemindView(false) }}>
          <FileText size={16} /><span>Todas las notas</span><small>{regular.length}</small>
        </button>
        <button className={remindView ? 'item activo' : 'item'} onClick={() => { setRemindView(true); setTrashView(false); setNotebookId(null) }}>
          <Bell size={16} /><span>Recordatorios</span><small className={overdue ? 'vencidos' : undefined}>{pendingReminders || ''}</small>
        </button>
        <div className="seccion">
          <span>Libretas</span>
          <button className="btn-icono" title="Nueva libreta" aria-label="Nueva libreta" onClick={() => {
            const name = prompt('Nombre de la nueva libreta')?.trim()
            if (name) act(() => setNotebookId(store.create({ kind: 'notebook' }, name)))
          }}><Plus size={16} /></button>
        </div>
        {notebooks.map(nb => (
          <div key={nb.id} className={notebookId === nb.id ? 'item activo' : 'item'} data-grupo="libretas">
            <button className="item-nombre" onClick={() => { setNotebookId(nb.id); setTrashView(false); setRemindView(false) }}>
              <Notebook size={16} /><span>{nb.name}</span><small>{countOf(nb.id)}</small>
            </button>
            {isPrivate(nb) && notebookId !== nb.id && <ShieldCheck size={14} className="privada-icono" aria-label="Libreta privada" />}
            {notebookId === nb.id && <>
              <button className={isPrivate(nb) ? 'btn-icono privada-icono' : 'btn-icono'} onClick={() => {
                if (isPrivate(nb) ? confirm(`¿Quitar "privada" a la libreta "${nb.name}"? Gemini podrá volver a leer sus notas (las marcadas una por una siguen privadas).`)
                  : confirm(`¿Hacer privada la libreta "${nb.name}"? Gemini no podrá leer ninguna de sus notas, tampoco las nuevas. Dictar sigue funcionando (solo envía tu voz).`))
                  setPrivate(nb, !isPrivate(nb))
              }} title={isPrivate(nb) ? 'Libreta privada (toca para quitar)' : 'Hacer privada: sin Gemini'}
                aria-label={isPrivate(nb) ? 'Quitar privada a la libreta' : 'Hacer privada la libreta'}>
                {isPrivate(nb) ? <ShieldCheck size={14} /> : <Shield size={14} />}
              </button>
              <button className="btn-icono" onClick={() => renameNotebook(nb)} title="Renombrar libreta" aria-label="Renombrar libreta"><Pencil size={14} /></button>
              <button className="btn-icono" onClick={() => deleteNotebook(nb)} title="Borrar libreta" aria-label="Borrar libreta"><Trash2 size={14} /></button>
            </>}
            <button className="agarre-lista" tabIndex={-1} title="Arrastra para ordenar" aria-label="Arrastrar para ordenar"
              onPointerDown={e => startSort(e, (from, to) => saveOrder(notebooks, from, to))}><GripVertical size={14} /></button>
          </div>
        ))}
        <button className={trashView ? 'item activo basurero' : 'item basurero'} onClick={() => { setTrashView(true); setRemindView(false); setNotebookId(null) }}>
          <Trash2 size={16} /><span>Basurero</span><small>{trash.length || ''}</small>
        </button>
        <div className="respaldo">
          <span>Respaldo en Drive: {lastBackup ? shortDate(lastBackup) : 'aún no'}</span>
          {backup.needsLogin ? <button onClick={login}>Dar permiso</button>
            : <button onClick={() => doBackup(true)} disabled={backup.busy}>{backup.busy ? 'Haciendo…' : 'Hacer ahora'}</button>}
          {backup.msg && <small role="status">{backup.msg}</small>}
        </div>
      </nav>
      <Resizer className="divisor-libretas" label="Ancho de la barra de libretas" value={layout.sidebar}
        onChange={w => resize('sidebar', w)} reset={() => resize('sidebar', LAYOUT.sidebar)} />

      <section className="lista" aria-label="Notas">
        <header>
          {selected ? <div className="barra-seleccion" role="toolbar" aria-label="Notas seleccionadas">
            <button className="btn-icono" onClick={() => setSelected(null)} title="Terminar de seleccionar" aria-label="Terminar de seleccionar"><XIcon size={18} /></button>
            <strong>{chosen.length ? plural(chosen.length, 'seleccionada', 'seleccionadas') : 'Toca las notas'}</strong>
            <button className="enlace" onClick={() => setSelected(chosen.length === list.length ? new Set() : new Set(list.map(([n]) => n.id)))}>
              {chosen.length === list.length ? 'Ninguna' : 'Todas'}</button>
            <span className="barra-seleccion-acciones">
              {trashView ? <>
                <button disabled={!chosen.length} onClick={restoreSelected}><RotateCcw size={16} /> Restaurar</button>
                <button className="peligro" disabled={!chosen.length} onClick={deleteSelectedForever}><Trash2 size={16} /> Eliminar</button>
              </> : <>
                <label className={chosen.length ? 'mover' : 'mover deshabilitado'} title="Mover a otra libreta">
                  <FolderInput size={16} aria-hidden="true" /> Mover
                  <select value="" disabled={!chosen.length} aria-label="Mover a la libreta" onChange={e => moveSelected(e.target.value)}>
                    <option value="">Mover a…</option>
                    {notebooks.map(nb => <option key={nb.id} value={nb.id}>{nb.name}</option>)}
                  </select>
                </label>
                <button className="peligro" disabled={!chosen.length} onClick={deleteSelected}><Trash2 size={16} /> Borrar</button>
              </>}
            </span>
          </div> : <>
          <div className="lista-titulo">
            <h2>{remindView ? 'Recordatorios' : trashView ? 'Basurero' : notebookName ?? 'Todas las notas'}</h2>
            <small>{remindView ? reminders.length : list.length}</small>
            <button className="btn-icono" onClick={() => store.sync()} title="Sincronizar" aria-label="Sincronizar"><RefreshCw size={16} /></button>
            {!remindView && list.length > 0 && <button className="btn-icono" onClick={() => setSelected(new Set())} title="Seleccionar varias notas" aria-label="Seleccionar varias notas"><CheckSquare size={16} /></button>}
            {trashView && trash.length > 0 && <button className="vaciar" onClick={emptyTrash}>Vaciar</button>}
          </div>
          <div className="lista-acciones">
            <button className="principal solo-celular" onClick={() => newNote()}><Plus size={18} /> Nota</button>
            <button className="recibir" onClick={() => setRecvMenu(true)} title="Abrir una nota que te enviaron o compartieron"><FileDown size={18} /> Nota recibida</button>
            <select value="" aria-label="Nueva nota desde plantilla" onChange={e => fromTemplate(e.target.value)}>
              <option value="">Desde plantilla…</option>
              {TEMPLATES.map(t => <option key={t.title} value={t.title}>{t.title}</option>)}
              {templates.map(t => <option key={t.id} value={t.id}>{t.name || UNTITLED}</option>)}
            </select>
            <span className={pendingCount || s.offline ? 'estado pendiente' : 'estado'} role="status">{status}</span>
          </div>
          </>}
        </header>
        <div className="tarjetas">
          {remindView ? remindersList() : !ready || (!s.synced && !files.length) ? <p className="vacio">Cargando…</p>
            : list.length === 0 ? <p className="vacio">{trashView ? 'El basurero está vacío' : 'Sin notas'}</p>
            : list.map(([n, depth]) => (
              // Se ordena entre sus hermanas: las del mismo nivel y la misma nota madre (data-grupo).
              <div key={n.id} className={selected ? 'nota-fila seleccionando' : 'nota-fila'} data-grupo={shownParent(n) ?? 'raiz'} style={{ marginLeft: 8 + depth * 16 }}>
                <button className={`nota${n.id === noteId && !selected ? ' activa' : ''}${selected?.has(n.id) ? ' elegida' : ''}`} aria-pressed={selected ? selected.has(n.id) : undefined}
                  onClick={e => clickNote(e, n.id)} onPointerDown={e => pressStart(e, n.id)} onPointerMove={pressMove} onPointerUp={pressEnd} onPointerCancel={pressEnd}
                  onContextMenu={e => { if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType !== 'mouse') e.preventDefault() }}>
                  {selected && <span className="marca" aria-hidden="true">{selected.has(n.id) ? <CircleCheck size={20} /> : <Circle size={20} />}</span>}
                  <strong>
                    {depth > 0 && '↳ '}{s.conflicts[n.id] && '⚠️ '}{n.appProperties?.icon && `${n.appProperties.icon} `}{n.name || UNTITLED}
                  </strong>
                  {/* Con clave: en la lista nunca se ve su texto, aunque esté abierta con la clave (alguien puede ver la pantalla). */}
                  {s.texts[n.id] && !isLocked(n) && <span className="resumen">{preview(s.texts[n.id].text)}</span>}
                  {isLocked(n) && <span className="resumen">🔐 Nota con clave</span>}
                  {!trashView && nextOf(n) && <span className={`tarjeta-recordatorio ${groupOf(nextOf(n)!.r)}`}>
                    <Bell size={12} aria-hidden="true" /> {isLocked(n) ? 'Recordatorio' : nextOf(n)!.label}: {chipText(nextOf(n)!.r)}</span>}
                  {trashView && <span className="resumen basurero-dias">Se elimina en {daysLeft(n)} días</span>}
                  <small>{shareOf(n) && !shareOf(n)!.fin && !shareOf(n)!.estado && <Users size={12} aria-label="Compartida" />}{isLocked(n) && <LockKeyhole size={12} aria-label="Con clave" />}{n.appProperties?.locked === 'true' && <Lock size={12} aria-label="Fijada" />}{shortDate(n.modifiedTime)}</small>
                </button>
                {!selected && <button className="agarre-lista" tabIndex={-1} title="Arrastra para ordenar" aria-label="Arrastrar para ordenar"
                  onPointerDown={e => startSort(e, (from, to) => saveOrder(siblings(shownParent(n)), from, to))}><GripVertical size={16} /></button>}
              </div>
            ))}
        </div>
      </section>
      <Resizer className="divisor-lista" label="Ancho de la lista de notas" value={layout.list}
        onChange={w => resize('list', w)} reset={() => resize('list', LAYOUT.list)} />

      <main className="editor">
        {note ? <>
          <header className="nota-barra">
            <button className="btn-icono volver" onClick={() => open(null)} aria-label="Volver" title="Volver"><ChevronLeft size={20} /></button>
            <button className="btn-icono solo-pc" disabled={layout.expanded} onClick={() => setLayout(l => ({ ...l, listHidden: !l.listHidden }))}
              title={layout.listHidden ? 'Mostrar lista de notas' : 'Ocultar lista de notas'}
              aria-label={layout.listHidden ? 'Mostrar lista de notas' : 'Ocultar lista de notas'}>
              {layout.listHidden ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <button className="btn-icono solo-pc" onClick={() => setLayout(l => ({ ...l, expanded: !l.expanded }))}
              title={layout.expanded ? 'Salir de pantalla completa' : 'Pantalla completa'}
              aria-label={layout.expanded ? 'Salir de pantalla completa' : 'Pantalla completa'}>
              {layout.expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <div className="ruta">
              <select value={note.appProperties?.notebook} onChange={e => moveNote(e.target.value)} disabled={locked}
                aria-label="Libreta de la nota" title={locked ? 'Nota fijada: toca Editar para moverla' : 'Mover a otra libreta'}>
                {notebooks.map(nb => <option key={nb.id} value={nb.id}>{nb.name}</option>)}
              </select>
              <ChevronRight size={14} aria-hidden="true" />
              <span className="ruta-nota">{note.name || UNTITLED}</span>
              {withKey ? <LockKeyhole size={14} className="privada-icono" aria-label="Nota con clave" />
                : privacy && <ShieldCheck size={14} className="privada-icono" aria-label="Privada: sin Gemini" />}
            </div>
            {!trashed && <>
            <button className={locked ? 'fijar fijada' : 'fijar'} onClick={() => store.patch(note.id, { props: { locked: locked ? null : 'true' } })}
              title={locked ? 'Cambiar la nota' : 'Fijar: solo leer y copiar, sin cambios sin querer'}>
              {locked ? <><Pencil size={16} /> Editar</> : <><Lock size={16} /> Fijar</>}
            </button>
            <button className="btn-icono" onClick={() => newNote('', '', note.id)} title="Nueva subnota" aria-label="Nueva subnota"><FilePlus size={18} /></button>
            {withKey && !isClosed(note) && <button className="btn-icono" onClick={() => store.closeVault()} title="Cerrar las notas con clave"
              aria-label="Cerrar las notas con clave"><LockKeyhole size={18} /></button>}
            <MoreMenu items={[
              ...(withKey ? [
                { label: 'Quitar clave', icon: <KeyRound size={16} />, onClick: () => unprotect(note) },
                { label: commonKey(note) ? 'Cambiar la clave común' : 'Cambiar clave', icon: <KeyRound size={16} />,
                  onClick: () => setKeyDialog(commonKey(note) ? { mode: 'cambiar-comun', noteId: note.id } : { mode: 'cambiar' }) },
              ] : [{ label: activeShare(note) ? 'Poner clave común' : 'Proteger con clave', icon: <LockKeyhole size={16} />, onClick: () => protect(note) }]),
              privacy === 'libreta'
                ? { label: 'Privada por su libreta', icon: <ShieldCheck size={16} />, onClick: () => alert(`Esta nota es privada porque está en la libreta "${noteNotebook?.name}". Para quitarlo, toca el escudo de la libreta.`) }
                : privacy === 'nota'
                  ? { label: 'Quitar privada (permitir Gemini)', icon: <ShieldOff size={16} />, onClick: () => setPrivate(note, false) }
                  : { label: 'Privada: sin Gemini', icon: <Shield size={16} />, onClick: () => setPrivate(note, true) },
              { label: shareOf(note) && !shareOf(note)!.owner ? 'Compartida contigo…' : shareOf(note) ? 'Compartida: personas…' : 'Compartir con…', icon: <Users size={16} />, onClick: () => setShareOpen(true) },
              { label: 'Enviar copia (WhatsApp, correo…)', icon: <Send size={16} />, onClick: sendCopy },
              { label: 'Guardar como plantilla', icon: <LayoutTemplate size={16} />, onClick: saveAsTemplate },
              { label: 'Borrar nota', icon: <Trash2 size={16} />, onClick: deleteNote, danger: true },
            ]} />
            </>}
          </header>
          {trashed ? <div className="aviso-fijada aviso-basurero">
            🗑️ Está en el basurero: se elimina sola a los 30 días.
            <button className="principal" onClick={() => restore(note)}>Restaurar</button>
            <button className="peligro" onClick={() => deleteForever(note)}>Eliminar para siempre</button>
          </div>
            : locked && <p className="aviso-fijada">🔒 Nota fijada: puedes leerla, copiar y marcar casillas. Toca <strong>Editar</strong> para cambiarla.</p>}
          {sealedNote ? <div className="nota-scroll">
            <h1 className="titulo-cerrado">{note.name || UNTITLED}</h1>
            {commonKey(note) ? <Unlock key={commonKey(note)} common verifier={commonKey(note)} onForgot={() => forgotCommonKey(note)} onOpen={offer => {
              store.openVault()
              if (offer) setKeyDialog({ mode: 'huella', salt: vault.saltOf(commonKey(note)) })
            }} /> : <Unlock verifier={verifier} onForgot={forgotKey} onOpen={offer => {
              store.openVault()
              if (offer) setKeyDialog({ mode: 'huella' })
            }} />}
          </div> : <>
          {conflict && <div className="conflicto" role="alert">
            <p><strong>⚠️ Esta nota también se cambió en otro dispositivo.</strong> ¿Qué versión quieres conservar?</p>
            <details>
              <summary>Ver la versión del otro dispositivo</summary>
              <p className="otra"><strong>{conflict.title || UNTITLED}</strong>{'\n'}{plain(conflict.text)}</p>
            </details>
            <div>
              <button className="principal" onClick={() => store.resolve(note.id, 'mine')}>La de este dispositivo</button>
              <button onClick={() => store.resolve(note.id, 'theirs')}>La del otro dispositivo</button>
            </div>
          </div>}
          {/* Portada, título y texto bajan juntos: al bajar por la nota la portada se va y deja todo el espacio. */}
          <div className={writing ? 'nota-scroll escribiendo' : 'nota-scroll'} onInput={() => setWriting(true)}>
            {cover && <Cover id={cover} />}
            <div className="cabecera">
              {parent && <button className="enlace" onClick={() => open(parent.id)}>↑ {parent.name || UNTITLED}</button>}
              {locked ? note.appProperties?.icon && <span className="icono">{note.appProperties.icon}</span> : <>
                <button className={note.appProperties?.icon ? 'icono' : 'enlace'} aria-label="Ícono de la nota" onClick={() => setPicker(!picker)}>
                  {note.appProperties?.icon ?? 'Agregar ícono'}
                </button>
                {note.appProperties?.icon && <button className="enlace" onClick={() => store.patch(note.id, { props: { icon: null } })}>Quitar ícono</button>}
                <button className="enlace" onClick={changeCover}>{cover ? 'Cambiar portada' : 'Agregar portada'}</button>
                {cover && <button className="enlace" onClick={() => store.patch(note.id, { props: { cover: null } })}>Quitar portada</button>}
              </>}
            </div>
            {picker && !locked && <EmojiPicker onPick={icon => { store.patch(note.id, { props: { icon } }); setPicker(false) }} />}
            {doc ? <>
              <input className="titulo" value={doc.title} placeholder="Título" readOnly={locked} onChange={e => store.edit(note.id, { title: e.target.value })} />
              {(() => {
                const sh = shareOf(note)
                if (!sh) return null
                if (sh.fin) return <p className="compartida-barra fin">Ya no está compartida: es tu copia.</p>
                if (sh.estado) return null
                return <button className="compartida-barra" onClick={() => setShareOpen(true)}>
                  <Users size={14} aria-hidden="true" /> {sh.owner ? `Compartida con ${sh.con.join(', ') || '…'}` : `Compartida por ${sh.dueno || 'otra persona'}`}
                  {sh.por && <span> · Modificado por {sh.por}{sh.en ? `, ${shortDate(sh.en)}` : ''}</span>}
                </button>
              })()}

              <Editor key={`${note.id}-${s.revs[note.id] ?? 0}`} inlineImages={!!shareOf(note)} me={session.email} content={doc.text} onChange={text => store.edit(note.id, { text })}
                notes={allNotes.map(n => ({ id: n.id, label: n.name || UNTITLED }))} onOpenNote={open} onError={fail} editable={!locked}
                geminiKey={geminiKey} onGeminiKey={setGeminiKey}
                privacy={privacy} onPrivate={() => setPrivate(note, true)}
                onReminder={id => setRemDlg({ noteId: note.id, id, label: reminders.find(x => x.r.id === id)?.label ?? 'Recordatorio' })}
                onNewReminder={(label, insert) => setRemDlg({ noteId: note.id, label, insert })}
                focusReminder={focusRem} />
            </> : <p className="vacio">Cargando…</p>}
          </div>
          </>}
        </> : <p className="vacio">Elige o crea una nota</p>}
      </main>

      {update && <UpdateToast update={update} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      {shareOpen && note && <ShareDialog title={doc?.title || UNTITLED} fileId={shareOf(note)?.id} owner={!shareOf(note) || shareOf(note)!.owner}
        ownerName={shareOf(note)?.dueno} myEmail={session.email} onShare={startShare} onRemove={removePerson}
        onLeave={() => { setShareOpen(false); deleteNote() }} onClose={() => setShareOpen(false)} />}
      {copyAsk && <CopyDialog who={copyAsk.who} onPick={copyAsk.resolve} />}
      {recvMenu && <ReceiveDialog inApp={desktop} onOpenWeb={() => { import('@tauri-apps/plugin-opener').then(o => o.openUrl('https://datheke.github.io')).catch(fail) }}
        onClose={() => setRecvMenu(false)} onShared={addShared} onFile={() => { setRecvMenu(false); openReceived() }} />}
      {received && (() => {
        const rems = (received.p.html.match(/data-type="recordatorio"/g) ?? []).length
        const photos = Object.keys(received.p.photos).length
        return <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Nota recibida">
          <div className="ventana recibida">
            <FileDown size={32} className="caja-icono" aria-hidden="true" />
            <h2>{received.p.icon && `${received.p.icon} `}{received.p.title || UNTITLED}</h2>
            <p className="caja-nota">Nota recibida{rems ? ` · ${rems} recordatorio${rems > 1 ? 's' : ''}` : ''}{photos ? ` · ${photos} foto${photos > 1 ? 's' : ''}` : ''}.
              Quedará como una nota tuya: lo que cambies no le llega a quien te la envió{rems ? ', y sus recordatorios sonarán en tus aparatos' : ''}.</p>
            <label className="recibida-libreta">Libreta
              <select value={received.notebook} onChange={e => setReceived({ ...received, notebook: e.target.value })}>
                {notebooks.map(nb => <option key={nb.id} value={nb.id}>{nb.name}</option>)}
                {!notebooks.length && <option value="">Mis notas (nueva)</option>}
              </select>
            </label>
            <div className="caja-fila">
              <button className="principal" onClick={addReceived}>Agregar a mis notas</button>
              <button onClick={() => setReceived(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      })()}
      {remDlg && (() => {
        const curText = s.texts[remDlg.noteId]?.text
        const cur = remDlg.id && curText ? remindersOf(curText).find(x => x.r.id === remDlg.id)?.r : undefined
        const n = s.files[remDlg.noteId]
        const apply = (r: Reminder | null) => { if (remDlg.id) changeReminder(remDlg.noteId, remDlg.id, r) }
        return <ReminderDialog reminder={cur} label={remDlg.label} locked={isLocked(n)} offline={s.offline} onClose={() => setRemDlg(null)}
          shared={!!shareOf(n) && !shareOf(n)!.fin} me={session.email}
          onSave={r => { if (remDlg.insert) remDlg.insert(r); else apply(r); setRemDlg(null); notify.askPermission() }}
          onRemove={() => { apply(null); setRemDlg(null) }}
          onDone={() => { if (cur) apply(markDone(cur)); setRemDlg(null) }}
          onHistory={hist => { if (cur) apply({ ...cur, hist }) }} />
      })()}
      {reminderHelp && <ReminderHelp mode={reminderHelp} current={reminderMode} calendarHere={calendarHere} onClose={() => setReminderHelp(null)} onUse={pickMode} />}

      {keyDialog && <div className="ventana-fondo" role="dialog" aria-modal="true" aria-label="Clave de notas">
        <div className="ventana">
          {keyDialog.mode === 'huella'
            ? <PrintOffer salt={keyDialog.salt} onDone={() => { setKeyDialog(null); keyDialog.then?.() }} />
            : keyDialog.mode === 'comun'
            ? <CreateKey common onCancel={() => setKeyDialog(null)} onCreated={async v => {
              const n = keyDialog.noteId ? s.files[keyDialog.noteId] : undefined
              try {
                if (n) await setCommonKey(n, v)
                setToast('Listo: la nota pide esta clave en todos los aparatos. Díselas a las personas con quienes la compartes.')
                const salt = vault.saltOf(v)
                if (await canOfferPrint(salt)) setKeyDialog({ mode: 'huella', salt })
                else setKeyDialog(null)
              } catch (e) { fail(e); setKeyDialog(null) }
            }} />
            : keyDialog.mode === 'cambiar' || keyDialog.mode === 'cambiar-comun'
            ? <ChangeKey common={keyDialog.mode === 'cambiar-comun'} onCancel={() => setKeyDialog(null)} prepare={() => store.openVault()}
              verifier={keyDialog.mode === 'cambiar-comun' ? commonKey(keyDialog.noteId ? s.files[keyDialog.noteId] : undefined) : verifier}
              onChanged={(v, old) => changedKey(v, old, keyDialog.mode === 'cambiar-comun' ? keyDialog.noteId : undefined)} />
            : keyDialog.mode === 'abrir'
            ? <Unlock compact verifier={verifier} onForgot={() => { setKeyDialog(null); forgotKey() }} onOpen={async offer => {
              await store.openVault()
              if (offer) setKeyDialog({ mode: 'huella', then: keyDialog.then })
              else { setKeyDialog(null); keyDialog.then?.() }
            }} />
            : <CreateKey again={keyDialog.mode === 'nueva'} onCancel={() => setKeyDialog(null)}
              onNoKey={keyDialog.mode === 'nueva' ? removeAllKeys : undefined} onCreated={async v => {
              setVerifier(v)
              await store.openVault()
              if (await canOfferPrint()) setKeyDialog({ mode: 'huella', then: keyDialog.then })
              else { setKeyDialog(null); keyDialog.then?.() }
            }} />}
          {keyDialog.mode === 'abrir' && <button className="enlace" onClick={() => setKeyDialog(null)}>Cancelar</button>}
        </div>
      </div>}

      {error && <div className="aviso" role="alert">
        {error === 'auth' ? 'La sesión de Google venció. Tus cambios están guardados en este dispositivo.' : error}
        {error === 'auth'
          ? <button onClick={login}>Reconectar</button>
          : <button onClick={() => { setProblem(null); store.sync() }}>Reintentar</button>}
      </div>}
    </div>
  )
}
