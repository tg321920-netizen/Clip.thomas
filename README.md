# ClipForge Studio

ClipForge Studio muestra cuatro funciones: importar una URL autorizada, subir y editar videos, extraer clips y crear historias de múltiples escenas. La aplicación Next.js vive en la raíz del repositorio. La rama de rescate conserva las reparaciones previas y las mejoras de foundation; publicación y generación externa paga están desactivadas.

## Regla del proyecto

No se aceptan funciones simuladas. Upload, análisis, metadatos, transcripción, clips, progreso, edición, render, publicación y analytics deben estar respaldados por procesamiento real o fallar explícitamente cuando falte una dependencia externa.

## Estado actual

La reparación está preparada para revisión, pero **no se declara completada la validación de build, Android ni calidad audiovisual comercial**. Consulta [el estado verificado de Studio](docs/CLIPFORGE_STUDIO_VERIFICATION.md) para evidencias, limitaciones y el ensayo acotado.

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

Los informes anteriores corresponden a otros commits y no prueban que esta reparación esté desplegada. Producción sigue en `codex/clipforge-agent-foundation`; no se ha modificado el servicio de Render.

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

Los renders y pruebas de Whisper con generación audiovisual necesitan autorización expresa. GitHub Actions verifica código en los commits normales; los workflows audiovisuales se ejecutan solo manualmente con esa autorización.

## Publicación real

`PUBLISHING = OFF` durante el rescate. Los adapters oficiales se conservan para una futura activación autorizada; tener OAuth válido no habilita publicación en esta versión.

Consulta:

- `docs/FINAL_EXTERNAL_HANDOFF.md` — verificación del núcleo y límites comprobados (2026-10-05).
- `docs/ZCODE_EXTERNAL_CONTRACT.md` — contrato y prueba local para ZCode externo.
- `docs/FUTURE_CHANNELS_AND_MARKETING.md` — separación orgánica/publicidad y evolución segura.
- `CLIPFORGE_AUTOPILOT_PROGRESS.md`
- `PROJECT_PLAN.md`
- `docs/AUTOPILOT_ARCHITECTURE.md`
- `docs/PUBLISHING_SETUP.md`
- `docs/RENDER_PRODUCTION.md`
- `AGENTS.md`
