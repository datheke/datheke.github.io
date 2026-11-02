// Prueba la app real ya compilada, en Chrome y con tamaño de celular y de PC, con Google Drive simulado: usa notas falsas,
// no toca las notas de nadie y nada sale a internet. No es parte de "npm test" y no agrega dependencias al proyecto.
//
// Cómo correrla (puppeteer-core va en una carpeta aparte y usa el Chrome ya instalado):
//   npm run build
//   npm i puppeteer-core --prefix <carpeta-temporal>   (con la variable PUPPETEER_SKIP_DOWNLOAD=1)
//   node scripts/probar-en-chrome.mjs <carpeta-temporal> <carpeta-para-las-capturas>
// Si otro Chrome de prueba queda abierto tras un fallo, se reconoce por "puppeteer_dev_chrome_profile" en su comando.
import assert from 'node:assert/strict'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const [dep, shots] = process.argv.slice(2)
mkdirSync(shots, { recursive: true })
const puppeteer = createRequire(dep + '/x.js')('puppeteer-core')
const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = createServer((q, r) => {
  let p = join(DIST, decodeURIComponent(q.url.split('?')[0]))
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html')
  r.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' })
  createReadStream(p).pipe(r)
}).listen(0)
const URL_APP = `http://127.0.0.1:${server.address().port}/`

const when = '2026-10-01T10:00:00.000Z'
const nb = (id, name) => ({ id, name, modifiedTime: when, mimeType: 'text/plain', appProperties: { kind: 'notebook' } })
const n = (id, name, notebook, extra = {}) => ({ id, name, modifiedTime: when, mimeType: 'text/html', appProperties: { kind: 'note', notebook, ...extra } })
const LONG = 'Esta nota tiene un título larguísimo que no alcanza a verse completo en la lista de notas de ninguna manera'
const FILES = [nb('nb4', 'Pruebas'), n('f', 'Buscar aquí', 'nb4'), n('g', 'Nota fijada', 'nb4', { locked: 'true' }), n('h', 'Para proteger', 'nb4'), n('t', 'En el basurero', 'nb4', { borrada: new Date().toISOString() }),
  nb('nb1', 'Trabajo'), nb('nb2', 'Casa'), nb('nb3', 'Libreta con un nombre también bastante largo para probar'),
  n('a', 'Reunión del lunes', 'nb1'), n('b', LONG, 'nb1'), n('c', 'Compras', 'nb2'), n('d', 'Banco', 'nb2', { protegida: 'true' }), n('e', 'Con desplegable', 'nb2'),
  { id: 'aj', name: 'Ajustes', modifiedTime: when, mimeType: 'text/plain', appProperties: { kind: 'ajustes', respaldo: new Date().toISOString() } }]
