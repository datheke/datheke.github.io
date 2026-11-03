import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Mention from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { Fragment, Slice, type Mark } from '@tiptap/pm/model'
import { EditorContent, Extension, mergeAttributes, Node, ReactRenderer, useEditor, useEditorState, type ChainedCommands, type Editor as TiptapEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { flip, size } from '@floating-ui/dom'
import StarterKit from '@tiptap/starter-kit'
import {
  AudioLines, Baseline, Bell, BetweenHorizontalEnd, BetweenVerticalEnd, Bold, ChevronDown, ChevronUp, ClipboardPaste, GripVertical, Highlighter,
  ImagePlus, Italic, Link, List, ListIndentDecrease, ListIndentIncrease, ListOrdered, ListTodo, Redo2, RemoveFormatting, Search, Smile,
  Sparkles, Strikethrough, Table, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart, Trash2, Underline, Undo2, X,
} from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react'
import { Calculator, insertCalc } from './Calculator.ts'
import { exitDetails, moveBlock, movableDepth, moveTo } from './blocks.ts'
import GeminiPanel, { type Privacy } from './GeminiPanel.tsx'
import { imageDataUrl, imageUrl, pickImage, uploadImage } from './images.ts'
import { appFont, FONTS } from './fonts.ts'
import { appFonts, copiedHtml, isFromApp, rememberCopy, tidyText } from './paste.ts'
import { closedDetails, findInDoc, fold, searchWords } from './search.ts'
import { runSlash, slashAllowed, type Command } from './slash.ts'
import { wordAt } from './word.ts'
import { useBack } from './back.ts'
import { chipText, groupOf, type Reminder } from './remind.ts'

// Las opciones con lo que tiene el texto: si no está en la lista (tamaño pegado con su formato original) se agrega.
const withCurrent = (options: string[][], value: string, label: string) =>
  !value || options.some(([v]) => v === value) ? options : [...options, [value, label]]
// Paletas propias en vez del selector de color del sistema, que en la app de Android no abre.
const TEXT_COLORS = [['', 'Automático'], ['#000000', 'Negro'], ['#595959', 'Gris'], ['#c00000', 'Rojo oscuro'], ['#ff0000', 'Rojo'],
  ['#e36c09', 'Naranja'], ['#bf9000', 'Dorado'], ['#00b050', 'Verde'], ['#0070c0', 'Azul'], ['#002060', 'Azul oscuro'], ['#7030a0', 'Morado']]
const HIGHLIGHTS = [['', 'Sin resaltado'], ['#fff59d', 'Amarillo'], ['#c8e6c9', 'Verde'], ['#b3e5fc', 'Celeste'], ['#f8bbd0', 'Rosado'],
  ['#ffe0b2', 'Naranja'], ['#e1bee7', 'Lila'], ['#e0e0e0', 'Gris']]
const SIZES = [['', 'Tamaño'], ['12px', '12'], ['14px', '14'], ['18px', '18'], ['24px', '24'], ['32px', '32']]
// Interlineado con los números de Word; en CSS va x1.2 porque el "sencillo" de Word es ~1.2 veces la letra.
const LINE_HEIGHTS = [['', 'Interlineado'], ['1.2', '1.0'], ['1.38', '1.15'], ['1.8', '1.5'], ['2.4', '2.0'], ['3', '2.5'], ['3.6', '3.0']]
const ALIGNS = [['left', 'Alinear a la izquierda', TextAlignStart], ['center', 'Centrar', TextAlignCenter],
  ['right', 'Alinear a la derecha', TextAlignEnd], ['justify', 'Justificar', TextAlignJustify]] as const
// Lo que tiene interlineado, alineación, sangría y estilo: párrafos, títulos y el título de un desplegable.
const BLOCKS = ['paragraph', 'heading', 'detailsSummary']
const INDENT_PX = 40
const MAX_INDENT = 8
const EMOJIS = '😀 😂 😍 🥰 😎 🤔 😢 😡 👍 👎 👏 🙏 💪 🎉 ❤️ ⭐ 🔥 ✅ ❌ ⚠️ 💡 📌 📎 📝 📅 ⏰ 🛒 🏠 💼 💰 📚 🎓 ✈️ 🚗 🍎 🍕 ☕ 🎵 🐶 🌱'.split(' ')

type Handle = { onKeyDown: (e: KeyboardEvent) => boolean }

function Menu({ items, command, ref }: { items: { label: string }[]; command: (item: unknown) => void; ref?: Ref<Handle> }) {
  const [index, setIndex] = useState(0)
  const sel = index < items.length ? index : 0
  useImperativeHandle(ref, () => ({
    onKeyDown: e => {
      if (!items.length) return false
      if (e.key === 'ArrowDown') setIndex((sel + 1) % items.length)
      else if (e.key === 'ArrowUp') setIndex((sel + items.length - 1) % items.length)
      else if (e.key === 'Enter') command(items[sel])
      else return false
      return true
    },
  }))
  return (
    <div className="menu" role="listbox">
      {items.length ? items.map((item, n) => (
        <button key={n} type="button" role="option" aria-selected={n === sel} className={n === sel ? 'activo' : undefined}
          onMouseDown={e => e.preventDefault()} onClick={() => command(item)}>{item.label}</button>
      )) : <p>Sin resultados</p>}
    </div>
  )
}

// Ventanita flotante para "/" y "@"; TipTap la posiciona junto al cursor.
function popup() {
  let renderer: ReactRenderer<Handle> | null = null
  let unmount = () => {}
  return {
    onStart: (props: SuggestionProps) => {
      renderer = new ReactRenderer(Menu, { props, editor: props.editor })
      unmount = props.mount(renderer.element as HTMLElement)
    },
    onUpdate: (props: SuggestionProps) => renderer?.updateProps(props),
    onKeyDown: ({ event }: { event: KeyboardEvent }) => renderer?.ref?.onKeyDown(event) ?? false,
    onExit: () => { unmount(); renderer?.destroy(); renderer = null },
  }
}

// Dónde va la ventanita: debajo del cursor, o arriba si abajo no cabe (teclado del celular), pero nunca encima de la
// barra de herramientas; su alto se ajusta al espacio que queda y se desplaza por dentro.
const toolbarBottom = () => Math.max(0, document.querySelector('.barra-fija')?.getBoundingClientRect().bottom ?? 0)
const room = () => ({ top: toolbarBottom() + 6, bottom: 8, left: 8, right: 8 })
const MENU_PLACE = {
  placement: 'bottom-start' as const,
  flip: false,
  floatingUi: {
    middleware: [
      flip(() => ({ padding: room(), fallbackPlacements: ['top-start'] })),
      size(() => ({
        padding: room(),
        apply({ availableHeight, elements }: { availableHeight: number; elements: { floating: HTMLElement } }) {
          const h = `${Math.max(120, Math.min(280, Math.floor(availableHeight)))}px`
          elements.floating.style.maxHeight = h
          const menu = elements.floating.querySelector<HTMLElement>('.menu') // la lista de adentro es la que se desplaza
          if (menu) menu.style.maxHeight = h
        },
      })),
    ],
  },
}

// Menú "/": al escribir "/" se elige qué insertar.
const Slash = Extension.create<{ items: Command[] }>({
  name: 'slash',
  addOptions: () => ({ items: [] }),
  addProseMirrorPlugins() {
    return [Suggestion<Command, Command>({
      editor: this.editor,
      pluginKey: new PluginKey('slash'),
      char: '/',
      allowedPrefixes: null,
      allow: ({ state, range }) => slashAllowed(state.doc, range.from),
      items: ({ query }) => this.options.items.filter(i => fold(i.label).includes(fold(query))),
      command: ({ editor, range, props }) => runSlash(editor, range, props),
      render: popup,
      ...MENU_PLACE,
    })]
  },
})

// Buscar dentro de la nota: las palabras se resaltan encima del texto, sin guardarse en él ni contar como un cambio.
type Found = { words: string[]; at: number; ranges: { from: number; to: number }[]; marks: DecorationSet }
const NOTHING_FOUND: Found = { words: [], at: 0, ranges: [], marks: DecorationSet.empty }
const findKey = new PluginKey<Found>('buscar')
const FindWords = Extension.create({
  name: 'buscar',
  addProseMirrorPlugins: () => [new Plugin<Found>({
    key: findKey,
    state: {
      init: () => NOTHING_FOUND,
      apply(tr, old) {
        const meta: { words?: string[]; at?: number } | undefined = tr.getMeta(findKey)
        if (!meta && !(tr.docChanged && old.words.length)) return old
        const words = meta?.words ?? old.words
        if (!words.length) return NOTHING_FOUND
        const ranges = meta?.words || tr.docChanged ? findInDoc(tr.doc, words) : old.ranges
        const at = Math.max(0, Math.min(meta?.at ?? old.at, ranges.length - 1))
        const marks = ranges.map((r, i) => Decoration.inline(r.from, r.to, { class: i === at ? 'buscado actual' : 'buscado' }))
        return { words, at, ranges, marks: DecorationSet.create(tr.doc, marks) }
      },
    },
    props: { decorations: state => findKey.getState(state)?.marks },
  })],
})

// Lleva a la palabra actual, abriendo los desplegables que la escondan. Eso no se guarda: buscar nunca cambia la nota
// (tampoco una fijada o una del basurero) y el cursor no se mueve del buscador.
function showFound(editor: TiptapEditor) {
  const found = findKey.getState(editor.state)
  const hit = found?.ranges[found.at]
  if (!hit) return
  const closed = closedDetails(editor.state.doc, hit.from)
  if (closed.length) {
    const tr = editor.state.tr.setMeta('addToHistory', false).setMeta('preventUpdate', true)
    for (const pos of closed) tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)?.attrs, open: true })
    editor.view.dispatch(tr)
  }
  editor.view.dom.querySelector('.buscado.actual')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// La barrita para buscar dentro de la nota. Enter: siguiente; Mayús+Enter: anterior; Esc: cerrar.
