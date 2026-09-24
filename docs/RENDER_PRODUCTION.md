# ClipForge — runtime de producción para medios

## Objetivo

La aplicación web puede desplegarse en Vercel, pero el procesamiento continuo de video necesita un runtime persistente con FFmpeg, FFprobe, Whisper CLI, espeak-ng y un filesystem compartido por la web y los workers. Para el modo actual de propietario único, el camino mínimo y seguro es ejecutar la web y los workers en una sola instancia de Render con un disco persistente.

## Implementación incluida

El repositorio contiene:

- `Dockerfile`: instala Node, FFmpeg/FFprobe, espeak-ng, Python y OpenAI Whisper CLI; compila la aplicación y arranca el runtime.
- `scripts/render-runtime.mjs`: supervisor único que mantiene en ejecución Next.js y los workers de transcripción, análisis, Auto Edit, render, News Mode, Autopilot, publicación y analytics. Si un proceso crítico termina de forma inesperada, el runtime completo termina para que la plataforma pueda reiniciarlo en vez de dejar un sistema parcialmente muerto.
- `app/api/health/route.ts`: health check que solo responde OK cuando FFmpeg, FFprobe y el almacenamiento son utilizables.
- `render.yaml`: Blueprint para una sola instancia con disco persistente y secretos fuera de Git.
- `.github/workflows/render-runtime-ci.yml`: construye la imagen real, verifica los binarios y arranca el runtime completo en Docker antes de aceptar cambios.

## Persistencia

`CLIPFORGE_STORAGE_DIR` apunta a `/var/data/clipforge` en el Blueprint. Ese directorio contiene originales, proyectos, jobs, renders, canales, publicaciones, analytics y credenciales OAuth cifradas. La configuración mantiene una sola instancia para no fingir coordinación multi-instancia sobre archivos locales.

El directorio HOME del runtime también se coloca dentro del volumen persistente para que Whisper pueda conservar modelos descargados entre reinicios.

## Seguridad

El Blueprint no contiene secretos reales.

- `CLIPFORGE_OWNER_ACCESS_KEY` queda como valor manual (`sync: false`) porque el propietario debe conocer esa clave.
- `CLIPFORGE_SESSION_KEY`, `CLIPFORGE_CREDENTIALS_KEY` y `CLIPFORGE_OAUTH_STATE_KEY` se generan en la plataforma.
- OAuth de TikTok, Google/YouTube y Meta continúa requiriendo las credenciales y aprobaciones de las apps del propietario.

## Capacidad inicial

El Blueprint usa una sola instancia `1c-2g`, un disco de 10 GB y Whisper `tiny` para reducir memoria y tiempo de arranque. Esto prioriza tener un MVP operativo; el modelo Whisper, CPU/RAM y el tamaño del disco pueden aumentarse después de medir tiempos reales con videos del propietario.

## Validación

No se considera listo un cambio del runtime solo porque compile. El workflow `ClipForge Render Runtime` debe comprobar:

1. build completo de la imagen;
2. FFmpeg disponible;
3. FFprobe disponible;
4. espeak-ng disponible;
5. Whisper CLI disponible;
6. arranque conjunto de web + workers;
7. `/api/health` en estado `ok` con almacenamiento escribible.

## Límite actual

Crear la instancia con disco persistente puede generar costo en Render. El repositorio deja toda la configuración lista, pero el aprovisionamiento de un recurso de pago requiere aprobación explícita del propietario. Hasta que esa instancia exista, Vercel sigue siendo el frontend/despliegue web verificado y el runtime pesado de producción no debe declararse aprovisionado.