const fill = '<p>relleno</p>'.repeat(50)
const BODY = {
  f: `<p>pan uno</p>${fill}<details class="details"><summary>Ver</summary><div data-type="detailsContent"><p>pan dos</p></div></details>${fill}<p>pan tres</p>`,
  g: '<p>manzana roja</p><details class="details"><summary>Ver</summary><div data-type="detailsContent"><p>manzana verde</p></div></details>',
  h: '<p>clavel rojo y clavel blanco</p>',
  t: '<p>pera una</p><p>pera dos</p>',
  a: '<p>Hablar del presupuesto de marzo.</p>',
  b: '<p>Nada importante aquí.</p>',
  c: `<p>${'relleno '.repeat(80)}</p><p>Comprar <strong>jam</strong>ón serrano y pan.</p>`,
  d: '<p>palabra secreto</p>',
  e: '<details class="details"><summary>Ver más</summary><div data-type="detailsContent"><p>Adentro hay aceitunas.</p></div></details>',
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
const outside = []
const uploads = []
async function route(req) {
  const u = new URL(req.url())
  if (u.origin === new URL(URL_APP).origin) return req.continue()
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS })
  if (req.method() !== 'GET') uploads.push(req.method() + ' ' + u.pathname)
  const json = o => req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(o) })
  if (u.hostname === 'accounts.google.com') return req.respond({ status: 200, contentType: 'text/javascript', body: '' })
  if (u.pathname.endsWith('/about')) return json({ user: { emailAddress: 'prueba@example.com' } })
  if (u.pathname.endsWith('/generateIds')) return json({ ids: Array.from({ length: 20 }, (_, i) => `gen${Date.now()}${i}`) })
  const m = u.pathname.match(/\/files\/([^/]+)$/)
  if (m && u.searchParams.get('alt') === 'media') return req.respond({ status: 200, contentType: 'text/html', headers: CORS, body: BODY[m[1]] ?? '' })
  if (u.pathname.endsWith('/drive/v3/files')) return json({ files: FILES })
  if (u.hostname.endsWith('googleapis.com') && req.method() !== 'GET') {
    const raw = (await req.fetchPostData()) ?? ''
    const start = raw.indexOf('{')
    let meta = {}
    for (let end = raw.indexOf('}', start); start >= 0 && end >= 0; end = raw.indexOf('}', end + 1)) {
      try { meta = JSON.parse(raw.slice(start, end + 1)); break } catch { /* sigue hasta cerrar el JSON */ }
    }
    const id = u.pathname.split('/files/')[1] ?? meta.id ?? 'gen' + Date.now()
    const old = FILES.find(x => x.id === id)
    const saved = { id, name: meta.name ?? old?.name ?? 'x', modifiedTime: new Date().toISOString(), mimeType: 'text/html', appProperties: { ...old?.appProperties, ...meta.appProperties } }
    if (old) Object.assign(old, saved); else FILES.push(saved)
    return json(saved)
  }
  if (u.hostname.endsWith('googleapis.com')) return json({ id: 'x', name: 'x', modifiedTime: new Date().toISOString(), mimeType: 'text/html', appProperties: {} })
  outside.push(u.href)
  return req.respond({ status: 404, headers: CORS, body: '' })
}

const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--disable-gpu', '--disable-extensions'] })
const errors = []
async function newPage(viewport) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setBypassServiceWorker(true)
  await page.setViewport(viewport)
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await page.setRequestInterception(true)
  page.on('request', r => route(r).catch(e => errors.push('route: ' + e.message)))
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('datheke-sesion', JSON.stringify({ email: 'prueba@example.com', token: 'prueba', expires: Date.now() + 3600000 }))
    window.alert = () => {}
    window.confirm = () => true
  })
  await page.goto(URL_APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('.nota').length >= 4, { timeout: 30000 })
  await page.waitForFunction(() => [...document.querySelectorAll('.resumen')].length >= 4, { timeout: 30000 })
  return page
}
const visible = (page, sel) => page.$eval(sel, el => !!el.offsetParent || el.getClientRects().length > 0).catch(() => false)
const text = (page, sel) => page.$eval(sel, el => el.textContent)
const clickText = (page, sel, t) => page.evaluate((s, x) => { const el = [...document.querySelectorAll(s)].find(e => e.textContent.includes(x)); if (!el) throw new Error('no está: ' + x); el.click() }, sel, t)
const tick = ms => new Promise(r => setTimeout(r, ms))
const ok = m => console.log('ok  ', m)

