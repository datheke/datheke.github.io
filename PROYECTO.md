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

## Doble nube con desborde (descartado por David, noviembre de 2026)
- Conectar Drive y Dropbox una sola vez.
- El usuario elige cuál se llena primero (recomendado: Drive → Dropbox).
- Al llegar ~95% avisar y guardar lo nuevo en la segunda.
- Vista unificada: el usuario no distingue en qué nube está cada nota.
- Botón para mover notas entre nubes.

## Versiones y basurero
- Notas activas = siempre la última versión (se pisa la anterior).
- Decidido por David (noviembre de 2026): una sola versión anterior por nota, para recuperar lo que se borre sin querer. Es cómo estaba la nota antes de la última vez que se empezó a cambiar; se reemplaza en la siguiente edición (otro día o tras 10 minutos sin tocarla). En el menú de la nota: "Ver versión anterior" y "Restaurar" (restaurar deja lo de ahora como versión anterior: se puede deshacer). Fijar no crea versiones. Cómo se hizo: los 10 minutos se cuentan desde el último guardado en Drive (igual en todos los aparatos); la versión es un archivo "version" en la carpeta oculta, con la misma clave que su nota, que no se lista ni va al respaldo y se borra con la nota; "Solo ver" no guarda versión. Las fotos no se guardan por la versión anterior (decisión de David): pasado un día, restaurarla recupera solo el texto, quita de la copia las fotos que ya se borraron y avisa "Las fotos de esta versión ya se borraron; se recuperó solo el texto".
- Fotos sin uso (hecho, noviembre de 2026): la foto que ya no usa ninguna nota (contando portadas, basurero, plantillas y conflictos) se marca y al día siguiente se borra de Drive y del aparato (decisión de David: un día, no 30). Si vuelve a usarse ese día, se desmarca. Deshacer funciona solo mientras la nota sigue abierta; si trae de vuelta una foto que ya se borró, en su lugar sale el aviso de que solo se recupera el texto. Las fotos de una nota que sale del basurero para siempre se van con ella (ya esperaron ahí), salvo las que usa otra nota. De una nota con clave cerrada usa los números de foto que el aparato anotó al guardarla (sin nada del texto); si de alguna nota no sabe qué fotos tiene o su copia está atrasada, no decide nada. En las notas compartidas las fotos van dentro de la nota, así que no dejan archivos sueltos.
- Borrado automático del basurero a los 30 días.
- Las fotos no se duplican entre versiones.

## Protección contra borrado
- Decidido por David (noviembre de 2026): solo las notas con clave piden clave. Una nota con clave no se puede borrar hasta quitarle la clave, y quitarla pide la clave o la huella. Las demás notas y el basurero solo piden confirmar. Una libreta con notas no se deja borrar; vacía, solo pide confirmar.
- Si una nota desaparece de la nube sin pasar por la clave, la app la restaura desde la copia local.
- PIN para abrir la app: descartado por David (noviembre de 2026).
- (No es posible poner clave dentro de Drive/Dropbox; se compensa con la carpeta oculta.)

## Respaldo visible
- Carpeta visible "Datheke – importante, no borrar" → "Respaldos", con el archivo "Datheke – respaldo.zip" (todas las notas y fotos).
- Se genera **una vez por semana solo si hubo cambios**.
- Se guardan **2 respaldos** (el actual y el anterior); el más viejo se pisa. Decidido por David (noviembre de 2026): si el actual es de hace menos de un día ("Hacer ahora" seguido), solo se reemplaza el actual y el anterior no se pierde.

## Carpetas visibles en "Mi unidad" (decidido por David, noviembre de 2026)
- Todo lo visible de Datheke va en una sola carpeta "Datheke – importante, no borrar": "Respaldos", "Notas compartidas" y "LÉEME – no borrar.txt" (dice dónde están las notas y qué no tocar). Las notas siguen en la carpeta escondida de Google (no se puede mostrar ni mover, y es su protección).
- En cada cuenta (David y su familia) las carpetas de antes ("Datheke" y "Datheke – notas compartidas") se mueven ahí solas al abrir Datheke, con lo que tengan adentro. Nada se borra.
- Las notas compartidas no pueden ir en la carpeta escondida (Google no deja compartir desde ahí) y los respaldos van visibles a propósito (se abren sin Datheke y no se borran junto con las notas).
- La llave de Android ("Datheke-llave-android") es solo de David, no la creó Datheke y no va dentro de esa carpeta: si se borrara esa carpeta, se iría la llave.
- Si se borra (o va a la papelera) el archivo de una nota compartida, el Datheke del dueño lo nota, avisa y ofrece "Volver a compartir" (archivo nuevo, se invita otra vez a cada uno con su permiso).

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
- "Puede editar" o "Solo ver" (decidido por David, noviembre de 2026): se elige al compartir y se cambia después en "La tienen"; la X sigue quitando a la persona. "Solo ver" es el permiso "comentarista" de Google: Google no deja cambiar la nota y la persona sí puede dejar el aviso de que se salió. Quien solo ve: la nota se abre como fijada y sin "Editar", no marca casillas, no pone clave y no le suenan sus recordatorios; si la pasan a "Solo ver" con cambios sin subir, quedan en una nota suya "(tu versión)". Al salirse, si Google no le deja quitarse el permiso, su Datheke deja el aviso "Datheke: salí de esta nota." y el Datheke del dueño le quita el permiso y lo saca de la lista (solo cuenta el aviso de la propia persona, de después de su última invitación).

