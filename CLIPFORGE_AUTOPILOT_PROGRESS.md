# ClipForge Autopilot — progreso

## COMPLETADO

- Inspección del repositorio actual.
- App canónica identificada en la raíz.
- Upload real MP4/MOV/WebM.
- Validación de archivos.
- FFprobe real para metadatos.
- FFmpeg real para miniaturas.
- Reproducción con HTTP Range.
- Persistencia actual por JSON + archivos locales.
- Pruebas de upload, project id y HTTP Range.
- Contrato inicial de Transcript y TranscriptSegment.
- Cola de jobs local/file-based para TRANSCRIBE_VIDEO.
- Worker independiente de transcripción.
- Adapter local para Whisper CLI.
- API idempotente para encolar y consultar transcripciones.

## EN PROGRESO

- Validación de AutopilotConfig, orquestación por proyecto y worker de ciclos.

## COMPLETADO RECIENTE

- AutopilotConfig persistido con modo MANUAL/AUTOPILOT: implementado.
- approvalRequired=true por defecto: implementado.
- Configuración de postsPerDay, plataformas, horarios, analytics y learning: implementada.
- AutopilotService encola solo la siguiente dependencia faltante: implementado.
- Recuperación de artefactos faltantes aunque un job anterior figure COMPLETED: implementada.
- Worker Autopilot separado de HTTP: implementado.
- API de configuración y avance manual por proyecto: implementadas.
- Selección de canales elegibles respeta plataforma, estado, publishingEnabled y dailyLimit: implementada.
- Channels + ChannelStrategy verificados con lint, typecheck, tests, build, Phase 1 E2E y render E2E: OK.
- ChannelRecord para TikTok, YouTube y Facebook: implementado.
- ChannelStrategy por canal: implementado.
- Configuración de timezone, dailyLimit, publishingEnabled y estado: implementada.
- Reglas editoriales independientes por canal: implementadas.
- ChannelRepository file-based reemplazable: implementado.
- APIs para listar/crear/editar/eliminar canales y editar estrategia: implementadas.
- Validación de plataforma, timezone, límites y estado: implementada.
- No se almacenan tokens OAuth ni secretos en ChannelRecord.
- AutoEditService separado de UI: implementado.
- HeuristicAutoEditProvider local sin coste externo: implementado.
- OpenAIAutoEditProvider opcional con Responses API estructurada: implementado.
- Selección de candidato, timing validado, hook, título, descripción, hashtags y texto en pantalla: implementados.
- Recomendación multicanal y estilo de subtítulos: implementados.
- Job AUTO_EDIT, worker independiente y encadenado a RENDER_CLIP: implementados.
- API GET/POST de Auto Edit: implementada.
- UI para iniciar y seguir Auto Edit: implementada.
- Auto Edit verificado con lint, typecheck, tests, build, Phase 1 E2E y render E2E: OK.
- SubtitleService con cues derivados de TranscriptSegment/word timestamps: implementado.
- Edición de texto y tiempos con validación: implementada.
- Estilos CLEAN/VIRAL/KARAOKE en ASS: implementados.
- Activación/desactivación de subtítulos: implementada.
- Render FFmpeg con subtítulos quemados sin tocar el original: implementado.
- UI de generación/edición/guardado y rerender: implementada.
- API GET/POST/PATCH de subtítulos por clip: implementada.
- Fase de subtítulos verificada con lint, typecheck, tests, build, Phase 1 E2E y render E2E con ASS/KARAOKE: OK.
- ClipService para convertir candidatos reales en clips persistidos: implementado.
- RenderService FFmpeg 9:16 con FILL/FIT y calidades FAST/BALANCED/HIGH: implementado.
- RENDER_CLIP con worker separado y progreso derivado de FFmpeg: implementado.
- Streaming HTTP Range de clips renderizados: implementado.
- UI para crear y previsualizar clips desde candidatos: implementada.
- Prueba E2E de render vertical y preservación del original: OK.
- Clip Engine verificado con lint, typecheck, tests, build, Phase 1 E2E y render E2E: OK.
- ContentAnalysisService separado de UI: implementado.
- TranscriptCandidateProvider con ventanas sobre TranscriptSegment: implementado.
- ViralScore 0–100 con componentes y razones: implementado.
- audioEnergy permanece null hasta existir AudioAnalyzer; no se inventa señal.
- Job ANALYZE_VIDEO y worker independiente: implementados.
- API de análisis idempotente: implementada.
- lint: OK.
- typecheck: OK.
- tests unitarios: OK.
- build Next.js: OK.
- Fase 1 end-to-end (upload + FFprobe + FFmpeg + playback + persistencia): OK.
- Whisper CLI instalado y ejecutado realmente en GitHub Actions: OK.
- Video con voz sintética procesado de extremo a extremo: OK.
- Audio extraído con FFmpeg: OK.
- Transcript persistido: OK.
- TranscriptSegment con startTime/endTime/text: OK.
- Job TRANSCRIBE_VIDEO completado: OK.
- Reutilización/idempotencia de una transcripción vigente: OK.

## PENDIENTE

- Autopilot: validación final de esta fase.
- Cola de jobs generalizada/durable.
- Scheduler.
- Publishing providers oficiales.
- Publication.
- Analytics.
- PerformanceAnalyzer.
- Dashboard /autopilot.
- AIUsage/cost control.
- Autenticación y aislamiento multiusuario.
- Webhooks opcionales para n8n.

## BLOQUEADO

- El repositorio no tiene actualmente base de datos ni autenticación.
- Channel.userId permanece null en modo local hasta introducir auth real; no se finge un usuario.
- Vercel no es el worker de video/Whisper definitivo.
- El runtime de producción todavía necesita un worker persistente con FFmpeg + Whisper instalado.
- El proveedor OpenAI es opcional y requiere credenciales reales fuera del repositorio.
- Vercel no debe usarse como worker pesado definitivo.

## SIGUIENTE PASO

1. Ejecutar lint, typecheck, tests y build con Autopilot core.
2. Corregir cualquier fallo antes de avanzar.
3. Implementar Publication + Scheduler con idempotencia y approvalRequired.
4. Añadir providers oficiales detrás de una interfaz común sin inventar credenciales.
5. Mantener publicación real desactivada hasta existir OAuth/scopes autorizados.
