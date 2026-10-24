# Recuperación e integración local — 24 de octubre de 2026

## Base verificable

Aplicación raíz de `tg321920-netizen/Clip.thomas`; la carpeta histórica `clipforge/` no se modifica.

| Rama inspeccionada | HEAD remoto observado | Comparación con main |
| --- | --- | --- |
| main | `f3d8ca33fd57452d475898fdf3adac4be210087c` | Base inicial; verify: 158/158 |
| codex/clipforge-agent-foundation | `6d109f0ace41b3fa6008c82d45b0ae3744c7c51a` | 93 commits posteriores |
| codex/clipforge-mobile-repairs-20261008 | `96413120c9acbc2b6c71ee77af7b1bf902e9f310` | 110 commits posteriores |
| codex/clipforge-core-rescue | `e1045dfae859e773ac65f4b12b1ef1ed10e20a3a` | 115 commits posteriores; incluye mobile + cinco reparaciones de ingesta |

Se revisaron log, estado y diferencias antes de crear `codex/clipforge-finalization-live-clipping-20261024` desde core-rescue. No hubo merges masivos, cherry-picks, reset, push ni cambios a main. Verify de la base elegida: 287 aprobadas, 1 omitida audiovisual, 0 fallidas. `7074082a4fbfb38119d40f8e8428872215386924` no existe en los objetos descargados y no se utilizó.

Main fija Next 16.3.5; base de integración fija Next/eslint-config-next 16.3.8 y React/React DOM 19.2.8. Se conservan esas versiones. Geist local evita descargar fuentes al compilar. Archiver permite ZIP por streaming. Playwright es dependencia de desarrollo para las comprobaciones móviles. Undici utiliza el proxy heredado para las APIs oficiales; requiere Node >=22.19.0 (la máquina probada usa 24.19.0).

## Diagnóstico y correcciones

1. La recuperación de captura usaba cantidad de archivos × duración nominal: sustituido por FFprobe; VOD/local reanuda desde tiempo medido. Fragmentos dañados se conservan en cuarentena y no se concatenan.
2. La autorización del usuario solo estaba en la UI: las dos entradas de ingesta ahora la exigen también en servidor.
3. Faltaba cancelación de ingesta: marca persistente, señal al proceso y protección ante completados/errores atrasados; reintento explícito conserva segmentos.
4. Los segmentos solo se analizaban al terminar la grabación: los cerrados ahora pueden generar fuentes y trabajos MEDIA_CLIPS mientras sigue la captura. El último fragmento se entrega al cerrar. Un final demasiado corto queda como fuente, sin inventar un clip.
5. Límite de captura comprobado durante la grabación y reserva de espacio libre. No se guarda la transmisión completa en RAM. Los intentos por caídas de worker también respetan maxAttempts, y reanudar espera a que el recorder cancelado libere su lock. El límite de 1 GB es deliberado: esto no promete 24/7 ilimitado.
6. BestClips combina transcripción completa, RMS y actividad visual medida. Cinco perfiles léxicos y señales ausentes explícitas. No se interpreta ruido/cortes como prueba de emociones o jugadas.
7. Checkpoint tras cada render validado; repetir un trabajo conserva IDs y reutiliza los archivos válidos.
8. ZIP de clips terminados por streaming, sin cargar los videos completos en memoria.
9. La captura manual consultaba capacidades de navegador durante el primer render: corregida la diferencia de hidratación servidor/cliente.

## Evidencia local