// ========== CELULAR ==========
const ph = await newPage({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
assert.equal(await visible(ph, '.lista'), true); assert.equal(await visible(ph, '.libretas'), false); assert.equal(await visible(ph, '.editor'), false)
assert.equal(await text(ph, '.lista-titulo h2'), 'Todas las notas')
ok('celular: abre directo en Todas las notas')
const twoLines = await ph.evaluate(t => { const s = [...document.querySelectorAll('.nota strong')].find(e => e.textContent === t); return s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight || 17) }, LONG)
assert.ok(await ph.evaluate(t => { const s = [...document.querySelectorAll('.nota strong')].find(e => e.textContent === t); return s.getBoundingClientRect().height > 25 }, LONG), 'título en dos renglones ' + twoLines)
ok('celular: título largo en dos renglones')
await ph.screenshot({ path: shots + '/1-celular-notas.png' })

await ph.click('.lista-titulo .solo-celular'); await tick(100)
assert.equal(await visible(ph, '.libretas'), true); assert.equal(await visible(ph, '.lista'), false); assert.equal(await visible(ph, '.editor'), false)
ok('celular: ← lleva a la pantalla de libretas')
await ph.screenshot({ path: shots + '/2-celular-libretas.png' })
const widest = await ph.evaluate(() => document.documentElement.scrollWidth)
assert.ok(widest <= 390, 'sin desplazarse a los lados: ' + widest)

await clickText(ph, '.libretas .item-nombre', 'Trabajo'); await tick(100)
assert.equal(await visible(ph, '.libretas'), false); assert.equal(await visible(ph, '.lista'), true)
assert.equal(await text(ph, '.lista-titulo h2'), 'Trabajo')
assert.equal((await ph.$$('.tarjetas .nota')).length, 2)
ok('celular: tocar una libreta muestra solo sus notas')
await clickText(ph, '.tarjetas .nota', 'Reunión'); await ph.waitForSelector('.ProseMirror'); await tick(300)
assert.equal(await visible(ph, '.editor'), true); assert.equal(await visible(ph, '.lista'), false); assert.equal(await visible(ph, '.libretas'), false)
await ph.click('.nota-barra .volver'); await tick(100)
assert.equal(await visible(ph, '.lista'), true); assert.equal(await text(ph, '.lista-titulo h2'), 'Trabajo')
ok('celular: nota y volver a sus notas')
await ph.click('.lista-titulo .solo-celular'); await tick(100)
assert.equal(await visible(ph, '.libretas'), true)
assert.equal(await ph.$eval('.item.activo .item-nombre span', e => e.textContent), 'Trabajo')
assert.ok((await ph.$$('.item.activo .btn-icono')).length >= 3, 'renombrar y borrar a la mano')
ok('celular: la libreta sigue marcada, con renombrar y borrar')
await ph.click('.cuenta-boton'); await tick(200)
const card = await ph.$eval('.cuenta-tarjeta', el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight } })
assert.ok(card.l >= 0 && card.r <= card.w && card.t >= 0 && card.b <= card.h, 'menú de cuenta dentro de la pantalla ' + JSON.stringify(card))
await ph.click('.cuenta-boton'); await tick(150)
ok('celular: el menú de la cuenta abre dentro de la pantalla')
await clickText(ph, '.libretas .item', 'Todas las notas'); await tick(100)

// Buscador en celular
await ph.type('.buscador input', 'JAMON'); await tick(300)
assert.equal(await text(ph, '.lista-titulo h2'), 'Resultados')
assert.equal((await ph.$$('.tarjetas .nota')).length, 1)
assert.equal(await ph.$eval('.tarjetas .resumen mark', e => e.textContent), 'jamón')
ok('buscador: encuentra "jamón" escribiendo JAMON, aunque esté con parte en negrita y lejos')
await ph.screenshot({ path: shots + '/3-celular-resultados.png' })
await clickText(ph, '.tarjetas .nota', 'Compras'); await ph.waitForSelector('.ProseMirror .buscado'); await tick(900)
const pos = await ph.$eval('.ProseMirror .buscado', el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight } })
assert.ok(pos.top >= 0 && pos.bottom <= pos.h, 'la palabra debe quedar a la vista: ' + JSON.stringify(pos))
const joined = await ph.$$eval('.ProseMirror .buscado', els => els.map(e => e.textContent).join(''))
assert.equal(joined, 'jamón')
ok('buscador: al abrir salta a la palabra y la resalta')
await ph.screenshot({ path: shots + '/4-celular-palabra.png' })
assert.ok(!/pendiente de subir/i.test(await text(ph, '.estado')), 'buscar no debe crear cambios por subir')
assert.deepEqual(uploads, [], 'ninguna nota debe subirse por abrirla o buscarla')
const saved = await ph.$eval('.ProseMirror', e => e.innerHTML)
assert.ok(saved.includes('buscado'))
ok('buscador: resaltar no cuenta como cambio en la nota')
await ph.click('.nota-barra .volver'); await tick(150)
assert.equal(await text(ph, '.lista-titulo h2'), 'Resultados')
ok('celular: volver regresa a los resultados')
await ph.click('.buscador .btn-icono'); await tick(150)
assert.equal(await text(ph, '.lista-titulo h2'), 'Todas las notas')
ok('buscador: la X vuelve a la lista')

