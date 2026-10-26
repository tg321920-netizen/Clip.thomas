# ClipForge: estabilidad y automatización comprobadas

Fecha: 26 de octubre de 2026, UTC. Aplicación de la raíz de `tg321920-netizen/Clip.thomas`. No se creó otra aplicación ni se modificaron StoryMotion, producción o publicaciones sociales.

**Actualización del 26 de octubre, 04:38 UTC:** se produjo **un clip auténtico adicional de Westcol de 29 segundos**, procedente del VOD autorizado, con audio original y archivado en R2 privado. Se comprobó reproducción y descarga desde Chromium móvil emulado con APIs reales. Z.ai respondió HTTP 429; la selección local permanece pendiente de revisión, sin chat observado para ese intervalo. No se acreditó una nueva captura LIVE ni se activó el monitor permanente. El fixture sintético anterior es exclusivamente QA y se excluye de la biblioteca del propietario.

El estado para continuar, identificadores privados, hashes, reparaciones y resultados de esta fase están en [CODEX_RESUME_REAL_WESTCOL.md](CODEX_RESUME_REAL_WESTCOL.md). Las secciones siguientes documentan la fase anterior; sus pruebas técnicas no cuentan como clips de Westcol ni como automatización activa.

## 1. Referencias verificadas e historial conservado

| Referencia al iniciar | SHA completo |
| --- | --- |
| `main` remoto | `f3d8ca33fd57452d475898fdf3adac4be210087c` |
| `codex/clipforge-core-rescue` remoto | `78acd95088e0bdb9dfc2669b53d1e21190bb8f5e` |
| `work/clipforge-functional-review-20261025-5d025fe` remoto | `af411716e897af9a0b5ccd8e15c9f5f02c490713` |

Se comprobó que `78acd950..af411716` contiene los **26 commits anteriores**. Se conservaron como ancestros. Por la instrucción de `AGENTS.md`, el checkout local continúa llamándose `codex/clipforge-core-rescue`; sus commits de reparación se envían únicamente a la rama remota de integración `work/clipforge-functional-review-20261025-5d025fe`. No se actualizan `main` ni la rama remota core-rescue y no se usa force-push.

Se leyeron `AGENTS.md`, `docs/CLIP_EDITOR_AGENT.md` y `docs/WESTCOL_CAPTURE_RESCUE_20261025.md`. Versiones verificadas desde package/lock: Next **16.3.8**, React/React DOM **19.2.8**. Pruebas locales con Node 24; CI utiliza Node 22.

## 2. Fallas encontradas y comparación

| Antes | Reparación / comportamiento actual |
| --- | --- |
| El monitor podía esperar edición y archivo antes de pedir otra captura. | Captura nativa, materialización, editor, render y R2 tienen workers separados. El capturador no espera render ni subidas a R2. |
| Una cola lenta podía crecer o detener la siguiente captura. | Hasta seis trabajos en cola/procesando por sesión entre materialización y medios; los originales continúan mientras existe disco. Prioridad por reacción observada y antigüedad del trabajo. |
| Reanudar un HLS podía volver a usar segmentos anteriores. | Índices originales inmutables, SHA-256, ventana por UTC y conservación de los fragmentos ya recibidos. La transición LIVE→VOD conserva el límite de recuperación. |
| FFmpeg aplicaba su comienzo LIVE por defecto y omitía parte de la ventana elegida. | Se abre la ventana HLS desde su primer segmento recuperable y se vincula el reloj al primer segmento realmente servido, no solo al comienzo anunciado por el manifiesto. |
| Un intervalo perdido podía aparecer dos veces. | Un intervalo abierto de interrupción se cierra con el tiempo del siguiente segmento, evitando duplicar esa misma pérdida. Se distinguen también segmentos iniciales no recibidos. |
| Medir espacio podía fallar si otro proceso retiraba un archivo de bloqueo entre `readdir` y `stat`. | Se tolera exclusivamente `ENOENT` durante ese recuento. Errores de permisos/disco siguen fallando de forma segura. Regresión determinista añadida. |
| Los errores nativos quedaban escondidos tras un error genérico. | Código/etapa y diagnóstico saneado; errores HLS recuperables acotados y persistidos sin URLs, tokens o encabezados. |
| Una limpieza histórica borraba partes MP4 antiguas. | Esos archivos se conservan apartados, sin integrarlos como si fueran originales verificados. Los TS originales tampoco se borran automáticamente. |
| Tener MP4 finales en R2 no preservaba necesariamente sus fuentes y colas. | Archivo independiente de originales y checkpoints con hashes, cobertura confirmada, manifiestos privados y restauración explícita con workers detenidos. |
| Z.ai devolvía el esquema en lugar de datos, o JSON incompleto. | Petición compacta de una instancia de datos; validación estricta de IDs/campos; recuperación solo de envoltorios completos; JSON truncado sigue rechazado. |
| El panel nuevo trató inicialmente una respuesta `{jobs, issues}` como un array. | Se corrigió contra el contrato existente; la prueba móvil con API real pasó después de la reparación. |

