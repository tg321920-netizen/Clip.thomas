# ClipForge Autopilot — progreso

## ESTADO ACTUAL

ClipForge ya tiene un flujo real y comprobable desde la ingesta hasta la publicación preparada, analytics y aprendizaje. No se consideran verificadas en vivo las acciones que dependan de credenciales o aprobaciones externas hasta probarlas con cuentas reales autorizadas.

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

- Despliegues hospedados requieren sesión firmada del propietario.
- Login server-side con cookie HttpOnly, SameSite=Lax y firma HMAC-SHA256.
- Las APIs devuelven 401 sin sesión válida.
- Si faltan secretos en hosting, ClipForge falla cerrado y muestra `/setup-required` en vez de exponer la aplicación.
- Local puede permanecer abierto para desarrollo o forzar el mismo control con variable de entorno.

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

## CONFIGURACIÓN DE DESPLIEGUE

- `vercel.json` raíz fija el proyecto canónico como Next.js, `npm run build` y salida `.next` para evitar que un preset estático busque `public` como output final.
- Los dos proyectos Vercel históricos siguen necesitando una nueva ejecución exitosa antes de declarar producción lista. Los últimos deployments observados antes de esta corrección estaban en ERROR.
- Vercel no es el worker pesado definitivo: FFmpeg/Whisper/TTS requieren un proceso persistente separado.

## PENDIENTE DE CÓDIGO / INFRAESTRUCTURA

- Active-speaker multi-persona con detección visual/face tracking real.
- Sustituir JSON/archivos locales por persistencia, cola y almacenamiento compartidos/durables para producción multi-instancia.
- Autenticación multiusuario y aislamiento por tenant si ClipForge se ofrece como SaaS; el acceso del propietario actual protege un despliegue controlado de un solo dueño, no sustituye tenant isolation.
- Analytics adicional de TikTok/Facebook donde las APIs, revisión y scopes de la app lo permitan.
- Webhooks/n8n opcionales.

## REQUIERE ACCIÓN EXTERNA DEL PROPIETARIO

- Crear/configurar o aprobar las apps de TikTok, Google/YouTube y Meta con los scopes necesarios.
- Registrar los redirect URI HTTPS reales.
- Configurar en el hosting los secretos de OAuth, CredentialVault y acceso del propietario; nunca se guardan en Git.
- Conectar cuentas reales en `/connections` y ejecutar una publicación controlada para validar cada provider en vivo.
- Provisionar el worker persistente y el almacenamiento duradero de producción.

## LIMITACIONES EXPLÍCITAS

- `Channel.userId` sigue `null` en el modo actual de propietario único.
- El filesystem local no es seguro para múltiples instancias ni tenants.
- Auto Focus V1 reacciona a voz pero no identifica visualmente al hablante entre varias personas.
- News Mode V1 no descarga material protegido de medios de terceros ni inventa hechos ausentes en la fuente.
- Publicación real de terceros no se declara verificada hasta completar OAuth con credenciales reales y publicar una prueba autorizada.