- `npm ci`, lint, typecheck y build de producción pasaron. Suite final: **298 aprobadas, 0 fallidas, 0 omitidas**, con CLIPFORGE_RUN_MEDIA_TESTS=true. Son resultados locales; no se atribuyen a CI remoto.
- phase1:e2e, render:e2e, reframe:e2e, autoedit:e2e, news:e2e y owned-content:e2e pasaron; publicación externa no ejecutada.
- Whisper.cpp real pasó transcription-e2e. Modelo tiny verificado con SHA-256 `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21` de su puntero LFS oficial.
- `node scripts/live-clipping-e2e.mjs`: narración propia sintetizada de 184,911 s → transcripción real → tres clips distintos de 31,68 / 31,78 / 27,92 s. MP4 H.264/AAC, 1080×1920, decodificación completa, subtítulos y original conservado por SHA-256. ZIP leído y CRC comprobado con Python zipfile. No es una grabación de un streamer ni prueba de reconocimiento de rostros.
- OCR de fotograma en tiempo de cue aprobado tras instalar spa.traineddata de Tesseract; fotograma revisado visualmente. Whisper tiny comete errores de palabras: se mantiene revisión editorial pendiente.
- Recuperación: tres renders ya validados se reutilizaron sin ejecutar otro render. Captura local segmentada de 60 s: dos trabajos únicos, fuente conservada, reanudación medida y reintento sin duplicados.
- Chromium móvil 393×851: entrada de URL, estado sin configurar, autorización, cancelación/reanudación, ausencia de desbordamiento horizontal y ausencia de errores JavaScript aprobados.
- Supervisor web + workers comprobado; /api/health devolvió status=ok, mediaReady=true y publishing=OFF.
- Lectura oficial del OpenAPI de Kick por el proxy: HTTP 200. No equivale a autorización de una cuenta.
- Descarga HTTP comprobada: ZIP de 14.117.333 bytes, MP4 con Range 206 y 1024 bytes solicitados, y rechazo 400 de ingesta sin autorización.
- `artifacts/live-clipping/` contiene MP4, ZIP, evidencia y fotogramas generados. Está ignorado por Git.

## Ejecutar y reproducir

En el entorno preparado, `source /workspace/clipforge-tools/activate.sh`. Instalar con `npm ci`; compilar con `CLIPFORGE_REDIS_URL= REDIS_URL= npm run build`. Para ejecutar, web y workers deben compartir el mismo CLIPFORGE_STORAGE_DIR.

```bash
source /workspace/clipforge-tools/activate.sh
cd /workspace/Clip.thomas
PORT=3000 node scripts/render-runtime-free.mjs
```

Ese supervisor inicia web/ingesta y procesa workers en serie para limitar CPU. Publicación está bloqueada por `lib/publishing-policy.mjs`, además de los tres switches en false. No se habilitan el agente ni demos al arrancar.

```bash
CLIPFORGE_RUN_MEDIA_TESTS=true npm run verify
node scripts/live-clipping-e2e.mjs
CLIPFORGE_TEST_BASE_URL=http://127.0.0.1:3000 CHROMIUM_PATH=/usr/bin/chromium node scripts/mobile-live-e2e.mjs
```

La prueba móvil usa Chromium a 393×851 y respuestas explícitamente simuladas para los estados de la UI; no acredita un teléfono físico ni una cuenta conectada.

## Límites y pendientes de la misión completa

- Falta una URL concreta propia/autorizada para validar captura externa de Kick/Twitch/YouTube. No se capturó material de terceros arbitrario. Los adaptadores oficiales no están validados con cuentas reales: faltan sus credenciales en esta máquina.
- La selección automática incremental genera **un clip por segmento**. No hay deduplicación visual entre segmentos ni contexto de transcripción cruzando su límite. El conteo configurable 1–10 aplica al flujo de videos existentes.
- Final de fuente finita se procesa al cerrar FFmpeg; no se descubre ni descarga automáticamente un VOD posterior de la plataforma. Requiere enlace VOD autorizado explícito.
- Auto Focus existente es zoom por actividad de voz centrado, **no** seguimiento visual del hablante. Tracking multipersona/active speaker y podcast dividido automático siguen pendientes; no se copió un motor AGPL para aparentarlos.
- La recuperación comprobada requiere conservar el filesystem. Redis no almacena los MP4. Render gratuito usa `/tmp/clipforge` y no garantiza persistencia ni ejecución continua.
- `CLIPFORGE_REDIS_URL` y `REDIS_URL` no están configurados aquí; no hay conector Render/Vercel disponible. No fue posible comprobar vencimiento, suspensión, backups ni salud de una base de datos remota. No se asume que esté disponible.
- No se hicieron llamadas pagadas Z.ai; faltan sus credenciales/modelo aquí. Se conserva ZaiAgentProvider y el endpoint general existente.
- No se modificaron despliegues, planes ni datos de producción. No se ejecutó GitHub Actions remoto ni se publicó esta rama. No se promete que la misión completa esté terminada.

