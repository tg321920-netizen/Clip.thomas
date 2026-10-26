# Perfiles de render y recuperación

Desarrollo posterior a 761e291; no se alteró esa etiqueta ni producción.

El editor manual permite vertical 9:16 u horizontal 16:9, 720p o 1080p.
La resolución elegida se guarda en el recorte; un servidor lento no la cambia.
El perfil Ágil (EFFICIENT) usa x264 veryfast/CRF 23; BALANCED mantiene medium/23.
HIGH conserva slow/20 y FAST ultrafast/28 para borradores. Un mismo CRF es un
objetivo de calidad comparable, no una garantía de igualdad perceptual.

Se conserva seek antes de entrada, filtros de un hilo y CONVERSATION mediante
filter_complex. CLIPFORGE_RENDER_THREADS controla 1–8 hilos, por defecto 2.
CLIPFORGE_MAX_RENDER_PROCESSES limita 1–2 codificadores por filesystem compartido,
por defecto uno. La contención mantiene el trabajo en cola sin consumir intentos
de codificación. No es un lock distribuido entre servidores independientes.

Los leases de render registran PID y arranque del proceso: se recupera un worker
muerto sin robar un render lento que sigue activo. Se serializa el encolado de un
mismo recorte. El plazo de render es configurable entre 30 y 3600 segundos con
CLIPFORGE_RENDER_TIMEOUT_SECONDS; por defecto 900.

Después de validar un MP4 se guarda un comprobante con SHA-256 del resultado,
hash de la fuente y todos los ajustes. Si el proceso muere antes de guardar READY
o del rename final, se comprueban el comprobante y la decodificación para reutilizar
el resultado, sin volver a codificar. Un parcial incompleto no tiene ese
comprobante válido: el siguiente intento reinicia ese render. No se afirma
reanudación desde cualquier fotograma ni se borra el original. El archivo parcial
del mismo recorte se reutiliza como temporal acotado.

## Medición local reproducible, material auténtico

    node scripts/render-profile-benchmark.mjs --source=/video/autorizado.mp4 --rights-confirmed

La fuente de esta prueba fue el original autorizado preservado del estadio,
SHA a53c477728d61778ceda6b7b33a7c86b6ab479333d6d9abc09e4e96e7dd08783.
Se midieron ocho segundos de 50 a 58; los cuatro resultados son QA técnico,
no clips nuevos entregados del streamer. No se escribieron medios en R2.

| Perfil | Primer render, validación incluida | Máximo RSS individual |
| --- | ---: | ---: |
| 720p BALANCED | 5,01 s | 305,1 MiB |
| 720p EFFICIENT | 3,50 s | 180,5 MiB |
| 1080p BALANCED | 8,23 s | 520,1 MiB |
| 1080p EFFICIENT | 4,74 s | 327,0 MiB |

En esta muestra, EFFICIENT redujo el tiempo aproximadamente 30 % en 720p y 42 %
en 1080p. No extrapolar a cualquier archivo ni al plan gratuito. Host local:
Node 24.19.0, cuatro CPU disponibles y unos 33,3 GiB, sin límite de 0,1 CPU.
El RSS es el máximo de un proceso hijo, no la suma del servidor y sus workers.
No acredita que el servidor completo quepa en 512 MiB.

Los cuatro MP4 tienen duración 8 s, H.264/AAC, decodificación íntegra y audio
original. Las pruebas de recuperación de final y parcial completo conservaron
el mismo hash y ejecutaron cero codificadores adicionales.
Evidencia: artifacts/render-profiles/real-20261026-b/evidence.json.
La antigua medición de 0,1 CPU/512 MiB no completó 30 s antes de 180 s.
Falta medir el hosting real; no se promete tiempo ni 1080p permanente allí.


## Perfil limitado nuevo, Node 22 / 512 MiB / 0,1 CPU

La prueba del perfil EFFICIENT terminó: 30 s de vídeo real, 720×1280,
H.264/AAC, un hilo, **304,908 s desde encolar hasta READY (cola, render y validación)**, pico **274,406 MiB**.
El arranque y recorrido completos tardaron 354,397 s. Decodificación íntegra,
audio original, acceso sin sesión rechazado con 401, OOMKilled=false y salida 0.
Los límites se comprobaron en cgroup: memory.max=536870912 y cpu.max=10000 100000.

Se usó la imagen local clipforge-node22-media-profile:20261026, Node 22.23.4,
FFmpeg/FFprobe 5.1.9. La aplicación/ingesta/scheduler/render compartieron el límite
con el proceso medidor. El worker R2 estuvo desactivado: no se certifica la memoria
del ensayo completo con respaldos, Whisper o varios renders a la vez. No es una
prueba del servicio Render ni modela su suspensión por inactividad.

Script: scripts/limited-runtime-profile.mjs. Solo se ejecuta en un contenedor con
la aplicación de solo lectura en /app, resultados escribibles en /profile y la
fuente real montada en /profile/storage/uploads/8e56073f-ae3a-4c2c-a73d-b11085dbd1b6/source.mp4.
Requiere --rights-confirmed y CLIPFORGE_PROFILE_SOURCE_SHA256. Configurar
CLIPFORGE_STORAGE_DIR=/profile/storage, dimensiones 720×1280 y un hilo.
El script rechaza una ejecución que no tenga exactamente 512 MiB y 0,1 CPU.
No pasar secretos, no conectar la red y mantener publicación/LIVE/agente apagados.

Evidencia preservada fuera del checkout para evitar incluir medios de QA en el
build: /workspace/clipforge-tools/hosting-profile/efficient-512-20261026/{result,container-state}.json.
Fuente SHA a53c477728d61778ceda6b7b33a7c86b6ab479333d6d9abc09e4e96e7dd08783.
MP4 técnico SHA de23cf255ae30e2051ee0eee15b10492e65efdf6cf2e62caa10e39a7a2db9d15.
No se archivó como clip nuevo del streamer.

Conclusión práctica: un recorte aislado puede completarse con estos recursos,
pero aproximadamente cinco minutos por treinta segundos no equivalen a edición
rápida, captura permanente o análisis de cuatro horas en tiempo real. 1080p se
conserva como opción; no se certificó bajo este límite. Falta medir el hosting
real y el conjunto con R2. Para uso permanente sin contratar servicios, un
servidor propio ya disponible sigue siendo una alternativa que requiere prueba.
