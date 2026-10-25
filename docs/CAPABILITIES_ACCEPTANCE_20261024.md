# Revisión funcional de ClipForge: resultados y presupuesto

Fecha: 24 de octubre de 2026, hora de Costa Rica. Aplicación de la raíz de `tg321920-netizen/Clip.thomas`, rama `codex/clipforge-finalization-live-clipping-20261024`. Base auditada: `31f8213d9ef09684c35e172686bce8e8e6b89299`; las correcciones de esta revisión se guardan después sobre esa rama. No se modificó main, no se desplegó ni se publicó contenido.

## Resultado práctico

El procesamiento técnico produce archivos reales y permite revisarlos desde una interfaz móvil. La selección editorial autónoma todavía no supera una aceptación: el modelo externo sigue bloqueado por saturación y la selección heurística puede mezclar temas. Un MP4 técnicamente válido no acredita un buen momento ni una publicación aprobada.

Se crearon dos grabaciones sintéticas propias de unos cuatro minutos, con guiones originales en español e inglés y un patrón visual. Se generaron **cinco MP4 por idioma**, de 25–35 segundos, sin solapamiento temporal. Se conservaron sus audios originales y se comprobaron H.264/AAC, decodificación completa, formato vertical 360×640, duraciones de pistas y subtítulos quemados. La prueba OCR examinó una muestra temporal de un clip por idioma; no certifica cada palabra de los diez videos. Los tests de render y reencuadre prueban 1080×1920 por separado.

Se subió una muestra de cada idioma al R2 privado real. Descarga íntegra por SHA-256, reproducción HTTP con rangos y reproducción/descarga desde Chromium móvil están comprobadas. No se activó acceso público. No se borraron originales ni archivos ajenos. Los clips de prueba quedan sujetos a su vencimiento y al control Conservar.

## Tipos de contenido

| Perfil implementado | Qué puede proponer | Qué se probó | Qué falta demostrar |
| --- | --- | --- | --- |
| PODCAST | Ideas, preguntas/respuestas, historias y desacuerdos | Candidatos y MP4 de narraciones propias; señales reales de audio y transcripción | Conversación humana, varias voces, selección editorial fiable y cambios de hablante |
| ENTERTAINMENT | Anécdotas, humor y reacciones | Análisis del perfil sobre las transcripciones propias | Chistes, desenlaces, contexto y precisión con un directo real autorizado |
| GAMING | Posibles jugadas y reacciones | Perfil, puntuaciones y candidatos sobre material de prueba | Comprensión de reglas, marcador, resultado y movimiento continuo; las imágenes aisladas no lo acreditan |
| NEWS | Declaraciones y fragmentos informativos | Perfil y candidatos; el guion de prueba aclara que sus ejemplos son ficticios | Verificación periodística de hechos reales, fuentes y contexto de cada recorte |
| MOTIVATION | Consejos y explicaciones con conclusión | Perfil y candidatos sobre narración propia | Calidad editorial y exactitud de consejos de personas reales |

Las cinco opciones existen y generaron candidatos; no se midió eficacia editorial real para cinco géneros. Audio RMS, actividad de escenas y coincidencias léxicas son señales heurísticas. No hay chat disponible en esta aceptación. La eliminación de repeticiones usa tiempo y similitud léxica; falta acreditar similitud semántica y duplicados visuales entre segmentos de directos.

## Idiomas y precisión medida

Whisper hizo inferencia real con detección automática del idioma, sin proporcionar el guion esperado al reconocedor. El guion sólo se usó después para medir distancia de edición de palabras. Se ignoraron mayúsculas, acentos y puntuación; no se corrigió el significado para mejorar la cifra.

| Idioma | Detección automática | Modelo tiny: error de palabras | Modelo base: error de palabras |
| --- | --- | --- | --- |
| Español | Correcta con ambos modelos | 149 / 490 = **30,4 %** | 53 / 490 = **10,8 %** |
| Inglés | Correcta con ambos modelos | 58 / 525 = **11,0 %** | 11 / 525 = **2,1 %** |

