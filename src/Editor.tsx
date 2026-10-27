import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Mention from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { PluginKey } from '@tiptap/pm/state'
import { EditorContent, Extension, mergeAttributes, Node, ReactRenderer, useEditor, useEditorState, type ChainedCommands, type Editor as TiptapEditor, type Range } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import StarterKit from '@tiptap/starter-kit'
import {
  Baseline, BetweenHorizontalEnd, BetweenVerticalEnd, Bold, Highlighter, ImagePlus, Italic, Link, List, ListOrdered, ListTodo,
  Redo2, RemoveFormatting, Smile, Strikethrough, Table, Trash2, Underline, Undo2,
} from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { imageUrl, pickImage, uploadImage } from './images.ts'
import { wordAt } from './word.ts'

// Fuentes incluidas en la app (main.tsx): se ven igual en PC, celular y web, también sin internet.
const FONTS = [['', 'Fuente'], ['"Lora Variable", serif', 'Serif'], ['"JetBrains Mono Variable", monospace', 'Monoespaciada'], ['"Caveat Variable", cursive', 'Manuscrita']]
const SIZES = [['', 'Tamaño'], ['12px', '12'], ['14px', '14'], ['18px', '18'], ['24px', '24'], ['32px', '32']]
const EMOJIS = '😀 😂 😍 🥰 😎 🤔 😢 😡 👍 👎 👏 🙏 💪 🎉 ❤️ ⭐ 🔥 ✅ ❌ ⚠️ 💡 📌 📎 📝 📅 ⏰ 🛒 🏠 💼 💰 📚 🎓 ✈️ 🚗 🍎 🍕 ☕ 🎵 🐶 🌱'.split(' ')

type Command = { label: string; run: (editor: TiptapEditor, range: Range) => void }
type Handle = { onKeyDown: (e: KeyboardEvent) => boolean }

// Para buscar sin importar tildes ni mayúsculas.
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

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

// Menú "/": al escribir "/" se elige qué insertar.
const Slash = Extension.create<{ items: Command[] }>({
  name: 'slash',
  addOptions: () => ({ items: [] }),
  addProseMirrorPlugins() {
    return [Suggestion<Command, Command>({
      editor: this.editor,
      pluginKey: new PluginKey('slash'),
      char: '/',
      items: ({ query }) => this.options.items.filter(i => fold(i.label).includes(fold(query))),
      command: ({ editor, range, props }) => props.run(editor, range),
      render: popup,
    })]
  },
})

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

type Props = {
  content: string
  onChange: (html: string) => void
  notes: { id: string; label: string }[]
  onOpenNote: (id: string) => void
  onError: (e: unknown) => void
}

// El contenido solo se usa al crear el editor; App lo vuelve a montar (key) al cambiar de nota.
export default function Editor({ content, onChange, notes, onOpenNote, onError }: Props) {
  // TipTap guarda la configuración al crearse: las funciones que cambian se leen desde refs.
  const latest = useRef({ onChange, notes, onError })
  useEffect(() => { latest.current = { onChange, notes, onError } })
  const [uploading, setUploading] = useState(0)

  async function addImages(editor: TiptapEditor, files: File[]) {
    for (const file of files) {
      setUploading(n => n + 1)
      try {
        const src = `drive:${await uploadImage(file)}`
        if (!editor.isDestroyed) editor.chain().focus().setImage({ src }).run()
      } catch (e) { latest.current.onError(e) } finally { setUploading(n => n - 1) }
    }
  }
  const addPhoto = async (editor: TiptapEditor) => {
    const file = await pickImage()
    if (file) addImages(editor, [file])
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
    { label: 'Separador', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
    { label: 'Enlace a otra nota (@)', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('@').run() },
  ]

  const editor = useEditor({
    extensions: [
      StarterKit, TextStyleKit, TaskList, TaskItem.configure({ nested: true }), TableKit, DriveImage, Callout,
      Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }), DetailsSummary, DetailsContent,
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
        },
      }),
    ],
    content,
    onUpdate: ({ editor }) => latest.current.onChange(editor.getHTML()),
  })

  // Pegar una captura o soltar fotos las sube a Drive. Si lo pegado trae texto (Word, web), se deja a TipTap.
  function onFiles(e: { preventDefault(): void; stopPropagation(): void }, data: DataTransfer | null) {
    const images = [...(data?.files ?? [])].filter(f => f.type.startsWith('image/'))
    if (!images.length || data?.types.includes('text/html')) return
    e.preventDefault()
    e.stopPropagation()
    addImages(editor, images)
  }

  return <>
    <Toolbar editor={editor} uploading={uploading > 0} onPhoto={() => addPhoto(editor)} />
    <EditorContent editor={editor} className="contenido"
      onPasteCapture={e => onFiles(e, e.clipboardData)} onDropCapture={e => onFiles(e, e.dataTransfer)}
      onClick={e => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-type="mention"]')?.dataset.id
        if (id) onOpenNote(id)
      }} />
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

