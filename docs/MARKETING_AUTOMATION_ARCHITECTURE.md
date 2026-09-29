# ClipForge Marketing Automation — arquitectura evolutiva

## Objetivo

Evolucionar ClipForge desde su pipeline real de video/clips hacia un motor simple de automatizaciones de marketing:

`SOURCE → EXTRACT → UNDERSTAND → IDEA → CONTENT → EDIT → BRAND → APPROVAL → PUBLISH → ANALYTICS`

La evolución es incremental. No reemplaza ni reescribe el pipeline actual de clips.

## 1. Qué existe actualmente

El repositorio raíz ya contiene la aplicación canónica de ClipForge. Hoy existen, entre otros:

- ingesta real de video y URL;
- FFprobe/FFmpeg;
- transcripción real con worker;
- análisis y candidatos;
- Auto Edit, subtítulos, Auto Focus y render vertical;
- News Mode;
- captura manual de pantalla;
- JobStore con cola, locks, recuperación de jobs, reintentos y backoff;
- Autopilot de clips;
- canales, scheduler y PublicationRecord;
- aprobación previa a publicación;
- OAuth y providers oficiales para TikTok, YouTube y Facebook;
- CredentialVault;
- analytics, PerformanceAnalyzer y AIUsage;
- runtime persistente Docker y workers separados;
- frontend Vercel separado del procesamiento pesado.

## 2. Qué se puede reutilizar

### Orquestación y tolerancia a fallos

Reutilizar patrones de `JobStore`: estados, intentos, locks, heartbeats, recuperación y backoff.

### Medios

Reutilizar el pipeline existente de ingest, análisis, clips, Auto Edit, subtítulos y render. El futuro nodo `EDIT` debe llamar estos servicios; no duplicarlos.

### Publicación

Reutilizar `PublicationService`, scheduler, providers OAuth, conexiones y analytics. El futuro nodo `PUBLISH` debe delegar en Publishing Hub y nunca publicar directamente.

### Seguridad

Reutilizar owner auth, CredentialVault, variables de entorno, validación de IDs/rutas y persistencia atómica.

### Analytics y aprendizaje

Reutilizar AnalyticsRepository/Service y PerformanceAnalyzer como base para memoria de marketing basada en evidencia.

## 3. Qué falta

- una definición general de workflow independiente del pipeline de clips;
- ejecuciones persistentes por workflow;
- resultados por paso;
- historial completo de transición;
- pausa genérica por aprobación o falta de información;
- capa Source extensible para texto, URL, documentos, empresa, MetaBot, etc.;
- Extraction normalizada;
- Marketing Brain;
- generador de contenido/copy multi-variante;
- perfiles de marca;
- bandeja unificada de aprobaciones;
- notificaciones internas y conectores futuros;
- calendario unificado de contenido;
- memoria de marketing por empresa/proyecto;
- recetas de automatización;
- editor visual posterior.

## 4. Qué partes actuales deben modificarse

No se deben modificar agresivamente los servicios existentes.

Cambios previstos por integración:

1. `AutopilotService`: convertirse en un ejecutor especializado invocable desde pasos de workflow, manteniendo compatibilidad con el dashboard actual.
2. `PublicationService`: aceptar contexto de execution/workflow para trazabilidad e idempotencia compartida.
3. `AnalyticsService` / `PerformanceAnalyzer`: poder asociar resultados a campaña, variante, marca y workflow.
4. UI: añadir navegación móvil para Automatizaciones, Aprobaciones, Contenido, Calendario, Analíticas, Marcas y Conexiones sin eliminar las pantallas existentes.
5. Runtime persistente: añadir worker de workflows cuando existan handlers ejecutables de Source/Extract/Marketing Brain.

## 5. Arquitectura propuesta

```text
sources/
  adapters
  SourceRepository

extraction/
  extractors
  ExtractionService

marketing-brain/
  MarketingBrainService
  objectives
  channel-planning

workflows/
  WorkflowRepository
  WorkflowService
  WorkflowRunner (fase posterior)

executions/
  persistidas dentro de workflows en Fase 1

content-generation/
  copy
  scripts
  variants

media-processing/
  reutiliza servicios existentes

branding/
  BrandRepository
  BrandService

approvals/
  ApprovalRepository
  ApprovalService

publishing/
  reutiliza PublicationService + providers

notifications/
  internal first

analytics/
  reutiliza analytics actuales + campaign attribution

integrations/
  MetaBot
  future authorized connectors
```

Principio: los nodos de workflow coordinan servicios. No contienen lógica pesada de video, OAuth o analytics.

## 6. Fases

### Fase 1 — Workflow + executions

Implementada en la rama `feature/marketing-workflows-phase1`:

- definiciones de workflow;
- pasos normalizados y extensibles;
- execution ID único;
- asociación opcional a projectId;
- estados del flujo;
- current step;
- resultados por paso;
- errores e intentos;
- historial;
- reintento del paso actual sin reiniciar pasos completados;
- waiting_approval;
- waiting_information;
- idempotency key;
- APIs para crear/listar/consultar workflows y ejecuciones;
- API de acciones de ejecución;
- pruebas de reanudación, aprobación e idempotencia.

### Fase 2 — Sources + extraction

Primero: `TEXT`, `URL`, `VIDEO`, `EXISTING_CLIPFORGE_CONTENT`. Después: PDF, CSV, Excel, imagen, audio, catálogo y MetaBot.

### Fase 3 — Marketing Brain

Plan estructurado con objetivo, audiencia, canal, formato, mensaje y CTA. Debe separar hechos extraídos de decisiones creativas.

### Fase 4 — Content generation

Título, hook, copy, CTA, guion, storyboard, textos en pantalla y variantes A/B/C.

### Fase 5 — Approvals

Bandeja `Necesita tu atención`, aprobación/rechazo/modificación y notificaciones internas.

### Fase 6 — Auto editor

Conectar el nodo `EDIT` con Clip Engine/Auto Edit/Subtitles/Render existentes.

### Fase 7 — Branding

Perfiles de marca y aplicación automática en copy y render.

### Fase 8 — Publishing Hub DRY RUN

`DRY_RUN=true` por defecto para los workflows nuevos. Preparar payload exacto de publicación sin acción externa.

### Fase 9 — Publicación autorizada

Integrar conexiones OAuth existentes. Mantener aprobación explícita y protección de idempotencia.

### Fase 10 — Analytics + marketing memory

Atribución por campaña/variante, aprendizaje basado en resultados y prevención de repetición de ideas.

## Reglas permanentes

- No reconstruir ClipForge.
- No eliminar funciones de clips.
- No publicar en cuentas no autorizadas.
- No publicar automáticamente durante desarrollo.
- No eliminar marcas de agua de terceros.
- Trabajar solo con contenido propio, autorizado o permitido.
- Mantener `DRY_RUN=true` hasta la activación explícita del Publishing Hub de workflows.
- Cada fase debe pasar lint, typecheck, tests y build antes de integrarse a `main`.
