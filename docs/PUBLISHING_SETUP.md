# ClipForge Publishing — configuración segura

## Estado

ClipForge tiene adapters separados para TikTok, YouTube y Facebook. Ningún adapter inventa una publicación: si faltan OAuth, permisos, consentimiento o configuración, el envío falla de forma explícita.

Los tokens no se guardan dentro de `ChannelRecord`, proyectos ni frontend. `CredentialVault` cifra el material OAuth en reposo con AES-256-GCM usando una llave maestra server-side (`CLIPFORGE_CREDENTIALS_KEY`).

## TikTok

Provider: `TikTokProvider`.

- API oficial: Content Posting API / Direct Post.
- Scope requerido por el adapter: `video.publish`.
- Antes de inicializar el post se consulta `creator_info/query`.
- La privacidad debe ser una opción devuelta por TikTok para ese creador.
- ClipForge exige consentimiento explícito por publicación (`consentAt`).
- Esta implementación usa `PULL_FROM_URL`; por ello el MP4 debe estar en una URL HTTPS cuya propiedad/dominio esté verificado para la app de TikTok.
- Clientes no auditados pueden quedar limitados a visibilidad privada según las reglas de TikTok.

Variables/credenciales reales se obtienen únicamente después de registrar y autorizar la app de TikTok. No se incluyen secretos en el repositorio.

## YouTube

Provider: `YouTubeProvider`.

- API oficial: YouTube Data API `videos.insert` mediante protocolo resumable.
- Scope requerido: `https://www.googleapis.com/auth/youtube.upload`.
- El worker inicia una sesión resumable y transmite el MP4 desde disco; no carga el video completo en memoria.
- `UPLOADED` no se considera publicado/terminado: ClipForge espera a que el procesamiento sea `PROCESSED`/exitoso.
- Privacidad soportada: `private`, `unlisted`, `public`.

El cliente OAuth de Google y su secreto pertenecen al entorno de producción, no al repositorio.

## Facebook Reels

Provider: `FacebookProvider`.

- Publica sobre una Facebook Page usando Page access token.
- Permisos declarados por el adapter: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
- `META_GRAPH_API_VERSION` es obligatorio y debe corresponder a la versión soportada/configurada por la app Meta; ClipForge no fija silenciosamente una versión que pueda quedar obsoleta.
- El flujo implementado separa inicio de sesión de upload, transferencia binaria del MP4 y finalización del Reel.

La app Meta, permisos y revisión deben configurarse en la cuenta del propietario antes de usar publicación real.

## Worker

`npm run worker:publishing`

El worker:

1. busca publicaciones `SCHEDULED` cuyo horario ya llegó;
2. ejecuta `PublishingReadinessService`;
3. encola `PUBLISH_POST` de forma idempotente;
4. llama al provider oficial correspondiente;
5. persiste el identificador externo;
6. consulta publicaciones `PUBLISHING` hasta obtener estado final.

Por seguridad contra publicaciones duplicadas, los fallos de envío no se reintentan automáticamente a ciegas. Un timeout después de enviar datos puede haber creado un objeto remoto aunque no se haya recibido respuesta; ese caso requiere reconciliación antes de reenviar.

## Configuración requerida

- `CLIPFORGE_CREDENTIALS_KEY`: 32 bytes codificados en base64.
- `CLIPFORGE_PUBLISHING_POLL_MS`: opcional.
- `META_GRAPH_API_VERSION`: obligatorio para Facebook.
- OAuth/tokens reales por canal: deben almacenarse mediante el flujo server-side que alimente `CredentialVault`.

## Pendiente para producción multiusuario

Los providers y el worker ya están desacoplados de la UI, pero la conexión OAuth interactiva y el aislamiento por usuario necesitan autenticación real y persistencia durable. Hasta entonces, no debe exponerse un endpoint público que permita escribir tokens arbitrarios en el vault.