Se leyeron AGENTS, README, PROJECT_PLAN, CLIPFORGE_AUTOPILOT_PROGRESS, CODEX_HANDOFF y handoffs/documentación disponibles. `ZCODE_EXTERNAL_CONTRACT.md` y `FUTURE_CHANNELS_AND_MARKETING.md` no están presentes en la base elegida; las referencias antiguas no se presentan como archivos existentes.

## Inventario efectivo reutilizado

| Componente | Ruta |
| --- | --- |
| VideoProcessor | `services/VideoProcessor.ts` |
| ProjectStore | `services/ProjectStore.ts` |
| UrlIngestService | `services/ingest/UrlIngestService.mjs` |
| IngestJobStore | `services/ingest/IngestJobStore.mjs` |
| AudioExtractor | `services/transcription/AudioExtractor.mjs` |
| TranscriptionService | `services/transcription/TranscriptionService.mjs` |
| WhisperCliProvider | `services/transcription/WhisperCliProvider.mjs` |
| WhisperCppProvider | `services/transcription/WhisperCppProvider.mjs` |
| ContentAnalysisService | `services/analysis/ContentAnalysisService.mjs` |
| TranscriptCandidateProvider | `services/analysis/TranscriptCandidateProvider.mjs` |
| ViralScoreService | `services/analysis/ViralScoreService.mjs` |
| ClipService | `services/clip/ClipService.mjs` |
| RenderService | `services/clip/RenderService.mjs` |
| AutoEditService | `services/autoedit/AutoEditService.mjs` |
| AutoEditBatchService | `services/autoedit/AutoEditBatchService.mjs` |
| AutoReframeService | `services/reframe/AutoReframeService.mjs` |
| SubtitleService | `services/subtitles/SubtitleService.mjs` |
| ContentFactoryService | `services/content-factory/ContentFactoryService.mjs` |
| NewsService | `services/news/NewsService.mjs` |
| NewsSummaryService | `services/news/NewsSummaryService.mjs` |
| NewsRenderService | `services/news/NewsRenderService.mjs` |
| TrendHunterService | `services/owned-content/TrendHunterService.mjs` |
| ResearchEngine | `services/owned-content/ResearchEngine.mjs` |
| CoherenceGate | `services/owned-content/CoherenceGate.mjs` |
| RightsGuard | `services/owned-content/RightsGuard.mjs` |
| OriginalNewsScriptService | `services/owned-content/OriginalNewsScriptService.mjs` |
| AudioEngine | `services/owned-content/AudioEngine.mjs` |
| VisualAssemblyService | `services/owned-content/VisualAssemblyService.mjs` |
| AutopilotService | `services/autopilot/AutopilotService.mjs` |
| WorkflowService | `services/workflows/WorkflowService.mjs` |
| AgentRuntimeService | `services/agent/AgentRuntimeService.mjs` |
| AgentOrchestrator | `services/agent/AgentOrchestrator.mjs` |
| AgentToolRegistry | `services/agent/AgentToolRegistry.mjs` |
| AutonomyPolicy | `services/agent/AutonomyPolicy.mjs` |
| AgentProvider | `services/agent/AgentProvider.mjs` |
| ZaiAgentProvider | `services/agent/providers/ZaiAgentProvider.mjs` |
| PublicationService | `services/publications/PublicationService.mjs` |
| SchedulerService | `services/scheduler/SchedulerService.mjs` |
| PublishingService | `services/publishing/PublishingService.mjs` |
| SocialPublishingRouter | `services/publishing/connectors/SocialPublishingRouter.mjs` |
| OAuthConnectionService | `services/oauth/OAuthConnectionService.mjs` |
| CredentialVault | `services/security/CredentialVault.mjs` |
| ApprovalService | `services/approvals/ApprovalService.mjs` |
| BrandService | `services/branding/BrandService.mjs` |
| AnalyticsCollectorService | `services/analytics/AnalyticsCollectorService.mjs` |
| AnalyticsService | `services/analytics/AnalyticsService.mjs` |
| PerformanceAnalyzer | `services/analytics/PerformanceAnalyzer.mjs` |
| MarketingMemoryService | `services/marketing-memory/MarketingMemoryService.mjs` |
| AIUsageService | `services/usage/AIUsageService.mjs` |

