# Reanudar ClipForge: clips auténticos de Westcol

**Avance posterior de edición/recuperación:** leer primero
[CONTINUE_WITHOUT_RENDER_20261026.md](CONTINUE_WITHOUT_RENDER_20261026.md).
Conserva siete commits sobre 774de6e, con código hasta 40cd791 y aceptación
local/R2/Node 22 comprobada. No volver a generar esas pruebas. La candidata
761e291 y el monitor apagado permanecen intactos; no hay despliegue nuevo.

**Nueva prioridad del propietario:** utilizar el editor manual y las sugerencias
locales desde Android sin esperar al monitor. Leer primero
[STABLE_ANDROID_DELIVERY_20261026.md](STABLE_ANDROID_DELIVERY_20261026.md).
La versión estable candidata está probada localmente, con un MP4 real en R2;
su despliegue accesible sigue bloqueado por acceso administrativo al hosting.
Conservar los avances de chat `c5c5958` y editor `761e291`; no repetir sus renders.

Checkpoint comprobado el 26 de octubre de 2026, UTC. Este documento permite
continuar el trabajo; no programa el reinicio de Codex cuando vuelve su cuota.

## Repositorio y límites

- Aplicación en la raíz de `tg321920-netizen/Clip.thomas`. No tocar StoryMotion ni reconstruir desde `clipforge/`.
- Checkout local obligatorio: `codex/clipforge-core-rescue`, según `AGENTS.md`.
- Destino de los avances: `work/clipforge-functional-review-20261025-5d025fe`.
- Base preservada: `1f6e82c7a5a5d25e404ec4c215650dd387921e11`, con los 32 commits adicionales sobre `78acd95088e0bdb9dfc2669b53d1e21190bb8f5e`.
- Código de esta recuperación: `5624a30473766108257272074fc7cec19cb888c8`. Consultar `git log` para el commit posterior de este checkpoint.
- Referencias remotas comprobadas antes de escribir: core `78acd95088e0bdb9dfc2669b53d1e21190bb8f5e`; main `f3d8ca33fd57452d475898fdf3adac4be210087c`.
- No force-push, despliegue de producción, compras, modelos de pago ni publicación social.
- Mantener en `false` `CLIPFORGE_AGENT_REAL_PUBLISHING`, `CLIPFORGE_CONTENT_REAL_PUBLISHING` y `CLIPFORGE_SMART_PUBLISH_ON_BOOT`.
- Los fixtures sintéticos sirven exclusivamente para QA. Nunca contarlos como acontecimientos o clips del streamer.

## Resultado audiovisual nuevo y recuperable

Un acontecimiento nuevo, distinto de cámara VIP y Nike: **Un reloj de diamantes para ir al estadio**.

| Evidencia | Valor comprobado |
| --- | --- |
| Fuente autorizada | `https://kick.com/westcol/videos/01a17413-f760-7067-aa90-2e6d458a1aa6` |
| Transmisión | `01a17413-f760-7067-aa90-2e6d458a1aa6` |
| Fuente local preservada | `d61eab18-d29f-499e-8cbd-35d02d8596c9`, 150,073667 s |
| SHA-256 del original | `c2cf985f0f2edcc9e1c88c5facb584ab02e117a062af1334dfd7008b7503dd44` |
| Recorte relativo al original | 110,2–139,2 s |
| Posición HLS/VOD recuperada | 1276,305375–1305,305375 s, aproximadamente 00:21:16–00:21:45 |
| Programa UTC del recorte | 2026-10-25T17:41:42.629Z–17:42:11.629Z |
| Verificación de posición | Correlación de audio 0,978078 con una muestra real de posición conocida; no implica reloj del proveedor exacto al fotograma |
| Proyecto de salida | `9bb28252-c86b-5325-a4e8-51d534020277` |
| Clip | `835b598b-7b54-40c3-a0a2-fcba0013f513` |
| MP4 | 29 s; 1080×1920; H.264/AAC; audio original; sin subtítulos quemados |
| SHA-256 del MP4 | `069bef2f87d646f9ea68378d64b21ece837b60146fdaa5cf0c90075a7afe747b` |
| ID privado de biblioteca R2 | `3e273d0edf34cf03cce0e34c3f59b4304e94f61e61c04775274bcc4befd1313d` |
| Selección | `LOCAL_HEURISTIC`, revisión `PENDING`, conservado sin caducidad automática |