Se reutilizan `UrlIngestService`, `IngestJobStore`, `JobStore`, `BestClipsService`, `TranscriptCandidateProvider`, señales de audio/escenas, `VisualEvidenceService`, `RenderService`, `ClipLibraryService`, el cliente IA y el sistema de acceso del propietario. Las piezas nuevas cubren funciones que esos servicios no ofrecían: diario de originales continuos, coordinación acotada de ventanas, deduplicación entre lotes y checkpoints/restauración de fuentes. No se incorporó otra aplicación ni un segundo agente con shell.

## 3. Captura VOD y LIVE: evidencia separada

| Caso | Resultado |
| --- | --- |
| VOD real de Westcol, dos fuentes anteriores de unos 90 s | Conservadas; respaldo nuevo de ambas fuentes en R2 y restauración en directorio aislado. Se verificaron hashes y decodificación de fuentes y clips. No son capturas nuevas. |
| Nuevo LIVE de Westcol | **PENDIENTE.** Última consulta: `26/10/2026 02:50:44 UTC, SOURCE_OFFLINE / SOURCE_STATE`. No se sustituyó por otro streamer ni por una ficción de LIVE. |
| HLS propio que avanza en tiempo real | FFmpeg real, aproximadamente 100 s de emisión, vídeo y audio verificables; cuatro segmentos con editor bloqueado en una cola de un trabajo. |
| HTTP 503 y reinicio que supera la ventana HLS | Conservación de los bytes anteriores, reanudación desde lo disponible y tiempos perdidos registrados. Evidencia final: `artifacts/stability/continuous-hls-2026-10-26T02-52-57.651Z/evidence.json`. |
| Integración HLS VOD propia en español | Tres TS reales → Whisper real → selección local → MP4 → R2 → descarga y restauración. Fuente visual/narración sintéticas y chat simulado, explícitamente identificados. |

La repetición final sobre el código `55e5061` conservó 100.064 s en 4 segmentos de la captura continua, sin huecos interiores detectados. La captura interrumpida conservó 80.000 s en 3 segmentos; registró por separado los 4 s iniciales no recibidos y los 16 s perdidos durante la interrupción. Cada TS válido se decodificó con vídeo y audio; no se contaron como recuperados los bytes inválidos apartados. Hubo dos repeticiones exitosas después de corregir el recuento de disco concurrente; los fallos previos no se ocultan como si hubieran sido éxitos.

Los segmentos preservan UTC, duración medida, índice y SHA-256; se comprueba vídeo/audio y decodificación. Las ventanas de análisis incluyen contexto de segmentos vecinos; no duplican la captura original. Los candidatos no pueden cruzar cortes de continuidad ni ocupar un intervalo medido sin paquetes. Cuando se agota almacenamiento se detiene la captura, se conservan archivos y se registra la interrupción.