function FindBar({ value, at, total, onChange, onStep, onClose }: {
  value: string; at: number; total: number; onChange: (v: string) => void; onStep: (d: number) => void; onClose: () => void
}) {
  const keep = (e: { preventDefault(): void }) => e.preventDefault() // el cursor se queda en la cajita (y el teclado abierto)
  return (
    <div className="buscar-nota" role="search">
      <Search size={16} aria-hidden="true" />
      <input autoFocus={!value} value={value} onChange={e => onChange(e.target.value)} placeholder="Buscar en esta nota" aria-label="Buscar en esta nota" enterKeyHint="search"
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') onClose()
        }} />
      <span className="buscar-cuenta" role="status">{value.trim() && (total ? `${at + 1} de ${total}` : 'Sin resultados')}</span>
      <button type="button" className="btn-icono" disabled={!total} onMouseDown={keep} onClick={() => onStep(-1)} title="Anterior" aria-label="Anterior"><ChevronUp size={18} /></button>
      <button type="button" className="btn-icono" disabled={!total} onMouseDown={keep} onClick={() => onStep(1)} title="Siguiente" aria-label="Siguiente"><ChevronDown size={18} /></button>
      <button type="button" className="btn-icono" onClick={onClose} title="Cerrar la búsqueda" aria-label="Cerrar la búsqueda"><X size={18} /></button>
    </div>
  )
}

// La nota guarda <img src="drive:ID">; aquí se muestra bajando la foto con la sesión.
const DriveImage = Image.extend({
  addNodeView: () => ({ node }) => {
    const img = document.createElement('img')
    const src = String(node.attrs.src ?? '')
    if (src.startsWith('drive:')) imageUrl(src.slice(6)).then(url => { img.src = url }, () => { img.alt = 'No se pudo cargar la foto' })
    else img.src = src
    return { dom: img }
  },
})

// Recuadro de aviso: el emoji se dibuja con CSS a partir de data-emoji.
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({
    emoji: { default: '💡', parseHTML: el => el.getAttribute('data-emoji') ?? '💡', renderHTML: a => ({ 'data-emoji': a.emoji }) },
  }),
  parseHTML: () => [{ tag: 'div[data-type="callout"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0],
})