function Toolbar({ editor, uploading, onPhoto }: { editor: TiptapEditor; uploading: boolean; onPhoto: () => void }) {
  const [emojis, setEmojis] = useState(false)
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: [1, 2, 3].find(level => e.isActive('heading', { level })) ?? 0,
      font: e.getAttributes('textStyle').fontFamily ?? '',
      size: e.getAttributes('textStyle').fontSize ?? '',
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'),
      link: e.isActive('link'), table: e.isActive('table'),
      undo: e.can().undo(), redo: e.can().redo(),
    }),
  })
  const c = () => editor.chain().focus()
  // Formatos de letra: sin selección van a la palabra del cursor (como en Word) y el cursor queda donde estaba.
  // focus = false en los colores: mover el foco cerraría el selector de color mientras se elige.
  function mark(apply: (ch: ChainedCommands) => ChainedCommands, focus = true) {
    const { empty, from, $from } = editor.state.selection
    const word = empty ? wordAt($from) : null
    let ch = focus ? editor.chain().focus() : editor.chain()
    if (word) ch = ch.setTextSelection(word)
    ch = apply(ch)
    if (word) ch = ch.setTextSelection(from)
    ch.run()
  }

  function link() {
    const href = prompt('Dirección del enlace (vacío para quitarlo)', editor.getAttributes('link').href ?? 'https://')
    if (href === null) return
    if (href.trim()) c().extendMarkRange('link').setLink({ href: href.trim() }).run()
    else c().extendMarkRange('link').unsetLink().run()
  }

  return <>
    <div className="barra" role="toolbar" aria-label="Formato">
      <select aria-label="Estilo de párrafo" value={s.block} onChange={e => {
        const level = Number(e.target.value) as 0 | 1 | 2 | 3
        if (level) c().setHeading({ level }).run()
        else c().setParagraph().run()
      }}>
        <option value={0}>Normal</option>
        <option value={1}>Título 1</option>
        <option value={2}>Título 2</option>
        <option value={3}>Título 3</option>
      </select>
      <select aria-label="Fuente" value={s.font} onChange={e => { const v = e.target.value; mark(ch => v ? ch.setFontFamily(v) : ch.unsetFontFamily()) }}>
        {FONTS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
      </select>
      <select aria-label="Tamaño de letra" value={s.size} onChange={e => { const v = e.target.value; mark(ch => v ? ch.setFontSize(v) : ch.unsetFontSize()) }}>
        {SIZES.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
      </select>
      <Btn label="Negrita" active={s.bold} onClick={() => mark(ch => ch.toggleBold())}><Bold size={18} /></Btn>
      <Btn label="Cursiva" active={s.italic} onClick={() => mark(ch => ch.toggleItalic())}><Italic size={18} /></Btn>
      <Btn label="Subrayado" active={s.underline} onClick={() => mark(ch => ch.toggleUnderline())}><Underline size={18} /></Btn>
      <Btn label="Tachado" active={s.strike} onClick={() => mark(ch => ch.toggleStrike())}><Strikethrough size={18} /></Btn>
      <label className="color" title="Color de letra">
        <Baseline size={18} /><input type="color" aria-label="Color de letra" onChange={e => { const v = e.target.value; mark(ch => ch.setColor(v), false) }} />
      </label>
      <label className="color" title="Resaltar">
        <Highlighter size={18} /><input type="color" aria-label="Color de resaltado" defaultValue="#fff59d" onChange={e => { const v = e.target.value; mark(ch => ch.setBackgroundColor(v), false) }} />
      </label>
      <Btn label="Lista con viñetas" active={s.bullet} onClick={() => c().toggleBulletList().run()}><List size={18} /></Btn>
      <Btn label="Lista numerada" active={s.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={18} /></Btn>
      <Btn label="Casillas" active={s.task} onClick={() => c().toggleTaskList().run()}><ListTodo size={18} /></Btn>
      <Btn label="Foto" disabled={uploading} onClick={onPhoto}><ImagePlus size={18} /></Btn>
      <Btn label="Emoji" active={emojis} onClick={() => setEmojis(!emojis)}><Smile size={18} /></Btn>
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
    {emojis && <EmojiPicker onPick={e => { c().insertContent(e).run(); setEmojis(false) }} />}
  </>
}