## Configuración reutilizable

Se probó el instalador idempotente del entorno (npm ci, herramientas locales y checksum) y se guardaron install_script y start_skill en el borrador. Se añadieron requisitos sin valores para KICK_ACCESS_TOKEN, TWITCH_ACCESS_TOKEN, YOUTUBE_API_KEY y TWITCH_CLIENT_ID, y switches de publicación en false. Se guardaron dominios de modelo/API/documentación conservando los presets. Guardar el borrador no publica el entorno ni valida una tarea nueva. El usuario debe revisar/guardar y publicar desde la configuración del entorno.

`.github/workflows/live-clipping-ci.yml` proporciona aceptación audiovisual manual por workflow_dispatch y artefactos; fue preparado, no ejecutado en GitHub.

## Commits de implementación de esta sesión

- `1bb617f`: cancelación persistente y duración real de captura.
- `7df6ac4`: fuentes Geist locales para build reproducible.
- `bd05e09`: señales medidas, perfiles y checkpoints de render.
- `4c1e21b`: adaptadores oficiales y procesamiento incremental de segmentos.
- `595e7d9`: ZIP por streaming, hidratación móvil y aceptación reproducible.
- `6ebb4a3`: límite de reintentos por caídas, exclusión al reanudar y proxy oficial.

La aceptación final volvió a ejecutar fuente → Whisper → tres renders → OCR → recuperación de checkpoints → ZIP: passed=true, checkpointReuse=true, OCR=true. El archivo ZIP final tiene 14.117.333 bytes. Ninguna publicación real se ejecutó.

La última observación de la política de red del runtime fue `state=unknown`; los dominios y credenciales guardados en el borrador no se presentan como requisitos ya aplicados. La evidencia de lecturas HTTP concretas y el modelo descargado no acredita una política general ni autorización de plataformas.


## Selección de cinco clips por captura

Se añadió cantidad total 1–10 al modo de directo, con 5 por defecto cuando se activa generación automática. CAPTURE analiza la grabación completa al finalizar y encola un único lote con la cantidad elegida. El modo incremental SEGMENTS mantiene un clip por segmento como opción separada; sus cantidades no se confunden con el total de una captura.

La prueba `source /workspace/clipforge-tools/activate.sh; node scripts/live-five-clips-e2e.mjs` usa una fuente propia ya generada por live-clipping-e2e: captura segmentada de 180 s → fuente → JobStore → media worker → Whisper → cinco MP4 distintos de 1080×1920 H.264/AAC con audio. Permite `--resume` para recuperar su ejecución guardada, sin repetir captura ni renders válidos. No llama a una plataforma.

La primera ejecución detectó timestamps de Whisper posteriores al final del medio y falló correctamente al validar un render incompleto. Se limitan ahora los tiempos de segmentos/palabras a la duración medida de la fuente, con marca timingAdjustedToSource; también se limita la selección sobre transcripciones previamente guardadas. La evidencia final contiene cinco archivos validados de 31,64 / 28,48 / 29,56 / 30,08 / 30,80 s, sin solapamientos. La marca de tiempo ajustada no garantiza exactitud lingüística: sigue pendiente la revisión editorial.

Se excluyen `artifacts/` y `storage/` de ESLint y TypeScript: los segmentos MPEG-TS generados tienen extensión .ts pero no son código TypeScript. Suite y build: 303 aprobadas, 0 fallidas, 0 omitidas. Evidencia en `artifacts/live-five-clips/evidence.json`.
