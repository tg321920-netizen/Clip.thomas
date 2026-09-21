# ClipForge Multi — arquitectura Autopilot

## Estado real inspeccionado

ClipForge usa Next.js, TypeScript y Tailwind. En este momento no hay base de datos, ORM, autenticación, Redis ni proveedor externo de jobs. Los proyectos se guardan como JSON y los medios viven bajo un storage configurable.

La app canónica está en la raíz. La carpeta `clipforge/` es una copia histórica y está excluida del typecheck/lint de la raíz.

## Límites actuales

- El almacenamiento local es adecuado para desarrollo/worker con volumen, no para escalar como almacenamiento final.
- No existe aislamiento por usuario porque todavía no existe autenticación.
- Los procesos pesados no deben ejecutarse dentro de una petición HTTP.
- Vercel debe considerarse frontend/API ligera; FFmpeg/Whisper/render necesitan un worker apropiado.

## Separación objetivo

- Ingest: upload, validación, source video.
- Transcription: audio + Whisper + TranscriptSegment.
- AI Analysis: candidatos y ViralScore.
- Clip Engine: FFmpeg, 9:16, overlays, audio.
- Auto Edit: metadata y decisiones de edición.
- Channels: cuentas y estrategia editorial.
- Scheduler: planificación configurable por timezone/canal.
- Publishing: providers oficiales por plataforma.
- Analytics: snapshots normalizados y datos específicos.
- Learning: PerformanceAnalyzer y recomendaciones auditables.
- Autopilot: orquestación, approvals y políticas.
- Jobs: ejecución durable, retries e idempotencia.

## Transcripción — primera implementación

La petición HTTP solo encola un job `TRANSCRIBE_VIDEO`. Un worker separado reclama el job y:

1. carga el proyecto;
2. comprueba si ya existe una transcripción vigente;
3. extrae audio WAV mono 16 kHz con FFmpeg;
4. ejecuta Whisper CLI;
5. normaliza segmentos y timestamps;
6. actualiza el JSON del proyecto de forma atómica;
7. marca el job completado o programa retry.

La cola actual es file-based porque el proyecto todavía no tiene DB/Redis. Está encapsulada para poder reemplazarla más adelante sin mezclar lógica de transcripción con UI.

## Persistencia lógica actual

`Project` sigue siendo el JSON existente.

`Video` corresponde a `project.source`.

`Transcript` se agrega como `project.transcript`.

`TranscriptSegment` vive en `project.transcript.segments[]`.

Al introducir una base de datos, estas entidades podrán migrarse sin cambiar el contrato conceptual.

## Seguridad

- No se concatenan argumentos del usuario en shell.
- FFmpeg y Whisper se ejecutan con `spawn(..., { shell: false })`.
- Las rutas se resuelven bajo `CLIPFORGE_STORAGE_DIR`.
- Los project IDs siguen validándose como UUID.
- No se añaden secretos al repositorio.

## Próxima decisión de infraestructura

Antes de Channels/Publishing/multiusuario será necesario escoger persistencia durable y autenticación. Esa decisión debe hacerse después de estabilizar el pipeline de video/transcripción, no antes.


## Content Analyzer — baseline funcional

La primera implementación de análisis no finge disponer de un modelo externo.

`TranscriptCandidateProvider` genera ventanas sobre límites reales de `TranscriptSegment`, con duración configurable y sin cortar dentro de un segmento. `ViralScoreService` calcula señales separadas para hook, interés semántico, emoción, comprensión independiente y duración.

La señal `audioEnergy` permanece en `null` hasta existir un `AudioAnalyzer`. El ViralScore se normaliza usando únicamente pesos de señales disponibles y siempre conserva un disclaimer de que no garantiza viralidad.

`ContentAnalysisService` acepta un provider por inyección. Esto permite añadir posteriormente un provider LLM sin mezclar llamadas de IA con UI ni reemplazar el baseline local.

La petición HTTP de análisis solo encola `ANALYZE_VIDEO`; `analysis-worker.mjs` ejecuta el trabajo fuera del request.
