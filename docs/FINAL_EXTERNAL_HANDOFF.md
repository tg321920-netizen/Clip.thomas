# ClipForge — verificación del núcleo, 2026-10-05

## Estado recibido

- Repositorio: `https://github.com/tg321920-netizen/Clip.thomas`.
- Rama: `codex/clipforge-agent-foundation`.
- HEAD inicial: `0e524cfae3755db73dfa27ac4771ce6ed4f1a305`.
- `git status --short` inicial vacío. No se hizo reset ni se cambió de rama.
- El commit de referencia `7074082a4fbfb38119d40f8e8428872215386924` no estaba
  disponible en el historial descargado de esta rama. No se usó como base.
- Este archivo no existía. Se leyeron `AGENTS.md`, `README.md`,
  `CODEX_HANDOFF.md` y documentación de agente, ZCode, Autopilot, publicación,
  marketing y runtime. La aplicación canónica está en la raíz; `clipforge/`
  es una copia histórica excluida de lint/typecheck y no se modificó.

## Cambios de esta sesión

1. Corregida reconexión OAuth de YouTube: solo se conserva el refresh token
   anterior cuando el nuevo consentimiento identifica el mismo canal. Si cambia
   el canal o falta la identidad anterior, se exige un refresh token nuevo antes
   de escribir credenciales o marcar la conexión. Evita cambiar silenciosamente
   de identidad al renovar acceso. Regresiones para identidad distinta/desconocida.
2. Eliminado un import sin uso detectado por lint en `UrlIngestService`.
3. Contratos futuros de negocio/campaña/métricas/`MarketingProvider` en
   `types/marketing-provider.ts`, separados de publicación orgánica. Son tipos,
   no un conector publicitario operativo. No existe método de gasto/activación.
4. Documentados contratos y comandos seguros de ZCode externo en
   `ZCODE_EXTERNAL_CONTRACT.md`, y evolución en `FUTURE_CHANNELS_AND_MARKETING.md`.

## Inventario reutilizado

| Área | Componentes existentes |
| --- | --- |
| Ingesta | VideoProcessor, ProjectStore, UrlIngestService, IngestJobStore; upload, URL y captura |
| Cola | JobStore; locks, heartbeats, idempotencia, reintentos, recuperación |
| Transcripción | AudioExtractor, TranscriptionService, WhisperCliProvider, WhisperCppProvider; chunks largos |
| Análisis/edición | ContentAnalysisService, TranscriptCandidateProvider, ViralScoreService, AutoEditService, AutoEditBatchService |
| Render | ClipService, RenderService, AutoReframeService, SubtitleService, FFmpeg/FFprobe |
| News/Factory | NewsService, NewsSummaryService, NewsRenderService, ContentFactoryService, OwnedContentWorkflowRunner |
| Editorial | TrendHunterService, ResearchEngine, CoherenceGate, RightsGuard, OriginalNewsScriptService, AudioEngine, VisualAssemblyService, ContentCostService, ContentLinePresets |
| Autonomía | AutopilotService, WorkflowService, AgentRuntimeService, AgentOrchestrator, AgentToolRegistry, AutonomyPolicy |
| IA | AgentProvider → ZaiAgentProvider; OpenAICompatibleClient; providers heurísticos conservados |
| Publicación | PublicationService, SchedulerService, PublishingService, SocialPublishingRouter, TikTok/Facebook/YouTube providers y connectors, MockPublishingProvider |
| OAuth | OAuthConnectionService, CredentialVault AES-256-GCM, callbacks server-side, estado firmado, refresh, desconexión |
| Aprobación/marca | ApprovalService, InternalNotificationService, BrandService |
| Negocios | SourceService, ExtractionService, MarketingBrainService, ProductProfileService, ContentGenerationService, MarketingEditService, MarketingWorkflowRunner, MarketingPublishingHub |
| Feedback | AnalyticsCollectorService, AnalyticsService, PerformanceAnalyzer, MarketingMemoryService, OwnedContentPerformanceService, AIUsageService |

CONVERSATION conserva `-filter_complex` con una salida `[vout]`: fondo,
encuadre, zoom, subtítulos ASS y audio coexistieron en la prueba real.

## Verificación local

Dependencias instaladas con `npm ci`, sin cambiar lockfile ni versiones. Node
24.19.0, Next 16.3.8; CI configura Node 22. FFmpeg/FFprobe del entorno. eSpeak NG
1.52 y Whisper.cpp se prepararon fuera del repositorio. Whisper usa el mismo
commit fijado por el build de Render (`d09f61a708f3487afa956ff578e60eae5e7a233c`)
y modelo multilingüe tiny. No se instalaron servicios de pago.

