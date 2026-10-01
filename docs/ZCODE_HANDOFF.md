# ZCode Handoff

## Propósito

ZCode será un **agente ejecutor inteligente** dentro de la automatización de ClipForge. No sustituye a ClipForge ni a sus servicios deterministas. El modelo decide entre acciones permitidas; ClipForge valida y ejecuta esas acciones mediante servicios internos.

La ruta conceptual es:

```text
Trigger / Autopilot / Workflow
  -> AgentRuntimeService
  -> AgentProvider
  -> Z.ai-compatible provider
  -> AgentDecision estructurada
  -> AgentToolRegistry
  -> servicios internos de ClipForge
  -> resultado persistido
  -> siguiente decisión
```

ZCode no recibe un shell del servidor, acceso directo a secretos ni acceso directo a las APIs de TikTok, Meta o Google.

## Papel de ZCode

ZCode/Z.ai puede actuar como cerebro de decisión para tareas como:

- consultar tendencias;
- revisar estado de canales;
- iniciar investigación;
- solicitar generación de guiones;
- solicitar voz;
- solicitar preparación visual;
- solicitar renders;
- consultar publicaciones;
- preparar o programar contenido dentro de las políticas activas;
- consultar analytics;
- leer memoria de marketing;
- ajustar estrategia únicamente dentro de los campos permitidos.

Las decisiones se entregan como estructuras `AgentDecision`, no como comandos libres.

## Herramientas internas disponibles

La allowlist inicial del `AgentToolRegistry` incluye:

- `trends.query`
- `channels.status`
- `research.start`
- `script.generate`
- `voice.create`
- `visual.prepare`
- `render.create`
- `publications.query`
- `publishing.prepare`
- `publishing.schedule`
- `publishing.publish`
- `analytics.query`
- `marketing.product.list`
- `marketing.product.read`
- `marketing.memory.read`
- `strategy.update`

Toda herramienta desconocida es rechazada.

## Lo que ZCode NO puede hacer

El agente no tiene herramientas para:

- ejecutar shell arbitrario;
- leer secretos o credenciales;
- modificar archivos arbitrarios del servidor;
- cambiar infraestructura;
- desplegar a producción;
- modificar Git o repositorios;
- hacer pagos;
- cambiar OAuth directamente;
- llamar directamente a TikTok, Facebook, YouTube, Meta o Google;
- publicar contenido real cuando las protecciones de ClipForge estén desactivadas.

Los secretos siguen siendo responsabilidad del runtime y de los servicios existentes de seguridad/OAuth.

## AgentRuntimeService

`AgentRuntimeService` conecta las ejecuciones persistidas de ClipForge con el agente.

Puede:

1. recibir o crear una tarea;
2. asociarla con workflow, proyecto y canal;
3. determinar el modo de autonomía;
4. entregar al provider únicamente el contexto permitido;
5. obtener una decisión estructurada;
6. ejecutar una herramienta registrada;
7. persistir resultado, estado, errores y siguiente acción;
8. recuperar ejecuciones pendientes después de un reinicio.

El worker `scripts/agent-worker.mjs` procesa ejecuciones `QUEUED` y `WAITING_RETRY`. Está deshabilitado por defecto mediante `CLIPFORGE_AGENT_ENABLED=false`.

## Interacción con Autopilot

Autopilot sigue siendo la capa que avanza proyectos/workflows existentes. El agente no lo reemplaza.

Los modos soportados son:

- **MANUAL**: cada acción del agente requiere aprobación.
- **SEMI_AUTO**: investigación, generación, preparación y render pueden avanzar; scheduling/publicación requieren aprobación.
- **AUTO**: permite recorrer acciones autorizadas sin revisión por paso, pero la publicación real mantiene guardas adicionales de canal, OAuth y flags de seguridad.

Configuraciones antiguas con modo `AUTOPILOT` se normalizan a `AUTO` para conservar compatibilidad.

## Ruta hasta TikTok, Facebook y YouTube

El agente nunca usa las APIs sociales directamente.

La ruta es:

```text
Agent / Autopilot
  -> Workflow
  -> AgentToolRegistry
  -> SocialPublishingRouter
  -> PlatformConnector
       -> TikTokConnector
       -> FacebookConnector
       -> YouTubeConnector
  -> providers existentes de ClipForge
  -> Publication
  -> remotePostId / estado
  -> Analytics
  -> MarketingMemory
  -> siguiente decisión
```

Antes de publicar, ClipForge comprueba:

1. que el canal exista;
2. que esté conectado;
3. que `publishingEnabled=true`;
4. que OAuth esté válido o sea refrescable;
5. que el contenido/publicación esté en estado válido;
6. que las aprobaciones requeridas estén completas;
7. que los flags de publicación real estén habilitados;
8. que el provider correcto corresponda a TikTok, Facebook o YouTube.

Los errores temporales y rate limits se marcan como retryables y usan el backoff persistente existente. Los fallos terminales pasan a `FAILED`.

## ZCode CLI en Termux vs Z.ai API en el runtime

### ZCode CLI en Termux

El CLI instalado en `~/zcode-agent` sirve para desarrollo y pruebas manuales desde el teléfono. Puede usar la autenticación del usuario y su plan Z.ai dentro de Termux.

Ese CLI **no es el runtime permanente de ClipForge** y no debe ser necesario mantener el teléfono abierto para operar ClipForge.

### Z.ai API en ClipForge

El runtime autónomo usa la abstracción `AgentProvider`. `ZaiAgentProvider` está preparado para un endpoint compatible con Z.ai desde el servidor.

Esto separa:

- desarrollo/manual: ZCode CLI en Termux;
- operación de ClipForge: AgentRuntimeService + Z.ai API compatible.

No se reutilizan credenciales de Codex y no se deben copiar credenciales del CLI al repositorio.

## Variables de entorno

Valores de ejemplo, sin secretos reales:

```text
CLIPFORGE_AGENT_ENABLED=false
CLIPFORGE_AGENT_REAL_PUBLISHING=false
CLIPFORGE_ZAI_API_KEY=
CLIPFORGE_ZAI_BASE_URL=https://api.z.ai/api/paas/v4
CLIPFORGE_ZAI_MODEL=
CLIPFORGE_ZAI_API_STYLE=chat-completions
CLIPFORGE_ZAI_TEMPERATURE=0.2
CLIPFORGE_ZAI_MAX_OUTPUT_TOKENS=1400
```

Para redes sociales siguen siendo necesarias posteriormente las variables OAuth ya definidas por ClipForge para TikTok, Google/YouTube y Meta/Facebook. No deben almacenarse en Git.

## Primera prueba MANUAL sin publicar

La primera integración real debe mantenerse en modo seguro:

1. mantener `CLIPFORGE_AGENT_REAL_PUBLISHING=false`;
2. mantener los canales sin publicación real habilitada;
3. configurar solamente el provider Z.ai del agente en un entorno de prueba;
4. crear una tarea con `autonomyMode=MANUAL`;
5. pedir una acción inocua como `channels.status`, `trends.query` o `marketing.memory.read`;
6. ejecutar la tarea;
7. comprobar que queda en `WAITING_APPROVAL` antes de usar la herramienta;
8. aprobar manualmente esa única acción;
9. confirmar que el resultado queda persistido;
10. comprobar que ninguna publicación ni llamada social real fue realizada.

Una segunda prueba puede usar `research.start` o generación de guion, todavía en MANUAL y con publicación real apagada.

## Requisitos antes de AUTO real

Antes de activar AUTO con publicación:

- runtime con almacenamiento persistente;
- provider Z.ai real validado;
- OAuth oficial de TikTok, Facebook y YouTube;
- cuentas/canales conectados;
- `publishingEnabled=true` solo en canales autorizados;
- pruebas controladas de publicación por plataforma;
- analytics reales validados donde la API/provider lo soporte;
- derechos/coherencia/aprobaciones internas satisfechas;
- activación explícita de los flags de publicación real.

Hasta entonces, MANUAL o SEMI_AUTO deben ser los modos de prueba.
