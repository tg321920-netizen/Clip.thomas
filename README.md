# ClipForge Multi

ClipForge Multi convierte videos largos en clips verticales reales para TikTok, YouTube Shorts y Facebook Reels. La aplicación Next.js vive directamente en la raíz del repositorio para que GitHub, Vercel y el runtime persistente construyan el mismo código.

## Regla del proyecto

No se aceptan funciones simuladas. Upload, análisis, metadatos, transcripción, clips, progreso, edición, render, publicación y analytics deben estar respaldados por procesamiento real o fallar explícitamente cuando falte una dependencia externa.

## Estado actual

El **MVP de propietario único está completo a nivel de código y verificación automática**.

Flujo disponible:

`VIDEO → FFprobe/FFmpeg → Whisper → análisis/candidatos → ViralScore → selección de cantidad → Auto Edit → subtítulos → Auto Focus → render 9:16 → canales → scheduler → publicación preparada → analytics/aprendizaje`

También incluye:

- News Mode con resumen basado en fuente, TTS y render vertical;
- captura manual de pantalla/ventana/pestaña cuando el navegador soporta `getDisplayMedia`;
- OAuth y adapters oficiales para TikTok, YouTube y Facebook;
- dashboard `/autopilot`;
- conexión de canales en `/connections`;
- almacenamiento cifrado de credenciales OAuth;
- autenticación de propietario opcional;
- Docker + `render.yaml` para el runtime persistente con FFmpeg, FFprobe, Whisper, TTS y workers;
- elección de cuántos clips/candidatos generar y reanálisis cuando cambia esa configuración.

El commit `17c95d3e2ccb1aad422de4242dfb42742b598b23` de `main` pasó `ClipForge CI` completo y está desplegado en el proyecto Vercel canónico `clip-thomas`.

## Importante sobre producción

Vercel aloja correctamente la aplicación web, pero su runtime no contiene FFmpeg/FFprobe ni almacenamiento persistente para el procesamiento pesado. Por eso `/api/health` en Vercel puede reportar `mediaReady: false`; no es un resultado válido para procesar video pesado allí.

Para usar ClipForge de extremo a extremo en producción, el runtime persistente debe desplegarse con el `Dockerfile`/`render.yaml` incluidos en este repositorio o en infraestructura equivalente con:

- FFmpeg y FFprobe;
- Whisper CLI;
- espeak-ng;
- almacenamiento persistente escribible;
- workers de transcripción, análisis, Auto Edit, render, News Mode, Autopilot, publishing y analytics.

Consulta `docs/RENDER_PRODUCTION.md`.

## Ejecutar localmente

```bash
npm ci
npm run dev
```

Los workers se ejecutan con los scripts `worker:*` de `package.json`.

## Validar

```bash
npm run verify
npm run build
npm run phase1:e2e
npm run render:e2e
npm run reframe:e2e
npm run news:e2e
```

GitHub Actions además valida Whisper real y la imagen Docker del runtime persistente.

## Publicación real

Los adapters oficiales existen, pero una publicación real requiere apps/cuentas autorizadas y credenciales OAuth reales del propietario. ClipForge no inventa tokens ni marca una cuenta como conectada sin completar OAuth.

Consulta:

- `CLIPFORGE_AUTOPILOT_PROGRESS.md`
- `PROJECT_PLAN.md`
- `docs/AUTOPILOT_ARCHITECTURE.md`
- `docs/PUBLISHING_SETUP.md`
- `docs/RENDER_PRODUCTION.md`
- `AGENTS.md`