Esta prueba de unos 100 segundos no demuestra cuatro horas diarias, una caída de toda la máquina, relevos de sesiones de seis horas sin huecos, cambios reales de transmisión durante un LIVE de Kick ni disponibilidad 24/7. Las regresiones de fuente cambiada, reinicio, cola, duplicados y estados dañados incluyen pruebas simuladas; no se etiquetan como observación real de Kick.

## 4. Selección editorial y chat

Se conservan las reacciones donde distintas cuentas observadas repiten una frase o emote. Los mensajes repetidos de una sola cuenta no equivalen a esa evidencia colectiva. Esto tampoco demuestra que todas las cuentas sean personas independientes ni reconoce emociones o jugadas con certeza.

Cada lote permite hasta diez candidatos; no hay cuota diaria de cinco. Si solo un acontecimiento completo es defendible, se devuelve uno. El score combina transcripción, límites de frase, contexto, energía, escenas y chat disponible; un aumento de volumen o de mensajes no acredita por sí solo un buen clip.

La deduplicación entre ventanas/lotes reserva un acontecimiento mediante identidad de transmisión, UTC de reacción, similitud de texto y huella visual perceptual. Una imagen estática similar por sí sola no elimina otra conversación. El muestreo visual no es seguimiento continuo de protagonistas. El reloj conserva una incertidumbre de diez segundos y el retraso humano del chat sigue siendo desconocido.

Los 2.815 mensajes históricos y las dos reacciones de 20/31 cuentas proceden de evidencia anterior. No son chat nuevo de esta ejecución. La prueba integral usa contadores sintéticos; la recepción/selección simultánea de chat real y un nuevo LIVE de Westcol sigue pendiente.

Los clips quedan `PENDING`, con procedencia `LOCAL_HEURISTIC`, `MODEL_SELECTION` o manual/sin verificar. Conservar no significa aprobar. Rechazar no borra el MP4. No hay aprobación humana automática.

## 5. Z.ai: diagnóstico y resultado real

Cinco solicitudes externas acotadas al modelo configurado **`glm-4.6v-flash`**, sin seleccionar un modelo de pago ni contratar créditos:

1. HTTP 200 con JSON de esquema (`type`, `properties`), no selecciones: `AI_SELECTION_INVALID`. Fue respuesta del modelo/formato, no una prueba de credenciales ausentes.
2. HTTP 200, `finish_reason=stop`, pero JSON incompleto: `AI_PROVIDER_INVALID_JSON`. Se rechazó; no se inventó el cierre ni el contenido faltante.
3. Con instrucciones compactas: una selección válida entre cuatro IDs suministrados.
4. Otra solicitud textual válida y una revisión visual válida con **tres fotogramas reales**, a 45,236 / 58,980 / 72,724 s del original.

Las cinco respuestas registraron **12.454 tokens totales**. No se atribuye un precio medido donde el proveedor no lo devuelve. La selección visual conservó un ID permitido y no fue aprobación de publicación. La evaluación puntual no incluyó chat/audio enriquecido del directo completo, ni observación continua: no acredita una IA infalible para encontrar todos los mejores momentos.

La corrección permite recuperar solo un objeto JSON inequívoco dentro de un envoltorio completo, sin cambiar su significado. Se rechazan múltiples objetos ambiguos, truncamientos, IDs desconocidos, campos inválidos y candidatos marcados como incompletos/engañosos. Solo se reintenta una vez un eco explícito del esquema con el modelo gratuito previsto. No se reintenta una decisión editorial vacía para forzar aprobación ni se oculta un error con un ranking supuestamente aprobado por IA.

Evidencias privadas locales: `artifacts/stability/zai-before.json`, `zai-after-first-repair.json`, `zai-compact.json` y `zai-vision.json`. En el último, el campo heredado `result.visualReviewed` quedó sin actualizar por el script de diagnóstico; la evidencia visual efectiva está en `visual.validSelections=1`, `visual.frameCount=3` y la segunda llamada registrada. No se utiliza ese campo erróneo para afirmar resultados adicionales.