Son dos voces sintéticas limpias, no un benchmark de habla natural, acentos latinoamericanos, jerga, música, gritos o conversaciones superpuestas. Estas cifras no se pueden convertir en un porcentaje general de precisión del producto. Se detectaron errores de significado, incluida la pérdida de una negación en inglés; hace falta revisar los subtítulos.

El modelo base mejora ambas muestras y tarda más. En este entorno con dos hilos de Whisper: español tiny 24,4 s frente a base 52,8 s para 231,1 s de audio; inglés tiny 22,9 s frente a base 73,4 s para 235,3 s. No son medidas de Render gratuito. El archivo base ocupa 147.951.465 bytes y fue verificado contra el SHA-256 publicado por el repositorio oficial de modelos: `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`. Se instaló como opción de prueba, sin cambiar el modelo de producción ni prometer que cabe junto a toda la aplicación en 512 MB.

- **Transcripción:** convierte el habla original en texto. Español e inglés comprobados con el alcance anterior.
- **Subtítulos originales:** se generan a partir de esa transcripción, con tiempos reales cuando hay palabras disponibles y aproximaciones por segmento en otros casos. Se comprobó visibilidad de dos muestras; falta medir alineación palabra por palabra con anotaciones humanas.
- **Traducción de subtítulos:** no está implementada/verificada en este flujo de clipping.
- **Doblaje del clip:** no está implementado/verificado. Se conserva el audio original.
- **TTS de contenido original:** existe, pero no equivale a traducción ni a doblaje de un video existente.
- **Otros idiomas:** el modelo es multilingüe, pero esta aceptación no los prueba ni los promete.

## Selección editorial: evaluación y límites

### IA externa real

Se solicitó al agente preparar hasta cinco clips de unos treinta segundos, con fuente propia, derechos confirmados y modelo configurado `glm-4.6v-flash`. Después del reintento limitado, terminó en `WAITING_INFORMATION` con:

> The service may be temporarily overloaded, please try again later

La prueba devolvió código de salida 2 y conservó evidencia del bloqueo. No se cambió de modelo, no se compró un plan, no se sustituyeron sus respuestas por resultados simulados. No se ejecutó la segunda evaluación inglesa tras ese bloqueo. La comprobación HTTP 200/JSON válida documentada en la fase anterior acredita una respuesta estructurada, no esta selección editorial completa.

### Heurísticas y revisión de ventanas

El lote local produjo diez MP4 reales. Esta revisión de sus transcripciones/guiones identifica límites que la validación de archivos no detecta:

| Clip | Ventana del original | Motivo técnico de selección | Revisión del texto y contexto |
| --- | --- | --- | --- |
| ES 1 | 54,28–86,52 s | Hook, información y duración; RMS 5/100 | Empieza con «También» y mezcla conversación con una historia de gaming. Requiere otro corte |
| ES 2 | 0–32,08 s | Pregunta inicial y estructura; RMS 11/100 | Explicación de recuperación; los subtítulos tiny tienen errores graves. Corregir texto antes de entregar |
| ES 3 | 139,44–168,96 s | Claridad/estructura heurísticas; RMS 15/100 | Pasa de noticias a aprendizaje. Requiere separar temas |
| ES 4 | 201,08–231,09 s | Información y cierre; RMS 9/100 | Explica revisión/exportación, pero tiene errores de transcripción. Requiere corrección |
| ES 5 | 172,64–201,08 s | Afinidad léxica y duración; RMS 11/100 | Mezcla un consejo con requisitos del archivo final. Requiere otro corte |
| EN 1 | 8,72–40,56 s | Información y estructura; RMS 12/100 | Recuperación de archivos con una idea razonablemente continua; revisar palabras erróneas |
| EN 2 | 72,84–103,48 s | Hook e información; RMS 8/100 | Mezcla popularidad con un ejemplo de gaming. Requiere separar temas |
| EN 3 | 145,72–175,88 s | Información/estructura; RMS 13/100 | Mezcla verificación y aprendizaje; la transcripción pierde una negación importante. No entregar así |
| EN 4 | 204,12–231,24 s | Duración y claridad heurísticas; RMS 15/100 | Revisión de subtítulos/publicación; revisar texto y final contra el audio |
| EN 5 | 106,76–134,68 s | Claridad heurística; RMS 6/100 | Mezcla gaming y noticias. Requiere separar temas |

