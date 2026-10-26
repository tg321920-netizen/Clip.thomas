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