| Comprobación | Resultado |
| --- | --- |
| lint | OK, sin advertencias después de corregir import |
| typecheck | OK |
| tests | 210 aprobadas, 0 fallidas |
| build inicial y final | OK, Next production build; el final incluye las correcciones |
| phase1:e2e | OK, servidor real, upload, metadatos y streaming |
| render:e2e | OK, 1080×1920, CONVERSATION con audio/subtítulos/zoom |
| reframe:e2e | OK, 2 ventanas de zoom, 1080×1920 |
| autoedit:e2e | OK, MP4 real, subtítulos KARAOKE |
| news:e2e | OK, narración eSpeak y MP4 1080×1920 |
| owned-content:e2e | OK, fuentes → render → aprobación → dry run; no publicación |
| whisper-cpp-smoke | OK, audio sintetizado → texto real |
| transcription-e2e | OK con WHISPER_PROVIDER=cpp, worker/cola/persistencia/reutilización |
| navegador | Inicio, Connections, Autopilot, Marketing, Approvals y Factory visibles; canal local de prueba creado |
| /api/health local | 200, status=ok, FFmpeg/FFprobe y almacenamiento escribible |

Whisper tiny produjo texto con errores de reconocimiento en la voz sintética:
el E2E acredita ejecución y timestamps, no precisión editorial. Revisar los
subtítulos antes de aprobar. Las pruebas OAuth/providers/KV usan dobles de test;
no equivalen a consentimiento Google, subida remota ni Redis de producción.

## Ejecutar de forma segura

```bash
npm ci
export CLIPFORGE_AGENT_REAL_PUBLISHING=false
export CLIPFORGE_CONTENT_REAL_PUBLISHING=false
export CLIPFORGE_AGENT_ENABLED=false
export CLIPFORGE_SMART_PUBLISH_ON_BOOT=false
npm run dev
```

El servidor HTTP no ejecuta todos los workers por sí solo. En terminales aparte,
con el mismo `CLIPFORGE_STORAGE_DIR` y publicación OFF:

```bash
npm run worker:transcription
npm run worker:analysis
npm run worker:autoedit
npm run worker:render
```

Configurar `WHISPER_PROVIDER=cpp`, `WHISPER_CPP_COMMAND` y
`WHISPER_CPP_MODEL_PATH` para Whisper.cpp, o instalar Whisper CLI para el provider
por defecto. News/Factory necesitan `ESPEAK_NG_PATH` o `espeak-ng` en PATH.
Para validar sin tocar Redis real:

```bash
CLIPFORGE_REDIS_URL= REDIS_URL= npm run build
npm run phase1:e2e
npm run render:e2e
npm run reframe:e2e
npm run autoedit:e2e
npm run news:e2e
npm run owned-content:e2e
```

## Credenciales y autorizaciones pendientes

Ausentes en **este entorno local**; no se deduce que falten también en Render:

- YouTube: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
  `CLIPFORGE_CREDENTIALS_KEY`, `CLIPFORGE_OAUTH_STATE_KEY`. Después necesita
  consentimiento del propietario en `/connections`; callback exacto
  `/api/oauth/youtube/callback`, scopes `youtube.upload` y `youtube.readonly`.
- Z.ai runtime: `CLIPFORGE_ZAI_API_KEY`, `CLIPFORGE_ZAI_MODEL`; no se probó una
  llamada pagada. Endpoint general por defecto `https://api.z.ai/api/paas/v4`.
- Meta: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`,
  `META_GRAPH_API_VERSION` y autorización de Página. Marketing API/Instagram
  requerirán permisos y revisión propios; no usar tokens inventados.
- TikTok: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` y
  consentimiento oficial por publicación.
- Hosting: `CLIPFORGE_OWNER_ACCESS_KEY`, `CLIPFORGE_SESSION_KEY`;
  `CLIPFORGE_REDIS_URL` para estado compartido cuando corresponda.

YouTube selecciona cuenta/canal mediante consentimiento de Google y consulta
`channels.list?mine=true`; toma la identidad devuelta. No hay un selector propio
de múltiples identidades de YouTube posterior al callback. Facebook sí tiene
selección propia de Página. YouTube analytics actuales son views/likes/comments
de Data API; retención, CTR y revenue necesitan integración adicional.

## Persistencia y producción

KV soporta OAuth cifrado, canales, publicaciones, smart publish y ejecuciones
del agente. **No** cubre todos los medios ni toda la aplicación: proyectos,
MP4, cola de medios, workflows y otros repositorios siguen dependiendo del
filesystem. En Render gratuito son efímeros; hace falta volumen o almacenamiento
durable equivalente para prometer recuperación integral tras reemplazo.

No se han ejecutado publicaciones, anuncios ni campañas reales. Se mantuvieron
los switches de publicación en false en los procesos de validación. Algunas
pruebas unitarias existentes cambian el switch en su proceso aislado para probar
guardas, usando providers simulados; no llaman a plataformas reales.

El conector de Render requiere confirmar el workspace antes de consultar
servicios. La revisión de despliegue/logs de producción no forma parte de la
evidencia local anterior. No confundir un build local correcto con producción
validada, ni `UPLOADED`/`PROCESSING` con `PUBLISHED`.
