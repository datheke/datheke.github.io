# Nota de traspaso

**Fecha:** 4 de noviembre de 2026, ~19:50 (hora de Ecuador). **Dónde quedé:** celular.
**IA y aparato:** Claude Code, celular (nube).
**Rama:** `main` (todo publicado; la rama de la sesión ya está unida).

## Qué se hizo (versiones 0.17.4 a 0.17.7, publicadas en web, Android y Windows)
- 0.17.4: "Línea al lado ───" en el menú `/`. Se probó y se quitó "hola /desplegable" con título (a David no le sirve).
- Clave de notas (una sola para todas, mínimo 6, con huella):
  - "Quitar clave" solo con la nota abierta y siempre pide la clave (o la huella).
  - Al salir de una nota con clave, la clave se cierra: al volver se pide otra vez.
  - Si no queda ninguna nota con clave, al proteger se crea una clave nueva (antes pedía una vieja olvidada).
  - Al proteger otra nota: "Usa la misma clave de tus otras notas" (botón Proteger).
  - "¿Olvidaste la clave?" escondido: aparece al mantener presionado el candado 2 segundos. La explicación va al final de Recordatorios en la tarjeta de la cuenta.
- Notas fijadas con chincheta 📌 en vez de candado.

## Qué falta
- Nada pendiente.
- David decidió dejar las actualizaciones como están ("hasta nuevo aviso"): no tocar.
- Recomendado a David: proteger con clave sus notas que tienen contraseñas (hoy están solo fijadas y se leen en la lista).

## Pendiente para la PC
- Nada obligatorio. Si quiere: probar en el celular la huella al volver a entrar a una nota con clave (en la nube no se puede probar).

## Aprendizajes para pasar a la fuente única
- En las pruebas con Drive simulado, el simulador tiene que guardar lo que la app envía (propiedades y contenido); si no, la app "pierde" cambios y parece un error que no existe.
- Antes de cambiar algo de claves o seguridad, probar en el navegador los intentos que deben fallar (clave equivocada, quitar sin clave, entrar sin clave) y contarle a David el resultado.
