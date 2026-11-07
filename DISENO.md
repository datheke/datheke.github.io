# Diseño nuevo (propuesta para el OK de David)

Regla: nada de lo que la app tiene hoy puede quedar fuera. `scripts/inventario.txt` tiene las 250 cosas que se ven hoy
(botones, menús, opciones del `/`, textos de ventanas). Al terminar, `node scripts/inventario.mjs --comparar` tiene que
decir "Nada falta"; si algo falta, no se publica.

Lo que NO cambia: el menú `/`, la barra que sale al seleccionar texto, y las ventanas de clave, compartir, recordatorio,
Gemini, nota recibida y conflicto (quedan igual, se abren desde donde diga abajo).

## 1. Barra lateral (izquierda)
| Hoy | Queda |
|---|---|
| Tarjeta de la cuenta (avatar) con todo adentro | Avatar: correo, versión, **Ajustes**, **Salir** (lo demás pasa a Ajustes) |
| + Nota, Todas las notas, Recordatorios | Igual |
| Libretas (+, privada, renombrar, borrar, arrastrar) | Igual, a la vista, menos «Plantillas», que queda solo en **Más ▾** (decidido por David) |
| Basurero | Dentro de **Más ▾** |
| (no existe) | **Más ▾**: Plantillas, Compartidas (las que compartí y las que me compartieron, con «Agregar una que me compartieron»), Importar (archivo .datheke; Evernote en la 0.18.4), Basurero (Calendario cuando exista) |
| Respaldo en Drive: fecha · Hacer ahora / Dar permiso | Ajustes → Respaldo (y la fecha también en Más ▾) |
| Celular: pantalla completa de libretas | Panel lateral que deja ver la lista; se cierra con regresar, tocando afuera o deslizando a la izquierda (decidido por David) |
| Rueda de Ajustes | Abre Ajustes en la lista de secciones (en el celular), no en una sección |

## 2. Ventana de Ajustes (nueva, con buscador)
| Sección | Qué tiene (todo ya existe hoy) | Hoy está en |
|---|---|---|
| Inicio de sesión y seguridad | Sesión iniciada como, Salir, clave de notas (cambiar, "¿Olvidaste la clave?") | Tarjeta de la cuenta y menú ⋯ de la nota |
| IA y aplicaciones conectadas | Vincular / Desvincular Gemini | Ventana de Gemini |
| Recordatorios | Quién avisa (Datheke o Google Calendar), Conectar aquí, Cambiar tono del aviso | Tarjeta de la cuenta |
| Importar | Archivo .datheke (también en Más → Importar); las compartidas se agregan en Más → Compartidas | Botón «Nota recibida» de la lista (ya no está) |
| Respaldo | Fecha del último, Hacer ahora, Dar permiso | Barra lateral |
| Apps y versión | Versión instalada, descargas Android/Windows, dirección web, copia en Documentos/Datheke | Tarjeta de la cuenta |

Dispositivos, Preferencias (libreta para notas nuevas, letra, modo oscuro) e Importar de Evernote se agregan a su sección
cuando se programen: no se ponen secciones vacías.

## 3. Barra de edición de la nota
| Queda a la vista | Insertar ▾ (con buscador) | Más ▾ (con buscador) |
|---|---|---|
| Insertar ▾, Gemini ✨, Dictar, Deshacer, Rehacer, Estilo de párrafo, Fuente, Tamaño de letra, Color de letra, Negrita, Más ▾ | Foto, Tabla, Casillas, Recordatorio 🔔, Emoji, Enlace, Calculadora 🧮, Desplegable, Recuadro 💡, Advertencia ⚠️, Importante ❗, Cita, Separador, Línea al lado | Cursiva, Subrayado, Tachado, Resaltar, Lista con viñetas, Lista numerada, Disminuir/Aumentar sangría, Alinear (4), Interlineado, Quitar formato |

Dentro de una tabla siguen apareciendo Agregar fila/columna y Borrar fila/columna/tabla.

## 4. Cabecera y menú ⋯ de la nota
Igual que hoy (Volver, libreta, buscar en la nota, Fijar/Editar, subnota, cerrar notas con clave, ⋯), y en ⋯ se agrega
**Ícono y portada** (siguen también arriba del título).

## 5. Lista de notas
Igual que hoy (título y cantidad, Sincronizar, Seleccionar varias, buscador, Desde plantilla…, estado), sin el botón "Nota recibida"
(la copia .datheke va en Más → Importar y en Ajustes → Importar; las compartidas, en Más → Compartidas).
