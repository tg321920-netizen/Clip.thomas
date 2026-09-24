# ClipForge Autopilot — progreso

## ESTADO ACTUAL

**MVP de propietario único: código completo y verificado.**

`main` integra el flujo real desde ingesta hasta clips, News Mode, captura manual, Autopilot, OAuth/providers, scheduler, analytics y runtime persistente preparado. El commit `17c95d3e2ccb1aad422de4242dfb42742b598b23` pasó `ClipForge CI` completo (run `36057286731`) y se desplegó correctamente en el proyecto Vercel canónico `clip-thomas` como deployment `dpl_iWsHt8bqTt5W4wyfhPV6rZc7drZp`, estado `READY`, target `production`.

El endpoint de salud de ese deployment Vercel reporta `mediaReady: false` porque Vercel no contiene FFmpeg/FFprobe ni el almacenamiento persistente requerido. El procesamiento pesado debe ejecutarse en el runtime Docker persistente preparado en este repositorio. No se presenta el runtime Vercel como procesador de medios.

## COMPLETADO Y VERIFICADO

### Ingesta y medios

- Upload real MP4/MOV/WebM por streaming, validación y límite de tamaño.
- FFprobe real para metadatos y FFmpeg real para poster/renders.
- HTTP Range para originales y renders.
- Rutas y parámetros seguros; `spawn` sin shell para procesos multimedia.

### Transcripción, análisis y clips

- Whisper CLI real mediante worker separado.
- Transcript y TranscriptSegment con timestamps.
- ContentAnalysisService, candidatos y ViralScore explicable.
- Cantidad de candidatos/clips configurable; cambiar esa configuración invalida y repite el análisis cuando corresponde.
- Clip Engine 9:16 1080×1920 H.264/AAC.
- Subtítulos CLEAN/VIRAL/KARAOKE editables y quemados con FFmpeg.
- Auto Edit heurístico + provider OpenAI opcional.
- Auto Focus V1 reactivo a voz con zoom FFmpeg progresivo.

### News Mode

- Resumen extractivo basado en la fuente, titular, categoría y plantilla.
- TTS real con espeak-ng.
- Render vertical narrado 1080×1920 con FFmpeg.
- Worker y E2E separados.

### Captura manual LIVE

- `getDisplayMedia` + MediaRecorder cuando el navegador lo soporta.
- El usuario elige y autoriza explícitamente pantalla/ventana/pestaña.
- La captura entra al pipeline real de ClipForge.

### Canales, Autopilot y scheduler

- ChannelRecord + ChannelStrategy para TikTok, YouTube y Facebook.
- AutopilotConfig y worker de orquestación.
- Dependencias transcripción → análisis → Auto Edit → render → publicación.
- PublicationRecord, aprobación, horarios, límites diarios, timezone y estados.
- PUBLISH_POST y publishing worker.
- Dashboard `/autopilot` con datos persistidos reales.

### OAuth y publicación oficial

- CredentialVault AES-256-GCM server-side.
- Conexión/desconexión desde `/connections`.
- OAuth con estado HMAC firmado y expiración.
- TikTok: autorización/callback/refresh y Direct Post con FILE_UPLOAD local por chunks; PULL_FROM_URL permanece disponible para dominios verificados.
- YouTube: OAuth offline, resumable upload y espera de procesamiento real.
- Facebook: autorización, Pages, selección explícita y Reels con inicio → transferencia binaria → finalización.
- Los providers están probados por contrato/mocks. Una publicación externa no se declara verificada hasta usar cuentas/apps reales autorizadas.

### Analytics, aprendizaje y costos

- AnalyticsRepository, AnalyticsService y FETCH_ANALYTICS idempotente.
- Worker periódico de analytics.
- YouTubeProvider obtiene estadísticas disponibles.
- PerformanceAnalyzer genera recomendaciones con evidencia suficiente.
- AIUsageService registra provider/model/operación/tokens sin inventar costos.

### Seguridad del propietario

- Deployment Protection de Vercel soportado para el frontend canónico.
- Login propio opcional con cookie HttpOnly, SameSite=Lax y HMAC-SHA256.
- APIs protegidas fallan cerrado cuando se exige sesión propia.
- Tokens OAuth no se exponen al frontend ni se guardan en ChannelRecord.

### Runtime persistente

- `Dockerfile` instala FFmpeg/FFprobe, espeak-ng, Python y Whisper CLI reales.
- `scripts/render-runtime.mjs` supervisa Next.js y los workers de transcripción, análisis, Auto Edit, render, News Mode, Autopilot, publishing y analytics.
- `/api/health` comprueba FFmpeg, FFprobe y almacenamiento escribible.
- `render.yaml` define una instancia con disco persistente para el MVP de propietario único.
- `ClipForge Render Runtime` ya verificó build Docker, binarios y arranque/health del runtime completo.

## PRUEBAS

- lint: OK.
- typecheck: OK.
- tests unitarios: OK.
- build Next.js: OK.
- Phase 1 E2E: OK.
- Clip render E2E: OK.
- Auto Focus E2E: OK.
- News Mode E2E: OK.
- Whisper E2E: verificado en workflow dedicado.
- Último `main` verificado por `ClipForge CI`: run `36057286731`, SUCCESS.
- Producción Vercel correspondiente: `dpl_iWsHt8bqTt5W4wyfhPV6rZc7drZp`, READY.

## LO ÚNICO QUE FALTA PARA ACTIVAR PRODUCCIÓN COMPLETA

Requiere infraestructura, cuentas o secretos reales del propietario; no debe resolverse inventando valores:

- provisionar/aprobar el servicio Render (o equivalente) con disco persistente a partir de `render.yaml`;
- definir `CLIPFORGE_OWNER_ACCESS_KEY` para ese runtime;
- crear/configurar o aprobar las apps de TikTok, Google/YouTube y Meta;
- registrar los redirect URI HTTPS y secretos OAuth reales;
- conectar cuentas en `/connections`;
- hacer una publicación controlada por plataforma para validar el flujo externo en vivo.

## MEJORAS POST-MVP

No bloquean empezar a trabajar con ClipForge:

- Active-speaker multi-persona con detección visual/face tracking real. Auto Focus V1 sí funciona, pero no afirma saber cuál de varias caras habla.
- Persistencia/colas/objetos compartidos y aislamiento multi-tenant para escalar como SaaS.
- Analytics adicionales de TikTok/Facebook donde las APIs y scopes lo permitan.
- Webhooks/n8n opcionales.
- Mejoras de TTS, B-roll y modelos de análisis.

## LIMITACIONES EXPLÍCITAS

- `Channel.userId` permanece `null` en el modo propietario único.
- El filesystem persistente de una sola instancia es adecuado para el MVP de un dueño, no para escalar horizontalmente.
- News Mode no descarga material protegido de terceros ni inventa hechos ausentes en la fuente.
- Ninguna publicación real de terceros se declara verificada sin OAuth y una prueba autorizada.