const search = async (page, q) => {
  await page.$eval('.buscador input', el => { el.focus(); el.select() }); await page.keyboard.press('Backspace')
  await page.type('.buscador input', q); await tick(250)
  return page.$$eval('.tarjetas .nota strong', els => els.map(e => e.textContent))
}
assert.deepEqual(await search(ph, 'secreto'), [])
assert.ok((await text(ph, '.tarjetas')).includes('No se encontró'))
ok('nota con clave: su contenido NO se encuentra')
assert.deepEqual(await search(ph, 'banco'), ['Banco'])
assert.ok((await text(ph, '.tarjetas .resumen')).includes('Nota con clave'))
ok('nota con clave: se encuentra por el título y no muestra su texto')
assert.deepEqual(await search(ph, 'marzo reunion'), ['Reunión del lunes'])
ok('buscador: varias palabras, en título y texto')
await search(ph, 'aceitunas')
await clickText(ph, '.tarjetas .nota', 'Con desplegable'); await ph.waitForSelector('.ProseMirror .buscado'); await tick(900)
assert.equal(await ph.$eval('.ProseMirror .buscado', el => el.getClientRects().length > 0), true)
assert.ok(await ph.$eval('.ProseMirror .details', el => el.classList.contains('is-open')))
ok('buscador: si la palabra está en un desplegable cerrado, lo abre')
await ph.click('.nota-barra button[aria-label="Buscar en esta nota"]'); await tick(150)
assert.equal(await ph.$('.buscar-nota'), null, 'la lupa también la cierra')
await ph.click('.nota-barra button[aria-label="Buscar en esta nota"]'); await tick(150)
await ph.type('.buscar-nota input', 'aceitunas'); await tick(500)
const anchoCel = await ph.$eval('.buscar-nota', el => el.getBoundingClientRect().right)
assert.ok(anchoCel <= 390, 'barra de búsqueda dentro de la pantalla: ' + anchoCel)
assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth) <= 390, 'sin desplazarse a los lados')
await ph.screenshot({ path: shots + '/8-celular-buscar-en-nota.png' })
ok('celular: la lupa abre y cierra, y la barra cabe en la pantalla')
await ph.browserContext().close()

// ========== PC ==========
const pc = await newPage({ width: 1280, height: 800 })
const ctrlF = async p => { await p.keyboard.down('Control'); await p.keyboard.press('f'); await p.keyboard.up('Control'); await tick(200) }
await ctrlF(pc)
assert.equal(await pc.$('.buscar-nota'), null)
ok('Ctrl+F sin nota abierta: la app no lo toma')
assert.equal(await visible(pc, '.libretas'), true); assert.equal(await visible(pc, '.lista'), true); assert.equal(await visible(pc, '.lista-titulo .solo-celular'), false)
ok('PC: la barra de libretas sigue igual y no aparece la flecha')
assert.equal(await pc.$eval(`.tarjetas .nota[title="${LONG}"] strong`, e => getComputedStyle(e).whiteSpace), 'nowrap')
ok('PC: la nota larga tiene su etiqueta con el nombre entero y sigue en un renglón')
const nbLong = await pc.$$eval('.item-nombre', els => els.map(e => e.title))
assert.ok(nbLong.some(t => t.includes('nombre también bastante largo')))
ok('PC: las libretas también tienen etiqueta')
await clickText(pc, '.libretas .item-nombre', 'Trabajo'); await tick(100)
assert.equal(await visible(pc, '.libretas'), true); assert.equal((await pc.$$('.tarjetas .nota')).length, 2)
ok('PC: elegir libreta sigue igual')
await clickText(pc, '.libretas .item', 'Todas las notas'); await tick(100)

