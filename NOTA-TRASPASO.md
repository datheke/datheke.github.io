# Nota de traspaso

**Fecha:** 6 de noviembre de 2026. **Dónde quedé:** PC.
**IA y aparato:** Claude Code, PC.
**Rama:** `main`, todo subido.

## Qué se hizo
- David eligió el estilo **B** (verde y redondeado) y aprobó `DISENO.md`.
- **0.18.0** (diseño nuevo, parte 1): colores y formas del estilo B, rueda de Ajustes junto al avatar, «Más ▾» en la barra
  lateral (Plantillas, Compartido conmigo, Basurero) y ventana de **Ajustes** con buscador (Settings.tsx). Plantillas
  quedó solo en «Más» (decisión de David). Inventario: «Nada falta».
- **0.18.1**: tras probarla en el celular, David pidió el menú como panel lateral (no pantalla completa) y que la rueda abra
  Ajustes en la lista de secciones. Regresar desde la lista ya no abre el menú: sale de la app (o vuelve a Todas las notas).
- **0.18.2**: el aviso de salida no llegaba cuando salía alguien con «Puede editar» (Google lo deja quitarse sin aviso).
  Ahora el dueño compara su lista con los permisos de Google cada 5 minutos, y la nota muestra una franja roja.
  Si ya no queda nadie (se salieron o se les quitó), deja de ser compartida y queda como nota normal en su libreta.

## Qué falta (en orden)
1. David prueba la 0.18.1 en el celular: menú lateral (regresar, tocar afuera, deslizar a la izquierda), rueda que abre la lista de Ajustes, «Más», Compartido conmigo.
2. **0.18.3**: «Compartidas» (las que compartí y las que me compartieron, con botón directo para agregar) e «Importar» en «Más» (archivo .datheke con título y libreta). Ver la sección «Compartidas e importar» de `PROYECTO.md`.
3. **0.18.4**: importar de Evernote (.enex) y enviar varias notas o una libreta entera en un archivo; al recibir, elegir cuáles.
4. **0.18.5** (diseño nuevo, parte 2): barra de edición con «Insertar ▾» y «Más ▾» (con buscador) e «Ícono y portada»
   también en el menú ⋯. Ver `DISENO.md` secciones 3 y 4. Al terminar, `node scripts/inventario.mjs --comparar` debe decir «Nada falta».
5. Después del diseño, el orden aprobado en `PROYECTO.md`.

## Pendiente de probar (David)
- La 0.18.1 en el celular.
- 0.18.2: con la nota de Karina, que salga la franja roja y la nota quede como normal (fuera de compartidas).
- "Solo ver" con dos cuentas de Google (que llegue el aviso "salió de…").
- Versión anterior en una nota que no haya tocado hace rato.

## Pendiente para el celular
- Lo de "Pendiente de probar".

## Aprendizajes para pasar a la fuente única
- Ninguno.
