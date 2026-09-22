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

- Inicio de la fase de subtítulos editables y estilos.

## COMPLETADO RECIENTE

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

- Subtítulos editables.
- AutoEditService.
- Channels y ChannelStrategy.
- Autopilot.
- Cola de jobs generalizada.
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
- Vercel no es el worker de video/Whisper definitivo.
- El runtime de producción todavía necesita un worker persistente con FFmpeg + Whisper instalado.
- El repositorio todavía no tiene credencial/proveedor de IA configurado para ejecutar el AI Content Analyzer contra un modelo externo.
- Vercel no debe usarse como worker pesado definitivo.

## SIGUIENTE PASO

1. Generar pistas de subtítulos desde TranscriptSegment y timestamps de palabras cuando existan.
2. Permitir edición de texto y tiempos, activación/desactivación y estilos CLEAN/VIRAL/KARAOKE.
3. Quemar subtítulos en FFmpeg mediante ASS sin alterar el original.
4. Invalidar y volver a renderizar el clip cuando cambien los subtítulos.
5. Probar lint, typecheck, tests, build y render E2E antes de avanzar a Auto Edit.