El vídeo real contiene una conversación sobre el reloj y el atuendo para ir al
partido. El encuadre horizontal 0,59 se revisó con fotogramas reales; no es una
demostración de seguimiento automático continuo. El audio descargado correlaciona
0,999867 con el recorte original. No se generaron imágenes ni narración artificial.

Una solicitud real al modelo configurado `glm-4.6v-flash` devolvió
`AI_PROVIDER_HTTP_429`. La selección no está aprobada por IA. Se guardó el
checkpoint para no repetir llamadas innecesarias. No hay observaciones de chat
para este intervalo: no atribuirle mensajes, cuentas, emojis o picos inventados.

## Archivos, originales y clips previos

- Resultado descargado realmente desde R2: `artifacts/real-westcol/delivery/new-westcol-r2.mp4`.
- Evidencia: `artifacts/real-westcol/delivery/{evidence,selection,download-evidence,audio-proof}.json`.
- Fuentes completas y transcripciones reales Whisper.cpp small Q5 en español: hotel `d61eab18-d29f-499e-8cbd-35d02d8596c9`; estadio `f20b4bb5-5f21-488e-9c74-391af17b6004`.
- Estadio: 150,080333 s; SHA `a53c477728d61778ceda6b7b33a7c86b6ab479333d6d9abc09e4e96e7dd08783`; respaldo privado sin clip nuevo adicional.
- Ambas fuentes pasaron decodificación completa y comprobación de audio, resolución, tamaño y SHA. Originales y checkpoints se archivaron en R2 con `LiveArchiveService`.
- Pruebas de fuentes y alineación: `artifacts/real-westcol/recovery/source-validation.jsonl`, `hotel-alignment.json`, `stadium-alignment.json`. La alineación también está en los metadatos de la fuente archivada.
- Los artefactos multimedia no se versionan en Git. Preservar los archivos existentes y los respaldos R2.
- Biblioteca anterior VIP: `fdbf5529b6ef764bce8a1bf81fe957da8f5ae2f445b1573968ac8ff906f8fa42`, 27,6 s, SHA `a0b4a9b2855fe6854859131a520981a5c46fbbc9c64bb1ebf08718ccd8b8b483`.
- Biblioteca anterior Nike: `f6e83ab7269ed68c5c460cc8ebd41ff08d5a532a41347129a25b900201e09084`, 30 s, SHA `cd74a6377b40adeafe82750e0b299d5d1024aca81c9d094da82711367e70b2cd`.
- Los tres clips auténticos están conservados y pendientes de revisión. No contarlos como tres clips nuevos.
- El antiguo fixture sintético `141ced41b9c4aeacbbc9ab5ef48bdb87a53f1148dc2d997eeec48b410133612a` se marcó `TECHNICAL_TEST`; sus bytes se preservaron y se excluye de la biblioteca del propietario.

## Reparaciones y verificaciones de esta fase

Un supervisor local antiguo tomó los mismos trabajos que un script que no los
había reclamado. Dos escritores modificaban las capturas mientras se leían. Se
detuvo ese supervisor local, sin tocar producción. Las fuentes se validaron de
nuevo cuando su hash quedó estable; se conservó el rechazo previo en el historial.

`IngestJobStore` y `JobStore` permiten reclamar atómicamente un trabajo concreto;
los operadores usan esa reclamación y heartbeat. Una transcripción fallida no
marca como fallida una ingesta ya terminada. Se añadió regresión de concurrencia
y recuperación. También se corrigió que actividad ordinaria del chat actuara
como un pico que suprimía otro acontecimiento. Se mantiene la distinción entre
una reacción repetida por cuentas diferentes y spam de una sola cuenta.

La biblioteca separa material técnico, VOD y LIVE; muestra Westcol por defecto,
posición del recorte, contexto, chat realmente medido y revisión pendiente.
Las demás funciones permanecen accesibles en «Todos mis videos».

