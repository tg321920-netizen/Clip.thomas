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

Antes de Publishing/multiusuario será necesario escoger persistencia durable y autenticación. La implementación local actual mantiene interfaces separadas para poder migrar sin reescribir la lógica de negocio.

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

La prueba de render verifica salida MP4 real, resolución 1080×1920, duración, archivo no vacío, fuente original intacta y reutilización de renders READY.

## Subtítulos editables

`SubtitleService` crea una pista de subtítulos clip-local a partir de la transcripción ya persistida. Si Whisper entregó timestamps por palabra, los conserva y agrupa en cues cortos. Si solo existen segmentos, divide el texto proporcionalmente sin inventar palabras ni tiempos externos al segmento.

Cada cue guarda `startTime`, `endTime`, `text` y opcionalmente palabras. Los tiempos son relativos al inicio del clip, lo que permite editar texto y timing sin modificar el video fuente.

Estilos iniciales:

- `CLEAN`: texto legible y discreto.
- `VIRAL`: tipografía más grande y contorno fuerte.
- `KARAOKE`: usa tags ASS `\\k` cuando existen timestamps por palabra; si una edición manual invalida esos timestamps, el cue se renderiza como texto normal en vez de fingir sincronización.

Los subtítulos se escriben en ASS dentro del directorio interno del clip y FFmpeg los quema después del encuadre 9:16. Cambiar texto, timing, estilo o estado enabled invalida el render previo y obliga a producir un nuevo MP4, manteniendo el original intacto.

## Auto Edit

`AutoEditService` vive fuera de la UI y trabaja sobre candidatos ya persistidos. Su responsabilidad es seleccionar un candidato válido, limitar cualquier ajuste de inicio/final a los límites reales de ese candidato y preparar metadata/editorial antes del render.

Providers iniciales:

- `HeuristicAutoEditProvider`: funciona sin API externa y usa ViralScore, transcript y timestamps disponibles.
- `OpenAIAutoEditProvider`: opcional, usa Responses API con salida JSON estructurada. Solo puede escoger IDs de candidatos suministrados; el servicio vuelve a validar ID y tiempos antes de persistir.

El plan persistido en `clip.autoEdit` incluye provider/modelo, candidateId, start/end, título, hook, descripción, hashtags, texto en pantalla, plataformas recomendadas, estilo de subtítulos, framing y calidad.

La idempotencia se basa en analysis/transcript/provider/model/candidato solicitado. Un Auto Edit vigente se reutiliza para evitar llamadas repetidas de IA. Si faltan subtítulos en un resultado reutilizado, se regeneran antes de continuar.

`AUTO_EDIT` es un job independiente. `autoedit-worker.mjs` prepara el clip, genera subtítulos y luego encola `RENDER_CLIP`; no mantiene una petición HTTP abierta.

## Channels y estrategia editorial

`ChannelService` introduce la configuración multicanal sin mezclar OAuth ni publicación todavía. Las plataformas iniciales son `TIKTOK`, `YOUTUBE` y `FACEBOOK` y el enum puede extenderse después.

Cada `ChannelRecord` guarda `id`, `userId`, plataforma, nombre, cuenta externa opcional, estado, `publishingEnabled`, `dailyLimit`, timezone IANA y timestamps.

`ChannelStrategy` pertenece a un canal y mantiene instrucciones editoriales independientes: nombre, descripción, `systemPrompt`, duración preferida, límite diario, temas preferidos y temas a evitar.

La persistencia actual vive en `storage/channels/{channelId}.json` detrás de `ChannelRepository`. Esa capa es deliberadamente reemplazable por una base de datos más adelante.

No se guardan access tokens, refresh tokens, API keys ni secretos dentro de ChannelRecord. `publishingEnabled` solo puede activarse cuando el canal está marcado `CONNECTED`; la conexión OAuth real se implementará en los publishing providers oficiales.

## Autopilot core

`AutopilotConfig` mantiene el modo general del sistema:

- `enabled`;
- `mode`: `MANUAL` o `AUTOPILOT`;
- `approvalRequired` (por defecto `true`);
- `postsPerDay`;
- plataformas activas;
- horarios preferidos;
- `analyticsEnabled`;
- `learningEnabled`.

La configuración se persiste de forma atómica en `storage/autopilot/config.json` mediante `AutopilotRepository`.

`AutopilotService.advanceProject()` nunca ejecuta procesamiento pesado dentro de HTTP. Inspecciona el estado persistido del proyecto y encola únicamente la siguiente dependencia que falta:

1. sin transcript válido → `TRANSCRIBE_VIDEO`;
2. con transcript pero sin análisis válido → `ANALYZE_VIDEO`;
3. con análisis pero sin Auto Edit → `AUTO_EDIT`;
4. con clip Auto Edit sin render READY → `RENDER_CLIP`;
5. con clip READY → `READY_FOR_PUBLICATION`.

Si un job previo figura COMPLETED pero falta su artefacto persistido, Autopilot reinicia ese job de forma explícita para no quedar bloqueado en un estado falso.

`autopilot-worker.mjs` recorre los proyectos desde almacenamiento y avanza cada uno por ciclos cortos. El modo manual puede invocar una sola transición mediante API sin activar el worker automático.

Autopilot todavía no publica por sí mismo. La transición `READY_FOR_PUBLICATION` entrega el clip y los canales elegibles a la próxima capa `Publication + Scheduler`. Esto conserva `approvalRequired=true` y evita fingir conectividad con plataformas antes de implementar OAuth/providers oficiales.