// ========== BUSCAR DENTRO DE LA NOTA ==========
const lupa = '.nota-barra button[aria-label="Buscar en esta nota"]'
const caja = '.buscar-nota input'
const cuenta = p => text(p, '.buscar-cuenta')
const enCaja = p => p.evaluate(() => document.activeElement?.matches('.buscar-nota input'))
const aLaVista = p => p.$eval('.buscado.actual', el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight })
const irA = async (p, zona, nota) => { await clickText(p, '.libretas button.item, .libretas .item-nombre', zona); await tick(150); await clickText(p, '.tarjetas .nota', nota); await p.waitForSelector('.ProseMirror'); await tick(400) }
uploads.length = 0
await irA(pc, 'Pruebas', 'Buscar aquí')
const antes = await pc.$eval('.ProseMirror', e => e.textContent)
await pc.click(lupa); await tick(100)
assert.equal(await enCaja(pc), true)
await pc.keyboard.type('PAN'); await tick(500)
assert.equal(await cuenta(pc), '1 de 3')
assert.equal((await pc.$$('.ProseMirror .buscado')).length, 3)
ok('en la nota: cuenta las 3 veces, sin importar mayúsculas')
await pc.keyboard.press('Enter'); await tick(800)
assert.equal(await cuenta(pc), '2 de 3')
assert.equal(await pc.$eval('.ProseMirror .details', e => e.classList.contains('is-open')), true)
assert.equal(await aLaVista(pc), true, 'la 2 está en un desplegable cerrado: lo abre y la muestra')
assert.equal(await enCaja(pc), true, 'el cursor sigue en la cajita')
ok('en la nota: Enter va a la siguiente, abre el desplegable que la esconde y el cursor sigue en la cajita')
await pc.screenshot({ path: shots + '/6-pc-buscar-en-nota.png' })
await pc.click('.buscar-nota button[aria-label="Siguiente"]'); await tick(800)
assert.equal(await cuenta(pc), '3 de 3'); assert.equal(await aLaVista(pc), true); assert.equal(await enCaja(pc), true)
await pc.click('.buscar-nota button[aria-label="Siguiente"]'); await tick(800)
assert.equal(await cuenta(pc), '1 de 3', 'después de la última vuelve a la primera')
await pc.click('.buscar-nota button[aria-label="Anterior"]'); await tick(800)
assert.equal(await cuenta(pc), '3 de 3', 'antes de la primera va a la última')
await pc.keyboard.down('Shift'); await pc.keyboard.press('Enter'); await pc.keyboard.up('Shift'); await tick(300)
assert.equal(await cuenta(pc), '2 de 3')
ok('en la nota: siguiente, anterior y Mayús+Enter, dando la vuelta')
await pc.$eval(caja, el => { el.focus(); el.select() }); await pc.keyboard.type('zzz'); await tick(300)
assert.equal(await cuenta(pc), 'Sin resultados')
assert.equal(await pc.$eval('.buscar-nota button[aria-label="Siguiente"]', b => b.disabled), true)
ok('en la nota: sin resultados lo dice y apaga las flechas')
await pc.keyboard.press('Escape'); await tick(150)
assert.equal(await pc.$('.buscar-nota'), null); assert.equal((await pc.$$('.ProseMirror .buscado')).length, 0)
assert.equal(await pc.$eval('.ProseMirror', e => e.textContent), antes)
ok('en la nota: Esc cierra y quita el resaltado; el texto quedó igual')
await ctrlF(pc)
assert.equal(await enCaja(pc), true)
await pc.keyboard.type('pan'); await tick(400)
assert.equal(await cuenta(pc), '1 de 3')
await pc.click('.ProseMirror p'); await tick(150)
assert.equal(await enCaja(pc), false)
await ctrlF(pc)
assert.equal(await enCaja(pc), true, 'desde la nota vuelve a la cajita')
assert.equal(await pc.$eval(caja, i => i.selectionStart === 0 && i.selectionEnd === i.value.length), true, 'con lo escrito seleccionado')
await pc.keyboard.type('tres'); await tick(400)
assert.equal(await cuenta(pc), '1 de 1')
assert.equal(await pc.$eval('.ProseMirror', e => e.textContent), antes, 'lo escrito no cae en la nota')
await pc.keyboard.press('Escape'); await tick(150)
ok('Ctrl+F con nota abierta: abre la búsqueda y, si ya estaba abierta, vuelve a la cajita')
await irA(pc, 'Casa', 'Con desplegable')
const antes2 = await pc.$eval('.ProseMirror', e => e.textContent)
await pc.click(lupa); await tick(100); await pc.keyboard.type('aceitunas'); await tick(500)
assert.equal(await cuenta(pc), '1 de 1'); assert.equal(await enCaja(pc), true)
assert.equal(await pc.$eval('.ProseMirror', e => e.textContent), antes2, 'lo escrito no cae en la nota')
assert.equal(await pc.$eval('.ProseMirror .details', e => e.classList.contains('is-open')), true)
ok('en la nota: escribir con la palabra en un desplegable cerrado no se mete en la nota')
await irA(pc, 'Pruebas', 'Nota fijada')
assert.equal(await pc.$eval('.ProseMirror', e => e.getAttribute('contenteditable')), 'false')
await pc.click(lupa); await tick(100); await pc.keyboard.type('manzana'); await tick(500)
assert.equal(await cuenta(pc), '1 de 2'); await pc.keyboard.press('Enter'); await tick(800)
assert.equal(await cuenta(pc), '2 de 2'); assert.equal(await aLaVista(pc), true)
ok('nota fijada: se puede buscar, y abre el desplegable sin cambiarla')
await irA(pc, 'Basurero', 'En el basurero')
assert.equal(await pc.$('.barra-fija .barra'), null, 'en el basurero no hay barra de formato')
await pc.click(lupa); await tick(100); await pc.keyboard.type('pera'); await tick(500)
assert.equal(await cuenta(pc), '1 de 2'); await pc.keyboard.press('Enter'); await tick(500)
assert.equal(await cuenta(pc), '2 de 2')
ok('basurero: se puede buscar dentro de la nota')
await pc.screenshot({ path: shots + '/7-pc-basurero.png' })
await tick(4000)
assert.deepEqual(uploads, [], 'buscar nunca debe subir ni cambiar una nota')
assert.ok(!/pendiente de subir/i.test(await text(pc, '.estado')))
ok('buscar en la nota: nada se subió ni quedó pendiente (nota normal, fijada, basurero y desplegables)')
// Solo tocar una nota fijada que termina en un bloque no debe cambiarla.
await irA(pc, 'Pruebas', 'Nota fijada')
await pc.click('.ProseMirror p'); await tick(4000)
assert.deepEqual(uploads, [], 'tocar una nota fijada no debe subirla')
ok('nota fijada: tocarla no la cambia')
uploads.length = 0
await clickText(pc, '.libretas .item', 'Todas las notas'); await tick(150)
await search(pc, 'lunes'); await clickText(pc, '.tarjetas .nota', 'Reunión'); await pc.waitForSelector('.ProseMirror'); await tick(300)
assert.equal(await pc.$('.buscar-nota'), null)
ok('buscador general: si la palabra está solo en el título, la nota abre normal')
await search(pc, 'presupuesto'); await clickText(pc, '.tarjetas .nota', 'Reunión'); await pc.waitForSelector('.buscar-nota'); await tick(500)
assert.equal(await pc.$eval(caja, i => i.value), 'presupuesto'); assert.equal(await cuenta(pc), '1 de 1')
ok('buscador general: si está en el texto, la nota abre con la búsqueda y sus flechas')
await pc.click('.buscador .btn-icono'); await tick(150)
await clickText(pc, '.tarjetas .nota', 'Banco'); await tick(500)
assert.equal(await pc.$(lupa), null)
ok('nota con clave cerrada: no se puede buscar (primero hay que entrar)')
await clickText(pc, '.tarjetas .nota', 'Para proteger'); await pc.waitForSelector('.ProseMirror'); await tick(400)
await pc.evaluate(() => [...document.querySelectorAll('.nota-barra button')].pop().click()); await tick(200)
await clickText(pc, 'button', 'Proteger con clave'); await pc.waitForSelector('.caja input[type="password"]')
const claves = await pc.$$('.caja input[type="password"]')
await claves[0].type('clave-de-prueba-123'); await claves[1].type('clave-de-prueba-123')
await clickText(pc, '.caja button', 'Guardar clave'); await tick(2500)
await pc.waitForSelector(lupa, { timeout: 8000 })
assert.ok(await pc.$('.nota-barra .privada-icono'), 'la nota quedó con clave')
await pc.click(lupa); await tick(100); await pc.keyboard.type('clavel'); await tick(500)
assert.equal(await cuenta(pc), '1 de 2'); await pc.keyboard.press('Enter'); await tick(300)
assert.equal(await cuenta(pc), '2 de 2')
ok('nota con clave abierta: se puede buscar dentro')
await pc.keyboard.press('Escape')
assert.deepEqual(await search(pc, 'blanco'), [])
ok('nota con clave abierta: el buscador general sigue sin encontrar su texto')
uploads.length = 0
await pc.click('.buscador .btn-icono'); await tick(150)

