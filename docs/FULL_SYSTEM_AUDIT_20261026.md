# ClipForge: auditoría y entrega local del 26 de octubre de 2026

El editor y los subtítulos tienen nuevas correcciones comprobadas con vídeo
auténtico, workers, navegador móvil y R2 real. **La versión nueva no está
desplegada y no hay una URL nueva certificada para Android.** La traducción
automática necesita revisión: esta prueba encontró errores de significado y
comprobó su corrección desde la interfaz. No se declara ClipForge 100 % terminado.

## Código y versiones preservadas

- Checkout operativo: `codex/clipforge-core-rescue`, conforme a AGENTS.md.
- Integración: `work/clipforge-functional-review-20261025-5d025fe`.
- Código auditado: `a4b23050b38f866720343cd44f1d039dc8f89689`.
- Nueva candidata: `clipforge-development-candidate-20261026.4`; referencia
  congelada `preview/clipforge-android-audit-20261026.4`, mismo SHA de código.
- Se conservan `b6936e610e8cd0fafe05d4d326f57db9537b7d24` y
  `761e291d72426bac647d513ac7e08ad75dcad9f1` con sus etiquetas anteriores.
- No hubo cambios de main, force-push, despliegues, planes, StoryMotion,
  publicación, monitor permanente o credenciales.

Se inventariaron 95 rutas API y 149 archivos de servicios. Se revisaron los
flujos centrales y la cobertura existente, no se ejecutaron los 95 endpoints
contra proveedores externos. Inventario: `artifacts/full-audit-20261026/module-inventory.json`.

## Errores encontrados y reparación

| Prioridad | Problema reproducido o confirmado en el código | Resultado |
| --- | --- | --- |
| Alta | Subtítulos guardaban un proyecto leído antes de adquirir el lock; podían borrar cambios concurrentes. | Mutación bajo el lock compartido y regresión concurrente. |
| Alta | Auto Focus, Auto Edit y solicitudes privadas también escribían copias antiguas. | Se integran con el lock de proyecto y las revisiones de edición. |
| Alta | Un render podía guardar su copia antigua del clip sobre ajustes o notas nuevos. | Solo actualiza sus campos; comprueba la revisión de edición. |
| Alta | El editor de subtítulos podía crear otro clip FILL al modificar uno CONVERSATION. | Reencola el ID existente. La prueba móvil conservó ambos IDs y encuadres. |
| Alta | El recorte manual no tenía acceso a subtítulos y no existía traducción del clipping. | Cuatro modos conectados al worker existente y editor/SRT accesibles. |
| Alta | Sin el flag explícito, un runtime Render no exigía autenticación por defecto. | Detección de Render; API sin sesión devuelve 401 incluso con el flag false. |
| Alta | El matcher excluía paths API con puntos. | `/api/:path*` siempre pasa por el control de propietario. Verificado con petición real. |
| Alta | Subida y ensamblado podían llenar el disco antes de fallar. | Reserva preventiva y margen de 128 MiB; respuesta 507; fragmentos completos conservados. |
| Alta | Eliminar un proyecto podía borrar el original compartido por clips derivados. | Rechazo 409 si existen referencias o trabajos pendientes; lock del proyecto. No se borraron originales reales. |
| Media | Guardar el mismo texto volvía a invalidar el MP4. | Comparación normalizada; el guardado sin cambios conserva revisión y archivo. |
| Media | Karaoke podía mostrar palabras anteriores después de corregir el texto. | Se descartan palabras que no corresponden al texto editado. |
| Media | Bloques abarcaban pausas largas y se aceptaban tiempos superpuestos. | Separación por pausas y rechazo de solapamientos; exportación SRT. |
| Media | Marcas como `[APPLAUSE]` se mezclaban con frases y traducciones. | Se excluyen del diálogo procesado; ASR bruto intacto. Caché heurística v4. |
| Media | Una pregunta posterior otorgaba puntuación de apertura a un inicio sin pregunta. | Hook limitado al comienzo; penalización de inicios dependientes de contexto. Sigue siendo una heurística. |
| Media | Errores al refrescar progreso/historial quedaban ocultos o persistían tras recuperar red. | Avisos separados y recuperación de la consulta al volver la conexión. |
| Media | Faltaba el traductor pero el trabajo podía consumir ASR y reintentos repetidos. | Comprobación previa y WAITING_RESOURCE; otros recortes siguen operativos. |

## Capacidades y evidencia

