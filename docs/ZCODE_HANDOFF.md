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


---

## Cloud Codex handoff: operación sin Termux

Este bloque es la fuente de verdad para continuar ClipForge desde un agente de código en la nube sin depender del teléfono.

### GitHub confirmado

- Repositorio: `tg321920-netizen/Clip.thomas`
- Rama operativa: `codex/clipforge-agent-foundation`
- Trabajar sobre la rama existente; no crear un proyecto nuevo ni reconstruir ClipForge desde cero.
- Leer también `AGENTS.md` antes de modificar.
- El agente de código puede usar GitHub para inspeccionar, modificar, commitear y hacer push según los permisos de la cuenta conectada.

### Render confirmado

- Workspace: `My Workspace` de `tg321920@gmail.com`
- Servicio: `clipforge-runtime-free`
- Service ID: `srv-das0aknlk1mc73dr2lpg`
- Repositorio conectado: `https://github.com/tg321920-netizen/Clip.thomas`
- Branch de despliegue: `codex/clipforge-agent-foundation`
- Auto deploy: habilitado por commit.
- Runtime: `https://clipforge-runtime-free.onrender.com`
- Build command: `bash scripts/render-native-free-build.sh`
- Start command:
  `FFMPEG_PATH="$PWD/.runtime/bin/ffmpeg" FFPROBE_PATH="$PWD/.runtime/bin/ffprobe" WHISPER_CPP_COMMAND="$PWD/.runtime/bin/whisper-cli" WHISPER_CPP_MODEL_PATH="$PWD/.runtime/models/ggml-tiny.bin" node scripts/render-runtime-free.mjs`

Por lo tanto, Termux NO es requisito para desplegar: un push a la rama operativa dispara Render automáticamente.

### Estado observado del runtime

Los logs observados muestran que los workers de ClipForge arrancan, incluido Agent worker y publishing worker.

También se observó:

`Real publishing gate is OFF; provider submission and provider status refresh are paused.`

No considerar la publicación terminada hasta recibir `PUBLISHED` real y URL remota.

### Z-Code / Z.ai server-side

El CLI de Z-Code en Termux queda como herramienta opcional de desarrollo, no como dependencia operacional.

El camino autónomo debe ser:

`AgentRuntimeService -> ZaiAgentProvider -> AgentToolRegistry -> servicios internos de ClipForge`

Variables esperadas, sin guardar valores en Git:

- `CLIPFORGE_AGENT_ENABLED`
- `CLIPFORGE_AGENT_REAL_PUBLISHING`
- `CLIPFORGE_ZAI_API_KEY`
- `CLIPFORGE_ZAI_BASE_URL`
- `CLIPFORGE_ZAI_MODEL`
- `CLIPFORGE_ZAI_API_STYLE`
- `CLIPFORGE_ZAI_TEMPERATURE`
- `CLIPFORGE_ZAI_MAX_OUTPUT_TOKENS`

### Google / YouTube y demás secretos

No copiar access tokens, refresh tokens, client secrets, contraseñas, cookies ni API keys a GitHub, archivos, issues, logs o prompts.

El agente debe consumir los secretos ya configurados en Render/ClipForge mediante variables de entorno, vault o almacenamiento seguro existente.

Si falta una variable, reportar únicamente el NOMBRE de la variable faltante. No imprimir ni solicitar que se publique su valor en un chat.

Si Google/YouTube exige consentimiento OAuth humano, detenerse solo en esa acción exacta, entregar la URL oficial generada por ClipForge y continuar después de la autorización.

### Secuencia para el siguiente Codex

1. Leer `AGENTS.md` y este documento completo.
2. Inspeccionar repo, rama, Render y runtime antes de tocar código.
3. Confirmar solo presencia/ausencia de variables requeridas; nunca mostrar valores.
4. Confirmar estado OAuth de YouTube y si el bloqueo actual es únicamente el publishing gate.
5. Validar el provider Z.ai server-side.
6. Hacer la primera prueba en `MANUAL` con publicación real OFF.
7. Corregir únicamente causas reales.
8. Ejecutar:
   - `npm run verify`
   - `npm run build`
   - `npm run render:e2e`
   - `npm run reframe:e2e`
9. Commit + push a `codex/clipforge-agent-foundation`.
10. Dejar que Render auto-despliegue; no disparar un deploy manual adicional si el commit ya lo activó.
11. Revisar deploy, health y logs.
12. Activar publicación real solo cuando canal, OAuth y guardas estén confirmados.
13. Éxito final de YouTube = `PUBLISHED` + URL real.

### Resultado buscado

ClipForge debe quedar mantenible y operable desde GitHub/Codex + Render, con Z.ai dentro del runtime para la operación autónoma. Termux deja de ser una dependencia crítica.