// El menú / en la app real
await clickText(pc, '.libretas .item', 'Todas las notas'); await tick(150)
await clickText(pc, '.tarjetas .nota', 'Reunión'); await pc.waitForSelector('.ProseMirror'); await tick(400)
await pc.click('.ProseMirror'); await pc.keyboard.press('End')
await pc.keyboard.press('Enter')
await pc.keyboard.type('hola...../sep'); await tick(300)
assert.equal(await visible(pc, '.menu'), true, 'menú abierto tras los puntos')
ok('menú /: abre pegado a los puntos')
await pc.screenshot({ path: shots + '/5-pc-menu.png' })
await pc.keyboard.press('Enter'); await tick(200)
const html1 = await pc.$eval('.ProseMirror', e => e.innerHTML)
assert.match(html1, /<p[^>]*>hola\.\.\.\.\.<\/p><hr/)
ok('menú /: "hola....." se queda y el separador va abajo')
await pc.keyboard.type('y/o y 12/05'); await tick(200)
assert.equal(await pc.$('.menu'), null, 'no debe abrir con y/o ni fechas')
ok('menú /: no molesta con y/o ni con fechas')
await pc.keyboard.press('Enter'); await pc.keyboard.type('texto /desp'); await tick(250)
await pc.keyboard.press('Enter'); await tick(250)
const html2 = await pc.$eval('.ProseMirror', e => e.innerHTML)
assert.match(html2, /<p[^>]*>texto <\/p><div[^>]*details/)
ok('menú /: "texto" se queda y el desplegable va abajo')
await tick(4000)
assert.ok(uploads.some(u => u.endsWith('/files/a')), 'lo escrito se debe subir: ' + JSON.stringify(uploads))
ok('lo que sí se escribe en una nota se sigue guardando y subiendo')
uploads.length = 0
await irA(pc, 'Casa', 'Con desplegable')
await pc.click('.ProseMirror summary, .ProseMirror [data-type="detailsSummary"]'); await pc.keyboard.press('End'); await pc.keyboard.type('X'); await tick(4000)
assert.ok(uploads.some(u => u.endsWith('/files/e')), 'también en una nota que termina en un bloque: ' + JSON.stringify(uploads))
ok('también en una nota que termina en un desplegable')
assert.deepEqual(errors, [], 'errores en la consola')
assert.deepEqual(outside.filter(u => !u.includes('kaspersky-labs.com')), [], 'nada debe salir a otros sitios') // ese lo inyecta el antivirus, no la app
ok('sin errores en la consola')
await browser.close(); server.close()
console.log('\nTODO OK')
process.exit(0)