| Capacidad | Estado | Alcance real |
| --- | --- | --- |
| Login, subida MP4/MOV/WebM, original, recorte manual, cola y descarga | VERIFIED_LOCAL | Aceptación audiovisual previa preservada; nueva interfaz de subtítulos y seguridad ejercitadas con APIs reales. |
| Flujo automático hasta MP4 subtitulado/traducido | VERIFIED_LOCAL | Archivo auténtico de 150 s → Whisper real → audio/escenas → dos candidatos de cinco → modelo local → FFmpeg. |
| Calidad de selección general | PARTIAL | Explicaciones y límites de frase; no eficacia viral certificada ni benchmark editorial de todos los géneros. |
| Español → español / inglés → inglés | VERIFIED_LOCAL | MP4 reales y SRT con ASR previo del mismo archivo, verificado por hash. |
| Inglés → español sin corrección | PARTIAL | Inferencia real; se encontraron errores de nombres y expresiones. No es calidad aprobada automáticamente. |
| Traducción revisada y corrección de subtítulos | VERIFIED_LOCAL | Comparación con inglés, edición móvil, re-render del mismo clip y persistencia de la versión automática anterior. |
| Sin subtítulos | VERIFIED_LOCAL | Recorte manual sin ASR/IA ya aceptado; no se repitió ese render. |
| Audio original | VERIFIED_LOCAL | AAC, voz original; correlación 0,999891 / 0,999859 y desfase medido 0 s para los dos clips corregidos. |
| R2 privado, enlace vencido, renovación, descarga | VERIFIED_LOCAL | R2 real: 403 para firma vencida; renovación 200 y SHA idéntico. |
| Recuperación de proyecto | VERIFIED_LOCAL | Raíz vacía restaurada con original, ASR, análisis, cortes, subtítulos corregidos, versión automática y MP4 íntegros. |
| Uso en Android emulado | VERIFIED_LOCAL | Chromium 393×851 con tacto, APIs reales, reproducción, descarga, pérdida de red y regreso. |
| Android físico y editor por Internet | BLOCKED | No hay ensayo autorizado/desplegado; faltan conexión administrativa y prueba del propietario. |
| Código de ensayo separado | READY_FOR_DEPLOYMENT | Plantilla validada; no acredita recursos reales del hosting ni traducción instalada allí. |
| Captura LIVE actual de Westcol | NOT_TESTED | `LIVE_NOT_TESTED`; no se inició un monitor ni se observaron mensajes nuevos. |
| Chat y recuperación HLS | PARTIAL | Código y regresiones conservados; HMAC y contadores acotados, sin guardar mensajes o IDs personales. Falta nueva aceptación LIVE. |
| Z.ai real | BLOCKED | Última evidencia: HTTP 429. No se repitió la llamada ni se usó un modelo de pago. |
| Cambio fiable de hablante / seguimiento visual | PARTIAL | Usa etiquetas aportadas cuando existen; SPEECH_ZOOM no es reconocimiento de protagonistas. |
| Podcasts sin vídeo | PARTIAL | La subida actual admite MP4/MOV/WebM; falta un flujo para archivos únicamente de audio. |
| Doblaje del clipping | PARTIAL | No está integrado; el TTS de historias no acredita doblaje. Se conserva el audio original. |
| Películas/documentales autorizados | NOT_TESTED | Motor compartido conservado; no se procesó aquí una fuente cinematográfica para certificarlo. |
| Publicación y conectores sociales reales | BLOCKED | Publicación OFF; los mocks y pruebas de conectores no acreditan OAuth o publicación real. |

No se exige chat a podcasts o vídeos largos. Se conserva el motor compartido;
no se ejecutaron noticias, historias o narraciones sintéticas como entregables.

## Resultados audiovisuales auténticos

