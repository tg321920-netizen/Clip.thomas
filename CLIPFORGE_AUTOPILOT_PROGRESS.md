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

- Validación CI del módulo de transcripción en rama de prueba.

- Verificación real end-to-end de Whisper sobre un video con voz.
- Confirmación de lint/typecheck/build después del módulo de transcripción.

## PENDIENTE

- AI Content Analyzer.
- Candidate/ViralScore.
- Clip Engine.
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
- La prueba Whisper real requiere un runtime/worker con Whisper CLI instalado.
- El último estado observado de Vercel estaba afectado por build-rate-limit.

## SIGUIENTE PASO

1. Ejecutar lint, typecheck y tests.
2. Ejecutar build.
3. En un worker con FFmpeg + Whisper CLI, encolar TRANSCRIBE_VIDEO y verificar:
   - audio extraído;
   - transcript persistido;
   - segmentos startTime/endTime/text;
   - idempotencia al repetir;
   - retry ante fallo.
4. Solo después iniciar AI Content Analyzer.
