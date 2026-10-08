# CODEX_HANDOFF — ClipForge

## Objetivo

ClipForge produce clips reales a partir de video/podcast reutilizable legalmente y los prepara/publica mediante conectores controlados. La prueba de éxito final para YouTube es `PUBLISHED` con URL real.

## Rama activa

`codex/clipforge-agent-foundation`

No cambiar de rama, no crear un proyecto paralelo y no hacer merge a `main` salvo instrucción explícita.

## Arquitectura resumida

- Web/API: Next.js.
- Media: FFmpeg, FFprobe, yt-dlp, whisper.cpp; eSpeak NG cuando aplica.
- Render de conversación: `services/clip/RenderService.mjs`.
- Descubrimiento/licencia/clip: `services/publishing/SmartLicensedClipService.mjs`.
- Publicación: `PublishingService`, `SocialPublishingRouter`, `YouTubeProvider`.
- OAuth: `services/oauth/OAuthConnectionService.mjs`.
- Secrets OAuth cifrados: `services/security/CredentialVault.mjs`.
- KV compartido: `lib/redis-kv.mjs`.
- Smart publish: `services/publishing/SmartPublishJobService.mjs`.
- Runtime Render gratuito: `scripts/render-runtime-free.mjs`.
- Agente: `services/agent/`, `scripts/agent-worker.mjs`, `AgentToolRegistry.mjs`.

## Persistencia

Render gratuito reemplaza instancias. Con `CLIPFORGE_REDIS_URL`, el KV compartido es durable para OAuth cifrado, canales, publicaciones, smart publish y ejecuciones del agente. El filesystem local es cache/fallback.

## Regla FFmpeg CONVERSATION

No usar el gráfico complejo dentro de `-vf`.

Usar `-filter_complex` y producir una única salida `[vout]`. Deben coexistir fondo desenfocado, video principal, zoom/overlay, ASS subtitles y audio, con salida 1080x1920.

## Agente interno

Se habilita con `CLIPFORGE_AGENT_ENABLED=true`.

Herramientas clave:

- `licensed.video.discover`
- `licensed.clip.produce`
- `publishing.prepare`
- `publishing.schedule`
- `publishing.publish`
- `channels.status`
- `publications.query`
- `analytics.query`

No recibe shell ni secretos y no debe saltarse `SocialPublishingRouter` ni las guardas de publicación real.

## Comandos de verificación

```bash
npm run verify
npm run build
npm run render:e2e
npm run reframe:e2e
```

Los workflows `ClipForge CI` y `ClipForge Render Runtime` deben quedar verdes.

## Estado Render

Servicio: `clipforge-runtime-free`.

Plan: gratuito. No migrar a plan pago sin instrucción explícita.

El build usa `scripts/render-native-free-build.sh` y debe mantener los tests aislados del Redis/KV real.

## Estado OAuth

El código soporta OAuth de YouTube, cifrado server-side, refresh token y recuperación desde KV. Si el runtime informa que no hay credenciales recuperables, la única acción externa válida es completar el consentimiento de Google desde la ruta de publicación única. No pedir tokens por chat ni guardarlos en Git.

## Flujo smart publish

Etapas esperadas:

`DISCOVERING_POPULAR_CC_VIDEOS → SOURCE_SELECTED → DOWNLOADING_SOURCE → TRANSCRIBING → ANALYZING_HIGHLIGHTS → GENERATING_SUBTITLES → APPLYING_SMOOTH_ZOOM → RENDERING → CREATING_TITLE_AND_METADATA → UPLOADING_TO_YOUTUBE → YOUTUBE_PROCESSING → PUBLISHED`

Después de reinicio, si ya existe un video remoto en procesamiento, reanudar consulta de estado; nunca duplicar el upload. Un timeout de procesamiento no equivale a FAILED ni PUBLISHED.

## Errores históricos importantes

- CONVERSATION roto por usar un filtergraph complejo en `-vf`.
- OAuth/estado perdido por filesystem efímero.
- tests de build conectados al Redis real y agotando clientes.
- publicación considerada terminada antes de procesamiento YouTube.
- riesgo de upload duplicado al recuperar una ejecución.

## Si una prueba real falla

1. Leer etapa y error reales del smart publish.
2. Revisar logs de Render del mismo deploy.
3. No borrar estado persistido.
4. Si ya existe `publicationId`/video remoto, recuperar estado antes de volver a subir.
5. Corregir causa, agregar regresión y ejecutar verify/build/E2E.
6. Solo pedir intervención humana si la API externa exige consentimiento/acción que el agente no puede conceder.