// Recordatorio de una línea: etiqueta 🔔 al final de la línea (remind.ts). Se toca para abrir su ventana.
const attr = (name: string) => ({ default: null, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`), renderHTML: (a: Record<string, unknown>) => a[name] ? { [`data-${name}`]: a[name] } : {} })
const toReminder = (a: Record<string, string | null>): Reminder => ({
  id: a.id ?? '', at: a.at ?? '', rep: a.rep ?? '', insist: a.insistir === 'true', done: a.hecho === 'true', hist: (a.historial ?? '').split(',').filter(Boolean),
  ...(a.solo ? { solo: a.solo } : {}),
})
const ReminderTag = Node.create<{ onOpen: (id: string) => void; me: string }>({
  name: 'recordatorio',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addOptions: () => ({ onOpen: () => {}, me: '' }),
  addAttributes: () => ({ id: attr('id'), at: attr('at'), rep: attr('rep'), insistir: attr('insistir'), hecho: attr('hecho'), historial: attr('historial'), solo: attr('solo') }),
  parseHTML: () => [{ tag: 'span[data-type="recordatorio"]' }],
  // En el HTML guardado (respaldo, copia de la PC) queda como texto: "🔔 15 nov · 09:00".
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'recordatorio', class: 'rec' }), `🔔 ${chipText(toReminder(node.attrs))}`],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.setAttribute('data-type', 'recordatorio')
      dom.contentEditable = 'false'
      const paint = (n: typeof node) => {
        const r = toReminder(n.attrs)
        const g = groupOf(r)
        dom.dataset.id = r.id
        const other = r.solo && r.solo.toLowerCase() !== this.options.me.toLowerCase() // en una compartida: le suena solo a otra persona
        dom.className = `rec ${other ? 'de-otro' : g}`
        dom.textContent = other ? `🔕 ${chipText(r)} · solo ${r.solo!.split('@')[0]}` : `${g === 'pendiente' ? '⏰' : g === 'hecho' ? '✓' : '🔔'} ${chipText(r)}${r.solo ? ' · solo yo' : ''}`
        dom.title = 'Recordatorio: toca para verlo o cambiarlo'
      }
      paint(node)
      dom.addEventListener('mousedown', e => e.preventDefault())
      dom.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); this.options.onOpen(String(node.attrs.id)) })
      return {
        dom,
        update: n => { if (n.type.name !== 'recordatorio') return false; node = n; paint(n); return true },
        ignoreMutation: () => true,
      }
    }
  },
})

// Interlineado y sangría por párrafo, como en Word. Van en el HTML de la nota: se ven igual en todos los aparatos.
// El interlineado pegado con su formato original (Word manda "107%") se respeta tal cual.
const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes: () => [{
    types: BLOCKS,
    attributes: {
      lineHeight: {
        default: null,
        parseHTML: el => el.style.lineHeight || null,
        renderHTML: a => a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {},
      },
      indent: {
        default: 0,
        parseHTML: el => Math.min(MAX_INDENT, Number(el.getAttribute('data-indent')) || 0),
        renderHTML: a => a.indent ? { 'data-indent': a.indent, style: `margin-left: ${a.indent * INDENT_PX}px` } : {},
      },
    },
  }],
})

// El título de un desplegable nace como Título 2 y se puede cambiar como cualquier título, también a Normal (0).
// Sin data-level (desplegables de antes) también es Título 2: antes ya se veían en negrita.
const Summary = DetailsSummary.extend({
  content: 'inline*', // también la etiqueta 🔔 de un recordatorio (y formato), no solo texto
  addAttributes() {
    return {
      ...this.parent?.(),
      level: {
        default: 2,
        parseHTML: el => el.hasAttribute('data-level') ? Number(el.getAttribute('data-level')) : 2,
        renderHTML: a => ({ 'data-level': a.level }),
      },
    }
  },
})

// Desplegables que no esconden lo nuevo:
//  - Enter al final del título de un desplegable cerrado lo abre y pone el cursor adentro (no queda oculto).
//  - Si algo se escribe o se crea dentro de un desplegable cerrado (también uno dentro de otro), se abre.
// Se hace en dos pasos: primero se abre (el contenido se vuelve visible) y luego se mueve el cursor; si fuera en un
// solo paso, TipTap vería el cursor en algo escondido y lo sacaría al título.
const OpenDetails = Extension.create({
  name: 'openDetails',
  priority: 1000, // antes que el Enter de TipTap (que en uno cerrado crea la línea afuera)
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state, view } = editor
        const { $head, empty } = state.selection
        if (empty && exitDetails(state, view.dispatch)) return true
        if (!empty || $head.parent.type.name !== 'detailsSummary') return false
        // Al final del título (después solo puede quedar la etiqueta 🔔 de un recordatorio, sin texto).
        let textAfter = false
        $head.parent.content.cut($head.parentOffset).forEach(n => { if (n.isText) textAfter = true })
        if (textAfter) return false
        const details = $head.node(-1)
        if (details.type.name !== 'details' || details.attrs.open) return false
        const detailsPos = $head.before(-1)
        let opening = state.tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true })
        // Y los desplegables vacíos que tenga adentro (creados antes y quedados cerrados): que se vean.
        details.descendants((n, pos) => {
          if (n.type.name === 'details' && !n.attrs.open && !n.textContent.trim()) opening = opening.setNodeMarkup(detailsPos + 1 + pos, undefined, { ...n.attrs, open: true })
        })
        view.dispatch(opening)
        // El contenido empieza justo después del título.
        const s2 = view.state
        const contentPos = s2.doc.resolve(detailsPos + 1).posAtIndex(1)
        const content = s2.doc.nodeAt(contentPos)
        if (!content) return true
        const first = content.firstChild
        let tr = s2.tr
        if (!first || first.type.name !== 'paragraph' || first.content.size > 0) tr = tr.insert(contentPos + 1, s2.schema.nodes.paragraph.create())
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(contentPos + 2))).scrollIntoView()
        view.dispatch(tr)
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('openDetails'),
      view: () => ({
        update: (view, prev) => {
          if (prev.doc.eq(view.state.doc)) return
          const open = () => {
            if (view.isDestroyed) return
            const { $from } = view.state.selection
            let tr = view.state.tr
            // Desplegables recién creados (título vacío) que nacieron cerrados: se abren, así se ve lo de adentro.
            view.state.doc.descendants((n, pos) => {
              if (n.type.name === 'details' && !n.attrs.open && !n.firstChild?.textContent.trim()) tr = tr.setNodeMarkup(pos, undefined, { ...n.attrs, open: true })
            })
            for (let d = $from.depth; d > 1; d--) {
              if ($from.node(d).type.name !== 'detailsContent') continue
              const details = $from.node(d - 1)
              if (details.type.name === 'details' && !details.attrs.open) tr = tr.setNodeMarkup($from.before(d - 1), undefined, { ...details.attrs, open: true })
            }
            if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false))
          }
          setTimeout(open)
        },
      }),
    })]
  },
})

// Alt+↑ / Alt+↓ suben o bajan lo que tiene el cursor (en la PC, además de arrastrar con la agarradera).
const MoveBlocks = Extension.create({
  name: 'moveBlocks',
  addKeyboardShortcuts() {
    const move = (dir: -1 | 1) => () => {
      const tr = moveBlock(this.editor.state, dir)
      if (tr) this.editor.view.dispatch(tr)
      return !!tr
    }
    return { 'Alt-ArrowUp': move(-1), 'Alt-ArrowDown': move(1) }
  },
})

// La misma marca (tamaño 14) en todo el texto de lo pegado.
function withMark(slice: Slice, mark: Mark): Slice {
  const map = (f: Fragment): Fragment => {
    const out: import('@tiptap/pm/model').Node[] = []
    f.forEach(n => out.push(n.isText ? n.mark(mark.addToSet(n.marks)) : n.copy(map(n.content))))
    return Fragment.from(out)
  }
  return new Slice(map(slice.content), slice.openStart, slice.openEnd)
}

// Copia completa de lo seleccionado (como la arma el editor para el portapapeles, con data-pm-slice).
function remember(view: EditorView) {
  if (view.state.selection.empty) return
  const { dom, text } = view.serializeForClipboard(view.state.selection.content())
  rememberCopy(dom.innerHTML, text)
}

type Props = {
  content: string
  onChange: (html: string) => void
  notes: { id: string; label: string }[]
  onOpenNote: (id: string) => void
  onError: (e: unknown) => void
  editable: boolean // false = nota fijada: se lee y se copia, no se cambia
  geminiKey: string // vacía = Gemini sin vincular
  onGeminiKey: (key: string) => void
  privacy: Privacy // nota o libreta privada: Gemini no lee su texto
  onPrivate: () => void // "Marcarla privada" desde el aviso de Gemini
  onReminder: (id: string) => void // tocaron la etiqueta 🔔 de una línea
  onNewReminder: (label: string, insert: (r: Reminder) => void) => void // 🔔 de la barra o "/recordatorio"
  focusReminder?: string // al abrir desde la lista: ir a esa línea
  find: string | null // buscar dentro de la nota: lo escrito (null: la barrita está cerrada)
  onFind: (text: string | null) => void
  me?: string // mi correo (recordatorios "solo para mí" en notas compartidas)
  inlineImages?: boolean // nota compartida: las fotos van dentro de la nota (la otra persona no ve tus fotos de Datheke)
}

// El contenido solo se usa al crear el editor; App lo vuelve a montar (key) al cambiar de nota.
export default function Editor({ content, onChange, notes, onOpenNote, onError, editable, geminiKey, onGeminiKey, privacy, onPrivate,
  onReminder, onNewReminder, focusReminder, find, onFind, inlineImages, me }: Props) {
  // TipTap guarda la configuración al crearse: las funciones que cambian se leen desde refs.
  const latest = useRef({ onChange, notes, onError, onReminder, onNewReminder, geminiKey, privacy })
  useEffect(() => { latest.current = { onChange, notes, onError, onReminder, onNewReminder, geminiKey, privacy } })
  // Fuentes que la app no tiene (pegadas antes de existir appFonts) se ven con la letra de la nota, igual en todos lados.
  const [initial] = useState(() => appFonts(content))
  const [uploading, setUploading] = useState(0)
  // Lo último que se pegó (dónde quedó y el original), para "Mantener formato original"; se olvida con el siguiente cambio.
  // kind: 'otro' = de otro lado, entró solo el texto (se puede volver al original); 'app' = copiado en Datheke, entró tal cual
  // (se puede pegar sin formato).
  // start: dónde empieza lo pegado (si el cursor estaba en un renglón vacío, el bloque pegado lo reemplaza).
  type Pasting = { from: number; start: number; html: string; text: string; kind: 'otro' | 'app' }
  const pasting = useRef<Pasting | null>(null)
  const [pasted, setPasted] = useState<(Pasting & { to: number }) | null>(null)
  const plainPaste = useRef(false) // lo que se pega ahora es solo texto: va en tamaño 14
  const inPaste = useRef(false) // pasteText/pasteHTML vuelven a pasar por handlePaste

  // Pegar: lo copiado en la app entra tal cual (aunque el teclado del celular haya guardado solo el texto); lo de otro lado,
  // solo el texto en tamaño 14 y sin renglones vacíos de más. false: que el editor lo pegue como siempre.
  function smartPaste(view: EditorView, text: string, html: string, event?: ClipboardEvent): boolean {
    const { from, $from } = view.state.selection
    const start = $from.parent.isTextblock && !$from.parent.content.size && $from.depth > 0 ? $from.before() : from
    const own = copiedHtml(text) ?? (html && isFromApp(html) ? html : null)
    inPaste.current = true
    try {
      if (own) {
        pasting.current = { from, start, html: own, text, kind: 'app' }
        view.pasteHTML(own, event)
      } else {
        if (!text) return false
        pasting.current = html ? { from, start, html, text, kind: 'otro' } : null
        plainPaste.current = true
        view.pasteText(tidyText(text), event)
      }
      return true
    } finally {
      inPaste.current = false
      plainPaste.current = false
    }
  }
  async function pasteButton(editor: TiptapEditor) {
    try {
      const text = await navigator.clipboard.readText()
      if (text && !editor.isDestroyed) { editor.commands.focus(); smartPaste(editor.view, text, '') }
    } catch { latest.current.onError(new Error('No pude leer lo copiado: mantén presionado en la nota y elige Pegar.')) }
  }

  async function addImages(editor: TiptapEditor, files: File[]) {
    for (const file of files) {
      setUploading(n => n + 1)
      try {
        const src = inlineImages ? await imageDataUrl(file) : `drive:${await uploadImage(file)}`
        if (!editor.isDestroyed) editor.chain().focus().setImage({ src }).run()
      } catch (e) { latest.current.onError(e) } finally { setUploading(n => n - 1) }
    }
  }
  const addPhoto = async (editor: TiptapEditor) => {
    const file = await pickImage()
    if (file) addImages(editor, [file])
  }

  // Recordatorio nuevo al final de la línea del cursor (desplegable, punto de lista o párrafo).
  function newReminder(editor: TiptapEditor) {
    const $from = editor.state.selection.$from
    const label = $from.parent.textContent.trim() || 'Recordatorio'
    latest.current.onNewReminder(label, r => {
      const at = editor.state.doc.resolve(Math.min($from.end(), editor.state.doc.content.size))
      const pos = at.end()
      const space = at.parent.textContent.endsWith(' ') || !at.parent.textContent ? [] : [editor.schema.text(' ')]
      editor.view.dispatch(editor.state.tr.insert(pos, [...space, editor.schema.nodes.recordatorio.create({
        id: r.id, at: r.at, rep: r.rep || null, insistir: r.insist ? 'true' : null, hecho: null, historial: r.hist.join(',') || null, solo: r.solo || null,
      })]))
    })
  }

  const commands: Command[] = [
    { label: 'Título 1', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
    { label: 'Título 2', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
    { label: 'Lista', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
    { label: 'Lista numerada', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
    { label: 'Casillas', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
    { label: 'Tabla', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: 'Foto', run: (e, r) => { e.chain().focus().deleteRange(r).run(); addPhoto(e) } },
    { label: 'Recuadro 💡', run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('callout', { emoji: '💡' }).run() },
    { label: 'Advertencia ⚠️', run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('callout', { emoji: '⚠️' }).run() },
    { label: 'Importante ❗', run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('callout', { emoji: '❗' }).run() },
    { label: 'Desplegable', run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
    { label: 'Cita', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
    { label: 'Calculadora 🧮', run: (e, r) => { e.chain().focus().deleteRange(r).run(); insertCalc(e) } },
    { label: 'Separador', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    { label: 'Recordatorio 🔔', inline: true, run: (e, r) => { e.chain().focus().deleteRange(r).run(); newReminder(e) } },
    { label: 'Enlace a otra nota (@)', inline: true, run: (e, r) => e.chain().focus().deleteRange(r).insertContent('@').run() },
  ]

  const editor = useEditor({
    extensions: [
      StarterKit, TextStyleKit, TaskList, TaskItem.configure({ nested: true, onReadOnlyChecked: () => true }), TableKit, DriveImage, Callout,
      // eslint-disable-next-line react-hooks/refs
      Calculator.configure({ gemini: () => ({ key: latest.current.geminiKey, private: !!latest.current.privacy }) }),
      Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }), Summary, DetailsContent,
      TextAlign.configure({ types: BLOCKS }), ParagraphFormat, MoveBlocks, OpenDetails, FindWords,
      // eslint-disable-next-line react-hooks/refs
      ReminderTag.configure({ onOpen: id => latest.current.onReminder(id), me: me ?? '' }),
      Placeholder.configure({ placeholder: 'Escribe / para insertar tablas, fotos, casillas, recuadros…' }),
      // Los comandos y el buscador de "@" leen refs solo al usarse (al escribir), no al dibujar.
      // eslint-disable-next-line react-hooks/refs
      Slash.configure({ items: commands }),
      // eslint-disable-next-line react-hooks/refs
      Mention.configure({
        HTMLAttributes: { class: 'enlace-nota' },
        suggestion: {
          items: ({ query }) => latest.current.notes.filter(n => fold(n.label).includes(fold(query))).slice(0, 8),
          render: popup,
          ...MENU_PLACE,
        },
      }),
    ],
    content: initial,
    editable,
    editorProps: {
      // El cursor nunca queda pegado al borde (al teclado del celular): se deja espacio al escribir y al volver a la nota.
      scrollThreshold: { top: 40, bottom: 80, left: 0, right: 0 },
      scrollMargin: { top: 40, bottom: 80, left: 0, right: 0 },
      // Tocar un separador pone el cursor en un renglón debajo (se crea si no hay uno vacío): así se puede escribir entre
      // dos separadores, o entre un separador y un desplegable.
      handleClickOn: (view, _pos, node, nodePos, _event, direct) => {
        if (!direct || !view.editable || node.type.name !== 'horizontalRule') return false
        const after = nodePos + node.nodeSize
        const next = view.state.doc.nodeAt(after)
        let tr = view.state.tr
        if (next?.type.name !== 'paragraph' || next.content.size) tr = tr.insert(after, view.state.schema.nodes.paragraph.create())
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView())
        view.focus()
        return true
      },
      // De otro lado entra solo el texto, con el formato de la nota; el original queda para "Mantener formato original".
      // Lo copiado de la app, y lo que no trae texto (una foto de una página), va como viene.
      handlePaste: (view, event) => {
        if (inPaste.current) return false // la vuelta de pasteText / pasteHTML
        const html = event.clipboardData?.getData('text/html') ?? ''
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (!text && !html) return false // una foto: la sube onFiles
        if (!text) return false
        return smartPaste(view, text, html, event)
      },
      // Lo pegado como solo texto va en tamaño 14 (lo de otro lado no trae el formato de la nota).
      transformPasted: (slice: Slice, view: EditorView): Slice => plainPaste.current ? withMark(slice, view.state.schema.marks.textStyle.create({ fontSize: '14px' })) : slice,
      handleDOMEvents: {
        // Al copiar o cortar se guarda la copia completa para pegarla igual (el teclado del celular guarda solo el texto).
        copy: view => { remember(view); return false },
        cut: view => { remember(view); return false },
        // Pegar desde la barra del teclado (Gboard) no avisa que es un pegado: llega como texto escrito de varias líneas.
        beforeinput: (view, e) => {
          const ev = e as InputEvent
          const data = ev.inputType === 'insertReplacementText' ? ev.dataTransfer?.getData('text/plain') ?? '' : ev.inputType === 'insertText' ? ev.data ?? '' : ''
          if (!ev.cancelable || !(data.includes('\n') || (data.length > 1 && copiedHtml(data)))) return false
          ev.preventDefault()
          return smartPaste(view, data, '')
        },
      },
    },
    onUpdate: ({ editor, transaction }) => {
      // A una nota que termina en un bloque el editor le agrega solo un renglón vacío al menor movimiento (o al volver a
      // dibujarse): eso no es un cambio de la persona. Se guarda junto con el próximo cambio de verdad.
      if (!transaction.docChanged) return
      latest.current.onChange(editor.getHTML())
      const p = pasting.current
      pasting.current = null
      setPasted(p && transaction.getMeta('uiEvent') === 'paste' ? { ...p, to: editor.state.selection.to } : null)
    },
  })

  // false: cambiar entre fijada y editable no es un cambio de la nota (si no, se marcaba para subir al abrirla).
  useEffect(() => { if (editor.isEditable !== editable) editor.setEditable(editable, false) }, [editor, editable])

  // Nota fijada en el celular: zoom con dos dedos, de 85% a 200%. Solo para leer: se va al editar, al cambiar de nota o al salir
  // (el editor se vuelve a crear). Lo hace la app, así funciona igual en la app y en la web.
  useEffect(() => {
    const box = frame.current
    const content = box?.querySelector<HTMLElement>('.contenido')
    if (editable || !box || !content) return
    let start: { d: number; z: number } | null = null
    let zoom = 1
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const down = (e: TouchEvent) => { if (e.touches.length === 2) start = { d: dist(e.touches), z: zoom } }
    const move = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return
      e.preventDefault()
      zoom = Math.min(2, Math.max(0.85, start.z * dist(e.touches) / start.d))
      content.style.zoom = String(Math.round(zoom * 100) / 100)
    }
    const up = (e: TouchEvent) => { if (e.touches.length < 2) start = null }
    box.style.touchAction = 'pan-x pan-y' // el navegador no hace su propio zoom de toda la página
    box.addEventListener('touchstart', down, { passive: true })
    box.addEventListener('touchmove', move, { passive: false })
    box.addEventListener('touchend', up)
    box.addEventListener('touchcancel', up)
    return () => {
      box.removeEventListener('touchstart', down)
      box.removeEventListener('touchmove', move)
      box.removeEventListener('touchend', up)
      box.removeEventListener('touchcancel', up)
      box.style.touchAction = ''
      content.style.zoom = ''
    }
  }, [editable])

  // Al salir el teclado del celular la parte visible se achica: el cursor vuelve a quedar a la vista.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    // Otra vez al terminar de salir el teclado (al volver a la app sale de a poco y el cursor quedaba casi tapado).
    const show = () => { for (const ms of [0, 350]) setTimeout(() => { if (!editor.isDestroyed && editor.isFocused) editor.commands.scrollIntoView() }, ms) }
    vv.addEventListener('resize', show)
    return () => vv.removeEventListener('resize', show)
  }, [editor])

  // Tocar el espacio entre dos cosas sin renglón (dos desplegables, un desplegable y una tabla…) crea un renglón ahí.
  useEffect(() => {
    const dom = editor.view.dom
    const between = (e: MouseEvent) => {
      const box = e.target as HTMLElement
      if (!editor.isEditable || (box !== dom && box.dataset.type !== 'detailsContent')) return
      const i = [...box.children].findIndex(k => k.getBoundingClientRect().top > e.clientY)
      if (i <= 0) return
      const pos = editor.view.posAtDOM(box, i)
      const $pos = editor.state.doc.resolve(pos)
      if (!$pos.nodeBefore || !$pos.nodeAfter || $pos.nodeBefore.isTextblock || $pos.nodeAfter.isTextblock) return
      const tr = editor.state.tr.insert(pos, editor.schema.nodes.paragraph.create())
      editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView())
      editor.view.focus()
    }
    dom.addEventListener('click', between)
    return () => dom.removeEventListener('click', between)
  }, [editor])

  // Flechita de un desplegable: solo lo abre o cierra. El cursor se queda donde estaba y no sale el teclado (antes la
  // nota saltaba al cursor, o lo escrito luego caía en el título del desplegable).
  useEffect(() => {
    const dom = editor.view.dom
    const toggle = (e: Event) => {
      const box = (e.target as HTMLElement).closest('.details > button')?.parentElement
      if (!box || !editor.isEditable) return
      e.preventDefault()
      e.stopPropagation()
      if (e.type !== 'click') return
      const summary = box.querySelector('summary')
      if (!summary) return
      const $p = editor.state.doc.resolve(editor.view.posAtDOM(summary, 0))
      for (let d = $p.depth; d > 0; d--) {
        const n = $p.node(d)
        if (n.type.name === 'details') return editor.view.dispatch(editor.state.tr.setNodeMarkup($p.before(d), undefined, { ...n.attrs, open: !n.attrs.open }))
      }
    }
    for (const t of ['pointerdown', 'mousedown', 'click']) dom.addEventListener(t, toggle, true)
    return () => { for (const t of ['pointerdown', 'mousedown', 'click']) dom.removeEventListener(t, toggle, true) }
  }, [editor])

  // Nota fijada: no se escribe, pero las casillas sí se marcan y desmarcan (lista de compras en el súper).
  // TipTap deja la casilla marcada (onReadOnlyChecked) y aquí se guarda el cambio en la nota.
  useEffect(() => {
    const dom = editor.view.dom
    const onCheck = (e: Event) => {
      const box = e.target
      if (editor.isEditable || !(box instanceof HTMLInputElement) || box.type !== 'checkbox') return
      const content = box.closest('li')?.querySelector(':scope > div')
      if (!content) return
      const $pos = editor.state.doc.resolve(editor.view.posAtDOM(content, 0))
      for (let d = $pos.depth; d > 0; d--) {
        const node = $pos.node(d)
        if (node.type.name !== 'taskItem') continue
        editor.view.dispatch(editor.state.tr.setNodeMarkup($pos.before(d), undefined, { ...node.attrs, checked: box.checked }))
        return
      }
    }
    dom.addEventListener('change', onCheck)
    // Nota fijada: tocar cualquier parte del título de un desplegable lo abre o cierra (no es un cambio de la nota).
    const onToggle = (e: MouseEvent) => {
      if (editor.isEditable) return
      const t = e.target as HTMLElement
      if (t.closest('[data-type="recordatorio"]') || !t.closest('summary')) return
      t.closest('.details')?.querySelector<HTMLButtonElement>(':scope > button')?.click()
    }
    dom.addEventListener('click', onToggle)
    return () => { dom.removeEventListener('change', onCheck); dom.removeEventListener('click', onToggle) }
  }, [editor])

  // Desde la lista de recordatorios: llevar a esa línea (abriendo el desplegable que la tenga adentro) y resaltarla.
  useEffect(() => {
    if (!focusReminder) return
    const t = setTimeout(() => {
      const el = editor.view.dom.querySelector<HTMLElement>(`[data-type="recordatorio"][data-id="${CSS.escape(focusReminder)}"]`)
      if (!el) return
      const box = el.closest('.details')
      if (box && !box.classList.contains('is-open') && !el.closest('summary')) box.querySelector<HTMLButtonElement>(':scope > button')?.click()
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.add('rec-resaltado')
      setTimeout(() => el.classList.remove('rec-resaltado'), 2000)
    }, 150)
    return () => clearTimeout(t)
  }, [editor, focusReminder])

  // Buscar dentro de la nota: resaltar lo escrito e ir a la primera palabra (al dejar de escribir un momento).
  useEffect(() => {
    const words = searchWords(find ?? '')
    if (words.length || findKey.getState(editor.state)?.words.length) editor.view.dispatch(editor.state.tr.setMeta(findKey, { words, at: 0 }))
    if (!words.length) return
    const t = setTimeout(() => showFound(editor), 150)
    return () => clearTimeout(t)
  }, [editor, find])
  const found = useEditorState({ editor, selector: ({ editor: e }) => {
    const f = findKey.getState(e.state)
    return `${f?.at ?? 0}/${f?.ranges.length ?? 0}`
  } }).split('/').map(Number)
  const stepFound = (d: number) => {
    const f = findKey.getState(editor.state)
    if (!f?.ranges.length) return
    editor.view.dispatch(editor.state.tr.setMeta(findKey, { at: (f.at + d + f.ranges.length) % f.ranges.length }))
    showFound(editor)
  }

  // Agarradera ⠿ para arrastrar bloques, como en Evernote: junto al bloque bajo el mouse o, en el celular (sin mouse),
  // junto al del cursor. Se mueve lo mismo que con Subir/Bajar (movableDepth), entre sus hermanos.
  const frame = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [grip, setGrip] = useState<{ start: number; top: number; left: number } | null>(null)
  const [dropLine, setDropLine] = useState<{ top: number; left: number; width: number } | null>(null)

  function gripAt(pos: number) {
    const box = frame.current
    if (!box || !editor.isEditable) return setGrip(null)
    const $pos = editor.state.doc.resolve(pos)
    const depth = movableDepth($pos)
    const start = depth > 0 ? $pos.before(depth) : -1
    const dom = start >= 0 ? editor.view.nodeDOM(start) : null
    if (!(dom instanceof HTMLElement)) return setGrip(null)
    const r = dom.getBoundingClientRect(), b = box.getBoundingClientRect()
    setGrip({ start, top: r.top - b.top + 2, left: Math.max(0, r.left - b.left - 26) })
  }

  useEffect(() => {
    if (!matchMedia('(hover: none)').matches) return
    const follow = () => { if (!dragging.current) gripAt(editor.state.selection.from) }
    editor.on('selectionUpdate', follow)
    editor.on('update', follow)
    return () => { editor.off('selectionUpdate', follow); editor.off('update', follow) }
  })

  function hover(e: { clientX: number; clientY: number }) {
    if (dragging.current) return
    const b = editor.view.dom.getBoundingClientRect()
    const hit = editor.view.posAtCoords({ left: Math.min(Math.max(e.clientX, b.left + 40), b.right - 8), top: e.clientY })
    if (hit) gripAt(hit.pos)
  }

  function startDrag(e: ReactPointerEvent) {
    const box = frame.current
    if (!grip || !box) return
    e.preventDefault()
    const view = editor.view
    const $start = view.state.doc.resolve(grip.start)
    const index = $start.index()
    const doms: HTMLElement[] = []
    let p = $start.start()
    $start.parent.forEach(child => { const d = view.nodeDOM(p); if (d instanceof HTMLElement) doms.push(d); p += child.nodeSize })
    if (doms.length !== $start.parent.childCount) return
    const scroller = box.closest<HTMLElement>('.nota-scroll')
    let to = index
    dragging.current = true
    document.body.classList.add('arrastrando')
    const move = (ev: PointerEvent) => {
      const rs = doms.map(d => d.getBoundingClientRect()), b = box.getBoundingClientRect()
      let gap = rs.findIndex(r => ev.clientY < r.top + r.height / 2)
      if (gap < 0) gap = rs.length
      const ref = rs[Math.min(gap, rs.length - 1)]
      setDropLine({ top: (gap < rs.length ? ref.top - 3 : ref.bottom + 1) - b.top, left: ref.left - b.left, width: ref.width })
      to = gap > index ? gap - 1 : gap
      if (scroller) {
        const s = scroller.getBoundingClientRect()
        scroller.scrollTop += ev.clientY < s.top + 50 ? -14 : ev.clientY > s.bottom - 50 ? 14 : 0
      }
    }
    const end = (drop: boolean) => () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', ok)
      window.removeEventListener('pointercancel', cancel)
      document.body.classList.remove('arrastrando')
      dragging.current = false
      setDropLine(null)
      setGrip(null)
      const tr = drop ? moveTo(view.state, grip.start, to) : null
      if (tr) view.dispatch(tr)
      view.focus()
    }
    const ok = end(true), cancel = end(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', ok)
    window.addEventListener('pointercancel', cancel)
  }

  // Pegar una captura o soltar fotos las sube a Drive. Si lo pegado trae texto (Word, web), se deja a TipTap.
  function onFiles(e: { preventDefault(): void; stopPropagation(): void }, data: DataTransfer | null) {
    const images = [...(data?.files ?? [])].filter(f => f.type.startsWith('image/'))
    if (!editable || !images.length || data?.types.includes('text/html')) return
    e.preventDefault()
    e.stopPropagation()
    addImages(editor, images)
  }

  // La barra de formato y el aviso de pegado quedan fijos arriba al bajar por la nota (la portada se va con el texto).
  return <>
    {(editable || find !== null) && <div className="barra-fija">
      {find !== null && <FindBar value={find} at={found[0]} total={found[1]} onChange={onFind} onStep={stepFound} onClose={() => onFind(null)} />}
      {editable && <Toolbar editor={editor} uploading={uploading > 0} onPhoto={() => addPhoto(editor)} onReminder={() => newReminder(editor)} onPaste={() => pasteButton(editor)} geminiKey={geminiKey} onGeminiKey={onGeminiKey}
        privacy={privacy} onPrivate={onPrivate} />}
      {pasted && <div className="pegado" role="status">
        <ClipboardPaste size={16} aria-hidden="true" /> {pasted.kind === 'app' ? 'Se pegó tal cual.' : 'Se pegó solo el texto, con el formato de la nota.'}
        <button type="button" className="principal" onMouseDown={e => e.preventDefault()} onClick={() => {
          // Se vuelve a pegar encima, con el pegado del editor: sigue en el renglón como un pegado normal.
          inPaste.current = true
          try {
            if (pasted.kind === 'app') {
              // Lo pegado (casillas, separadores…) se cambia por un renglón vacío y ahí va solo el texto.
              const { state, view } = editor
              const to = Math.min(pasted.to, state.doc.content.size)
              const tr = state.tr.replaceWith(pasted.start, to, state.schema.nodes.paragraph.create())
              view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pasted.start + 1))))
              view.focus()
              plainPaste.current = true
              view.pasteText(tidyText(pasted.text))
            } else {
              editor.chain().focus().setTextSelection({ from: pasted.from, to: pasted.to }).run()
              editor.view.pasteHTML(appFonts(pasted.html))
            }
          } finally { inPaste.current = false; plainPaste.current = false }
          setPasted(null)
        }}>{pasted.kind === 'app' ? 'Pegar sin formato' : 'Mantener formato original'}</button>
        <button type="button" className="btn-icono" aria-label="Cerrar" onClick={() => setPasted(null)}>✕</button>
      </div>}
    </div>}
    <div className="contenido-marco" ref={frame} onMouseMove={hover} onMouseLeave={() => { if (!dragging.current) setGrip(null) }}>
      <EditorContent editor={editor} className="contenido"
        onPasteCapture={e => onFiles(e, e.clipboardData)} onDropCapture={e => onFiles(e, e.dataTransfer)}
        onClick={e => {
          const id = (e.target as HTMLElement).closest<HTMLElement>('[data-type="mention"]')?.dataset.id
          if (id) onOpenNote(id)
        }} />
      {editable && grip && <button type="button" className="agarre" tabIndex={-1} style={{ top: grip.top, left: grip.left }}
        title="Arrastra para mover (o Alt+↑ / Alt+↓)" aria-label="Arrastrar para mover" onPointerDown={startDrag}>
        <GripVertical size={16} />
      </button>}
      {dropLine && <div className="linea-soltar" style={dropLine} />}
    </div>
  </>
}

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="emojis" role="group" aria-label="Emojis">
      {EMOJIS.map(e => <button key={e} type="button" onClick={() => onPick(e)}>{e}</button>)}
    </div>
  )
}

export function Cover({ id }: { id: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let live = true
    imageUrl(id).then(u => { if (live) setUrl(u) }, () => {})
    return () => { live = false }
  }, [id])
  return url ? <img className="portada" src={url} alt="" /> : <div className="portada" />
}

function Btn({ label, onClick, active, disabled, children }: {
  label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode
}) {
  // onMouseDown: tocar el botón no le quita el foco al texto (en el celular se perdía la selección).
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
    className={active ? 'activo' : undefined} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>
}

function Toolbar({ editor, uploading, onPhoto, onReminder, onPaste, geminiKey, onGeminiKey, privacy, onPrivate }: {
  editor: TiptapEditor; uploading: boolean; onPhoto: () => void; onReminder: () => void; onPaste: () => void; geminiKey: string; onGeminiKey: (key: string) => void
  privacy: Privacy; onPrivate: () => void
}) {
  const [panel, setPanel] = useState<'emojis' | 'text' | 'highlight' | 'ia' | 'voz' | null>(null)
  const toggle = (p: typeof panel) => setPanel(panel === p ? null : p)
  useBack(!!panel, () => setPanel(null))
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const parent = e.state.selection.$from.parent
      return {
        block: parent.type.name === 'detailsSummary' ? parent.attrs.level : [1, 2, 3].find(level => e.isActive('heading', { level })) ?? 0,
        align: ALIGNS.find(([a]) => e.isActive({ textAlign: a }))?.[0] ?? 'left',
        lineHeight: parent.attrs.lineHeight ?? '',
        font: e.getAttributes('textStyle').fontFamily ?? '',
        size: e.getAttributes('textStyle').fontSize ?? '',
        color: e.getAttributes('textStyle').color ?? '',
        highlight: e.getAttributes('textStyle').backgroundColor ?? '',
        bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
        bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'),
        link: e.isActive('link'), table: e.isActive('table'),
        undo: e.can().undo(), redo: e.can().redo(),
      }
    },
  })
  const c = () => editor.chain().focus()
  const font = appFont(s.font)
  const [bubble, setBubble] = useState<'text' | 'highlight' | null>(null)
  const [touch] = useState(() => matchMedia('(pointer: coarse)').matches)
  // Formatos de letra: sin selección van a la palabra del cursor (como en Word) y el cursor queda donde estaba.
  function mark(apply: (ch: ChainedCommands) => ChainedCommands) {
    const { empty, from, $from } = editor.state.selection
    const word = empty ? wordAt($from) : null
    let ch = editor.chain().focus()
    if (word) ch = ch.setTextSelection(word)
    ch = apply(ch)
    if (word) ch = ch.setTextSelection(from)
    ch.run()
  }

  // Interlineado y sangría van a cada párrafo de la selección, como en Word.
  function setBlocks(attrs: (current: Record<string, unknown>) => Record<string, unknown>) {
    c().command(({ tr }) => {
      tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
        if (BLOCKS.includes(node.type.name)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs(node.attrs) })
      })
      return true
    }).run()
  }

  // En una lista la sangría sube o baja el nivel del renglón; si no se puede (primer renglón) o no es lista, corre el párrafo.
  function indent(delta: 1 | -1) {
    const item = ['taskItem', 'listItem'].find(t => editor.isActive(t))
    if (item && (delta > 0 ? c().sinkListItem(item).run() : c().liftListItem(item).run())) return
    setBlocks(a => ({ indent: Math.min(MAX_INDENT, Math.max(0, Number(a.indent) + delta)) }))
  }

  function link() {
    const href = prompt('Dirección del enlace (vacío para quitarlo)', editor.getAttributes('link').href ?? 'https://')
    if (href === null) return
    if (href.trim()) c().extendMarkRange('link').setLink({ href: href.trim() }).run()
    else c().extendMarkRange('link').unsetLink().run()
  }

  return <>
    <div className="barra" role="toolbar" aria-label="Formato">
      {/* Gemini primero: en el celular la barra se corre de lado y así se ve sin buscarlo. */}
      <Btn label="Gemini: corregir, resumir, sacar tareas o pedir algo" active={panel === 'ia'} onClick={() => toggle('ia')}>
        <Sparkles size={18} className="chispa" />
      </Btn>
      <Btn label="Dictar a Gemini" active={panel === 'voz'} onClick={() => toggle('voz')}><AudioLines size={18} className="chispa" /></Btn>
      <Btn label="Recordatorio en esta línea" onClick={onReminder}><Bell size={18} /></Btn>
      <Btn label="Pegar (lo copiado en Datheke va tal cual)" onClick={onPaste}><ClipboardPaste size={18} /></Btn>
      <select aria-label="Estilo de párrafo" value={s.block} onChange={e => {
        const level = Number(e.target.value) as 0 | 1 | 2 | 3
        const { from, to, $from, $to } = editor.state.selection
        // El título de un desplegable guarda su nivel (0 = Normal); el resto pasa a título o a párrafo.
        let ch = $from.parent.type.name === 'detailsSummary' ? c().updateAttributes('detailsSummary', { level })
          : level ? c().setHeading({ level }) : c().setParagraph()
        // El título trae su tamaño: se quita el tamaño fijo del texto (pegado o elegido), que si no lo tapa.
        if (level) ch = ch.setTextSelection({ from: $from.start(), to: $to.end() }).unsetFontSize().setTextSelection({ from, to })
        ch.run()
      }}>
        <option value={0}>Normal</option>
        <option value={1}>Título 1</option>
        <option value={2}>Título 2</option>
        <option value={3}>Título 3</option>
      </select>
      <select aria-label="Fuente" value={font} onChange={e => { const v = e.target.value; mark(ch => v ? ch.setFontFamily(v) : ch.unsetFontFamily()) }}>
        {FONTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Tamaño de letra" value={s.size} onChange={e => { const v = e.target.value; mark(ch => v ? ch.setFontSize(v) : ch.unsetFontSize()) }}>
        {withCurrent(SIZES, s.size, s.size.replace(/px$/, '')).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="Interlineado" value={s.lineHeight} onChange={e => { const v = e.target.value; setBlocks(() => ({ lineHeight: v || null })) }}>
        {withCurrent(LINE_HEIGHTS, s.lineHeight, s.lineHeight).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {ALIGNS.map(([align, label, Icon]) => (
        <Btn key={align} label={label} active={s.align === align}
          onClick={() => align === 'left' ? c().unsetTextAlign().run() : c().setTextAlign(align).run()}><Icon size={18} /></Btn>
      ))}
      <Btn label="Negrita" active={s.bold} onClick={() => mark(ch => ch.toggleBold())}><Bold size={18} /></Btn>
      <Btn label="Cursiva" active={s.italic} onClick={() => mark(ch => ch.toggleItalic())}><Italic size={18} /></Btn>
      <Btn label="Subrayado" active={s.underline} onClick={() => mark(ch => ch.toggleUnderline())}><Underline size={18} /></Btn>
      <Btn label="Tachado" active={s.strike} onClick={() => mark(ch => ch.toggleStrike())}><Strikethrough size={18} /></Btn>
      <Btn label="Color de letra" active={panel === 'text'} onClick={() => toggle('text')}><Baseline size={18} color={s.color || undefined} /></Btn>
      <Btn label="Resaltar" active={panel === 'highlight'} onClick={() => toggle('highlight')}>
        <Highlighter size={18} style={s.highlight ? { background: s.highlight, borderRadius: 4 } : undefined} />
      </Btn>
      <Btn label="Lista con viñetas" active={s.bullet} onClick={() => c().toggleBulletList().run()}><List size={18} /></Btn>
      <Btn label="Lista numerada" active={s.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={18} /></Btn>
      <Btn label="Disminuir sangría" onClick={() => indent(-1)}><ListIndentDecrease size={18} /></Btn>
      <Btn label="Aumentar sangría" onClick={() => indent(1)}><ListIndentIncrease size={18} /></Btn>
      <Btn label="Casillas" active={s.task} onClick={() => c().toggleTaskList().run()}><ListTodo size={18} /></Btn>
      <Btn label="Foto" disabled={uploading} onClick={onPhoto}><ImagePlus size={18} /></Btn>
      <Btn label="Emoji" active={panel === 'emojis'} onClick={() => toggle('emojis')}><Smile size={18} /></Btn>
      <Btn label="Enlace" active={s.link} onClick={link}><Link size={18} /></Btn>
      {s.table ? <>
        <Btn label="Agregar fila" onClick={() => c().addRowAfter().run()}><BetweenHorizontalEnd size={18} /></Btn>
        <Btn label="Agregar columna" onClick={() => c().addColumnAfter().run()}><BetweenVerticalEnd size={18} /></Btn>
        <Btn label="Borrar fila" onClick={() => c().deleteRow().run()}>−F</Btn>
        <Btn label="Borrar columna" onClick={() => c().deleteColumn().run()}>−C</Btn>
        <Btn label="Borrar tabla" onClick={() => c().deleteTable().run()}><Trash2 size={18} /></Btn>
      </> : <Btn label="Insertar tabla" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table size={18} /></Btn>}
      <Btn label="Quitar formato" onClick={() => c().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={18} /></Btn>
      <Btn label="Deshacer" disabled={!s.undo} onClick={() => c().undo().run()}><Undo2 size={18} /></Btn>
      <Btn label="Rehacer" disabled={!s.redo} onClick={() => c().redo().run()}><Redo2 size={18} /></Btn>
      {uploading && <span className="estado">Subiendo foto…</span>}
    </div>
    {(panel === 'ia' || panel === 'voz') && <GeminiPanel key={panel} editor={editor} mode={panel} geminiKey={geminiKey}
      onKey={onGeminiKey} onClose={() => setPanel(null)} privacy={privacy} onPrivate={onPrivate} />}
    {panel === 'emojis' && <EmojiPicker onPick={e => { c().insertContent(e).run(); setPanel(null) }} />}
    {panel === 'text' && <Palette label="Color de letra" colors={TEXT_COLORS} current={s.color}
      onPick={v => { mark(ch => v ? ch.setColor(v) : ch.unsetColor()); setPanel(null) }} />}
    {panel === 'highlight' && <Palette label="Color de resaltado" colors={HIGHLIGHTS} current={s.highlight}
      onPick={v => { mark(ch => v ? ch.setBackgroundColor(v) : ch.unsetBackgroundColor()); setPanel(null) }} />}
    {/* Barra sobre lo seleccionado, como en Evernote. En el celular va debajo: arriba está el menú de copiar del teléfono. */}
    <BubbleMenu editor={editor} className="burbuja" options={{ placement: touch ? 'bottom' : 'top', offset: 8 }}>
      <div className="burbuja-fila" role="toolbar" aria-label="Formato de lo seleccionado">
        <Btn label="Gemini con lo seleccionado" active={panel === 'ia'} onClick={() => setPanel('ia')}><Sparkles size={16} className="chispa" /></Btn>
        <Btn label="Negrita" active={s.bold} onClick={() => mark(ch => ch.toggleBold())}><Bold size={16} /></Btn>
        <Btn label="Cursiva" active={s.italic} onClick={() => mark(ch => ch.toggleItalic())}><Italic size={16} /></Btn>
        <Btn label="Subrayado" active={s.underline} onClick={() => mark(ch => ch.toggleUnderline())}><Underline size={16} /></Btn>
        <Btn label="Tachado" active={s.strike} onClick={() => mark(ch => ch.toggleStrike())}><Strikethrough size={16} /></Btn>
        <Btn label="Color de letra" active={bubble === 'text'} onClick={() => setBubble(bubble === 'text' ? null : 'text')}>
          <Baseline size={16} color={s.color || undefined} />
        </Btn>
        <Btn label="Resaltar" active={bubble === 'highlight'} onClick={() => setBubble(bubble === 'highlight' ? null : 'highlight')}>
          <Highlighter size={16} style={s.highlight ? { background: s.highlight, borderRadius: 4 } : undefined} />
        </Btn>
        <Btn label="Enlace" active={s.link} onClick={link}><Link size={16} /></Btn>
        <Btn label="Quitar formato" onClick={() => c().unsetAllMarks().run()}><RemoveFormatting size={16} /></Btn>
      </div>
      {bubble === 'text' && <Palette label="Color de letra" colors={TEXT_COLORS} current={s.color}
        onPick={v => { mark(ch => v ? ch.setColor(v) : ch.unsetColor()); setBubble(null) }} />}
      {bubble === 'highlight' && <Palette label="Color de resaltado" colors={HIGHLIGHTS} current={s.highlight}
        onPick={v => { mark(ch => v ? ch.setBackgroundColor(v) : ch.unsetBackgroundColor()); setBubble(null) }} />}
    </BubbleMenu>
  </>
}

function Palette({ label, colors, current, onPick }: { label: string; colors: string[][]; current: string; onPick: (color: string) => void }) {
  return (
    <div className="paleta" role="group" aria-label={label}>
      {colors.map(([value, name]) => (
        <button key={name} type="button" title={name} aria-label={name} aria-pressed={value.toLowerCase() === current.toLowerCase()}
          onMouseDown={e => e.preventDefault()} onClick={() => onPick(value)}>
          {value ? <span style={{ background: value }} /> : name}
        </button>
      ))}
    </div>
  )
}
