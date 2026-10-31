# Datheke (antes Notas David)

App de notas personal de costo cero: React + Vite + TypeScript; escritorio y Android con Tauri 2. Publicada en https://datheke.github.io
Las reglas generales están en `~/.claude/CLAUDE.md`; aquí solo lo de este proyecto.

## Antes de trabajar
- El plan por etapas y el estado están en `PROYECTO.md`: léelo antes de empezar una etapa nueva.
- ⚠️ Este repositorio es PÚBLICO: nunca escribas aquí correos, claves ni datos privados.

## Cuentas y publicación (no mezclar con otros proyectos)
- GitHub: org `datheke`, se sube con la cuenta `david3gallegos3work-gif` (va en la URL del remote). Google Cloud: ver la sección `notas-david` de `.cuentas.json`.
- ⚠️ Aquí "sube" TAMBIÉN publica: cada push a main publica la web en GitHub Pages (`pages.yml`). No usa Vercel ni Supabase.
- Las apps de escritorio y Android se compilan solo en GitHub Actions (`desktop.yml`, manual); no hay Rust instalado en la PC.

## Código
- Para la parte Rust/Tauri (`src-tauri/`) usa las skills `rust-patterns` y `rust-testing`, y los agentes de Rust de este proyecto.
- Verificar antes de decir "listo": `npm run lint` y `npm run build`.
- El dev server se cae al cerrar la sesión: reinícialo con `npm run dev`.
