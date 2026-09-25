# ClipForge — infraestructura gratis para empezar

## Objetivo

Empezar a usar ClipForge sin pagar infraestructura mientras se valida el flujo real. Esta configuración es para un MVP de propietario único, no para producción comercial.

## Frontend / panel

El proyecto canónico en Vercel es `clip-thomas`. La aplicación se construye y despliega desde `main`.

Vercel sirve la interfaz y las rutas ligeras. No se presenta como el procesador multimedia principal porque su runtime no incluye FFmpeg/FFprobe/Whisper persistentes.

## Runtime multimedia gratis

`render.yaml` define un runtime Docker en plan `free` usando `Dockerfile.free` y el pipeline real de ClipForge:

- FFmpeg + FFprobe.
- `whisper.cpp` con modelo multilingual `tiny`, en vez del runtime Python/PyTorch más pesado.
- espeak-ng.
- Next.js.
- transcripción, análisis, Auto Edit, render, News Mode, Autopilot, publishing y analytics.

Para reducir memoria, `scripts/render-runtime-free.mjs` mantiene el servidor web y ejecuta los workers **uno por uno** mediante `--once`; no mantiene ocho procesos Node de workers residentes simultáneamente.

El almacenamiento se apunta a `/tmp/clipforge` para no requerir disco de pago.

### Limitaciones del modo gratis

- El almacenamiento es efímero: proyectos, videos, renders, jobs y credenciales locales pueden perderse cuando la instancia duerme, reinicia o se redepliega.
- El servicio gratis puede dormir por inactividad y tardar en despertar.
- La CPU/RAM gratis es limitada. `whisper.cpp tiny` y los workers secuenciales reducen consumo, pero video + transcripción + FFmpeg seguirán siendo lentos frente a infraestructura dedicada.
- Para validar el MVP conviene comenzar con videos cortos y clips pequeños.
- No usar este modo como almacenamiento definitivo ni para un SaaS multiusuario.

## Seguridad

`CLIPFORGE_REQUIRE_OWNER_AUTH=true` permanece activado. `CLIPFORGE_OWNER_ACCESS_KEY` no se guarda en GitHub: debe configurarse como secreto en el servicio. Las llaves de sesión, credenciales OAuth y estado OAuth se generan o permanecen server-side.

## Paso de actualización cuando haya ingresos

`render.production.yaml` conserva la configuración durable: una instancia con disco persistente y el runtime completo. Al migrar, los datos dejan de depender de `/tmp` y se mantienen entre reinicios/despliegues.

Después, el siguiente salto es mover proyectos/jobs/publicaciones a Postgres/Neon y los videos/renders a object storage, dejando workers separados para escalar.
