# ClipForge — runtime de producción para medios

## Objetivo

La aplicación web puede desplegarse en Vercel, pero el procesamiento prolongado de medios necesita FFmpeg, FFprobe y workers. Whisper y el traductor son dependencias opcionales del análisis y los subtítulos; el recorte manual funciona sin ellos. Para propietario único, web y workers comparten una raíz de almacenamiento y una sola instancia. Un filesystem efímero requiere checkpoints R2 confirmados y restauración; no equivale a un volumen durable ni garantiza ejecución continua.

## Implementación incluida

El repositorio contiene:

- `Dockerfile`: instala Node, FFmpeg/FFprobe, espeak-ng, Python y OpenAI Whisper CLI; compila la aplicación y arranca el runtime.
- `scripts/render-runtime.mjs`: supervisor único que mantiene en ejecución Next.js y los workers de transcripción, análisis, Auto Edit, render, News Mode, Autopilot, publicación y analytics. Si un proceso crítico termina de forma inesperada, el runtime completo termina para que la plataforma pueda reiniciarlo en vez de dejar un sistema parcialmente muerto.
- `app/api/health/route.ts`: health check que solo responde OK cuando FFmpeg, FFprobe y el almacenamiento son utilizables.
- `render.yaml`: propuesta Docker gratuita con almacenamiento temporal. No tiene disco persistente.
- `render.production.yaml`: propuesta independiente `1c-2g`, disco de 10 GB y `/var/data/clipforge`; puede generar cargos y no está autorizada para esta misión.
- `render.audit-preview.yaml`: ensayo nativo `clipforge-development-preview`, Node 22.23.4, referencia congelada, autenticación y R2; auto-deploy, publicación y LIVE OFF. Es la propuesta vigente; no se creó el servicio.
- `render.stable-preview.yaml` y `render.development-preview.yaml`: propuestas anteriores conservadas, no instrucciones para desplegar la punta experimental sobre producción.
- `.github/workflows/render-runtime-ci.yml`: prueba optativa manual de imágenes y runtime nativo. Solo corre con `workflow_dispatch` y la aprobación audiovisual explícita. La CI ordinaria verifica código y build; no demuestra que esta imagen se haya construido.

## Persistencia

`CLIPFORGE_STORAGE_DIR` apunta a `/var/data/clipforge` solo en la propuesta de producción con disco. Las propuestas gratuitas usan `/tmp`: los originales, proyectos y trabajos locales pueden perderse al reemplazar la instancia. `ProjectRecoveryService` archiva originales y checkpoints en R2 privado cuando está activado y la copia termina; no protege una subida o checkpoint inconclusos. Consultar [PROJECT_RECOVERY.md](PROJECT_RECOVERY.md).

El runtime con disco conserva también sus cachés/modelos. El build nativo prepara FFmpeg, FFprobe y whisper.cpp; verifica el SHA-256 de `ggml-tiny.bin`. El traductor offline no se instala en la plantilla gratuita: necesita una instalación y capacidad medidas por separado.

## Seguridad

El Blueprint no contiene secretos reales.

- `CLIPFORGE_OWNER_ACCESS_KEY` queda como valor manual (`sync: false`) porque el propietario debe conocer esa clave.
- `CLIPFORGE_SESSION_KEY`, `CLIPFORGE_CREDENTIALS_KEY` y `CLIPFORGE_OAUTH_STATE_KEY` se generan en la plataforma.
- OAuth de TikTok, Google/YouTube y Meta continúa requiriendo las credenciales y aprobaciones de las apps del propietario.
- `RENDER_API_KEY` es una credencial administrativa del entorno de mantenimiento. Nunca se copia a las variables del proceso web, Git, logs o documentación. Su primer uso permitido es GET; crear el ensayo requiere aprobación separada después de ese diagnóstico.

## Capacidad inicial

La propuesta de pago usa `1c-2g`, 10 GB y Whisper `tiny`; no se midieron sus recursos reales porque no está aprovisionada. El ensayo gratuito propone un encoder/hilo y 720p por defecto, conservando 1080p seleccionable, sin reducción silenciosa. La prueba limitada histórica de 30 s/720p tardó 304,908 s con 0,1 CPU y 512 MiB: no es una medición del hosting actualmente disponible.

La aceptación local adicional del 27 de octubre observó aproximadamente 542,5 MiB como máximo de la suma de RSS del árbol de procesos con web/workers, ASR y traducción (puede contar páginas compartidas varias veces; no es un pico de cgroup). El worker de backup estaba desactivado en esa medición. No certifica que el conjunto quepa en 512 MiB. Un render manual útil puede ensayarse por separado del ASR y la traducción, midiendo también R2 y la disponibilidad de la web.

## Validación

No se considera listo un cambio del runtime solo porque compile. El workflow optativo `ClipForge Render Runtime`, cuando sea autorizado, comprueba:

1. build completo de la imagen;
2. FFmpeg disponible;
3. FFprobe disponible;
4. espeak-ng disponible;
5. Whisper CLI disponible;
6. arranque conjunto de web + workers;
7. `/api/health` en estado `ok` con almacenamiento escribible.

En esta misión se corrigió la ausencia de `git` en `Dockerfile` (necesario para su instalación VCS de yt-dlp) y se añadió la verificación del modelo. La ausencia se reprodujo en la imagen base; no se ejecutó un build Docker completo ni un despliegue. Validar salud tampoco sustituye login → subida auténtica → recorte → FFmpeg → R2 → reproducción → descarga desde fuera del servidor.

## Límite actual

Crear la instancia con disco persistente puede generar costo en Render. No se creó ni modificó ningún servicio. `RENDER_API_KEY` no está vinculada al entorno activo al 27 de octubre: estado `BLOCKED_EXTERNAL_AUTHORIZATION`. El siguiente paso es vincularla privadamente para `api.render.com`; después se consulta la cuenta y los servicios mediante GET. Solo tras presentar recursos, costes y operación concreta se puede solicitar la aprobación de creación. No hay URL nueva de ensayo comprobada y no se acredita editor funcional externo por el estado histórico de Vercel/Render.
