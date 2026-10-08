# ClipForge — instrucciones para agentes de código

Estas reglas aplican a todo el repositorio. La misión autorizada de reparación de Studio conserva ambas historias; su rama operativa es:

`codex/clipforge-core-rescue`

No crear otro proyecto, no cambiar de rama y no reconstruir ClipForge desde cero.

## Objetivo actual

ClipForge Studio mantiene cuatro entradas visibles: importar URL autorizada, subir y editar, extraer clips y crear historias de 6–12 escenas. Durante este rescate, `PUBLISHING = OFF`. Se conservan los conectores y el agente, pero no se activan publicaciones ni demostraciones audiovisuales al arrancar.

Flujo objetivo:

`fuente licenciada → descarga → transcripción → análisis → fragmento >90 s → subtítulos → CONVERSATION 9:16 → zoom suave → render MP4 → metadata → YouTube → procesamiento → PUBLISHED`

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
