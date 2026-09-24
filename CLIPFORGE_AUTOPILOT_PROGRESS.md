# ClipForge Autopilot — progreso

## ESTADO ACTUAL

ClipForge ya tiene un flujo real y comprobable desde la ingesta hasta la publicación preparada, analytics y aprendizaje. El proyecto Vercel canónico `clip-thomas` está desplegado en producción y el commit de `main` correspondiente está verificado por CI. Además, el repositorio ya contiene y verifica una imagen Docker de producción para el procesamiento pesado de medios con web + workers en una sola instancia persistente. No se consideran verificadas en vivo las acciones que dependan de credenciales, aprobaciones externas o recursos de pago hasta probarlas con cuentas/infraestructura reales autorizadas.

## COMPLETADO Y VERIFICADO

### Ingesta y medios

- Upload real MP4/MOV/WebM por streaming, con validación y límite de tamaño.
- FFprobe real para metadatos y FFmpeg real para poster/renders.
- HTTP Range para originales y renders.
- Rutas/parametrización seguras; multimedia sin concatenar shell crudo.

### Transcripción, análisis, edición y clips

- Whisper CLI real mediante worker separado, Transcript y TranscriptSegment con tiempos.
- ContentAnalysisService, candidatos, ViralScore explicable y provider OpenAI opcional.
- Clip Engine 9:16 1080×1920 H.264/AAC.
- Subtítulos CLEAN/VIRAL/KARAOKE editables y quemados con FFmpeg.
- Auto Edit heurístico + provider OpenAI opcional.
- Auto Focus V1 reactivo a voz con zoom FFmpeg progresivo sin alterar el original.
- La V1 no finge reconocer cuál de varias caras habla.

### News Mode

- Resumen extractivo desde la fuente, titular, categoría y plantilla.
- TTS real con espeak-ng.
- Render vertical narrado 1080×1920 con FFmpeg.
- Worker y E2E separados.

### Live manual

- Captura manual con getDisplayMedia + MediaRecorder cuando el navegador lo soporta.
- El usuario autoriza explícitamente pantalla/ventana/pestaña.
- El resultado entra al mismo pipeline real de ClipForge.

### Canales, Autopilot y scheduler

- ChannelRecord + ChannelStrategy para TikTok, YouTube y Facebook.
- AutopilotConfig y worker de orquestación.
- Dependencias transcripción → análisis → Auto Edit → render → publicación.
- PublicationRecord, aprobación, horarios, límites diarios, timezone y estados.
- PUBLISH_POST y publishing worker.

### OAuth y publicación oficial

- CredentialVault AES-256-GCM server-side.
- Flujo web de conectar/desconectar cuentas desde `/connections`.
- OAuth con estado HMAC firmado y expiración.
- TikTok: autorización, callback, token y refresh.
- YouTube/Google: autorización offline, callback, refresh y detección de canal.
- Facebook: autorización, lectura de Pages y selección explícita cuando hay varias.
- TikTok Direct Post consulta creator info, exige consentimiento/privacidad y soporta FILE_UPLOAD directo del MP4 local por chunks; PULL_FROM_URL permanece disponible para dominios HTTPS verificados.
- YouTube usa resumable upload desde archivo local y espera procesamiento real.
- Facebook Reels usa inicio → transferencia binaria local → finalización, con Graph API version configurada explícitamente.
- Los providers están probados por contrato/mocks y no se afirma una publicación real hasta disponer de cuentas/apps autorizadas.

### Analytics, aprendizaje y costos

- AnalyticsRepository, AnalyticsService y FETCH_ANALYTICS idempotente.
- Worker periódico de analytics.
- YouTubeProvider obtiene estadísticas reales disponibles.
- PerformanceAnalyzer genera recomendaciones solo con evidencia suficiente.
- AIUsageService registra provider/model/operación/tokens y no inventa costos ausentes.
- Dashboard `/autopilot` muestra únicamente datos persistidos reales.

### Protección de acceso del propietario

- El despliegue canónico de Vercel usa Deployment Protection y ClipForge puede confiar explícitamente en esa capa solo dentro de Vercel.
- Si se activa `CLIPFORGE_REQUIRE_OWNER_AUTH=true`, el login propio de ClipForge vuelve a ser obligatorio y tiene prioridad sobre el modo de confianza de plataforma.
- Login propio server-side con cookie HttpOnly, SameSite=Lax y firma HMAC-SHA256.
- Las APIs protegidas fallan cerrado sin sesión válida cuando el login propio está activo.
- Local puede permanecer abierto para desarrollo o forzar el mismo control con variable de entorno.

