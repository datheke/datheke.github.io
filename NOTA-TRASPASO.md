# Nota de traspaso

**Fecha:** 3 de noviembre de 2026, ~22:20 (hora de Ecuador). **Dónde quedé:** PC.
**IA y aparato:** Claude Code, PC.
**Rama:** `main`.

## Qué estaba haciendo
- Se probó en la PC la 0.17.3 (zoom con Ctrl + rueda y tarjeta de la cuenta): funciona.
- Se quitó el botón Pegar al vincular Gemini. Ya está en la web; las apps siguen en la 0.17.3 y aún lo tienen.

## Qué falta (David ya dio su OK; sin código escrito)
1. Línea al lado del texto (`hola ─────`): opción nueva "Línea al lado" en el menú `/`, hasta el final del renglón. El Separador no cambia.
   Va como un ajuste más del renglón en `ParagraphFormat` (`src/Editor.tsx`). Revisar con texto largo y en el celular.
2. `hola /desplegable`: "hola" pasa a ser el título (triángulo a la izquierda, contenido abajo; nace como Título 2).
   Va en `runSlash` (`src/slash.ts`), con su prueba en `src/slash.test.ts`. Dentro del título de otro desplegable sigue como hoy.
   Descartado: que el contenido se abra dentro del mismo renglón.
3. Mostrárselo a David. Con su "sube": versión 0.17.4 con todo junto (también lo de Gemini) y armar Android y Windows.

David decidió dejar las actualizaciones como están ("hasta nuevo aviso"): no tocar.

## Pendiente para el celular
- Lo de "Qué falta".

## Aprendizajes para pasar a la fuente única
- Ninguno.
