# Aceptación de reflexiones originales en español

Ejecución: 24-10-2026 en Costa Rica / 25-10-2026 UTC. Aplicación de la raíz de `tg321920-netizen/Clip.thomas`. Producción y publicación social sin cambios.

## Resultado

Dos historias originales completas, con fotografías reales CC0, narración española, subtítulos quemados, movimiento y fundidos. Ambas se decodifican completamente y se reproducen y descargan en Chromium móvil. Las dos copias privadas de R2 se descargaron completas y sus SHA-256 coinciden con los originales. La aceptación editorial del propietario, incluida escucha de la voz, sigue pendiente. No se declara que toda la plataforma esté al 100 % ni que las voces tengan aprobación comercial humana.

| Archivo en `artifacts/spanish-reflections/run-jksNXm/` | Duración | Formato | Narración | Tamaño |
| --- | --- | --- | --- | --- |
| `lo-que-crece-en-silencio.mp4` | 31 s | H.264/AAC, 1080 × 1920, 30 fps, yuv420p | Kokoro local, español `ef_dora` | 27.106.104 bytes |
| `una-pausa-tambien-cuenta.mp4` | 32 s | H.264/AAC, 1080 × 1920, 30 fps, yuv420p | Archivo WAV subido y conservado | 27.184.837 bytes |

El WAV del segundo caso contiene una síntesis Kokoro del segundo guion original: prueba el camino de grabación aportada, **no es una grabación humana**. Se subieron 5.942.862 bytes desde el formulario real, sin simular respuestas. El original conserva su hash. El relato contiene 77 palabras; el primero, 81.

## Fallas confirmadas y correcciones

| Problema | Hallazgo y resultado |
| --- | --- |
| Cinco clips pedidos y tres largos entregados anteriormente | El selector actual valida cantidad, intervalos finitos, independencia y límites explícitos; se conservaron sus regresiones y advertencia de entrega parcial. No se volvió a solicitar una tanda comercial de cinco durante esta misión. El foco nuevo es una historia completa: `SHORT_REFLECTION` exige duración real 30–45 s, sin cortar ni acelerar narración. Los resultados reales duran 31 y 32 s. |
| Transcripciones con errores | Se confirmó que Whisper base todavía altera palabras: primer reconocimiento con distancia normalizada de palabras 4,94 %, segundo 9,09 %. No se usan sus errores como texto final: se alinea el guion corregido con el audio, se conserva el texto exacto y se rechazan incoherencias grandes, negaciones sin confirmar y final sin confirmar. Hay tiempos interpolados; no se afirma alineación perfecta. |
| Voz básica de baja calidad | eSpeak queda identificado como básico. Se añadió Kokoro local y carga de narración propia. Se descartó el prototipo Piper por las restricciones de su modelo antecesor. No se consumieron servicios de pago ni se declaró aprobación subjetiva de la voz. |
| Falta de selección visual demostrada | Biblioteca de ocho fotos CC0 con hashes, fuentes y etiquetas españolas. Seis fotos distintas por vídeo. Se revisaron fotogramas de las doce escenas. Es selección por etiquetas, no un modelo de visión ni una biblioteca comercial general. |
| Imágenes sintéticas insuficientes para aceptación | No se usaron barras, fondos inventados ni imágenes de prueba en los dos vídeos entregados. Dos fotografías inicialmente consideradas se sustituyeron tras revisión por encuadres más apropiados. Los patrones de otras pruebas son exclusivamente regresiones técnicas. |
| Render roto con fotografías | FFmpeg rechazó xfade por tasa `1/0`: se normalizan timestamps, base temporal y CFR antes del fundido. El rango de color JPEG producía `yuvj420p`: se convierte el rango de muestras y se exporta H.264 `yuv420p` limitado. |
| Subtítulos sobre fondo detallado | Se aumentaron tamaño/peso y fondo oscuro. Se comprobaron fotogramas a tiempos reales. El OCR del bosque completo generaba ruido; la prueba de historias usa ahora la zona conocida de subtítulos, manteniendo el requisito de palabras reconocidas. También se revisó el fotograma visualmente. |
| Móvil sin validación completa | Se corrigieron etiquetas accesibles del selector de voz y grabación. Se subió WAV real >4 MB, creó trabajo, cerró página durante render, recuperó resultado, reprodujo, descargó, consultó escenas y reprodujo R2 con peticiones Range. Pantalla táctil emulada de 393 × 851, sin desbordamiento horizontal ni errores JavaScript. Android físico pendiente. |
| Guardado de historias en R2 | Las historias no eran elegibles para la biblioteca: solo se aceptaban rutas de clips. Se añadió elegibilidad estricta para resultados de historias nuevos y validados, conservando protecciones de UUID, ruta, hash, cuota y retención. No se adoptaron ni eliminaron objetos ajenos. |
| Recuperación incompleta | Se conservan voz, alineación, escenas y créditos al recuperar resultados. Los fragmentos y transiciones tienen cachés verificadas. Cerrar el navegador no interrumpió el segundo trabajo. Una nueva instancia con filesystem perdido todavía necesita infraestructura durable para entradas, proyectos y cola. |

## Evidencia audiovisual

El directorio del primer vídeo contiene `evidence.json`, `worker.log`, seis fotogramas y `scene-contact-sheet.jpg`. El subdirectorio `mobile/` contiene el segundo recibo `evidence.json`, el log del worker, seis fotogramas, `scene-contact-sheet.jpg`, `review.png`, `review-top.png` y las dos descargas móviles. `r2-integrity.json` documenta las descargas completas de R2. Los archivos generados están excluidos de Git.

