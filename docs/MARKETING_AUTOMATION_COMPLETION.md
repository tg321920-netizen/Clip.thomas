# ClipForge Marketing Automation — estado de implementación

## Objetivo

ClipForge conserva su pipeline de clips y añade una capa modular de automatización de marketing:

`SOURCE → EXTRACT → UNDERSTAND → IDEA → CONTENT → APPROVAL → EDIT → BRAND → PUBLISH → ANALYTICS`

No se reconstruyó el producto y no se eliminó el flujo de clips existente.

## Implementado

### 1. Workflows + executions

- definiciones de workflow;
- ejecución persistente con UUID;
- estado y paso actual;
- resultados por paso;
- historial, errores y reintentos;
- reanudación desde el último paso correcto;
- estados `waiting_approval` y `waiting_information`;
- idempotencia por workflow;
- `MarketingWorkflowRunner` con handlers para los pasos principales.

### 2. Sources + extraction

Inicialmente soporta:

- `TEXT`;
- `URL` HTTP/HTTPS autorizada explícitamente;
- `CLIPFORGE_PROJECT` para reutilizar transcript/análisis existentes.

La extracción web valida redirecciones y hosts públicos, limita tamaño/tipo de respuesta y no ejecuta scripts. Se guardan texto, resumen, metadatos y señales como precio, contacto, horario y CTA.

### 3. Marketing Brain

- objetivo;
- audiencia;
- canales;
- formato;
- mensaje;
- CTA;
- concepto;
- justificación;
- evidencia, supuestos e información faltante.

La evidencia propuesta por IA se verifica contra el texto real extraído. `AUTO` usa IA solo si existe proveedor configurado; `DETERMINISTIC` funciona sin costo de IA.

### 4. Content generation

Genera hasta tres variantes:

- A: problema;
- B: demostración;
- C: beneficio.

Cada variante incluye título, hook, descripción, copy, CTA, hashtags, guion, storyboard, subtítulos y textos en pantalla.

### 5. Human approval + notifications

Bandeja móvil `/approvals` con acciones:

- Ver;
- Aprobar;
- Modificar / solicitar cambios;
- Rechazar.

La aprobación de contenido exige seleccionar una variante cuando existen varias. Hay notificaciones internas para solicitudes y resoluciones.

### 6. Automatic editing bridge

`MarketingEditService` conecta contenido aprobado con el Auto Edit existente de ClipForge cuando hay un proyecto de video asociado:

- 9:16;
- subtítulos;
- selección/reutilización de clip;
- plan de textos y storyboard;
- metadatos para branding.

Si no existe un activo de video autorizado, queda `WAITING_SOURCE_ASSET` en vez de fabricar material inexistente.

### 7. Brand profiles

Perfiles persistentes con:

- nombre;
- logo URL;
- colores;
- fuentes;
- estilo visual;
- tono;
- CTA preferido;
- sitio web;
- WhatsApp;
- redes.

La marca se aplica como snapshot al contenido/plan de edición para mantener trazabilidad.

### 8. Publishing Hub — DRY RUN

`MarketingPublishingHub` prepara una **Simulación de publicación** con payload, plataforma, canal y programación.

Reglas:

- `dryRun=true` por defecto;
- publicación real requiere una aprobación separada;
- idempotencia evita simulaciones duplicadas;
- Instagram se puede preparar en DRY RUN, pero live queda bloqueado hasta implementar conector oficial;
- no se publica directamente desde Marketing Brain ni Content Generation.

### 9. Authorized live handoff

Para plataformas con infraestructura existente (Facebook, TikTok, YouTube), el Hub puede entregar una pieza a `PublicationService` solamente si:

1. la publicación fue aprobada por una persona;
2. existe un canal `CONNECTED`;
3. `publishingEnabled=true`;
4. existe un clip preparado;
5. `CLIPFORGE_MARKETING_REAL_PUBLISHING=true` fue activado intencionalmente.

El handoff todavía crea una publicación con aprobación requerida dentro del pipeline de publicación existente; no salta los controles de consentimiento.

### 10. Analytics + marketing memory

`MarketingMemoryService` registra:

- contenido creado;
- variante seleccionada;
- hooks, títulos, CTA y ángulos usados;
- contenido rechazado;
- notas de revisión;
- recomendaciones de `PerformanceAnalyzer` basadas en métricas reales.

No transforma muestras pequeñas en reglas automáticas.

## Recetas iniciales

- Video largo → clips;
- Producto → anuncio;
- Empresa → semana de contenido;
- MetaBot → publicidad;
- URL → contenido.

Las recetas son workflows predefinidos y no obligan al usuario a construir nodos manualmente.

## Interfaz

- `/marketing`: dashboard móvil de automatizaciones, contenido, recetas, marcas y Publishing Hub;
- `/approvals`: bandeja `Necesita tu atención`;
- `/autopilot`: publicación/analytics existentes;
- `/connections`: cuentas autorizadas existentes.

## Seguridad permanente

- tokens fuera del código;
- owner auth existente cubre `/api/*` alojadas;
- CredentialVault/OAuth existentes se reutilizan para publicación real;
- aprobación humana para acciones sensibles;
- idempotencia antes de publicar;
- no eliminar marcas de agua de terceros;
- usar contenido propio, autorizado o permitido;
- preferir archivo fuente limpio;
- DRY RUN por defecto para el nuevo motor.

## Extensiones pendientes, no bloqueantes para el núcleo

La arquitectura ya admite adaptadores futuros para PDF, CSV, Excel, imagen, audio independiente, catálogo estructurado y MetaBot. Estos formatos no se implementaron todos simultáneamente para mantener el desarrollo incremental y evitar romper ClipForge.

También queda como fase posterior el editor visual de nodos drag-and-drop. El motor funciona sin depender de ese editor.