Es una revisión de ingeniería de las ventanas textuales, no una aprobación audiovisual para publicar. Todos los clips conservan revisión editorial pendiente. La muestra confirma que se seleccionan momentos de energía baja y que la puntuación no basta para encontrar los mejores momentos. `CoherenceGate` existente inspecciona investigación/guion/recursos de noticias originales; no se lo presentó como verificador universal de clips sin esos datos.

## Fallos corregidos en esta revisión

1. Pedir cinco clips rechazaba todo el lote si sólo había menos candidatos válidos. Ahora entrega los disponibles y muestra cantidad solicitada, cantidad real y aviso. Cero candidatos sigue siendo un error explícito.
2. La recuperación distinguía únicamente por cantidad. Ahora una entrega editorial deliberadamente menor se reconoce sólo después de completar todos los renders seleccionados; una interrupción parcial sigue reanudándose. Hay regresión unitaria y una prueba de agente con solicitud de cinco y selección simulada de dos, MP4 reales y recuperación sin otra llamada de ranking.
3. Proyectos con códec ausente hacían caer la página móvil al usar `toUpperCase()`. Ahora muestran metadata pendiente; el listado también reconstruye la URL del original cuando falta. La prueba móvil conservó esos datos incompletos para comprobar la corrección.
4. El OCR confundía bordes del patrón de prueba con texto. Se añadió un segundo modo de segmentación sobre el mismo fotograma, manteniendo la exigencia de palabras coincidentes. Se inspeccionó el fotograma; no se sustituyó el video por una imagen ni se eliminó la aserción.

## Pruebas y evidencia

La línea base ejecutó 341 tests: 338 aprobados, cero fallos y tres audiovisuales omitidos por su flag explícito. La verificación posterior con `CLIPFORGE_RUN_MEDIA_TESTS=true` ejecutó **342 tests aprobados, cero fallos y cero omitidos**, lint, TypeScript y build. También pasaron `agent:e2e`, `render:e2e` y `reframe:e2e`. Las respuestas del modelo en `agent:e2e` son fixtures locales explícitos.

La prueba móvil funcional usa Chromium a 393×851 sin interceptar APIs: historial real, MP4 reales, reproducción, descarga con hash, rangos y reproducción de R2 real para ambos idiomas. Se comprobó que la selección del agente conserva el requisito de confirmar derechos. No se probó un Android físico. Un recurso devolvió 404 en consola; no hubo excepciones de JavaScript tras la reparación ni fallos de los medios comprobados.

Artefactos de esta ejecución, fuera de Git:

- tiny: `artifacts/editor-languages/run-BQXHm0/evidence.json` y referencias/transcripciones de ambos idiomas.
- base: `artifacts/editor-languages/run-7HXQhM/evidence.json`.
- diez MP4, pruebas OCR/R2 y motivos: `artifacts/editor-languages/run-BQXHm0/heuristic-c58b7bd3-e3ef-47f9-b4a4-1a9c6a812005/evidence.json`.
- ZIP de diez MP4 y textos: mismo directorio, `review-clips.zip` (13.049.089 bytes).
- interfaz móvil real: mismo directorio, `mobile/evidence.json` y `mobile/review.png`.
- IA externa bloqueada: `artifacts/editor-languages/run-7HXQhM/real-ai-3b13c4f7-74bf-417e-ac63-65e054595837/evidence.json`.