## 6. MP4 y acontecimientos realmente entregados

**Westcol: cero MP4 nuevos y cero acontecimientos nuevos aprobados en esta fase.** Se verificaron de nuevo dos borradores anteriores, correspondientes a dos momentos distintos. No se volvieron a renderizar para aumentar la cantidad.

| Archivo | Duración | Archivo privado R2 |
| --- | --- | --- |
| `artifacts/capture-rescue-delivery/2026-10-25T21-40-19-827Z/1-westcol-borrador.mp4` | 27,6 s | `fdbf5529b6ef764bce8a1bf81fe957da8f5ae2f445b1573968ac8ff906f8fa42` |
| `artifacts/capture-rescue-delivery/2026-10-25T21-40-19-827Z/2-westcol-borrador.mp4` | 30 s | `f6e83ab7269ed68c5c460cc8ebd41ff08d5a532a41347129a25b900201e09084` |

Ambos H.264/AAC, 1080×1920, reproducción y descarga comprobadas. Los subtítulos permanecen apagados: las transcripciones reales todavía contienen errores y necesitan corrección. No se declara resuelta la exactitud de ASR ni una calidad editorial profesional.

**Nuevo MP4 entregable técnico: uno**, de **30,08 s**, H.264/AAC, yuv420p, 1080×1920, audio medido −21,6 dB medio / −0,6 dB pico, sin intervalos negros detectados, decodificación completa y pistas de duración compatible:

- Archivo: `artifacts/stability/pipeline-2026-10-26T02-07-09.427Z/141ced41b9c4aeacbbc9ab5ef48bdb87a53f1148dc2d997eeec48b410133612a.mp4`.
- R2: `141ced41b9c4aeacbbc9ab5ef48bdb87a53f1148dc2d997eeec48b410133612a`.
- SHA-256: `8bd7ef7dcc0e81fa4dbae7ac362bd7d05518bc94d01424ae2db290d6f919e561`.
- Título de biblioteca: **PRUEBA TÉCNICA · NO PUBLICAR**. Vídeo patrón y voz sintética propia: no es un resultado comercial ni material real de Westcol.

Se solicitaron diez en esa integración y se produjo uno, sin rellenar la cuota. Whisper.cpp `ggml-small-q5_1.bin` detectó español, generó 22 segmentos y 138 palabras con tiempos; transcribir unos 90 s tardó aproximadamente 78 s con dos hilos. Es una medición puntual de material sintético, no un compromiso de rendimiento para cuatro horas reales. No hubo llamada a IA externa en esa integración. Subtítulos desactivados, selección `LOCAL_HEURISTIC`.

Los renders temporales de fixtures de `render:e2e` y `reframe:e2e` no se cuentan como nuevos clips entregables de un streamer. No se revalidaron traducción, doblaje o inglés en esta fase.

## 7. R2, originales y recuperación

Respaldo nuevo confirmado de estos dos MP4 originales, de 92.042.620 y 92.027.836 bytes:

| Proyecto/sesión | SHA-256 original |
| --- | --- |
| `7d7d67bd-1c74-4414-8121-fad64f39c597` | `2be90fd88a0e723146afde972727bd498b207fc2adca49cf4b81b77113a9d8bc` |
| `2f7f745e-aa8f-4ffd-8500-9171c38fb414` | `0417a6d985090abe62fafa949d7989d98433c49096c1219cb1352c47852a7257` |

Rutas privadas: `clipforge-managed/v1/sources/ID/original-SHA.mp4`, TS por índice/hash y `checkpoints/ID/latest.json`. Los clips están bajo `clipforge-managed/v1/media/ID.mp4`. No se suben claves ni URLs firmadas al repositorio.