En ambos: pista de vídeo y audio, volumen audible, cero intervalos negros detectados, decodificación completa, seis fotografías diferentes con procedencia y texto exacto del guion en subtítulos. El primer final mantiene 0,928 s después del audio; el segundo, 1,048 s. La última palabra se confirmó con reconocimiento; el final no se recorta para cumplir duración.

Cobertura de coincidencias con el texto: 96,30 % y 92,21 %, respectivamente. Palabras con tiempos aproximados: 42 y 18. Estos porcentajes son diagnósticos de alineación, **no una puntuación de calidad comercial**. La selección de fotografías mantiene etiquetas de justificación por escena y revisión requerida.

El recorrido móvil encontró primero un problema de etiquetas; después, dos errores del propio verificador: lectura del cuerpo de respuesta expulsado de la caché CDP tras un WAV grande y selector de descarga ambiguo. Se corrigieron, comprobando el trabajo real mediante GET y delimitando la descarga a su tarjeta. La revisión final se reanudó desde el trabajo real ya renderizado (`reviewResumed=true`), sin recrear el vídeo ni inventar estados. El error posterior de OCR se resolvió sobre el mismo MP4, tras inspección visual, sin reemplazarlo por otro contenido.

## R2 privado

Bucket configurado: `clipforge-clips`. Dentro de `clipforge-managed/v1/media/`:

- Primer vídeo: `744ac1b4ddfbf7fc81266598d7ec60eb96676368ab7260eb840c3feb67501a87.mp4`; SHA-256 `542b24a4d278cff7981ce67650e82a730d2692edf3737d30509c9d09168e7321`.
- Segundo vídeo: `c5a4c61c6a8eddd84ed927de4d0ac6b86ce12be6d1781a7fd99dcbe27168b9d8.mp4`; SHA-256 `ee992fe2576ed69c2f432c68076ad9342eca14cca42ac478813bc14f2a3565e5`.

Se pueden descargar desde el panel autenticado de Cloudflare o mediante **Clips guardados** en esta versión de ClipForge con los mismos bindings privados. No se habilitó acceso público. Retención: 30 días salvo **Conservar**. No se efectuó limpieza global ni se tocaron otros clips.

## Pruebas

- `npm ci`: dependencias instaladas desde el lockfile de la aplicación raíz; stack verificado: Next 16.3.8, React 19.2.8.
- Línea base anterior a estas reparaciones: 342 pruebas aprobadas, incluidas audiovisuales autorizadas. La historia de rescate aportaba además sus regresiones de selección revisadas.
- `CLIPFORGE_RUN_MEDIA_TESTS=true npm run verify`: lint, TypeScript y 352 pruebas aprobadas; cero fallos y cero omitidas.
- `CLIPFORGE_RUN_MEDIA_TESTS=true npm run build`: verificación anterior y build de producción local aprobados.
- `phase1:e2e`, `render:e2e`, `reframe:e2e`, `autoedit:e2e`, `news:e2e`, `owned-content:e2e`, `agent:e2e`: aprobados. Las noticias/contenido y decisiones de agente de estas regresiones son fixtures de prueba; no representan noticias investigadas ni evaluación de un modelo externo real.
- `reflection:e2e -- --r2`: aprobado, Kokoro y Whisper reales; ningún LLM externo.
- `mobile-reflection-e2e.mjs`: creación real seguida de revisión reanudada aprobada, reproducción y descarga local/R2 de ambos archivos. No hay mocks de API. No se probó en dispositivo Android físico.
- Instalador local ejecutado y repetido; modelos descargados por HTTPS y verificados con SHA-256. Sin API de pago, publicación social ni despliegue de producción.

## Historia conservada

- Integración previa conservada: `96de6389d8226d42abda40105ca666cc303e745a`.
- Rescate remoto revisado: `78acd95088e0bdb9dfc2669b53d1e21190bb8f5e` y sus cambios selectores/tests/docs, revisados antes de resolver el conflicto.
- Commit que conserva ambas historias: `d56eb11`.
- Implementación de estas reflexiones: `1a50022a0b3c1c690e10b08f5a8670e82f1eeefd`.
- `origin/main` inspeccionado y sin cambios: `f3d8ca33fd57452d475898fdf3adac4be210087c`.
- El objeto `7074082a4fbfb38119d40f8e8428872215386924` sigue ausente en este clon; no se utilizó.

Se leyeron las instrucciones y documentación existentes, incluidas las del editor y revisión de capacidades. Los documentos `ZCODE_EXTERNAL_CONTRACT.md` y `FUTURE_CHANNELS_AND_MARKETING.md` no están en la raíz: sus archivos reales están en `docs/`. No se inventaron documentos inexistentes.

## Qué falta

No se desplegaron estos commits ni se instalaron modelos en producción. No se probó un Android físico ni se obtuvo aprobación humana del timbre/entonación de las voces. La biblioteca no cubre cualquier historia. No se certificó persistencia completa de proyectos en infraestructura efímera ni capacidad 24/7: se observó FFmpeg por encima de 600 MB RSS, además de la web. R2 conserva los MP4, no reemplaza la persistencia de trabajo editable. El endpoint de recursos de 20 MB se verificó en Next con servidor Node persistente, no en funciones Vercel.

Uso y requisitos: [SPANISH_REFLECTION_STUDIO.md](SPANISH_REFLECTION_STUDIO.md). No se activó generación automática de cinco vídeos al día: la prioridad fue completar y verificar estas dos piezas.