Las dos muestras nuevas del R2 privado están bajo `clipforge-clips/clipforge-managed/v1/media/`:

- español: `635fc55dea836c56dc850112ea44c7cbc3c368496aeeebb4a1a32c0ec91ac7df.mp4`, 1.394.108 bytes.
- inglés: `2f0312494e178d583769e6857659d3e742d49bd461c0e7d27005cec40b8f5510.mp4`, 1.375.915 bytes.

Son muestras técnicas con selección heurística y subtítulos pendientes de corrección, no clips de Westcol ni piezas aprobadas.

## Despliegue y persistencia

La consulta de solo lectura a `https://clipforge-studio-trial.onrender.com/api/health` respondió HTTP 200, FFmpeg/FFprobe y almacenamiento utilizables, publicación OFF y versión `e1045dfae859e773ac65f4b12b1ef1ed10e20a3a`. Esa versión es distinta de la rama local auditada. No se acreditan allí estas correcciones, el nuevo agente ni R2 por el simple hecho de que el health check responda.

`render.yaml` sigue apuntando a main. No se cambió ni se activó un despliegue. R2 preserva los clips finales, no todos los originales, transcripciones o trabajos. En este entorno no hay `CLIPFORGE_REDIS_URL`, `REDIS_URL` ni `DATABASE_URL`. Sin acceso al panel de infraestructura no se puede certificar el estado o fecha de caducidad de una base de datos externa desconocida. No hay que depender de una base supuestamente gratuita sin comprobar su cuenta. Render documenta 30 días para Postgres gratuito; eso no implica una caducidad equivalente de Neon.

Captura de cuatro horas, cola incremental para esa duración, contexto entre segmentos, VOD al terminar, almacenamiento de originales y disponibilidad permanente siguen sin aceptación. Reencuadre vertical está probado; seguimiento fiable de protagonista y montaje automático de dos participantes siguen pendientes.

## Presupuesto mensual: cuatro horas diarias y cinco clips diarios

Supuesto: treinta días, **120 horas de entrada** y **150 clips de treinta segundos**, equivalentes a 75 minutos de salida. Precios en USD consultados el 24 de octubre de 2026; no se contrató nada.

| Partida | Estimación | Condición |
| --- | --- | --- |
| GLM-4.6V-Flash | USD 0 en la tarifa actual | Gratis según Z.ai; disponibilidad y cuotas no garantizadas. Esta prueba se bloqueó por saturación |
| Whisper y FFmpeg locales | USD 0 de API | Consumen CPU/RAM/electricidad; el software gratuito no aporta un servidor encendido |
| R2 Standard | USD 0 dentro de cuotas | 10 GB-mes, 1 millón de operaciones A y 10 millones B gratuitos por cuenta; salida de R2 gratuita |
| Servidor propio ya disponible | USD 0 de alquiler adicional | Aparte electricidad/conexión. Necesita permanecer encendido y tener capacidad; no equivale a un servicio gratuito alojado |
| Render gratuito | USD 0 | Pruebas y uso intermitente; se duerme tras 15 minutos sin tráfico entrante, 750 horas gratuitas por workspace, disco efímero. No se promete captura continua |
| Render Starter, alternativa | Desde USD 7/mes | 512 MB y media CPU. No se recomienda prometer este volumen sin medir memoria/rendimiento |
| Render Standard, presupuesto inicial alojado | Desde USD 25/mes | 2 GB y una CPU; objetivo más razonable para evaluar, todavía sin benchmark de cuatro horas ni garantía de capacidad |

Con un bitrate total de 2–8 Mbit/s, los 150 clips ocuparían aproximadamente **1,1–4,5 GB**. El render usa calidad CRF, no un tamaño fijo: hay que medir los archivos reales. Retención de treinta días y límite de biblioteca de 8 GB reducen almacenamiento, pero Conservar acumula archivos y la cuota gratuita se comparte con otros buckets. Guardar los 120 h de originales a 3–6 Mbit/s requeriría unos **162–324 GB**: los originales necesitan una política distinta y almacenamiento temporal acotado. No se presupuestó conservar todo el directo en R2.