Se restauraron realmente ambas fuentes y sus dos clips en `artifacts/stability/restored-real/`, verificando bytes y decodificación. La integración técnica restauró sus tres originales TS y el resultado. La recuperación de un monitor global pausado y el tratamiento de originales que nunca llegaron al checkpoint tienen además regresión simulada. No se restauran locks ni se arranca ningún worker automáticamente.

Los enlaces renovables duran quince minutos por defecto. La renovación verificó los dos MP4 reales con HTTP 200 y hashes idénticos, sin nuevo render. Se requieren sesión del propietario para solicitarlos en un servidor alojado; quien reciba un enlace temporal puede descargarlo hasta su caducidad. No se activó acceso público al bucket. Una solicitud S3 sin firma no devolvió el archivo (HTTP 400); eso es una prueba de acceso al almacenamiento, no un fallo nuevo de captura HLS.

A las 02:30:30 UTC había **327.414.297 bytes**, 49 objetos y cinco objetos de fuentes en este bucket. No es una lectura de facturación global de la cuenta. No se verificaron reglas externas de lifecycle, fecha de caducidad de Neon ni planes/estado administrativo de Render: no había conectores administrativos disponibles y esta canalización no depende de Neon para guardar vídeos.

No se borraron originales, respaldos o archivos ajenos. Los clips finales conservan la política existente de 30 días, protegibles con Conservar; el worker nuevo de fuentes no ejecuta limpieza. Un checkpoint confirma solo los archivos/instante que contiene, no la durabilidad de datos posteriores.

## 8. Uso desde Android

La versión reparada **no fue desplegada a producción**. Estas instrucciones corresponden al código y servidor local probados; verlas en el sitio público requiere un despliegue separado autorizado y el backend correcto.

Mientras esta versión no esté desplegada, los archivos ya guardados se pueden localizar en el bucket `clipforge-clips`, carpeta `clipforge-managed/v1/media`, por los IDs de la sección 6. No necesitan hacerse públicos.

1. Abrir ClipForge con la sesión del propietario.
2. En la página principal, consultar **Westcol · captura y revisión**: fuente LIVE/OFFLINE, monitor, disco, último segmento, UTC, respaldo, checkpoint e interrupciones.
3. Consultar trabajos pendientes/fallidos. Reintentar el trabajo cuando su recurso esté disponible; detener un trabajo o pausar monitor/captura. La pausa del propietario no se deshace al reiniciar.
4. En **Clips guardados**, reproducir el vídeo y abrir **Ver contexto y nuevo recorte**. La transcripción aparece marcada como automática y potencialmente errónea.
5. Rechazar, conservar o solicitar un nuevo intervalo. El recorte necesita el original recuperado y el worker de render; se valida el intervalo y se conserva la primera versión.
6. Descargar MP4 o **Renovar acceso privado**. Un enlace caducado no obliga a volver a renderizar.
7. Revisar audio, principio/final, contexto y derechos antes de publicar manualmente por un flujo autorizado. Esta misión no publica.

Chromium emulado a 393×851 verificó APIs reales, reproducción de ambos MP4 privados, Range 206, descarga idéntica, contexto, formulario y renovación del enlace, sin errores JavaScript ni desbordamiento horizontal. La prueba no cambió la revisión de los clips del propietario ni envió un recorte duplicado. El backend de recorte tiene pruebas aparte de idempotencia, original ausente e intervalos interrumpidos. **Android físico sigue pendiente.**

## 9. Pruebas ejecutadas y alcance