### Runtime persistente preparado

- `Dockerfile` de producción instala FFmpeg/FFprobe, espeak-ng, Python y Whisper CLI reales.
- `scripts/render-runtime.mjs` supervisa Next.js + workers de transcripción, análisis, Auto Edit, render, News Mode, Autopilot, publicación y analytics en una sola instancia.
- `/api/health` comprueba FFmpeg, FFprobe y almacenamiento escribible sin exponer rutas ni secretos.
- `render.yaml` define el MVP de propietario único con una instancia, disco persistente y secretos fuera de Git.
- El HOME de Whisper puede residir en el volumen persistente para reutilizar modelos descargados.
- Workflow `ClipForge Render Runtime` construye la imagen, valida FFmpeg/FFprobe/espeak-ng/Whisper y arranca el runtime completo antes de considerarlo verificable.

### Pruebas verificadas

- lint: OK.
- typecheck: OK.
- tests unitarios: OK.
- build Next.js: OK.
- Phase 1 E2E: OK.
- Clip render E2E: OK.
- Auto Focus E2E: OK.
- News Mode E2E: OK.
- Whisper E2E: OK en el workflow dedicado del bloque principal.
- `ClipForge CI` para el bloque de runtime: SUCCESS (run `36045943968`).
- `ClipForge Render Runtime`: SUCCESS (run `36045981913`), incluyendo build Docker, binarios reales y health check del runtime completo.

## CONFIGURACIÓN DE DESPLIEGUE

- `vercel.json` raíz fija el proyecto canónico como Next.js, `npm run build` y salida `.next`.
- Proyecto canónico Vercel: `clip-thomas` (`prj_8rOfWiKDx2N5tWuvt5pfqtnypZwl`).
- Producción Vercel verificada antes del bloque Docker: deployment `dpl_CiMpDxD56trLPC5Gqn8y8rVkqwyQ`, estado `READY`, target `production`, commit `3675f287efcfde752cbbc0becdbdaa7b825f2f90` de `main`.
- El proyecto Vercel histórico `clipforge` se considera duplicado y no forma parte de la ruta canónica.
- Runtime pesado preparado: Docker + Blueprint Render documentados en `docs/RENDER_PRODUCTION.md`.

## PENDIENTE DE CÓDIGO / INFRAESTRUCTURA

Los siguientes puntos no se deben declarar terminados sin infraestructura, dependencias o alcance adicional real:

- Active-speaker multi-persona con detección visual/face tracking real.
- Para escalar a múltiples instancias/tenants: sustituir archivos locales por persistencia, cola y almacenamiento compartidos/durables.
- Autenticación multiusuario y aislamiento por tenant si ClipForge se ofrece como SaaS; el modo actual está diseñado para un propietario único.
- Analytics adicional de TikTok/Facebook donde las APIs, revisión y scopes lo permitan.
- Webhooks/n8n opcionales.

## REQUIERE ACCIÓN EXTERNA DEL PROPIETARIO

- Aprobar/provisionar el servicio Render con disco persistente si se desea activar el runtime pesado continuo. El Blueprint está preparado, pero no se crea un recurso de pago sin aprobación explícita.
- Elegir `CLIPFORGE_OWNER_ACCESS_KEY` para ese runtime; el resto de secretos internos pueden generarse en la plataforma.
- Crear/configurar o aprobar las apps de TikTok, Google/YouTube y Meta con los scopes necesarios.
- Registrar los redirect URI HTTPS reales y configurar sus secretos OAuth.
- Conectar cuentas reales en `/connections` y ejecutar una publicación controlada para validar cada provider en vivo.
- Si se decide convertir ClipForge en SaaS multiusuario, definir/provisionar persistencia compartida y modelo de identidad/tenant antes de activar usuarios externos.

## LIMITACIONES EXPLÍCITAS

- `Channel.userId` sigue `null` en el modo actual de propietario único.
- El filesystem persistente de una sola instancia es adecuado para el MVP de un dueño, no para escalar horizontalmente o aislar múltiples tenants.
- Auto Focus V1 reacciona a voz pero no identifica visualmente al hablante entre varias personas.
- News Mode V1 no descarga material protegido de medios de terceros ni inventa hechos ausentes en la fuente.
- Publicación real de terceros no se declara verificada hasta completar OAuth con credenciales reales y publicar una prueba autorizada.
