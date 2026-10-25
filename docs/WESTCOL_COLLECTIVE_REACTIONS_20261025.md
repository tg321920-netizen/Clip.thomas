# Reacciones compartidas del chat: ajuste solicitado por el propietario

El propietario autorizó preparar más de cinco clips y pidió tomar en cuenta que varias personas repitan lo mismo. El número debe depender de momentos diferentes disponibles; un coro prolongado no se convierte en varias copias del mismo corte.

## Cambio comprobado

El análisis anterior reducía el peso de toda repetición textual. Ahora distingue actividad concentrada en pocos participantes de una reacción compartida por muchos. Puede detectar un cambio de reacción incluso si el total de mensajes no aumenta. Compara volumen, participantes y concentración de texto con seis intervalos previos completos; conserva el retraso desconocido de las reacciones y la revisión pendiente. Un coro estable no dispara un candidato nuevo cada diez segundos.

`ChatActivityCollector`, dentro del servicio existente de actividad, mide la frase dominante y cuántos participantes diferentes la repitieron. Filtra por sala, deduplica IDs, normaliza espacios/mayúsculas, acota memoria y entrega solamente contadores. Los textos e identidades no se guardan en el fixture. Las observaciones antiguas sin esos contadores se declaran `AGGREGATE_REPETITION_ONLY`: no se inventa que todos repitieron la misma frase.

`ViralScoreService` explica la señal y el editor recibe sus limitaciones. El objetivo de la interfaz pide **hasta** la cantidad elegida y contempla reacciones compartidas aunque repitan texto. La interfaz indica que se pueden pedir más de cinco; el límite técnico existente sigue siendo diez por lote. Se comprobó selección de ocho momentos independientes; no se añadió una cuota diaria de cinco ni se amplió la autonomía de publicación.

Además se corrigió un fallo encontrado al diagnosticar la captura: recortar primero un error muy largo podía dejar visible el final de una URL de reproducción firmada. `UrlIngestService` ahora elimina URLs, autorizaciones y valores largos antes de recortar el texto. La regresión ejecuta un subproceso que falla con una URL larga y comprueba que no sale su valor privado.

## Segunda observación real

- Canal: `https://kick.com/westcol`, sala pública `669512`; se descartaría cualquier otra sala.
- Observación: **13:01:48–13:10:22 de Costa Rica**, 25 de octubre de 2026; **2.815 mensajes recibidos**, 52 intervalos, cero errores de conexión del chat.
- **13:04:50**: la reacción dominante fue repetida por **20 participantes distintos**.
- **13:09:00**: la reacción dominante fue repetida por **31 participantes distintos**.
- Estas son marcas del chat para revisar, **no MP4 de esos acontecimientos ni marcas VOD certificadas**. La nueva captura nativa falló al abrir el medio; se observó HTTP 400 en uno de los intentos. No se confirmó la causa. No se saltaron accesos, DRM, protecciones ni se atribuyó el fallo a claves incorrectas.
- La prueba local terminó. El receptor oficial de eventos de Kick, la captura fiable para este enlace y la vigilancia permanente del canal continúan pendientes; el botón normal de captura aún no conecta automáticamente este contador al chat de Kick.

`tests/fixtures/westcol-collective-chat-20261025.json` conserva los agregados numéricos reales. La prueba reproduce las dos reacciones y deja explícito `videoCaptured: false`. La prueba anterior de 2.267 mensajes también se reevalúa: el tramo de 80 mensajes suma interés por repetición compartida, conservando que no se midieron participantes por frase en aquella primera toma.

## Clip existente y almacenamiento

Sigue existiendo **un único MP4 real entregable**, el borrador de 30 segundos descrito en `WESTCOL_LIVE_REVIEW_20261025.md`; no se generaron cinco copias ni nuevos clips falsos. El modelo de IA no lo aprobó en aquella evaluación y su estado editorial sigue pendiente de cambios.

El reintento de guardado **sí funcionó** el 25 de octubre a las 12:53:11 de Costa Rica. Está en R2 privado con ID `faf27088f1b1f66ef2fcbdb61077a22e44dc830feefb84f9f070fa233863ed50`, 13.470.134 bytes y retención ordinaria hasta el 24 de noviembre. La descarga temporal se comprobó completa y coincide con el SHA-256 `7d62cdc368c584806ff85939e2e657e152ac53e66a32420e2cc316a54f751de5`. El bucket conserva su acceso privado; la URL temporal no se guarda en Git. Este resultado actualiza el fallo de archivado de la primera observación.

Se probó aparte Whisper.cpp **small-q5_1** gratuito sobre el borrador. Mejora parte del texto, pero todavía confunde nombres y repite palabras. No se quemaron subtítulos no revisados ni se cambió el modelo ASR predeterminado de producción. Esta fase no realizó otra selección con una API de IA ni activó modelos de pago.

## Validación

**376 pruebas aprobadas, cero fallos y cero omitidas**; lint, TypeScript, build, `render:e2e` y `reframe:e2e` correctos. Se probaron repetición colectiva, un solo emisor, coro constante, deduplicación, otras salas, límites del contador, intervalos parciales, selección de ocho y dos fixtures reales anónimos. La prueba móvil a 393×851 selecciona ocho, comprueba el objetivo enviado, consentimiento y ausencia de desbordamiento; sus APIs son fixtures explícitos y no acreditan ocho vídeos producidos ni calidad de una IA real. Publicación apagada y producción sin modificar.