- `npm run build` correcto, incluyendo lint, TypeScript y suite: **420 aprobadas, 0 fallidas, 6 omitidas de 426**. Las seis pruebas nativas optativas no se regeneraron en este build.
- Render del nuevo contenido auténtico, FFprobe, decodificación completa, archivado privado y descarga con SHA idéntico: correctos.
- `scripts/mobile-stability-e2e.mjs` contra este MP4 nuevo y APIs locales reales: reproducción R2, renovación y descarga correctas, sin mocks, sin desbordamiento ni errores JS. Evidencia en `artifacts/real-westcol/mobile/evidence.json`.
- Esa prueba usa Chromium 393×851 con tacto emulado; **Android físico sigue pendiente**. No modificó revisiones ni encoló otro recorte.
- `render:e2e` y `reframe:e2e` históricos están documentados en el informe previo; no confundirlos con nuevas capturas LIVE o clips del streamer.

## Estado exacto de automatización

**Monitor y captura permanentes desactivados.** No hay promesa 24/7 ni proceso
que reactive Codex al renovarse los tokens. El propietario puede pedir «continúa».
ClipForge puede trabajar sin el navegador cuando sus workers estén supervisados
en un servidor apto, con almacenamiento persistente y recursos comprobados.
R2 conserva archivos; no ejecuta Node, FFmpeg ni Whisper.

El canal estaba OFFLINE en la consulta pública inicial y en la prueba móvil
de las 04:38 UTC. La vía oficial no estaba configurada para esta consulta; no
atribuirle una confirmación oficial. El VOD estuvo disponible durante la descarga
y dejó de aparecer después: resolución posterior `SOURCE_NOT_FOUND`. Se usaron
únicamente originales ya preservados; no reintentar URLs firmadas antiguas.
**Esta fase no acredita una captura LIVE nueva de Westcol.**

Para automatizar, continuar con [LIVE_WORKER_OPERATIONS.md](LIVE_WORKER_OPERATIONS.md)
y el informe de estabilidad. Confirmar capacidad, volumen, supervisión, permisos
vigentes y cobertura real antes de activar los workers. No iniciar un monitor
de pago ni producción para cumplir una expectativa de automatización.

## Próxima sesión

1. Leer este checkpoint, `AGENTS.md`, `docs/CLIP_EDITOR_AGENT.md` e informes Westcol. Verificar HEAD, rama remota e historial; no descartar commits ni limpiar originales.
2. Reutilizar el clip nuevo y renovar sus enlaces con `ClipLibraryService.temporaryAccess(id)`. En la interfaz local: «Clips de Westcol» → reproducir / «Descargar MP4» / «Renovar acceso privado». Los enlaces caducan; no hace falta renderizar de nuevo.
3. Si se perdió el filesystem, restaurar checkpoints de ambas fuentes a una raíz aislada con `live:restore -- --session=ID --target=RUTA --workers-paused`; comprobar hashes y conflictos antes de usarla. No restaurar sobre archivos distintos ni arrancar workers automáticamente.
4. Investigar infraestructura persistente existente sin comprar ni desplegar. Si el canal vuelve LIVE y es accesible/autorizado, validar captura y chat sincronizados con los servicios existentes. Si sigue offline, usar únicamente el VOD autorizado si vuelve a estar disponible o los originales auténticos preservados.
5. Revisar otros acontecimientos independientes del original del estadio. No regenerar reloj, cámara VIP ni Nike para aumentar cantidades. Entregar menos resultados si falta calidad o contexto.
6. La API real 429 sigue pendiente; no reintentar en bucle ni pasar a modelos de pago. Distinguir siempre selección local, resultado del modelo y aprobación editorial.

Herramientas locales: `source /workspace/clipforge-tools/activate.sh`. Para ASR
real se utilizó `WHISPER_CPP_MODEL_PATH=/workspace/clipforge-tools/ggml-small-q5_1.bin`.
Los scripts `westcol-real-scout.mjs` y `westcol-real-window.mjs` requieren opt-in
externo y derechos confirmados. `westcol-real-delivery.mjs --rights-confirmed
--resume-selection` está ligado a esta fuente recuperada: **no volver a ejecutarlo
si el clip archivado ya es válido**. Nunca guardar URLs firmadas o claves en Git.
