# Nota de traspaso

**Fecha:** 3 de noviembre de 2026, ~20:40 (hora de Ecuador). **Dónde quedé:** celular (nube).
**IA y aparato:** Claude Code, celular (sesión en la nube).
**Rama:** `main` (todo publicado; la rama de la sesión ya está unida).

## Qué se hizo (versiones 0.16.1 a 0.17.3, todas publicadas en web, Android y Windows)
- Calculadora en la nota (`/calcu`): letras A, B, C en los renglones con número, Todo / Marcados / Sin marcar,
  cuentas combinadas, cuentas con palabras ("médico más viaje") sin Gemini, y Gemini/dictado que la ponen.
- Pegar: siempre sin formato (tamaño 14, sin renglones vacíos); el aviso ofrece "Pegar con formato"
  (lo copiado en la app vuelve tal cual, lo de otro lado con su formato original).
- Zoom en notas fijadas como en un PDF (85% a 250%): dos dedos o dos toques en el celular; Ctrl + rueda o doble clic en la PC.
- Tarjeta de la cuenta: versión instalada a la vista, enlaces de descarga de Android y Windows (abrir o copiar),
  secciones plegables.

## Qué falta
- Nada pendiente. David decidió dejar las actualizaciones como están ("hasta nuevo aviso"): no tocar.

## Pendiente para la PC
- Nada obligatorio. Si quieres, probar en la PC: zoom con Ctrl + rueda en una nota fijada y la tarjeta de la cuenta.

## Aprendizajes para pasar a la fuente única
- Desde la nube no se puede subir directo a `main`: se publica con un pull request y se une con "merge" (no "rebase", que deja choques falsos en el siguiente).
- En Datheke, después de cada "sube" David espera también las apps: lanzar `desktop.yml` para Android y Windows y avisar con los enlaces cuando terminen.
- Pegar desde la barra del teclado del celular (Gboard) no dispara el evento de pegar: llega como texto escrito y solo trae el texto, sin formato.
- La app de Android (Tauri) no tiene permiso para leer el portapapeles con un botón: pegar siempre por el menú del sistema.
