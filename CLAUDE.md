# Datheke (antes Notas David)

App de notas personal de costo cero: React + Vite + TypeScript; escritorio y Android con Tauri 2. Publicada en https://datheke.github.io
Las reglas generales están en `~/.claude/CLAUDE.md`; aquí solo lo de este proyecto.

## Antes de trabajar
- El plan por etapas y el estado están en `PROYECTO.md`: léelo antes de empezar una etapa nueva.
- Al terminar una función o cambiar una decisión, actualiza la tabla de Estado de `PROYECTO.md` en el mismo commit (viaja por GitHub a la PC y al celular). Antes de decir que algo falta, revisa los menús, el historial y esa tabla, y pregúntale a David si fue una decisión.
- ⚠️ Este repositorio es PÚBLICO: nunca escribas aquí correos, claves ni datos privados.

## Cuentas y publicación (no mezclar con otros proyectos)
- GitHub: org `datheke`, se sube con la cuenta `david3gallegos3work-gif` (va en la URL del remote). Google Cloud: datos en las cuentas privadas de David.
- ⚠️ Aquí "sube" TAMBIÉN publica: cada push a main publica la web en GitHub Pages (`pages.yml`). No usa Vercel ni Supabase.
- Las apps de escritorio y Android se compilan solo en GitHub Actions (`desktop.yml`, manual); no hay Rust instalado en la PC.
- Después de cada "sube" con cambios en la app, lanza `desktop.yml` para Android y Windows y avisa con los enlaces al terminar.

## Código
- Para la parte Rust/Tauri (`src-tauri/`) usa las skills `rust-patterns` y `rust-testing`, y los agentes de Rust de este proyecto.
- Verificar antes de decir "listo": `npm run lint` y `npm run build`.
- El dev server se cae al cerrar la sesión: reinícialo con `npm run dev`.
- Para ver un cambio con poca RAM: `npm run build` y `npx vite preview --port 5173 --strictPort` (liviano; Google deja entrar en 5173).
