# Almacenamiento privado y retención de clips

La integración añade una biblioteca de MP4 finales en Cloudflare R2 Standard. La aplicación anterior usa `storage/` y archivos de proyecto locales: eso no conserva los medios si la instancia desaparece. Ni `ProjectStore` ni el KV existente proporcionan un backend de archivos de vídeo. `R2ObjectStore` añade el transporte S3 privado y `ClipLibraryService` añade su índice y conservación; no se duplica la aplicación ni se utiliza Git como alojamiento de vídeos.

## Alcance y límites

- Sólo los resultados nuevos de `RenderService` con `archiveEligible=true`, estado READY y validación positiva se archivan. Los originales y resultados históricos quedan fuera de la limpieza.
- Los archivos se envían por streaming con Content-MD5 y se comprueba tamaño y SHA-256 del objeto confirmado. Un fallo conserva el render local; el siguiente intento adopta una subida ya verificada sin duplicarla.
- Cada versión distinta tiene identidad por contenido. El índice privado permite ver y descargar los MP4 finales aunque se pierdan los archivos y trabajos de la instancia. No recupera originales, líneas de tiempo completas ni trabajos locales: para reeditar hace falta conservar el original.
- Las versiones sin protección vencen a los 30 días. El worker revisa el vencimiento como máximo una vez por hora. «Conservar» se persiste antes de confirmarse en la interfaz y excluye esa versión de la limpieza. Quitar la protección inicia un nuevo plazo de 30 días.
- Un bloqueo remoto con escrituras condicionales serializa archivado, protección y borrado entre procesos. Registros inválidos o un listado incompleto detienen la limpieza. Los marcadores de versiones vencidas evitan que un reintento vuelva a subirlas.
- La limpieza remota sólo elimina objetos e índices identificados dentro de `clipforge-managed/v1/`. No borra otros objetos del bucket, archivos locales originales ni publicaciones. Los temporales de renders siguen usando `MediaTempCleanup` y su lista explícita de nombres permitidos tras READY.
- No se acredita todavía una captura continua de cuatro horas ni la calidad de selección del modelo visual, aunque su integración ya existe. La limitación de 1 GB por ingesta y la captura por ventanas deben resolverse antes de prometer ese flujo completo.

## Configurar R2

1. Usar un bucket privado exclusivo de ClipForge con clase Standard. Mantener desactivados el acceso público r2.dev y dominios públicos; los vídeos se sirven mediante las rutas autenticadas de la aplicación.
2. Crear credenciales R2 S3 de lectura/escritura limitadas a ese bucket. No usar una clave global de la cuenta.
3. Introducir estos valores mediante **Variables de entorno** del servidor:

| Variable | Valor |
| --- | --- |
| `CLIPFORGE_MEDIA_STORAGE_PROVIDER` | `r2` |
| `CLIPFORGE_R2_ACCOUNT_ID` | ID de cuenta Cloudflare de 32 caracteres hexadecimales |
| `CLIPFORGE_R2_BUCKET` | Nombre del bucket privado |
| `CLIPFORGE_R2_ACCESS_KEY_ID` | Access Key ID R2 S3 |
| `CLIPFORGE_R2_SECRET_ACCESS_KEY` | Secret Access Key R2 S3 |

La clave secreta se introduce en el editor seguro como variable del proceso: SigV4 necesita firmar localmente y no puede hacerlo con un placeholder de «Secretos de red». Los valores nunca se pegan en el chat, en comandos, Git o logs. El código sólo guarda requisitos por nombre. El transporte conserva el proxy y los certificados del entorno y no sigue redirecciones hacia otros destinos.

El supervisor ejecuta `scripts/storage-worker.mjs --once` únicamente cuando se selecciona R2. En otro runtime usar `npm run worker:storage`; `npm run worker:storage:once` realiza una pasada. Un recibo local reduce escaneos repetidos y verificaciones, pero no sustituye el índice remoto. No activar publicación ni cambiar planes para probarlo.

`npm run worker:storage:once -- --dry-run` permite revisar los vencimientos sin borrar medios. Los errores pendientes se muestran en la biblioteca con mensajes seguros; no se exponen credenciales ni el contenido interno de los recibos.

## Cuotas y costo

El límite de la biblioteca es 8 GB y cada archivo puede ocupar hasta 512 MB. Se cuenta todo el contenido del bucket antes de incorporar un objeto nuevo; no se borran clips protegidos para hacer sitio. Un cupo lleno deja el render local y un error pendiente de reintento. Los objetos subidos cuyo índice no llegó a confirmarse se conservan para recuperar el intento y también cuentan hacia el cupo.

[R2 Standard](https://developers.cloudflare.com/r2/pricing/) incluye 10 GB-mes, un millón de operaciones A, diez millones B y transferencia de salida gratuita. Las cuotas pertenecen a toda la cuenta, no sólo a este bucket; otros buckets, lecturas adicionales y servicios pueden generar cargos. El límite de ClipForge reduce el consumo propio, no es un tope de facturación de Cloudflare. La cuenta puede requerir información de pago para activar R2; cualquier activación de facturación queda a cargo del propietario. Este cambio no crea servicios, no contrata planes y no asegura gratuidad ilimitada.

## Interfaz y comprobación

En Mis videos, «Clips guardados» muestra el estado real, el espacio, la fecha de vencimiento y el botón «Conservar». Las rutas `/api/media/library` y `/api/media/library/:id/source` consultan el índice remoto y soportan reproducción por rangos. El propietario debe mantener la autenticación de la aplicación en despliegues alojados. El ZIP existente de proyectos sigue dependiendo de sus archivos locales; esta biblioteca añade descarga individual recuperable.

Pruebas de seguridad y recuperación: `node --test tests/clip-library.test.mjs tests/r2-object-store.test.mjs`. Prueba móvil con respuestas de API locales explícitas: `node scripts/mobile-storage-e2e.mjs` contra el servidor de prueba. Esas pruebas no acreditan acceso a una cuenta R2 real. Las aceptaciones multimedia deben usar `CLIPFORGE_MEDIA_STORAGE_PROVIDER=local` para aislar los datos del propietario.

La preferencia `CLIPFORGE_DEFAULT_LIVE_URL=https://kick.com/westcol` identifica el canal principal solicitado por el propietario. Se utiliza para rellenar el enlace al seleccionar Directo activo; no inicia una captura, no acredita derechos del creador y no activa OAuth ni publicación.

## Validación contra R2 real

En la prueba privada del 24 de octubre de 2026 (Costa Rica) se guardó un MP4 sintético propio de 1.350.053 bytes, se comprobó descarga completa por SHA-256, rangos, índice sin archivos locales, idempotencia y activación/desactivación de «Conservar» con retención de 30 días. No se publicó en redes. La pieza está identificada como «Prueba técnica del agente (IA simulada)»; las decisiones del modelo en esa prueba eran fixtures locales.

La prueba detectó un defecto que los dobles S3 no mostraban: la compresión HTTP de los registros JSON producía ETags débiles y las escrituras condicionales fallaban con conflicto. El transporte ahora solicita `Accept-Encoding: identity`, conserva proxy/TLS y comprueba versiones fuertes para modificar registros. No elimina el prefijo débil para forzar una coincidencia: si no puede verificar la versión, conserva los archivos y detiene la escritura. Hay regresiones de transporte y protección frente a versiones débiles.