Presupuesto de prueba con equipo propio: **USD 0 de servicios**, más electricidad/conexión, sin garantía de disponibilidad de la IA. Presupuesto inicial para evaluar un servidor alojado con más margen: **aproximadamente USD 25/mes**, antes de impuestos, cómputo extra, tráfico cobrado por el servidor o persistencia adicional. No es una cotización ni una promesa de procesar cuatro horas diarias. Conviene validar selección editorial y un ensayo continuo antes de pagar.

No se activó una alternativa paga de IA. Para comparar un modelo elegido expresamente, el costo sería `(tokens de entrada / millón × tarifa de entrada) + (tokens de salida / millón × tarifa de salida)`; los tokens de 120 horas todavía no se han medido. Vercel sirve interfaz/endpoints ligeros, no esta carga de FFmpeg/Whisper.

Fuentes oficiales: [Z.ai](https://docs.z.ai/guides/overview/pricing), [R2](https://developers.cloudflare.com/r2/pricing/), [Render](https://render.com/pricing), [límites gratuitos de Render](https://render.com/docs/free), [modelos de Whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp).

## Uso desde Android cuando esta versión esté desplegada

1. Entrar en la web de ClipForge e iniciar sesión como propietario.
2. Subir un MP4/MOV/WebM propio o importar una URL autorizada; esperar a que el original esté disponible.
3. Para análisis local, elegir Crear mejores clips, perfil, cantidad cinco y duración treinta segundos. Para IA real, ir a Autopilot → Agente editor, seleccionar el proyecto, cinco clips/treinta segundos y confirmar derechos/envío al proveedor. La API debe estar disponible.
4. Consultar Mis videos. Un trabajo encolado no es un render terminado. Si hay menos candidatos válidos, leer el aviso y revisar los entregados.
5. Reproducir cada candidato y revisar principio, final, sentido, audio y texto. El editor de subtítulos existe en las opciones avanzadas del proyecto; su corrección manual no se volvió a validar de extremo a extremo en esta aceptación.
6. Descargar cada MP4 o el ZIP local del proyecto. En Clips guardados, comprobar que R2 confirmó el archivo; marcar Conservar si se necesita más allá de treinta días. Guardar el original aparte para reeditar.
7. Preparar la publicación para revisión. Ninguna acción de esta misión publica, programa campañas ni habilita publicación automática.

## Reproducir en el entorno de desarrollo

```bash
source /workspace/clipforge-tools/activate.sh
CLIPFORGE_RUN_MEDIA_TESTS=true npm run build
npm run languages:e2e
npm run capabilities:e2e
npm run agent:e2e
npm run render:e2e
npm run reframe:e2e
```

`languages:e2e` crea audio/imagen propios y ejecuta Whisper; `capabilities:e2e` usa esos proyectos con selección heurística y render real. `--r2` añade explícitamente escritura/lectura en el R2 configurado, sin limpieza de archivos. `--real-ai` llama explícitamente al modelo gratuito configurado y devuelve código 2 si se bloquea; no se debe interpretar como un test editorial aprobado. `CLIPFORGE_LANGUAGE_FIXTURE_DIR` selecciona una ejecución bilingüe ya terminada. La comparación base se hizo configurando `WHISPER_CPP_MODEL_PATH=/workspace/clipforge-tools/ggml-base.bin` sólo para la prueba, después de activar herramientas.

Para la prueba móvil, usar `CLIPFORGE_REVIEW_EVIDENCE=/ruta/al/evidence.json node scripts/mobile-editor-review-e2e.mjs`, con la evidencia bilingüe que ya incluyó R2. Inicia y detiene su propio servidor de pruebas. No es un enlace de acceso al propietario. Terminar el build antes de abrir ese servidor: el build cambia sus archivos de Next.js.
