# ClipForge — instrucciones para agentes de código

Estas reglas aplican a todo el repositorio. La misión autorizada de reparación de Studio conserva ambas historias; su rama operativa es:

`codex/clipforge-core-rescue`

No crear otro proyecto, no cambiar de rama y no reconstruir ClipForge desde cero.

Para retomar la misión de clips auténticos de Westcol, leer primero
`docs/CODEX_RESUME_REAL_WESTCOL.md`. Esa misión usa vídeo y audio reales; sus
entregables no pueden sustituirse por historias, voces o imágenes sintéticas.
La duración objetivo actual es aproximadamente 30 segundos con contexto; las
funciones anteriores se conservan, sin ejecutarlas como entregas del streamer.

## Objetivo actual

Revisión adicional del 28: leer primero `docs/RECHECK_20261028.md`. Conservar
CLIP_BUSY/409 para renders activos, validación de límites/fuentes/opciones,
fallo definitivo de idioma sin reintentos inútiles y editor manual de subtítulos
en FAILED/DRAFT. La candidata `.2` e8107f7 es nueva e inmutable; `.1` cc16902 se
conserva. Suite nativa completa 558/558, sin omisiones; no acredita Android
físico ni LIVE. No regenerar el M4A de recuperación ni los MP4 aceptados.


Continuación maestra del 28 de octubre: leer `docs/MASTER_MISSION_20261028.md`.
Conservar reanudación de lotes con IDs/textos/revisiones, solicitudes inmutables,
perfiles automáticos, editor DRAFT y reintentos sin nuevo encode. La candidata
cc16902 (.1 del 28) está congelada; no moverla. Traducción local v2 y Marian son
opcionales, REVIEW_REQUIRED y no caben junto al editor en 512 MiB. No regenerar
su MP4 NASA de QA ni contarlo como Westcol. El diagnóstico Render es GET y
requiere vinculación privada; crear el ensayo sigue pendiente de aprobación.


Continuación de fiabilidad: leer `docs/RELIABILITY_HARDENING_20261027.md`.
Conserva los seis conjuntos de reparaciones posteriores a 54dcc89: leases y
reclamaciones por intento, progreso serializado, subidas, guard de originales,
aislamiento de metadatos y borradores móviles de subtítulos. No reintroducir
keys de editor basadas en updatedAt que borren texto sin guardar al refrescar.
No regenerar los vídeos ya preservados; producción y monitor siguen OFF.

Rescate de captura posterior: leer `docs/WESTCOL_CAPTURE_RECHECK_20261027.md`.
Hay una captura VOD nueva, un borrador de 30,56 s y dos TS restaurados desde R2.
La recuperación ya no aparta segmentos válidos por cancelación/fallo del host.
No regenerar el comentario, VIP, Nike o reloj como entregas nuevas. El monitor
sigue OFF y LIVE_NOT_TESTED; no atribuir chat inexistente a ese VOD.

Continuación posterior del 27 de octubre: leer primero
`docs/STUDIO_COMPLETION_20261027.md`. Conserva audio-only, glosarios, historial
de subtítulos, recuperación de metadatos de hasta 16 MiB, deduplicación y el
arreglo de dimensiones del zoom. No regenerar sus archivos de aceptación.
La traducción sigue REVIEW_REQUIRED; Chromium móvil no acredita Android físico.
La nueva referencia congelada no reemplaza a4b2305 ni 761e291.

Auditoría posterior: leer `docs/FULL_SYSTEM_AUDIT_20261026.md` antes de retomar.
Contiene los clips auténticos de prueba, errores de traducción y correcciones,
recuperación R2, estados VERIFIED_LOCAL/PARTIAL/BLOCKED y la candidata nueva.
No regenerar esos archivos ni llamar desplegado a un resultado local.

Para los avances posteriores a la candidata 761e291, leer primero
`docs/CONTINUE_WITHOUT_RENDER_20261026.md`: recuperación R2, controles móviles,
perfil económico y prueba Node 22/512 MiB/0,1 CPU ya comprobados. No repetir sus
renders para mostrar progreso ni confundir la integración de desarrollo con un
despliegue público. Se conserva la rama operativa indicada arriba.

La prioridad vigente es el editor utilizable desde Android: subida, selección
manual de intervalo, render real y descarga, sin depender de IA o LIVE. Leer
`docs/STABLE_ANDROID_DELIVERY_20261026.md`. El perfil estable mantiene el clipping
manual y local; las funciones experimentales se conservan en el perfil de
desarrollo, sin despliegue automático. No presentar la versión local como ya
disponible en el dominio público.

ClipForge Studio mantiene cuatro entradas visibles: importar URL autorizada, subir y editar, extraer clips y crear historias de 6–12 escenas. Durante este rescate, `PUBLISHING = OFF`. Se conservan los conectores y el agente, pero no se activan publicaciones ni demostraciones audiovisuales al arrancar.

Flujo objetivo:

`fuente autorizada → importación → análisis opcional → intervalo con contexto (~30 s ajustable) → subtítulos revisables opcionales → formato elegido → FFmpeg → MP4/M4A → R2 privado → revisión/descarga`

El flujo histórico de publicación se conserva, pero queda fuera de esta misión.
Un podcast de solo audio produce audio real y SRT; no fabricar escenas para él.

Nunca considerar `QUEUED`, `RENDERED`, `UPLOADED` o `PROCESSING` como publicación terminada.

## Stack y servicios principales

- Next.js + TypeScript + Tailwind.
- FFmpeg / FFprobe.
- yt-dlp para fuentes soportadas.
- whisper.cpp en Render gratuito.
- eSpeak NG cuando se necesita TTS local.
- almacenamiento local como cache y Redis/Render Key Value como estado compartido durable.
- OAuth cifrado mediante `CredentialVault`.
- publicación mediante `SocialPublishingRouter` / providers.
- agente interno mediante `AgentRuntimeService` + `AgentToolRegistry`.

## Regla crítica de FFmpeg

El modo `CONVERSATION` usa un gráfico complejo.

NO volver a colocar ese gráfico dentro de `-vf`.

Debe usar:

- `-filter_complex`
- una única salida de video etiquetada `[vout]`

El fondo desenfocado, video principal, overlay/zoom, subtítulos ASS y audio deben poder coexistir en ese mismo render.

## Persistencia en Render gratuito

El filesystem de una instancia de Render gratuito es efímero.

Cuando `CLIPFORGE_REDIS_URL` está configurado, el KV compartido es la fuente durable para:

- credenciales OAuth cifradas;
- canales;
- publicaciones;
- estado del smart publish;
- ejecuciones del agente.

Los archivos locales son cache/fallback; no diseñar una función crítica nueva suponiendo que `/tmp` o `storage/` sobrevivirán un reemplazo de instancia.

El build de Render debe mantener Redis aislado de la suite de tests; no hacer que `npm run build` toque el KV real.

## Agente interno

El agente no recibe shell ni secretos. Solo puede usar la allowlist de `services/agent/AgentToolRegistry.mjs`.

Herramientas relevantes:

- `licensed.video.discover`
- `licensed.clip.produce`
- `publishing.prepare`
- `publishing.schedule`
- `publishing.publish`
- `channels.status`
- `publications.query`
- `analytics.query`

`CLIPFORGE_AGENT_ENABLED=true` habilita el worker. La publicación real sigue protegida por `CLIPFORGE_AGENT_REAL_PUBLISHING`, estado del canal, OAuth, aprobaciones y el router de publicación.

No ampliar permisos del agente con shell, Git, secretos o llamadas sociales directas.

## Seguridad

- Nunca guardar secretos en Git.
- Nunca imprimir access tokens, refresh tokens, client secrets, claves de cifrado o claves privadas.
- `CLIPFORGE_OWNER_ACCESS_KEY` requiere al menos 16 caracteres.
- `CLIPFORGE_SESSION_KEY` requiere al menos 32 caracteres.
- `CLIPFORGE_CREDENTIALS_KEY` y `CLIPFORGE_OAUTH_STATE_KEY` son secretos server-side.
- No bajar requisitos de seguridad para aceptar claves débiles.
- No hacer force push.
- No borrar publicaciones reales sin identificar exactamente el video.

## Verificación mínima

Antes de declarar un cambio terminado:

```bash
npm run verify
npm run build
npm run render:e2e
npm run reframe:e2e
```

Los checks de código se ejecutan primero. Las pruebas audiovisuales (`render:e2e`, `reframe:e2e` y otros renders), llamadas pagas y modificaciones de producción necesitan autorización explícita del propietario; no se disparan automáticamente para conseguir un check verde. Los checks y el despliegue real permanecen pendientes hasta esa autorización.

Para publicación real, el único éxito es `PUBLISHED` confirmado por YouTube y una URL real.

## Errores históricos que no deben regresar

1. `Simple filtergraph ... expected exactly 1 input and 1 output`: CONVERSATION debe usar `-filter_complex` + `[vout]`.
2. Estado/OAuth perdido tras redeploy: usar KV compartido, no solo archivos locales.
3. Tests de build conectándose al Redis de runtime: el build de Render debe limpiar `CLIPFORGE_REDIS_URL` / `REDIS_URL` durante verificación.
4. Marcar YouTube como publicado antes de terminar procesamiento: esperar estado real `PUBLISHED`.
5. Reintentar un upload indeterminado después de reinicio: nunca duplicar un upload si ya existe una publicación remota o su estado no es seguro.

## Forma de trabajo

Inspeccionar antes de modificar, reutilizar lo existente, corregir la causa real y agregar regresión cuando corresponda. Mantener cambios pequeños y comprobables. Si una dependencia externa requiere una acción humana (por ejemplo consentimiento OAuth de Google), detenerse solo en esa acción exacta.
