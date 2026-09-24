# ClipForge Publishing — configuración segura

## Estado

ClipForge tiene adapters separados para TikTok, YouTube y Facebook. Ningún adapter inventa una publicación: si faltan OAuth, permisos, consentimiento o configuración, el envío falla de forma explícita.

Los tokens no se guardan dentro de `ChannelRecord`, proyectos ni frontend. `CredentialVault` cifra el material OAuth en reposo con AES-256-GCM usando una llave maestra server-side (`CLIPFORGE_CREDENTIALS_KEY`). El flujo interactivo `/connections` inicia OAuth oficial, valida `state`, procesa el callback server-side y guarda las credenciales cifradas. TikTok y YouTube refrescan tokens mediante `OAuthConnectionService` cuando corresponde.

## TikTok

Provider: `TikTokProvider`.

- API oficial: Content Posting API / Direct Post.
- Scope requerido por el adapter: `video.publish`.
- Antes de inicializar el post se consulta `creator_info/query`.
- La privacidad debe ser una opción devuelta por TikTok para ese creador.
- ClipForge exige consentimiento explícito por publicación (`consentAt`).
- Para clips renderizados localmente, ClipForge usa `FILE_UPLOAD`: inicializa el Direct Post, recibe `upload_url` y transmite el MP4 en uno o varios chunks sin cargar el archivo completo en memoria.
- `PULL_FROM_URL` sigue disponible de forma explícita; en ese modo TikTok exige una URL HTTPS de un dominio/prefijo cuya propiedad esté verificada para la app.
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
- OAuth permite seleccionar una Page autorizada cuando la cuenta administra más de una.
- Permisos declarados por el adapter: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
- `META_GRAPH_API_VERSION` es obligatorio y debe corresponder a la versión soportada/configurada por la app Meta; ClipForge no fija silenciosamente una versión que pueda quedar obsoleta.
- El flujo implementado separa inicio, transferencia binaria del MP4 y finalización del Reel.

La app Meta, permisos y revisión deben configurarse en la cuenta del propietario antes de usar publicación real.

## Worker

`npm run worker:publishing`

El worker:

1. busca publicaciones `SCHEDULED` cuyo horario ya llegó;
2. ejecuta `PublishingReadinessService`;
3. encola `PUBLISH_POST` de forma idempotente;
4. obtiene credenciales OAuth vigentes;
5. llama al provider oficial correspondiente;
6. persiste el identificador externo;
7. consulta publicaciones `PUBLISHING` hasta obtener estado final.

Por seguridad contra publicaciones duplicadas, los fallos de envío no se reintentan automáticamente a ciegas. Un timeout después de enviar datos puede haber creado un objeto remoto aunque no se haya recibido respuesta; ese caso requiere reconciliación antes de reenviar.

## Configuración requerida

- `CLIPFORGE_CREDENTIALS_KEY`: llave server-side de 32 bytes para cifrar credenciales.
- `CLIPFORGE_OAUTH_STATE_KEY`: secreto server-side independiente para firmar el estado OAuth.
- TikTok: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`.
- YouTube: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- Facebook: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_GRAPH_API_VERSION`.
- `CLIPFORGE_PUBLISHING_POLL_MS`: opcional.

Los redirect URI deben ser HTTPS y coincidir con los registrados en cada proveedor. Los scopes y productos deben estar habilitados/aprobados en las respectivas consolas de desarrollador.

## Pendiente para producción multiusuario

La conexión OAuth interactiva, los providers y el worker ya están separados de la UI. Antes de exponer ClipForge como SaaS multiusuario todavía se necesita autenticación de usuarios, aislamiento por tenant y persistencia durable compartida para proyectos/jobs/canales/publicaciones/credenciales. La versión file-based actual sirve para desarrollo y un despliegue controlado de un solo propietario, no para múltiples instancias concurrentes.
