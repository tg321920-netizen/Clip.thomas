# Desarrollo utilizable sin depender de Render ni de Z.ai

Estos cambios pertenecen a la integración de desarrollo. La candidata
clipforge-stable-candidate-20261026.1 sigue en 761e291 y no se desplegó otra versión.

## Correcciones de selección

Se reprodujo un fallo real de lógica: dos segmentos de 1 s separados por cinco
minutos producían un candidato de 301 s aunque el máximo fuese 45 s. El fallback
ahora respeta duración mínima/máxima y no cruza silencios largos.

transcript-heuristic-v3 conserva preguntas con intervenciones inmediatamente
posteriores, registra huecos, referencias textuales al humor/contraste y etiquetas
de hablante cuando existen. No inventa diarización ni reconocimiento emocional.
La puntuación conserva sus motivos y señales ausentes. El chat sigue disponible
para streaming, sin convertirse en requisito de podcasts o videos subidos.
La deduplicación temporal se hizo más estricta; entregar menos candidatos es válido.
La caché v2 se invalida para no esconder la reparación detrás de resultados viejos.
Se conserva la selección manual aun cuando no existan candidatos completos.

Prueba reproducible:

    npm run selection:local:review -- --project=UUID --rights-confirmed

Exige transcripción terminada y fuente real existente. Cachea RMS y cambios de
escena por SHA-256 para no repetir el escaneo de bytes idénticos. No llama a un
modelo ni modifica proyectos o R2.

Evidencia real: artifacts/podcast-context/current/evidence.json, original
autorizado de 150,08 s, transcripción Whisper.cpp existente y nuevos escaneos
reales. Cinco sugerencias: 0–25,12; 19,32–53,8; 100,8–131,8; 70,8–104,8;
117,8–143,8 s. Todas duran 25–34,48 s. Siguen sujetas a revisión editorial:
la deduplicación temporal no demuestra que cada acontecimiento sea único.
No hubo chat observado ni etiquetas de hablante disponibles, tampoco llamadas a modelos ni nuevos renders.
El material probado es una conversación de streaming preservada, no una prueba
independiente de documentales o películas ni una nueva transcripción de podcast.

## Android y recuperación real

El editor permite escoger formato, resolución y velocidad/calidad; reanuda
recortes guardados sin cambiar el intervalo ni crear otra identidad. El panel
muestra la fecha de copia, el worker realmente observado, fallos automáticos
y recuperación de proyectos ausentes. Las peticiones del editor son ligeras:
el respaldo y el render se hacen en workers.

    CLIPFORGE_RUN_R2_TESTS=true npm run recovery:mobile:e2e -- --project=UUID --rights-confirmed

La prueba usa un respaldo autorizado existente; no usa respuestas HTTP simuladas.
Se ejecutó localmente en Chromium 393×851 con tacto:

1. Autenticación real; la API de recuperación sin sesión devuelve 401.
2. Instancia vacía: restauración solicitada desde el botón y ejecutada por worker.
3. Original recuperado con SHA-256 idéntico y trabajos pausados.
4. Recorte manual 60–68 s, horizontal 1280×720 y perfil EFFICIENT.
5. SIGKILL del worker y de su FFmpeg mientras existía el parcial.
6. Cierre del navegador, arranque de otro worker, recuperación del lease muerto.
7. Segundo intento READY, reproducción horizontal y descarga desde el editor.
8. FFprobe/decodificación completos, audio AAC original y hashes iguales.

Evidencia: artifacts/recovery-mobile/evidence.json y run-eJ7wcg/mobile.png.
El MP4 técnico de 8 s no se archivó como nuevo clip del streamer. No hubo
publicación, llamadas de IA ni modificaciones de producción.
Esto prueba un reinicio local real del worker y una pérdida de filesystem
simulada con R2 real. No acredita Android físico, reinicios de Render ni 24/7.

La subida reanudable anterior permanece intacta. No se repitió su aceptación
completa para presentar avances nuevos. Se conserva el límite de 1 GiB y el
soporte comprobado de podcasts con vídeo; audio sin vídeo sigue sin certificarse.
