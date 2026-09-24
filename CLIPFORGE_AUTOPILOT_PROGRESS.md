# ClipForge Autopilot — progreso

## ESTADO ACTUAL

ClipForge ya tiene un flujo real y comprobable desde la ingesta hasta la preparación/publicación programada. No se consideran completadas las integraciones que dependan de credenciales externas hasta probarlas con cuentas autorizadas reales.

## COMPLETADO Y VERIFICADO

### Ingesta y medios

- Upload real MP4/MOV/WebM por streaming, con límite de tamaño y validación de nombre/MIME/extensión.
- FFprobe real para duración, resolución, FPS y códecs.
- FFmpeg real para poster y renders.
- Reproducción del original y renders con HTTP Range.
- Persistencia local actual por JSON + archivos.
- Rutas y parámetros validados; procesos multimedia se ejecutan sin `shell: true`.

### Transcripción y análisis

- Worker independiente de Whisper CLI.
- Transcript + TranscriptSegment con tiempos reales.
- Idempotencia de transcripciones vigentes.
- ContentAnalysisService y TranscriptCandidateProvider.
- ViralScore 0–100 con razones; `audioEnergy` permanece `null` mientras no exista una señal de audio medida.
- Provider OpenAI opcional con Responses API estructurada.
- Uso de tokens de OpenAI registrado cuando la respuesta devuelve `usage`; no se inventan precios ni costos ausentes.

### Clips, subtítulos y edición

- Clip Engine real 9:16 1080×1920 H.264/AAC.
- Modos FILL/FIT y calidades FAST/BALANCED/HIGH.
- CLEAN/VIRAL/KARAOKE con edición de texto y tiempos.
- Auto Edit heurístico y provider OpenAI opcional.
- Auto Focus V1 reactivo a voz a partir de TranscriptSegment.
- Auto Focus aplica zoom FFmpeg progresivo sin modificar el original.
- La V1 de Auto Focus no afirma identificar cuál de varias caras está hablando.

### News Mode

- Resumen extractivo desde la transcripción, sin inventar hechos fuera de la fuente.
- Categoría, titular, resumen, evidencia fuente y plantilla.
- TTS real con `espeak-ng` mediante worker separado.
- Render vertical narrado 1080×1920 con FFmpeg.
- Poster real del proyecto como recurso visual de la V1.

### Canales, Autopilot y publicaciones

- ChannelRecord para TikTok, YouTube y Facebook.
- ChannelStrategy por canal.
- AutopilotConfig y worker de orquestación.
- Flujo de dependencias transcripción → análisis → Auto Edit → render → publicación.
- PublicationRecord con aprobación, programación y estados de publicación.
- Scheduler con timezone, límites diarios y horarios preferidos.
- PUBLISH_POST y publishing worker.
- CredentialVault AES-256-GCM para credenciales OAuth server-side.
- Providers oficiales implementados para TikTok, YouTube y Facebook, con fallos cerrados cuando faltan permisos/credenciales.
- TikTok exige consentimiento explícito, privacidad válida y URL HTTPS verificada para Direct Post.
- YouTube usa subida reanudable y no marca `uploaded` como publicado hasta completar procesamiento.
- Facebook Reels usa sesión de subida de Page y versión Graph configurada explícitamente.
- Código/provider tests verificados; publicación real todavía requiere cuentas/apps OAuth autorizadas.

### Analytics, aprendizaje y costos

- AnalyticsRepository y AnalyticsService normalizados.
- Métricas soportadas se guardan solo cuando existen; no se fabrican métricas ausentes.
- `FETCH_ANALYTICS` añadido a JobStore con idempotencia por publicación.
- Analytics worker separado con refresco periódico configurable.
- YouTubeProvider obtiene estadísticas reales de video para vistas, likes y comentarios.
- Providers sin analytics implementado se omiten explícitamente en lugar de simular datos.
- PerformanceAnalyzer correlaciona duración, estilo de subtítulos, plataforma y resultados observados.
- Recomendaciones requieren evidencia mínima y no cambian silenciosamente la estrategia.
- AIUsageService registra provider/model/operación/tokens y costo únicamente si el costo fue proporcionado.
- `/autopilot` muestra datos persistidos reales: canales, aprobaciones, programaciones, errores, analytics, recomendaciones y uso IA.

### Live manual

- Captura manual mediante `getDisplayMedia` + `MediaRecorder` cuando el navegador lo soporta.
- El usuario debe autorizar explícitamente la pantalla/ventana/pestaña.
- Botones comenzar/terminar, preview local y validación de upload.
- La captura entra al mismo proyecto real y puede iniciar Autopilot.
- Compatibilidad depende del navegador/dispositivo; no se simula soporte donde no existe.

### Pruebas

- lint: OK.
- typecheck: OK.
- tests unitarios: OK.
- build Next.js: OK.
- Phase 1 E2E: OK.
- Clip render E2E: OK.
- Auto Focus E2E: OK.
- News Mode E2E: OK.
- Whisper E2E en GitHub Actions: OK en el bloque principal previamente integrado.

## PENDIENTE DE CÓDIGO

- OAuth web completo para conectar/desconectar cuentas desde la UI y refrescar tokens automáticamente.
- Analytics oficial adicional para plataformas donde la app y sus permisos lo permitan.
- Active-speaker multi-persona con detección visual/face tracking real.
- Autenticación de usuarios de ClipForge y aislamiento multiusuario.
- Persistencia/cola/almacenamiento durables para producción multi-instancia.
- Webhooks/n8n opcionales.

## REQUIERE CONFIGURACIÓN O ACCIÓN EXTERNA

- Crear/configurar las apps de TikTok, Google/YouTube y Meta y aprobar los permisos/scopes requeridos.
- Registrar redirect URIs y completar OAuth con cuentas reales.
- Proporcionar secretos mediante variables de entorno server-side; nunca se guardan en Git.
- Elegir/provisionar un worker persistente con FFmpeg, FFprobe, Whisper y TTS.
- Proporcionar almacenamiento duradero compartido para producción.
- Resolver límites externos de despliegue si Vercel bloquea builds por cuota/rate limit.

## LIMITACIONES QUE NO SE OCULTAN

- `Channel.userId` continúa `null` hasta implementar autenticación real.
- JSON local no ofrece aislamiento multiusuario ni operación segura multi-instancia.
- Vercel no debe ejecutar el trabajo pesado definitivo de FFmpeg/Whisper/TTS.
- Auto Focus V1 reacciona a voz, pero no identifica visualmente al hablante entre varias personas.
- News Mode V1 no verifica hechos contra Internet ni descarga material de medios de terceros.
- Los providers de publicación están probados con mocks/contratos; no se afirma publicación real sin OAuth y cuentas autorizadas.