Fuente inglesa: [grabación NASA/JFK en Rice, dominio público](https://commons.wikimedia.org/wiki/File:President_Kennedy_speech_on_the_space_effort_at_Rice_University,_September_12,_1962.ogv).
Se conservaron licencia/metadatos consultados. Original OGV SHA
`0b58b4a955497f8acefb0de0633f753f65212b60bcd7ad08a4427a409a59598a`.
Se importó un extracto auténtico de las posiciones 480–630 s, compatible con MP4.
La fuente tiene 352×240: exportar a 720p no recupera detalle perdido del original.

Proyecto automático `a1148060-64cf-427d-9a52-d67d80b8f56e`:

| Clip corregido | Posición en la grabación | Duración FFprobe | SHA-256 | Registro privado R2 |
| --- | --- | --- | --- | --- |
| Preguntas sobre la exploración y la Luna | 493,90–524,12 s | 30,233333 s | `db6cf37b79fda297a8293949640e903ea4083b3fa36ec7ab8ed0d55db62d36a6` | `a5748a7579c3159bceab7a997085e3ba52401638bf66df3dc98fb854f7be50e8` |
| Instalaciones y potencia del cohete | 575,28–605,80 s | 30,533333 s | `e88b0b26695c7a790dc34920569a800a5389fd551d77709bd5301c467de61361` | `2afc9d4cdb18dd17f79c4410d0dabfd946a2c1ecd7e9bd366eb5d84c2a8a140e` |

Ambos son H.264/AAC, 720×1280, decodificables y con subtítulos legibles comprobados
en fotogramas. Selección LOCAL_HEURISTIC; revisión del propietario PENDING.
El clip de preguntas requiere valorar si conviene ampliar su contexto.
No hay chat para esta grabación y no se atribuyen espectadores, picos o emociones.

El modelo confundió Rice con arroz, «come again» con volver a empezar y «ground
shake» con batido de tierra. Se corrigieron desde el formulario móvil. Esas
correcciones fueron de esta revisión de Codex, **no resultado automático del modelo
ni aprobación humana del propietario**. Las dos versiones automáticas erróneas
se conservaron en R2 como REJECTED. Los clips anteriores de Westcol no cambiaron.

Son dos momentos seleccionados, cuatro MP4 contando las versiones antes/después
de la corrección. Se agregaron dos muestras de subtítulos originales: 25,5 s
del discurso en inglés y 8 s de vídeo autorizado previo en español. Esta última
es QA de subtítulos y no un acontecimiento nuevo entregado de Westcol. **Cero
capturas LIVE nuevas y cero vídeos artificiales como resultados.**

Archivos y pruebas locales, fuera de Git:

- `artifacts/subtitle-translation/run-3Yk0Ap/corrected-evidence.json`.
- `a55dfa2d-1bcf-4194-a4e8-75c50d1979d1-corrected.mp4` y
  `b33c948d-a24a-451a-930e-616cdc10807d-corrected.mp4`, en ese directorio.
- SRT, audio-proof.json, expired-link-proof.json y translation-quality-review.json.
- `restored-corrected/`: archivos recuperados, sin borrar la raíz anterior.
- `artifacts/native-subtitles/run-wU4SpL/evidence.json`: originales ES/EN.
- `artifacts/full-audit-20261026/{rice,rocket}-corrected.png`: revisión visual.

## Pruebas y fallos conservados

- Baseline: verify, 461 aprobadas y seis nativas optativas omitidas.
- Código final: build incluye lint, TypeScript y suite: **474 aprobadas, cero
  fallidas, seis omitidas de 480**. Las omitidas no se cuentan como aprobadas.
- Queda un warning de trazado dinámico en LiveSessionStore. Se inspeccionaron
  108 manifiestos de despliegue: ninguno incluye storage, artifacts o archivos
  .env. El warning no se presenta como un fallo corregido.
- Pruebas nuevas de concurrencia, SRT, texto/karaoke, idioma, pausa del worker,
  disco, fuente compartida, marcas ASR y puntuación de apertura.
- Prueba móvil con inferencia/servicios reales: subida, selección, dos MP4,
  página cerrada, reproducción, descarga/SRT, corrección, guardado sin cambio,
  red interrumpida/restablecida, 409 al intentar borrar el original compartido.
- R2 real y restauración en raíz nueva; hashes y textos coinciden.
- Hubo un STORAGE_BUSY durante el primer archivado concurrente. Se reanudó con
  backoff y sin nuevos encodes. El ejecutor Playwright necesitó el proxy del
  entorno para descargar la URL S3 firmada; corregirlo permitió la descarga.
  Un error ReferenceError del script de QA también se corrigió. Se preservaron
  esas ejecuciones fallidas; no se confunden con fallos definitivos de R2.
- No se repitieron el benchmark 0,1 CPU/512 MiB ni los renders antiguos.
  Render/reframe sintéticos históricos siguen separados de las nuevas pruebas
  audiovisuales auténticas. Z.ai y Android físico no se ejecutaron aquí.

## Recursos, recuperación y ensayo

El lote original de dos clips tardó 177,168 s en el entorno local; la transcripción
ocupó aproximadamente 97,7 s. Una muestra de RSS del proceso Whisper small Q5
fue 563 MiB, sin incluir el servidor: **no acredita caber en 512 MiB**. El perfil
gratuito anterior de 305 s por 30 s sigue siendo una medición local distinta.
No se midió rendimiento en Render ni se certificó análisis de cuatro horas en
tiempo real. Se mantienen 720p/1080p y un encoder; no se reduce la calidad elegida.

El traductor CPU opcional usa CTranslate2 4.6.3 y SentencePiece 0.2.1. Modelo
Argos en-es 1.0; paquete SHA
`d698d0ef87ad70d5d184b7fa6965905bf4368f09a2bb9ffb165a79bac96af0c4`.
Modelo SHA `d5771f823c9dd7eedcf9367c116aede65613a194f761a81826351e2bccb194c4`.
Pesos y dependencias no se guardan en Git. Instalación explícita, sin autoarranque:

    bash scripts/install-local-translation.sh /ruta/runtime

Configurar en el servidor de procesamiento:

    CLIPFORGE_TRANSLATION_PYTHON=/ruta/runtime/translation-venv/bin/python
    CLIPFORGE_TRANSLATION_MODEL_PATH=/ruta/runtime/translation-model-en-es

La inferencia no descarga modelos ni llama APIs externas. Si falta el recurso,
el trabajo queda WAITING_RESOURCE antes de transcribir; el modo sin subtítulos
y los demás proyectos siguen utilizables. El blueprint de bajo consumo NO
instala ni certifica este modelo automáticamente.

R2 conserva únicamente lo que se confirmó: original, metadata, cortes y MP4.
Una subida incompleta o cambios posteriores al checkpoint pueden perderse.
Cerrar Chrome no cancela trabajos guardados; suspender/reemplazar la instancia
puede interrumpirlos. Las restauraciones dejan pendientes pausados. Los locks
requieren un filesystem compartido en una sola instancia; no se certificó un
clúster ni vigilancia permanente.

`render.audit-preview.yaml` propone otro servicio `clipforge-development-preview`,
plan free, Node 22.23.4, autenticación, R2, un encoder y autoDeploy OFF, desde la
nueva referencia congelada. Pasó el esquema oficial. No creó un servicio.
RENDER_API_KEY sigue sin vinculación en el entorno activo; no se enviaron nuevas
consultas administrativas sin credencial. No se conoce el plan/cupo real de la
cuenta ni la caducidad de sus posibles bases de datos. No se dependió de ellas.

## Commits de reparación y uso desde Android

- `8e6226032e54b3cc6a022bccc4d8ad4ef75f98bf`: subtítulos atómicos y SRT.
- `a0684837369308012fd8fad721283452015afaec`: autenticación Render y disco.
- `c66f45ca8453cf9194fedecedb19f588927a9c42`: traducción local y flujo móvil.
- `1452805d751a4397c2800a63087589849a06e68d`: recorte correcto, fuentes y reintentos.
- `25152d9915e1e8778fa93e437744e9effea04a13`: recursos ausentes, scoring y candidata.
- `a4b23050b38f866720343cd44f1d039dc8f89689`: Auto Edit, Auto Focus y recortes
  privados actualizan el proyecto bajo su lock; candidata .4 inmutable.

Archivos cambiados: servicios SubtitleService, LocalTranslationProvider,
ClipService, BestClipsService, ViralScoreService, AudioEnergyService, ProjectStore,
subidas; owner-auth, proxy, guard de eliminación y normalizador; rutas de clips/
subtítulos y proyecto; ManualClipEditor, ClipSubtitleEditor, ProjectPipeline,
MediaTools, RecentProjects y tipos; worker de render, instalador/QA, regresiones y
plantilla de ensayo. El historial Git conserva el detalle por archivo.

Después de un ensayo autorizado: entrar con la clave del propietario → SUBIR Y
EDITAR VIDEO → subir MP4/MOV/WebM → elegir intervalo/formato/resolución y modo de
subtítulos → Generar MP4. Para lotes: CREAR MEJORES CLIPS, cantidad/duración/idioma.
Se puede cerrar la página mientras el servidor siga activo. En proyectos guardados,
abrir el proyecto → CREAR MEJORES CLIPS → Revisar candidatos y ajustar cortes →
comparar inglés, corregir, guardar y descargar SRT/MP4. En la biblioteca, elegir
Todos mis videos para fuentes distintas de Westcol y renovar el acceso privado.

**Próximo paso externo:** vincular/aplicar privadamente RENDER_API_KEY para
api.render.com. Primero GET administrativo; después aprobación específica para
crear el ensayo con la candidata revisada. El propietario completa Android físico
en esa URL. Hasta entonces no hay una entrega VERIFIED_DEPLOYED del editor nuevo.
