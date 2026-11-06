# Nota de traspaso

**Fecha:** 6 de noviembre de 2026, noche. **Dónde quedé:** PC (chat nuevo por saturación).
**IA y aparato:** Claude Code, PC.
**Rama:** `main`. Hay commits locales sin subir: `DISENO.md`, `scripts/inventario.mjs`, `scripts/inventario.txt` y esta nota (no cambian la app).

## Qué se hizo hoy (todo publicado hasta la 0.17.13)
- 0.17.8 a 0.17.10: limpieza de fotos sin uso (se borran al día siguiente) y copia visible en Documents/Datheke en Android (ya funciona).
- 0.17.11: compartir con "Puede editar" o "Solo ver" y aviso cuando alguien se sale.
- 0.17.12: una sola carpeta "Datheke – importante, no borrar" (Respaldos, Notas compartidas, LÉEME), "Hacer ahora" que no borra el respaldo viejo, aviso si se borra el archivo de una nota compartida. Funcionó en el Drive de David.
- 0.17.13: versión anterior de cada nota (⋯ → Ver versión anterior → Restaurar; restaurar otra vez lo deshace).
- Decisiones de David y lo que falta: tabla de Estado de `PROYECTO.md` (única fuente).

## En curso: diseño nuevo (como Evernote)
1. Propuesta de dónde queda cada cosa: `DISENO.md`. Lista de las 250 cosas que se ven hoy: `scripts/inventario.txt`; al terminar, `node scripts/inventario.mjs --comparar` debe decir "Nada falta" (si no, no se publica).
2. Tres estilos dibujados para que David elija (PC y celular, 4 pantallas cada uno): https://claude.ai/artifact/Vqek3VWa8Bkt5kospCzRV7
   A = limpio y claro (como Notion), B = verde y redondeado (como Evernote, lo más parecido a hoy), C = moderno con barra oscura (como Linear).
3. Falta: que David elija (o mezcle) y dé el OK a `DISENO.md`; luego pasarlo a la app. Para verlo en pantalla hace falta ≥3 GB de RAM libre (hoy ~1,6 GB): pedirle que cierre programas.

## Pendiente de probar (David)
- "Solo ver" con dos cuentas de Google (lo más importante: que al salirse la otra persona llegue el aviso "salió de…").
- Versión anterior en una nota que no haya tocado hace rato.

## Después del diseño (orden aprobado)
Dibujos a mano, calendario, Kanban, tablas con filtros, combinar cambios al editar entre dos, "Enviar a IA", Dispositivos (con "Perdí mi celular"), importar de Evernote, modo oscuro.

## Pendiente para el celular
- Lo de "Pendiente de probar".

## Aprendizajes para pasar a la fuente única
- Ninguno.
