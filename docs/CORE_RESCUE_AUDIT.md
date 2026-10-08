# ClipForge Multi: auditoría de rescate

Base inspeccionada: `main` en `f3d8ca33fd57452d475898fdf3adac4be210087c` (30 septiembre 2026).
Rama: `codex/clipforge-core-rescue`. Solo se trabaja en Clip.thomas.

## Estado encontrado

- UploadPanel enviaba el archivo entero en un POST; cualquier interrupción eliminaba el archivo recibido y obligaba a reiniciar. La ruta contaba bytes recibidos, ignoraba escrituras parciales de disco y no comparaba el tamaño final en disco. No hay evidencia suficiente para atribuir el incidente Android exclusivamente a uno de estos defectos.
- Existe almacenamiento local aislado por UUID, reproducción con HTTP Range y miniaturas FFmpeg. Render gratuito configura `/tmp/clipforge`: la persistencia entre reemplazos de instancia no está garantizada. Las variables de entorno por sí solas no demuestran que exista un volumen persistente.
- Ingesta URL usa yt-dlp y reserva fallback FFmpeg para falta del binario. YouTube puede bloquear importaciones; se reconoce el bloqueo y se ofrece subida autorizada, sin cookies ni evasión.
- TranscriptCandidateProvider agrupa segmentos reales y elimina candidatos redundantes; sus valores predeterminados eran 15–60 s. ViralScore usa patrones de texto; energía de audio es opcional. No representa vistas reales.
- AutoEditService/HeuristicAutoEditProvider eligen un candidato y preparan metadatos/subtítulos. No implementan cortes internos de silencios ni edición completa del original.
- VisualAssemblyService usa un único recurso y crea un fondo de color si no hay recursos. OwnedContentRenderService reutiliza NewsRenderService: un póster fijo, sin seis escenas ni proveedor de imágenes.
- AudioEngine tiene TTS eSpeak gratuito y autorización explícita para premium; subtítulos estimados por proporción de palabras, no alineación real. El grafo de música reutiliza la narración sin asplit explícito.
- NewsRenderService usa split, scale, crop, gblur, overlay y ass. El render de clips usa scale/crop/pad/ass. No hay motor de escenas zoompan/xfade.
- Los renders comprobaban resolución y metadatos parciales, sin decodificación completa, verificación obligatoria de audio ni diagnóstico de negro. Un clip READY existente se devolvía sin verificar el archivo.
- JobStore/IngestJobStore tienen archivos JSON atómicos, locks y recuperación por antigüedad; emplean COMPLETED como estado final. La recuperación temporal no equivale a persistencia durable ni asegura exclusión con workers vivos cuyo heartbeat se atrase.
- Los supervisores arrancaban workers de publicación automáticamente. La publicación real se bloquea en esta rama y dichos workers se retiran del arranque.

## Servicios y accesos

- GitHub: acceso confirmado a Clip.thomas; ramas existentes y cinco commits recientes inspeccionados. Rama de rescate creada en remoto.
- Render: cuenta conectada; la herramienta exige confirmación de workspace. Único workspace visible: My Workspace (`tea-d2bvocfdiees73f5gpv0`). Pendiente confirmación antes de inspeccionar servicios.
- Vercel: la consulta por proyectos cuyo nombre contiene clip devolvió cero resultados. No demuestra inexistencia en otro equipo o con otro nombre.
- Entorno local: FFmpeg 7.1.5 y FFprobe disponibles. No se encontró eSpeak ni Whisper. La conexión al proxy y la instalación npm fallaron; el sandbox deniega apertura de puertos HTTP. No hay secretos o identidades externas configurados en el entorno cloud.

## Cambio verificable de Fase 1

Subidas con fragmentos de 2 MiB, capability secreta por sesión, SHA-256 por fragmento y archivo reconstruido, escrituras completas, detección de duplicados, finalización atómica y análisis en el worker existente. Interrupciones conservan fragmentos completos. Solo se limpia almacenamiento temporal de sesiones expiradas; nunca originales o renders.