## Etapas
1. Base: login Google, libretas, lista de notas, sincronización con Drive (web).
2. Editor tipo Word: formatos, colores, listas, casillas, tablas, emojis, fotos dentro de la nota, menú "/", ícono y portada, plantillas, notas dentro de notas, desplegables, recuadros y enlaces con `@`.
3. Modo sin internet: copia local + indicador de pendientes + manejo de conflictos.
4. Apps instalables: Windows, Mac y Android con carpeta real (Tauri + GitHub Actions).
5. Extras: dibujos a mano, íconos, diseño estilo Evernote pulido, botón "Enviar a IA" y Gemini opcional.
6. Doble nube con desborde (Dropbox), versiones/basurero de 30 días, protección con clave, respaldos semanales.
7. Kanban, calendario y tablas inteligentes.
8. Notas compartidas con otros Gmail (ver y editar).

## Estado (6 de noviembre de 2026, versión 0.18.2)
Revisado contra el menú `/`, los botones de la app, todo el historial de versiones y palabras parecidas; no probando cada función en un aparato.

| Etapa | Ya está | Falta (David dijo que sí) | Por decidir |
|---|---|---|---|
| 1 a 3 | Todo | Nada | Nada |
| 4 | Windows y Android. Carpeta visible en Android: se escribía en la carpeta privada de la app (escondida); va a Documents/Datheke. Android sí deja crear la carpeta; la 0.17.9 mostró que Tauri bloqueaba el archivo de control `.datheke.json` (nombre con punto) y la 0.17.10 le da permiso. Falta confirmar en el celular que se copien notas y fotos (si algo más falla, Ajustes → Apps y versión muestra el error) | Mac | Nada |
| 5 | Íconos y Gemini. Diseño nuevo, parte 1 (0.18.0): estilo B, barra lateral con «Más» (Plantillas, Compartido conmigo, Basurero) y ventana de Ajustes con buscador. 0.18.1 (falta probarla en el celular): en el celular el menú es un panel lateral (se cierra con regresar, tocando afuera o deslizando a la izquierda) y la rueda abre Ajustes en la lista de secciones | Diseño nuevo, parte 2 (0.18.3): barra de edición con «Insertar ▾» y «Más ▾», e Ícono y portada también en ⋯. Dibujos a mano y "Enviar a IA" (en Ajustes, junto a Gemini) | Nada |
| 6 | Basurero de 30 días, clave de notas con huella, respaldo semanal, protección al borrar (ver "Protección contra borrado") limpieza de fotos sin uso (0.17.8; falta probarla en el celular) y versión anterior por nota (0.17.13; falta probarla) | Nada | Rescatar una nota que desaparece de la nube (hoy solo si tenía cambios sin subir) |
| 7 | Nada | Calendario dentro de la app, Kanban y tablas con filtros y orden, unidos a los recordatorios | Nada |
| 8 | Notas compartidas por correo, clave común, y elegir "Puede editar" o "Solo ver" con cambio y aviso de salida (0.18.2: también avisa cuando sale alguien con «Puede editar», que antes no se detectaba, y la nota lo dice en rojo hasta tocar «Entendido»; falta probarlo con dos cuentas de Google) | Combinar los cambios cuando dos personas editan la misma nota a la vez | Nada |
| Ideas nuevas | — | Dispositivos, con un apartado para celular perdido o robado. Importar notas de Evernote. Preferencias: libreta para notas nuevas, letra por defecto y modo oscuro | Etiquetas (recomendado: no por ahora) |

Descartado por David (noviembre de 2026): Dropbox con doble nube y PIN para abrir la app.

Orden aprobado: fotos → carpeta de Android → "solo ver"/"puede editar" → versión anterior → diseño nuevo → lo demás. Cada cosa en su propia versión, probada en el celular.

## Diseño nuevo (aprobado por David el 5 de noviembre de 2026)
- Barra lateral con menú "Más": Basurero, Calendario, Plantillas, Libretas, Recordatorios y Compartido conmigo. Sin Archivos ni Espacios.
- Ventana de Ajustes con buscador y estas secciones: Inicio de sesión y seguridad, Dispositivos, IA y aplicaciones conectadas, Recordatorios, Importar, Respaldo, Apps y versión, Preferencias. Sin Adjuntos.
- Barra de edición: a la vista lo de siempre; "Insertar ▾" y "Más ▾" con su nombre escrito y un buscador adentro.
- Ícono y portada: arriba del título, como hoy, y también en el menú ⋯ de la nota (aprobado con `DISENO.md`).
- Estilo elegido: B, verde y redondeado (como Evernote, lo más parecido a lo de antes). Dónde queda cada cosa: `DISENO.md`.
- Antes de cambiar nada: inventario de todo lo que la app tiene hoy (cada botón, menú, opción del `/` y ajuste) con el lugar donde queda en el diseño nuevo. No se publica si algo del inventario no tiene lugar.
