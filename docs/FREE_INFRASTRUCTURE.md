# ClipForge — infraestructura gratis para empezar

## Objetivo

Empezar a usar ClipForge sin pagar infraestructura mientras se valida el flujo real. Esta configuración es para un MVP de propietario único, no para producción comercial.

## Frontend / panel

El proyecto canónico en Vercel es `clip-thomas`. La aplicación ya se construye y despliega desde `main`.

Vercel puede servir la interfaz y las rutas ligeras, pero su entorno no se considera el procesador multimedia principal porque el deployment no incluye FFmpeg/FFprobe/Whisper persistentes.

## Runtime multimedia gratis

`render.yaml` define ahora un runtime Docker en plan `free` con el pipeline real de ClipForge:

- FFmpeg + FFprobe
- Whisper `tiny`
- espeak-ng
- Next.js
- workers de transcripción, análisis, Auto Edit, render, News Mode, Autopilot, publishing y analytics

El almacenamiento se apunta a `/tmp/clipforge` para no requerir disco de pago.

### Limitaciones del modo gratis

- El almacenamiento es efímero: proyectos, videos, renders, jobs y credenciales locales pueden perderse cuando la instancia duerme, reinicia o se redepliega.
- El plan gratis puede dormir por inactividad y tardar en despertar.
- Video + Whisper + FFmpeg pueden superar CPU/RAM disponibles en trabajos grandes. Para empezar, usar videos cortos y `WHISPER_MODEL=tiny`.
- No usar este modo como almacenamiento definitivo ni para un SaaS multiusuario.

## Seguridad

`CLIPFORGE_REQUIRE_OWNER_AUTH=true` permanece activado. `CLIPFORGE_OWNER_ACCESS_KEY` no se guarda en GitHub: debe configurarse como secreto en el servicio. Las llaves de sesión, credenciales OAuth y estado OAuth se generan o permanecen server-side.

## Paso de actualización cuando haya ingresos

`render.production.yaml` conserva la configuración durable: una instancia con disco persistente. Al migrar, los datos dejan de depender de `/tmp` y se mantienen entre reinicios/despliegues.

Después, el siguiente salto es mover proyectos/jobs/publicaciones a Postgres/Neon y los videos/renders a object storage, dejando los workers separados para escalar.
