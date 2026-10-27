# ClipForge Studio

ClipForge Studio permite importar vídeos autorizados, recortarlos y preparar clips para revisión. El perfil estable conserva el editor, las sugerencias y la biblioteca; historias y automatizaciones experimentales quedan separadas. La aplicación Next.js vive en la raíz del repositorio. La rama de rescate conserva las reparaciones previas y las mejoras de foundation; publicación y generación externa paga están desactivadas.

## Regla del proyecto

No se aceptan funciones simuladas. Upload, análisis, metadatos, transcripción, clips, progreso, edición, render, publicación y analytics deben estar respaldados por procesamiento real o fallar explícitamente cuando falte una dependencia externa.

## Estado actual

La [auditoría del 26 de octubre](docs/FULL_SYSTEM_AUDIT_20261026.md) distingue código, pruebas reales y despliegue. El editor, los subtítulos originales, R2 y la corrección de traducciones se verificaron localmente con vídeos auténticos. El traductor automático cometió errores de significado que necesitaron corrección. Android físico y el ensayo privado accesible siguen pendientes; no hay una URL nueva certificada.

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
- Docker + `render.yaml` para el runtime persistente con FFmpeg, FFprobe, Whisper, TTS y workers;
- elección de cuántos clips/candidatos generar y reanálisis cuando cambia esa configuración.

Los informes anteriores corresponden a otros commits y no prueban que esta reparación esté desplegada. El sitio anterior observado conserva `e1045df`; no se modificaron los servicios existentes.

## Importante sobre producción

Vercel puede alojar la interfaz y endpoints ligeros; el procesamiento nativo prolongado requiere un runtime multimedia con sus workers y almacenamiento. Por eso `/api/health` en Vercel puede reportar `mediaReady: false`; no es un resultado válido para procesar video pesado allí.

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
