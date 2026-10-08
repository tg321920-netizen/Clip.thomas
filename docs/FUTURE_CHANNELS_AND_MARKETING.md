# Evolución multicanal y marketing seguro

Esta preparación conserva el core y no activa APIs nuevas, anuncios ni gasto.
El contrato TypeScript está en `types/marketing-provider.ts`; todavía no hay un
`MetaMarketingProvider` operativo ni endpoints de campañas.

## Dos responsabilidades separadas

| Responsabilidad | Servicio actual / ampliación |
| --- | --- |
| Publicación orgánica | `SocialPublishingRouter` → `PlatformConnector` → provider oficial |
| OAuth y renovación | `OAuthConnectionService` → `CredentialVault` |
| Programación | `SchedulerService`, no un segundo calendario por provider |
| Medios | `ClipService`, `RenderService`, `AudioEngine`, `VisualAssemblyService` |
| Anuncios futuros | `MarketingProvider` → futuro `MetaMarketingProvider` |
| Aprendizaje | `AnalyticsService`, `PerformanceAnalyzer`, `MarketingMemoryService` |

YouTube/Shorts comparten identidad y provider; el formato se determina por el
contenido. Facebook tiene OAuth, selección de Página y publicación de Reels.
Posts, imágenes, video convencional, comentarios e insights de Meta necesitan
capacidades y validación oficial adicionales. Instagram Business y Reels aún no
tienen OAuth ni provider operativo, aunque ya existen como destinos editoriales
en `MarketingChannel`. TikTok tiene provider de publicación; sus analytics no
están implementadas. Una opción editorial no equivale a un conector disponible.

Cada ampliación debe implementar el adaptador y declarar sus capacidades antes
de incorporarse a los enums, fábrica de providers y router existentes. Reutilizar
`getStatus`, `publish`, `getAnalytics`, renovación y desconexión; no insertar
condicionales de Graph API en el agente, los workflows ni la interfaz.

## Negocios, productos y marca

`BusinessMarketingProfile` referencia el `BrandService` y los perfiles de
`ProductProfileService` existentes. Recoge audiencia, tono, objetivos, zona
horaria, canales y promociones con fuente y vigencia. Es un contrato futuro,
no una nueva base de datos ni una segunda implementación de esos servicios.

La secuencia reutiliza `SourceService` → `ExtractionService` →
`MarketingBrainService` → `ContentGenerationService` → `MarketingEditService`
→ marca → aprobación → programación/publicación → métricas → memoria.
Fuentes actuales: texto, URL autorizada y proyecto ClipForge. Noticias y trends
usan el flujo editorial de Owned Content; ideas, productos, negocios y
promociones deben referenciar fuentes verificables, sin inventar condiciones
comerciales. Video, short, reel, post, guion, copy y caption reutilizan los
formatos existentes; thumbnail y entrega publicitaria requieren adapters nuevos.

## Contrato de anuncios

`MarketingCampaignDraft` contiene campaña → conjuntos → anuncios, creatividad
por `generationId`/`variantId`/`assetIds`, copy, CTA, destino, público y presupuesto
en unidades monetarias menores. Los IDs de workflow permiten mantener aprobación
e idempotencia con el motor actual. No guarda tokens.

El futuro `MetaMarketingProvider` implementará validación, previsualización sin
efectos y lectura de métricas del contrato. La interfaz actual deliberadamente
no expone creación, activación, aumento de presupuesto ni cobro. Incorporar esos
métodos requiere autorización futura explícita, credenciales oficiales, límites
de gasto y aprobación de la revisión exacta del payload. Aprobar un post
orgánico nunca autoriza una campaña pagada.

Los experimentos A/B referenciarán variantes de `ContentGenerationService` y
resultados medidos. CPM, CPC, CTR, conversiones, costo por resultado y ROAS son
`null` cuando faltan datos; no convertir ausencia de medición en cero. Registrar
moneda, ventana y atribución. La memoria propone recomendaciones basadas en
evidencia; no aumenta presupuestos automáticamente.

## Cola existente

No crear otra cola. El mapeo actual es:

| Trabajo conceptual | Implementación actual |
| --- | --- |
| TRANSCRIBE / ANALYZE | `TRANSCRIBE_VIDEO` / `ANALYZE_VIDEO` en `JobStore` |
| GENERATE_CLIP / GENERATE_METADATA | `AUTO_EDIT` y servicios de clips/metadata |
| RENDER | `RENDER_CLIP`, `RENDER_NEWS`, `OWNED_CONTENT` |
| RESEARCH / IDEA / SCRIPT / AUDIO | pasos de workflows y herramientas permitidas del agente |
| APPROVAL / SCHEDULE | `ApprovalService` / `SchedulerService` |
| PUBLISH / FETCH_ANALYTICS | `PUBLISH_POST` / `FETCH_ANALYTICS` |
| ANALYZE_PERFORMANCE / RECOMMENDATIONS | `PerformanceAnalyzer` / memoria de marketing |

Los nombres conceptuales no son nuevos tipos ejecutables de `JobStore`. Cuando
un paso necesite worker independiente, extender la cola actual con su handler,
idempotencia, recuperación y pruebas. Los modos MANUAL/SEMI_AUTO/AUTO permanecen
en `AutonomyPolicy`; AUTO nunca implica autorización de gasto o publicación.
