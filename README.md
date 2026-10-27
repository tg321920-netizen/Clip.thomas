# ClipForge Studio

ClipForge Studio permite importar vídeos autorizados, recortarlos y preparar clips para revisión. El perfil estable conserva el editor, las sugerencias y la biblioteca; historias y automatizaciones experimentales quedan separadas. La aplicación Next.js vive en la raíz del repositorio. La rama de rescate conserva las reparaciones previas y las mejoras de foundation; publicación y generación externa paga están desactivadas.

## Regla del proyecto

No se aceptan funciones simuladas. Upload, análisis, metadatos, transcripción, clips, progreso, edición, render, publicación y analytics deben estar respaldados por procesamiento real o fallar explícitamente cuando falte una dependencia externa.

## Estado actual

La [entrega técnica del 27 de octubre](docs/STUDIO_COMPLETION_20261027.md) distingue código, pruebas reales y despliegue. Se comprobaron vídeo y podcasts de solo audio, subtítulos con historial y glosario, selección local, descarga y restauración privada R2. Chromium móvil utilizó las APIs y archivos reales. La traducción automática sigue necesitando revisión de significado; Android físico y el ensayo accesible siguen pendientes. No hay una URL nueva certificada.

Flujo comprobado localmente:

`VÍDEO AUTORIZADO → subida → ASR/análisis opcionales → recorte → subtítulos/traducción revisada opcionales → FFmpeg → MP4 → R2 privado → revisión y descarga`

También incluye:

- News Mode con resumen basado en fuente, TTS y render vertical;
- captura manual de pantalla/ventana/pestaña cuando el navegador soporta `getDisplayMedia`;
- OAuth y adapters oficiales para TikTok, YouTube y Facebook;
- dashboard `/autopilot`;
- conexión de canales en `/connections`;
- almacenamiento cifrado de credenciales OAuth;
- autenticación de propietario obligatoria por defecto en Render/Vercel;
- Docker y plantillas diferenciadas para runtime gratuito efímero o infraestructura persistente, con FFmpeg, FFprobe y workers;
- elección de cuántos clips/candidatos generar y reanálisis cuando cambia esa configuración;
- podcasts de audio MP3/M4A/WAV/OGG/FLAC/AAC: recorte M4A real y SRT, sin imágenes inventadas;
- glosario por proyecto, comparación original/traducción e historial recuperable de subtítulos.

Los informes anteriores corresponden a otros commits y no prueban que esta reparación esté desplegada. La última versión observada del sitio anterior fue `e1045df`; las consultas del 27 de octubre agotaron el tiempo de espera y no acreditan su versión actual. No se modificaron los servicios existentes.

## Importante sobre producción

Vercel puede alojar la interfaz y endpoints ligeros; el procesamiento nativo prolongado requiere un runtime multimedia con sus workers y almacenamiento. Por eso `/api/health` en Vercel puede reportar `mediaReady: false`; no es un resultado válido para procesar video pesado allí.

Para usar ClipForge de extremo a extremo en producción, se necesita un runtime multimedia y persistencia comprobada. `render.yaml` propone un ensayo Docker gratuito con disco efímero; `render.production.yaml` propone recursos y disco de pago, sin autorización para aprovisionarlos. El ensayo nativo revisado está en `render.audit-preview.yaml`, con auto-deploy, publicación y LIVE desactivados. La infraestructura equivalente necesita:

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
