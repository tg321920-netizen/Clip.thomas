# Perfeccionamiento verificado — 25 de octubre de 2026

Se mantiene la aplicación de la raíz y la rama `codex/clipforge-core-rescue`. Los dos vídeos anteriores se conservaron; la edición nueva del segundo se guarda por separado. Sin despliegue, publicaciones sociales ni consumo de modelos de pago.

## Cambios concretos

- El codificador de historias limita su anticipación de fotogramas y referencias: `rc-lookahead=8:sync-lookahead=0:ref=2`. Se aplica a escenas, fundidos y exportación. Los perfiles forman parte de las firmas de caché para no reutilizar una codificación anterior como si fuera nueva.
- Las comprobaciones de decodificación, escenas negras y volumen limitan los hilos de decodificador/filtros. Mantienen la decodificación completa y los mismos criterios de validación.
- Se puede escuchar el archivo de narración **antes** de crear el vídeo, ver su duración y recibir un aviso si no cabe con la pausa final. El relato muestra un contador de palabras.
- El selector de estilo de imágenes aparece en el modo que realmente utiliza esos estilos; las fotos gratuitas no muestran un control sin efecto visual.

## Memoria medida sobre vídeo real

`node scripts/story-memory-e2e.mjs` compara las configuraciones sobre el MP4 autorizado existente, no barras de colores. Python obtiene el pico RSS de cada proceso mediante el kernel Linux.

| Operación | Antes | Después | Resultado |
| --- | --- | --- | --- |
| Fundido/codificación de dos fragmentos 1080p | 595.800 KiB | 413.400 KiB | 30,61 % menos pico RSS |
| Decodificación completa | 118.664 KiB | 67.320 KiB | 43,27 % menos pico RSS |

SSIM entre las dos codificaciones del benchmark: **0,990274**. El benchmark comprueba similitud y reducción de memoria, no calidad editorial ni memoria agregada del servidor. La decodificación limitada tardó más: 8,77 s frente a 4,43 s en esta ejecución. Las mediciones no certifican que web, worker, Kokoro y Whisper juntos quepan en 512 MB.

Se descartó un experimento de ONNX sin arena/patrón de memoria: subió el pico de Kokoro de 402.432 a 1.242.072 KiB, aunque producía el mismo audio. Esa configuración **no** se integró. También se descartó quitar toda la anticipación del codificador: requería más espacio y tiempo en esta prueba.

Evidencia: `artifacts/story-memory/run-8uSqmr/evidence.json`. El script acepta otro MP4 local vertical de al menos 14 segundos y crea una salida aislada. No modifica el original ni llama APIs.

## Recorrido móvil nuevo, completo

Se creó un trabajo nuevo desde una pantalla táctil Chromium de **393 × 851**, con API real, sin interceptar respuestas ni reutilizar un resultado concluido: `reviewResumed=false`.

1. Se escribió el relato original y se eligió la voz aportada.
2. Se reprodujo la vista previa local de la grabación y se mostró su duración real: `narrationPreviewPlayed=true`.
3. Se subió el WAV de 5.942.862 bytes, se verificó su hash y se guardó el trabajo `story-46c5b21a-339a-4f26-9d9b-82e3e0b84bda`.
4. Se cerró la página durante el render real. El worker terminó y el resultado se recuperó al volver a abrirla.
5. Se reprodujeron y descargaron ambos vídeos, se comprobaron los hashes de descarga, las escenas y el diseño sin desbordamiento ni errores JavaScript.
6. Se reprodujo la copia privada de R2, se comprobaron peticiones Range y se descargó íntegra para contrastar SHA-256.

Se revisaron los fotogramas de las seis escenas de la versión nueva. Hay imagen y audio, H.264/AAC, 1080 × 1920, 30 fps, subtítulos quemados legibles, duración **32 segundos**, final completo y ausencia de intervalos negros detectados. El archivo de narración de esta prueba sigue siendo Kokoro subido como fixture; no es una grabación humana.

## Archivo para revisar

`artifacts/spanish-reflections/run-jksNXm/una-pausa-tambien-cuenta-optimizado.mp4`

Tamaño: **19.341.398 bytes**, frente a 27.184.837 bytes de la edición previa: **28,85 % menos**. La pista de audio decodificada es idéntica, SHA-256 `216dcd7b89ee006efb2c76e97076b9af746cad33d763c2f9126f6b72d3f1cc18`.

SSIM entre los dos vídeos completos: **0,972854**. Se comparan dos codificaciones, no una referencia sin pérdidas: el dato no garantiza identidad visual ni aprobación comercial. Se conservaron ambas versiones para revisión.

En R2 privado: `clipforge-clips/clipforge-managed/v1/media/4068a73e4d240e7495f807a8dc8e5e9bf505257a93dcb9f92103c5a6c7b6b278.mp4`. SHA-256 del MP4: `317350b12528fd9368d9742a55903eede3f4a53ea49982d4cf4c4ca69fdb03b0`. Se verificó la descarga completa. No se habilitó acceso público.

Recibos, capturas y comparación: `artifacts/spanish-reflections/run-jksNXm/mobile-refined/`, incluidos `evidence.json`, `r2-integrity.json`, `quality-comparison.json`, `narration-preview.png`, `review.png` y `scene-contact-sheet.jpg`.

## Regresiones y límites

La verificación y build local pasan con **352 pruebas**, cero fallos y cero omisiones audiovisuales. Se repitieron `render:e2e`, `reframe:e2e`, `autoedit:e2e`, `agent:e2e`, `phase1:e2e`, `news:e2e` y `owned-content:e2e`: aprobados. Los modelos externos del test del agente son simulados; esta misión no evaluó ni activó una API de pago.

Siguen pendientes un Android físico, aprobación humana de la voz y las piezas, biblioteca visual para temas generales, infraestructura durable de proyectos/cola y despliegue de esta rama. La configuración local se prepara para Kokoro y Whisper base; no equivale a instalarla en producción ni a certificar restauración en una tarea nueva.

Uso: [SPANISH_REFLECTION_STUDIO.md](SPANISH_REFLECTION_STUDIO.md). La aceptación anterior permanece documentada en [SPANISH_REFLECTION_ACCEPTANCE_20261024.md](SPANISH_REFLECTION_ACCEPTANCE_20261024.md).