| Verificación | Resultado |
| --- | --- |
| Baseline nuevo de esta recuperación | 401 aprobadas, cero fallos, cero omitidas. |
| `npm ci` | Instalación limpia correcta: 473 paquetes, sin cambiar versiones arbitrariamente. |
| `npm run verify` / `npm run build` con pruebas nativas habilitadas | `420 aprobadas, cero fallos y cero omitidas`. Build Next correcto; las comprobaciones de Redis permanecen aisladas. |
| `npm run render:e2e` | Correcto: CONVERSATION vertical, imagen/audio y subtítulos del fixture. No prueba exactitud de ASR de Westcol. |
| `npm run reframe:e2e` | Correcto: salida 1080×1920 y ventanas de encuadre. No demuestra seguimiento facial continuo. |
| HLS/Kick y recuperación | Pruebas nativas y regresiones correctas; protocolo largo, VOD, reanudación LIVE→VOD y preservación de partes antiguas. |
| `live:continuity:e2e` | Fuente propia que avanza; HTTP 503, editor lento, reinicio y pérdida de ventana. Véase cobertura real en sección 3. |
| `live:pipeline:e2e` | Un MP4 técnico de 30,08 s con Whisper y R2 reales; chat/fuente sintéticos; tres originales recuperados. |
| R2 real de fuentes anteriores | Dos originales y dos clips restaurados, hashes idénticos, decodificación completa. |
| R2 simulado | Colisiones, checksum/rutas inválidas, originales no archivados, monitor pausado y checkpoint idempotente. |
| Móvil con APIs/R2 reales | Reproducción/descarga de dos clips, contexto y renovación; emulación Chromium, no Android físico. |
| Z.ai real | Dos respuestas inválidas rechazadas; tres respuestas válidas posteriores, incluida una revisión de tres fotogramas. Separadas de mocks de CI. |
| CI GitHub | `Correcto: [40261087380](https://github.com/tg321920-netizen/Clip.thomas/actions/runs/40261087380), commit de código `55e50617856e411d0ae900a4b4240ce718917819`, Node 22. CI omite las pruebas audiovisuales por política; no acredita LIVE, R2 real ni Android físico.` |

Evidencias adicionales: `artifacts/stability/restored-real/evidence.json`, `private-renewal/evidence.json`, `pipeline-2026-10-26T02-07-09.427Z/evidence.json`, `mobile/evidence.json`. Son artefactos privados/locales, no material multimedia versionado en Git. Los comandos y sus opt-ins están en [LIVE_WORKER_OPERATIONS.md](LIVE_WORKER_OPERATIONS.md).

## 10. Monitor persistente e infraestructura pendiente

**Estado exacto: desactivado; no se dejó un capturador permanente contra Westcol.** Los workers de prueba se detienen al terminar. Se preparó una plantilla systemd, sin instalarla, y comandos separados para monitor, captura, ingesta, medios, recortes y archivo.

Faltan servidor/proceso permanente, volumen compartido real, capacidad/retención suficiente, supervisión y una prueba prolongada con LIVE/chat autorizados. La configuración gratuita de Render usa filesystem efímero; conservar algunos MP4 en R2 no vuelve persistentes automáticamente los procesos o los bytes aún sin subir. Redis existente para OAuth/automatización no reemplaza el volumen de esta cola audiovisual.

Los límites actuales son deliberadamente conservadores: 2 GiB locales, 1 GiB libre mínimo, seis trabajos en cola/procesando por sesión y 8 GB de archivo en el bucket. El recuento incluye originales, contextos materializados y renders. Al llegar al límite se detiene con diagnóstico; **no puede prometer cuatro horas diarias bajo esos límites**. Aumentarlos requiere una capacidad real revisada, no quitar las protecciones para que el contador siga avanzando.

Los trabajos WAITING_RESOURCE/FAILED se conservan como incidencias y no ocupan ese contador de ejecución activa. La cola se acota por sesión; la coordinación global entre varias sesiones y los relevos prolongados necesitan validación y ajustes antes de operación permanente. No se declara probado ese caso.

No se comprobó una opción cloud gratuita de esta cuenta que sostenga Node + Whisper + FFmpeg 24/7. Un equipo propio ya disponible es una alternativa ejecutable, con gastos de red/electricidad y límites medibles. No se contrató servicio alguno ni se activó infraestructura de pago.

## 11. Presupuesto orientativo: cuatro horas/día y cinco clips/día

