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


## Clip Engine — render vertical real

`ClipService` transforma un candidato persistido en un `ClipRecord` no destructivo. El video fuente nunca se sobrescribe.

`RenderService` ejecuta FFmpeg con argumentos separados y `shell: false`. El primer perfil de salida es MP4 H.264 + AAC, `yuv420p`, `faststart` y resolución 1080×1920.

Encuadres iniciales:

- `FILL`: escala conservando proporción y recorta al centro hasta llenar 9:16.
- `FIT`: conserva el cuadro completo y añade padding negro hasta 9:16.

Calidades iniciales:

- `FAST`: preset ultrafast, CRF 28.
- `BALANCED`: preset medium, CRF 23.
- `HIGH`: preset slow, CRF 20.

El render no se ejecuta dentro de una petición HTTP. La API crea o reutiliza el clip y encola `RENDER_CLIP`. `render-worker.mjs` reclama el trabajo, persiste progreso real de FFmpeg y marca el clip READY o FAILED.

Los archivos se guardan en:

`storage/clips/{projectId}/{clipId}/render.mp4`

y se sirven mediante una ruta de streaming con soporte HTTP Range.

La prueba de render debe verificar:

1. salida MP4 real;
2. resolución 1080×1920 con ffprobe;
3. duración esperada;
4. archivo no vacío;
5. fuente original sin modificaciones;
6. reutilización del render READY.


## Subtítulos editables

`SubtitleService` crea una pista de subtítulos clip-local a partir de la transcripción ya persistida. Si Whisper entregó timestamps por palabra, los conserva y agrupa en cues cortos. Si solo existen segmentos, divide el texto proporcionalmente sin inventar palabras ni tiempos externos al segmento.

Cada cue guarda `startTime`, `endTime`, `text` y opcionalmente palabras. Los tiempos son relativos al inicio del clip, lo que permite editar texto y timing sin modificar el video fuente.

Estilos iniciales:

- `CLEAN`: texto legible y discreto.
- `VIRAL`: tipografía más grande y contorno fuerte.
- `KARAOKE`: usa tags ASS `\\k` cuando existen timestamps por palabra; si una edición manual invalida esos timestamps, el cue se renderiza como texto normal en vez de fingir sincronización.

Los subtítulos se escriben en ASS dentro del directorio interno del clip y FFmpeg los quema después del encuadre 9:16. Cambiar texto, timing, estilo o estado enabled invalida el render previo y obliga a producir un nuevo MP4, manteniendo el original intacto.

La UI permite generar, activar/desactivar, escoger estilo y editar texto/inicio/final. Al guardar, se encola un nuevo `RENDER_CLIP`.
