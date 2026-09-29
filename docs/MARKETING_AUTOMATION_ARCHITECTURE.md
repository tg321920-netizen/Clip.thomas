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
- frontend Vercel separado del procesamiento pesado;
- motor genérico de workflows y executions de marketing;
- Sources/Extraction inicial para texto, páginas web autorizadas y proyectos existentes de ClipForge;
- Marketing Brain con planificación basada en evidencia y fallback determinista sin IA.

## 2. Qué se puede reutilizar

### Orquestación y tolerancia a fallos

Reutilizar patrones de `JobStore`: estados, intentos, locks, heartbeats, recuperación y backoff.

### Medios

Reutilizar el pipeline existente de ingest, análisis, clips, Auto Edit, subtítulos y render. El futuro nodo `EDIT` debe llamar estos servicios; no duplicarlos.

### Publicación

Reutilizar `PublicationService`, scheduler, providers OAuth, conexiones y analytics. El futuro nodo `PUBLISH` debe delegar en Publishing Hub y nunca publicar directamente.

### Seguridad

Reutilizar owner auth, CredentialVault, variables de entorno, validación de IDs/rutas y persistencia atómica. Las APIs nuevas quedan detrás del proxy global de owner auth en despliegues alojados.

### IA y costos

Reutilizar `OpenAICompatibleClient` y `AIUsageService`. El Marketing Brain funciona en modo `AUTO`, `AI` o `DETERMINISTIC`: `AUTO` usa IA solo cuando existe proveedor configurado; si no, continúa sin costo de IA.

### Analytics y aprendizaje

Reutilizar AnalyticsRepository/Service y PerformanceAnalyzer como base para memoria de marketing basada en evidencia.

## 3. Qué falta

- ejecutar automáticamente handlers de nodos sobre el motor de workflows;
- ampliar Sources a PDF, CSV, Excel, imagen, audio independiente, catálogo y MetaBot;
- Extraction semántica específica por empresa/producto/servicio;
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
  SourceRepository
  SourceService
  adapters futuros

extraction/
  ExtractionService
  WebPageExtractor
  extractors futuros

marketing-brain/
  MarketingBrainService
  MarketingPlanRepository
  evidence validation

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

Implementada e integrada en `main`:

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
- idempotency key acotada al workflow;
- APIs para crear/listar/consultar workflows y ejecuciones;
- API de acciones de ejecución;
- pruebas de reanudación, aprobación e idempotencia.

### Fase 2 — Sources + extraction

Implementada e integrada en `main`:

- `TEXT`: información escrita por el usuario;
- `URL`: página web HTTP/HTTPS con confirmación explícita de autorización;
- `CLIPFORGE_PROJECT`: reutiliza transcripción, análisis y metadatos de un proyecto existente;
- persistencia separada de fuentes y extracciones;
- contenido extraído, metadatos, origen y estado de autorización;
- extracción web con límites de tamaño, tipo de contenido y validación SSRF en cada redirección;
- limpieza de HTML sin ejecutar scripts;
- resumen determinista barato;
- señales útiles iniciales: precios, emails, teléfonos, URLs, horarios y candidatos de CTA;
- reutilización de candidatos de clips existentes como evidencia, sin duplicar procesamiento de video;
- APIs para crear/listar/consultar fuentes y ejecutar/consultar extracciones;
- pruebas para texto, URL autorizada, proyecto ClipForge y redirecciones web.

Queda para iteraciones posteriores de Sources: PDF, CSV, Excel, imagen, audio independiente, catálogo de productos, información estructurada de empresa y MetaBot.

### Fase 3 — Marketing Brain

Implementación actual:

- recibe una o varias extracciones completadas;
- impide mezclar extracciones de proyectos ClipForge distintos;
- produce un plan estructurado: objetivo, audiencia, canales, formato, mensaje, CTA, concepto, justificación y duración recomendada;
- respeta las restricciones explícitas del usuario sobre objetivo, audiencia, canales y formato;
- separa `evidence`, `assumptions` y `missingInformation`;
- toda evidencia propuesta por IA se verifica contra el texto real de la extracción; evidencia no verificable se descarta;
- nunca instruye a inventar precio, descuento, contacto, ubicación, capacidad, disponibilidad, garantía o rendimiento;
- modo `AUTO`: usa IA solo cuando hay API key + modelo configurados;
- modo `DETERMINISTIC`: genera un plan base sin llamada a IA;
- modo `AI`: exige proveedor configurado y falla de forma explícita si falta;
- reutiliza `OpenAICompatibleClient` y registra tokens con `AIUsageService` sin inventar costos;
- persiste planes y expone APIs para crear/listar/consultar;
- pruebas cubren fallback sin IA, restricciones del brief, validación de evidencia, contabilidad de tokens y separación entre proyectos.

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