El cliente conserva la sesión en almacenamiento del navegador y reanuda al seleccionar el mismo archivo. Tras finalizar, el trabajo sigue en servidor. No hay incremento de progreso por temporizadores.

MediaValidationService exige MP4 H.264/yuv420p, AAC cuando hay audio, duración y resolución coherentes, decodificación completa y evidencia de intervalos negros. Las escenas oscuras parciales producen evidencia para revisión; un video prácticamente negro requiere declaración explícita del proyecto para ser aceptado. No afirma alineación semántica ni subtítulos visualmente comprobados.

## Evidencia y límites

`node tests/resumable-upload.test.mjs`: ocho pruebas reales de disco, interrupción/reanudación, duplicados, integridad, autorización, exclusión, limpieza y escrituras parciales.

`node scripts/core-rescue-e2e.mjs --service-only`: reconstrucción de 28.638.115 bytes, ingesta y miniatura reales, cola retomada desde otra instancia de JobStore y render de tres segundos a 360x640 H.264/AAC. Evidencia en `artifacts/core-rescue/evidence.json`; MP4 en `artifacts/core-rescue/first-validated.mp4`. El archivo de prueba autorizado es un patrón generado localmente con audio sinusoidal y un átomo MP4 free para probar el tamaño de transferencia; no es el archivo Android del propietario ni una prueba de narración.

CI inicial 37795226386: lint, typecheck, build, 168 pruebas, transferencia HTTP y render real PASS. CI 37799579309: 173 pruebas PASS y aceptación real de historia y edición PASS. CI 37800544784: build y pruebas PASS; Whisper real transcribió una grabación ficticia original de 1.200 segundos y produjo tres clips distintos de 106,7, 90 y 90 segundos. Los archivos y sus JSON de evidencia están disponibles como artefactos de esas ejecuciones. Estos números corresponden a commits concretos, no se presentan como resultados del último commit.

La historia contiene seis imágenes originales distintas, movimiento zoompan, transiciones xfade, voz española eSpeak con tiempos medidos y subtítulos normales. Un fotograma del render posterior se revisó visualmente y mediante OCR. El guion automático local cubre el ejemplo maya; otros temas requieren un relato completo del usuario o un proveedor autorizado. No se llama a una API externa de pago.

La edición completa conserva el original y recorta silencios medidos a -50 dB con márgenes. Cuando se piden subtítulos, Whisper transcribe también el audio editado para alinear los nuevos tiempos. El encuadre FIT conserva la imagen completa y no afirma detección del hablante. La intensidad controla cortes y movimiento discreto.

Los trabajos MEDIA_* usan QUEUED, PROCESSING, VALIDATING, READY, FAILED, WAITING_RESOURCE y CANCELLED; READY vuelve a comprobar archivos reales. Un test mata un proceso durante VALIDATING y demuestra recuperación única sin robar bloqueos vivos. Identidad de proceso y serialización de recuperación complementan los locks existentes. Esto verifica reinicios con almacenamiento conservado, no la supervivencia de /tmp tras reemplazar una instancia de Render.

La pantalla inicial conecta tres formularios y el historial al backend. Vercel dirige la entrada al runtime multimedia existente, reutilizando la separación ya aplicada a /factory. Los archivos se reproducen con Range y se descargan con Content-Disposition. Las pruebas de navegador y subtítulos del último commit deben consultarse en su ejecución de CI; no se declara Android físico verificado.

La comprobación autenticada del runtime desplegado y el despliegue de la rama siguen pendientes de acceso al workspace de Render y a la sesión del propietario. No se han creado recursos pagos. La conexión GitHub rechazó inicialmente crear PR con 403; se preparó la descripción y un intento mediante el token del workflow después de la aceptación audiovisual.

PUBLISHING = OFF en la rama; no se ha desplegado este cambio en producción y no se afirma que el servicio actual lo tenga aplicado.