No se cambió ningún plan. La página oficial de [R2](https://developers.cloudflare.com/r2/pricing/), consultada el 26/10/2026, indica para Standard: 10 GB-mes gratuitos, un millón de operaciones A y diez millones B por mes; almacenamiento adicional USD 0,015/GB-mes y egreso gratuito. Los cupos se comparten por cuenta; no se garantiza una factura cero sin conocer otros usos.

| Partida | Estimación / condición |
| --- | --- |
| Modelo configurado `glm-4.6v-flash` | Tarifa gratuita documentada en la configuración existente; su disponibilidad/límites pueden cambiar. No se habilita fallback de pago. El monitor actual usa heurísticas locales. |
| 150 clips de 30 s al mes | Con tamaños parecidos a los dos borradores reales, unos **2,1 GB**. Puede caber en el cupo gratuito si el resto del uso también cabe. |
| Originales de 4 h/día, supuesto 8 Mb/s | **14,4 GB/día; 432 GB en 30 días**. Cambia según el bitrate. Es incompatible con prometer almacenamiento gratuito ilimitado y conservarlo todo. |
| R2 para 432 GB sostenidos | Aproximadamente **USD 6,33/mes solo por almacenamiento** sobre 10 GB gratuitos, antes de otros usos/operaciones. Es una comparación, no un plan activado; el límite actual de 8 GB detendría el archivo mucho antes. Sin eliminar fuentes, el volumen sigue creciendo mes a mes. |
| Whisper y FFmpeg | Sin cobro por llamada al correr localmente; requieren CPU/RAM/disco y tiempo. La prueba puntual de ASR no certifica una máquina de 512 MB. |
| Servidor permanente | **Pendiente de elegir y medir**. Sin servidor propio disponible no hay un presupuesto mensual completo verificado de USD 0. |

La opción sin contratar servicios es guardar clips finales dentro del cupo, preservar fuentes en disco propio suficiente y operar con límites revisados. Esta misión no habilitó borrado automático de originales, compras ni modelos de pago. No se puede convertir esta estimación en una promesa de cuatro horas diarias gratis.

## 12. Commits, entrega y trabajo pendiente

Commits de código nuevos, todos descendientes de `af411716`:

- `d8d028139ec6a3c52f528e2353f0a6ce6193f6cf`: JSON editorial de GLM y validación conservadora.
- `f69062d6247dfb9eea559e51990b71df53fee1c8`: captura separada y cola acotada.
- `baf68a57e4079895ad5c59b03c8a6c38f04cc513`: recuperación HLS por reloj real y preservación histórica.
- `eef4738df263459abec6e19e5f4d252a35720a2e`: originales/checkpoints privados y revisión móvil.
- `55e50617856e411d0ae900a4b4240ce718917819`: diagnóstico seguro, cobertura inicial y medición de disco concurrente.

El commit que agrega este informe se identifica en `git log` de la rama remota; el documento no inventa su propio hash. No se modificaron las referencias remotas de main/core-rescue. No hay archivos de medios, credenciales o enlaces firmados incluidos en los commits.

La recuperación/alineación comprobada requiere reloj HLS PROGRAM-DATE-TIME válido. No está certificada la recuperación antiduplicados de una fuente sin ese reloj ni el cambio de ID entre LIVE y su VOD.

Pendientes concretos: LIVE nuevo autorizado de Westcol y chat simultáneo; observación prolongada y relevos entre sesiones; infraestructura persistente y retención/capacidad para cuatro horas; Android físico; revisión/corrección de ASR y decisiones editoriales; seguimiento visual continuo no demostrado. Las solicitudes manuales de nuevo recorte requieren workers y fuentes accesibles. Un error de modelo no se convierte en aprobación y una captura interrumpida no se presenta como completa.

**No se declara ClipForge reparado al 100 % ni funcionando permanentemente.** Se entrega código probado, una captura HLS propia recuperable, originales reales restaurados, un resultado técnico integral y revisión/descarga privada comprobadas.
