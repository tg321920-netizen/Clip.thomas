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

- Preparación incremental de la siguiente fase: AI Content Analyzer.

## COMPLETADO RECIENTE

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
- El runtime de producción todavía necesita un worker persistente con FFmpeg + Whisper instalado.
- El repositorio todavía no tiene credencial/proveedor de IA configurado para ejecutar el AI Content Analyzer contra un modelo externo.
- Vercel no debe usarse como worker pesado definitivo.

## SIGUIENTE PASO

1. Implementar AI Content Analyzer como servicio/provider separado.
2. Generar candidatos solo desde TranscriptSegment y límites configurables.
3. Guardar razones y señales del ViralScore sin presentar la puntuación como garantía.
4. Añadir provider de IA configurable sin inventar credenciales.
5. Probar el analizador con provider de prueba y, cuando exista una credencial/runtime autorizado, validar una llamada real.
6. No iniciar Clip Engine hasta estabilizar esta fase.
