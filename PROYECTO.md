# Datheke — Especificación del proyecto

App personal de notas estilo Evernote, **costo cero**, con almacenamiento en la nube del propio usuario (Google Drive y/o Dropbox).

## Objetivos
- Costo cero (sin servidores pagados, sin Supabase ni bases de datos que se pausen).
- Diseño propio, inspirado en Evernote (sin copiar logo ni marca).
- Límite de almacenamiento = la nube del usuario (Drive 15 GB, Dropbox 2 GB).
- Login con cuenta de Google; la sesión queda abierta. Sin configuración por dispositivo.
- Multiusuario simple: cada persona entra con su cuenta y sus notas van a SU propia nube (ej. el cuñado con sus 15 GB).

## Plataformas
| Plataforma | Formato | Copia local |
|---|---|---|
| Windows | App instalable (Tauri) | Carpeta real en disco (ej. Documentos/Datheke) |
| Mac | App instalable (Tauri, .dmg sin firmar) | Carpeta real en disco |
| Android | APK instalable (Tauri, sin Play Store) | Carpeta real en el teléfono |
| iPhone | Versión web (PWA) en GitHub Pages, agregada a pantalla de inicio | Almacenamiento del navegador + subida inmediata |

Un solo código para todas. Instaladores generados gratis con GitHub Actions (incluido el .dmg de Mac).

## Stack
- Frontend: React + TypeScript + Vite
- Editor: TipTap (fuentes, tamaños, colores, negrita, listas, casillas, tablas, emojis, fotos)
- Íconos: Lucide
- Dibujo a mano: lienzo (canvas)
- Apps instalables: Tauri 2
- Hosting web: GitHub Pages (repositorio público; las notas NUNCA van al repositorio)
- Google: proyecto gratuito en Google Cloud, OAuth con permiso mínimo (drive.appdata / drive.file), app publicada en "producción" para evitar que el acceso caduque cada 7 días.

## Sincronización
- Cada cambio se guarda primero localmente y luego se sube a la nube (unos segundos después).
- Siempre se sobrescribe el mismo archivo de cada nota (ID fijo): nunca duplicados.
- Sin internet: se edita la copia local; al volver la conexión se sube sola. Los demás dispositivos ven la versión anterior hasta entonces.
- Indicador visible de "N cambios pendientes de subir".
- Conflicto (misma nota editada en dos dispositivos sin internet): avisar y dejar elegir cuál conservar.

## Almacenamiento en la nube
- Datos principales en la **carpeta oculta de la app** en Drive (appDataFolder): no visible ni borrable desde drive.google.com.
- Cada nota y cada foto como archivo separado (solo se sube lo que cambió).
- Notas en formato abierto (HTML/JSON); fotos como imágenes normales comprimidas (~150–350 KB).
- Capa de almacenamiento intercambiable (adaptadores): Google Drive, Dropbox.

## Doble nube con desborde
- Conectar Drive y Dropbox una sola vez.
- El usuario elige cuál se llena primero (recomendado: Drive → Dropbox).
- Al llegar ~95% avisar y guardar lo nuevo en la segunda.
- Vista unificada: el usuario no distingue en qué nube está cada nota.
- Botón para mover notas entre nubes.

## Versiones y basurero
- Notas activas = siempre la última versión (se pisa la anterior).
- Se guarda versión al cerrar la nota o tras unos minutos sin editar (no por cada tecla).
- Versiones anteriores van al basurero con nombre: "Nota X – modificada el DD/MM/AAAA, HH:MM".
- Borrado automático del basurero a los 30 días.
- Las fotos no se duplican entre versiones.

## Protección contra borrado
- Borrar notas/libretas o vaciar el basurero exige clave/PIN.
- Si una nota desaparece de la nube sin pasar por la clave, la app la restaura desde la copia local.
- PIN opcional para abrir la app en el celular.
- (No es posible poner clave dentro de Drive/Dropbox; se compensa con la carpeta oculta.)

## Respaldo visible
- Carpeta visible "Datheke" con el archivo "Datheke – respaldo.zip" (todas las notas y fotos).
- Se genera **una vez por semana solo si hubo cambios**.
- Se guardan **2 respaldos** (el actual y el anterior); el más viejo se pisa.

## Funciones inspiradas en AppFlowy (solo ideas, no su código — AppFlowy es AGPLv3)
- **Menú "/":** al escribir `/` se elige qué insertar (tabla, foto, lista, casilla, dibujo, recuadro, etc.).
- **Ícono y portada por nota:** emoji/ícono propio y una imagen de portada arriba.
- **Plantillas:** "Lista de compras", "Reunión", etc., y plantillas creadas por el usuario.
- **Notas dentro de notas:** páginas anidadas.
- **Bloques desplegables y recuadros de aviso** (callouts).
- **Enlaces entre notas** con `@`.
- **Tablero Kanban:** columnas tipo Pendiente / En proceso / Hecho.
- **Vista de calendario:** notas y tareas por fecha.
- **Tablas inteligentes:** tabla sencilla con filtros y orden dentro de una nota.

## IA (costo cero)
- **"Enviar a IA" (principal):** copia la nota y abre Claude o ChatGPT, usando la suscripción propia de cada usuario.
- **Gemini gratis (opcional, apagado por defecto):** resumir, corregir, traducir. Advertir que en el plan gratuito Google puede usar el contenido; no usar con notas privadas. Verificar condiciones del nivel gratuito al implementarlo.

## Notas compartidas
- Botón "Compartir": escribir el Gmail de otra persona y elegir "puede editar" o "solo ver" (permisos de Drive).
- El invitado abre la nota en esta misma app con su propia cuenta de Google; la primera vez la acepta con un toque (Google Picker, por el permiso drive.file).
- Las notas compartidas viven en una carpeta **visible** de Drive (la carpeta oculta no se puede compartir).
- Edición conjunta: los cambios se **combinan** (CRDT, ej. Yjs) en lugar de pisarse; se actualizan cada pocos segundos (no es tiempo real exacto, no hay servidor).
- Protección: historial de versiones para recuperar lo que otro borre o cambie.
- El espacio lo ocupa la cuenta del dueño de la nota, incluidas fotos añadidas por otros.

## Etapas
1. Base: login Google, libretas, lista de notas, sincronización con Drive (web).
2. Editor tipo Word: formatos, colores, listas, casillas, tablas, emojis, fotos dentro de la nota, menú "/", ícono y portada, plantillas, notas dentro de notas, desplegables, recuadros y enlaces con `@`.
3. Modo sin internet: copia local + indicador de pendientes + manejo de conflictos.
4. Apps instalables: Windows, Mac y Android con carpeta real (Tauri + GitHub Actions).
5. Extras: dibujos a mano, íconos, diseño estilo Evernote pulido, botón "Enviar a IA" y Gemini opcional.
6. Doble nube con desborde (Dropbox), versiones/basurero de 30 días, protección con clave, respaldos semanales.
7. Kanban, calendario y tablas inteligentes.
8. Notas compartidas con otros Gmail (ver y editar).
