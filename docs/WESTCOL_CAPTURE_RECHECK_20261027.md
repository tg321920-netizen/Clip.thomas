# Westcol: captura VOD nueva y recuperación segura — 27/10/2026

**Hay un clip auténtico nuevo de 30,56 s, guardado en R2 privado y descargado
con el mismo SHA-256. La captura nueva es VOD. No se acredita una captura LIVE:
Westcol estaba OFFLINE y el monitor permanente sigue apagado.**

## Vídeo disponible

- Archivo descargado realmente desde R2:
  `artifacts/westcol-capture-recheck-20261027/new-westcol-r2.mp4`.
- Tema: responde a un comentario y explica que no ha tenido tiempo. Se conserva
  su introducción y se termina antes de cambiar a la historia del dolor de muela.
- Fuente: `https://kick.com/westcol/videos/01a16a2b-77a0-7e21-a328-b6a294996e80`;
  sesión VOD del 23/10, canal `669746`. No es el VOD retirado del día 25.
- Captura original nueva: proyecto `4f285c14-ba1b-4f1b-9d8f-8317e5d24564`,
  90,053333 s, 1920×1080, H.264/AAC, 92.057.471 bytes, decodificación completa.
  SHA `5faeb485dc6280a1c6f4e1465932600add35d1115f8c4df5acc2f059d4a3ee76`.
- Clip: `3f332ea7-ffeb-4999-b88a-6635c967de0c`, corte 30,92–61,48 s de esa
  captura. Contenedor medido 30,566667 s, 1080×1920, H.264/yuv420p/AAC, 30 fps,
  9.853.533 bytes. CONVERSATION conserva la imagen auténtica sobre fondo derivado
  de ella. No se acredita seguimiento facial ni se añadieron escenas o voces.
- Posición derivada del HLS: 624,254–654,814 s (10:24,254–10:54,814).
  Se solicitaron 600 s de comienzo, pero el segmento HLS comenzó en 593,334 s:
  no se presentó el desplazamiento solicitado como si fuese el recibido.
  PDT de la captura: `2026-10-23T19:19:46.912Z`; corte aproximado
  `19:20:17.832Z–19:20:48.392Z`, conservando incertidumbre de reloj de 10 s.
- SHA del clip: `d3ed17a9b54d46015e89c0d98ca99148515eb608397c6a64508c1eb95c14fb8f`.
- ID R2: `78d8194bdd363ae41f80216bfed9ea257a255a13e03e7e3565654f1ece068237`,
  `keep=true`, revisión **PENDING**. Objeto privado:
  `clipforge-managed/v1/media/78d8194bdd363ae41f80216bfed9ea257a255a13e03e7e3565654f1ece068237.mp4`.

**Conteo:** una captura fuente MP4 nueva, un recorte MP4 nuevo y dos segmentos
TS originales nuevos. Las copias de descarga/restauración no son otros clips.
Los archivos sintéticos de QA tampoco cuentan. No se regeneraron VIP, Nike ni
reloj como entregas nuevas; se comprobó además la descarga del VIP existente.

## Qué ocurrió con el HTTP 400

La reparación HLS ya estaba en `bb0b76e`; no se reemplazó con otra implementación.
La prueba nativa actual reproduce FFprobe/FFmpeg truncando a 4095 caracteres el
destino HTTP de una URL de fixture de más de 9000: el servidor devuelve 400 en
la apertura del manifiesto. El transporte Node conserva la URL completa y da a
FFmpeg una dirección corta de loopback. Se comprueban rangos, recuperación,
desplazamientos VOD y rechazos de URL insegura/medio cifrado. Es QA identificado.

El 400 histórico de Westcol no conserva su petición firmada, así que no puede
atribuirse retrospectivamente esa causa con certeza. La captura externa nueva
pasó por resolución pública Kick → HLS/Node → FFmpeg → dos TS → MP4. No usó
yt-dlp ni recibió 400. La URL inicial resuelta medía 2079 caracteres; no se
afirma que esta fuente reproduzca la longitud del fallo antiguo.

Consultas del 27/10:

- 18:07 UTC: canal OFFLINE por la vía pública; API oficial UNCONFIGURED.
  Esto no impidió capturar el VOD y no se usó para culpar a las credenciales.
- VOD anterior `01a17413-f760-7067-aa90-2e6d458a1aa6`: SOURCE_NOT_FOUND en
  SOURCE_AVAILABILITY. No aparecía entre las 20 grabaciones públicas devueltas;
  esa observación no prueba una eliminación permanente.
- Otra grabación pública del mismo canal sí resolvió, con identidad y estado
  público comprobados por el servicio existente. Se procesó solo una ventana
  acotada, dentro de la misión de captura autorizada.
- 18:47 UTC, desde la prueba móvil: OFFLINE. **LIVE_NOT_TESTED**.

No se modificaron firmas, proxy, TLS, sesiones privadas, DRM ni restricciones.
Los diagnósticos guardan etapa/código/longitud, nunca la URL multimedia firmada,
cabeceras privadas, respuestas OAuth o valores de claves.

## Fallo nuevo demostrado y corregido

Al verificar TS retenidos, `captureSegmentedStream` atrapaba cualquier error y
renombraba el fragmento como `.invalid-*`. Cancelar durante la decodificación,
no disponer de FFmpeg o recibir un SIGKILL podía apartar bytes válidos. Un
FFprobe incompatible también se interpretaba erróneamente como daño del medio.
Cuatro regresiones fallaron antes del arreglo.

Commit **`807cf58e50bad590fe3f4fda9e04a05c2944a6a7`**:

- La cancelación se propaga antes de apartar un segmento.
- Herramientas ausentes, errores conocidos del host, timeout, señal del sistema
  y respuesta inválida de FFprobe conservan la identidad del archivo para reintento.
- La señal de cancelación llega a FFprobe y a la creación de miniaturas.
- Un timeout espera al cierre real del hijo antes de inspeccionar su último TS.
- Un rechazo de datos del decodificador sigue apartando el fragmento, conservando
  sus bytes; no se acepta como vídeo válido.
- Se añadieron seis regresiones de estado con stubs explícitos y una aceptación
  adicional con FFmpeg/FFprobe y segmentos auténticos previamente conservados.

La prueba auténtica canceló un decodificador real y luego volvió a verificar
tres TS de la fuente anterior `2f7f745e-aa8f-4ffd-8500-9171c38fb414`, con los
mismos hashes. No abrió el origen ni generó otro MP4. Esa fuente antigua no
conservaba reloj UTC por segmento: no se inventó uno en esa prueba.

Otra regresión demostró que la reanudación manual podía sustituir la identidad
del reloj por otra sesión del mismo canal. Ahora reutiliza `sameLiveSource`,
la comprobación que ya tenía la captura continua. `LIVE_SOURCE_CHANGED` y
`LIVE_SOURCE_IDENTITY_UNKNOWN` detienen la concatenación antes de abrir el HLS
nuevo; conservan el reloj y los bytes y no disparan reintentos automáticos.
Se añadieron cuatro escenarios de identidad y una regresión de la política de
reintentos. El caso positivo permite continuar la misma sesión; una captura
completa se recupera sin consultar el directo actual. Son tests con resolutores
inyectados explícitos, no una nueva observación de Kick LIVE.

## Selección editorial y modelos

Whisper.cpp small Q5 local transcribió realmente los 90 s en español: 15
segmentos, con errores visibles en nombres y expresiones. El análisis local
midió audio y cambios de escena y devolvió cuatro candidatos. El de puntuación
máxima mezclaba el comentario con el tema siguiente; Codex eligió el candidato
0004 (puntuación heurística 55), más coherente en contexto, para un solo borrador.

La decisión combina una propuesta local con revisión de contexto por Codex:
no es aprobación editorial del propietario ni selección validada por Z.ai.
Solo se revisó esta ventana de 90 s; no se afirma que sea el mejor momento de
la grabación completa de más de dos horas.
No se llamó a Z.ai ni a otro LLM externo; tampoco se reintentó el 429 histórico.
Las simulaciones de proveedor en tests no cuentan como evaluación de modelo real.

**No se observó chat para este VOD.** No se atribuyen mensajes, cuentas, frases,
emojis, picos ni viralidad a esta escena. Se conservaron el colector, el filtrado
por sala, las reacciones compartidas, la deduplicación y los tests históricos,
sin presentar aquellas observaciones del día 25 como actividad de esta fuente.

El clip mantiene audio original y subtítulos desactivados. La correlación PCM
de una muestra de 12 s con el intervalo original fue **0,9996248**, sin desfase
en esa muestra. FFprobe y decodificación completa verificaron ambas pistas y
duración, sin intervalos negros detectados. Se inspeccionaron fotogramas reales.
Eso no sustituye la revisión del propietario del lenguaje, contexto y corte.

## R2, recuperación y Android

La fuente MP4, ambos TS, el clip, el registro editorial y checkpoints quedaron
en R2 privado. Los dos TS se decodificaron y analizaron por paquetes: sin huecos
detectados >0,5 s; manifiesto sin gaps registrados para esta ventana. Duraciones
TS: 59,999667 y 30,086667 s; no se confunden con la duración exacta del MP4.

Se restauró el checkpoint LIVE/VOD a una raíz aislada, con workers pausados:
`artifacts/westcol-capture-recheck-20261027/restored-project-2F3RDv/storage`.
Original, TS y MP4 coincidieron por SHA-256 y los TS restaurados se decodificaron.
También se creó la copia ordinaria de proyecto, reutilizando los objetos grandes
ya archivados. Snapshot: `94835ce47da3264d6dbc52a2552e7a84008b8d675c466587c31d757ac16a5f42`.
No se restauró sobre datos diferentes ni se borraron originales o backups.
El registro editorial restaurado rechazó reservar ese mismo acontecimiento con
otro identificador y propietario de trabajo; no hubo otro encode para probarlo.

Chromium 393×851 utilizó APIs reales, sesión de propietario y R2: los accesos
anónimos devolvieron 401; el clip nuevo se reprodujo en 1080×1920, se renovó su
acceso privado y se descargó con SHA idéntico. Sin error JS ni desbordamiento.
No se cambió la revisión ni se encoló otro recorte. **ANDROID_PHYSICAL_NOT_TESTED**.

Para verlo ahora, abrir el MP4 descargado indicado al principio. Alternativa
desde la cuenta del propietario: Cloudflare → R2 → `clipforge-clips` → el objeto
privado indicado. La versión nueva de ClipForge permite Clips de Westcol →
reproducir/descargar/renovar, pero esta fase solo comprobó esa interfaz local:
no hay un despliegue público nuevo ni una URL de ensayo inventada.

## Pruebas, archivos y continuidad

| Prueba | Resultado |
| --- | --- |
| `npm run verify` y verificación incluida en build | 507 totales: 501 aprobadas, cero fallidas, seis omitidas |
| `npm run build`, Node 22.23.4 / Next 16.4.3 | PASSED |
| HLS + recuperación + política de errores, con pruebas nativas activas | 27 aprobadas / cero fallidas u omitidas; incluye el 400 reproducido y reanudación VOD |
| Cancelación/reanudación con tres TS antiguos auténticos | PASSED; cero red/encode y hashes conservados |
| Captura VOD nueva y render worker real | PASSED; fuente de 90,05 s y un clip de 30,56 s |
| R2: archivo, descarga y restauración completa | PASSED; fuente + dos TS + clip |
| Navegador móvil autenticado, R2 real | PASSED para el clip nuevo; Android físico pendiente |
| `render:e2e`, `reframe:e2e` | PASSED; fixtures sintéticos de QA, separados de entregables |
| LIVE nuevo y vigilancia 24/7 | NOT_TESTED / monitor OFF |

Las seis omisiones pertenecen a la suite ligera por defecto, no se cuentan como
aprobadas. Dos pruebas HLS optativas sí se ejecutaron por separado. Los logs,
manifiestos, selección, hashes y prueba de audio están en
`artifacts/westcol-capture-recheck-20261027/`, fuera de Git.

Archivos de código: `services/ingest/UrlIngestService.mjs`,
`tests/capture-recovery-safety.test.mjs`, `scripts/capture-recovery-e2e.mjs`,
`scripts/westcol-real-window.mjs`, `scripts/westcol-vod-recovery-delivery.mjs` y
`scripts/mobile-stability-e2e.mjs`. El segundo commit,
**`9f9eff8220b11877b66b3d83e2a0a43ad9d6a090`**, registra la aceptación autenticada
y herramientas acotadas de VOD/R2. El commit documental posterior cierra el informe.

La protección adicional de identidad quedó en
**`0b1853f43472cf39f172299356ff3f5b5b2fe205`**. Modifica también
`lib/ingest-error-policy.mjs` y sus pruebas.
[CI 40565942103](https://github.com/tg321920-netizen/Clip.thomas/actions/runs/40565942103)
aprobada para ese código: instalación, auditoría de dependencias, verify
(507 totales / 501 aprobadas / cero fallidas / seis omitidas) y build.
El cierre posterior solo cambia documentación y mantiene ese código comprobado.

Se inició sobre `9c5e1dc`, que ya conservaba 65 commits sobre `78acd950`;
`66893b8` y sus 23 avances son ancestros. Se mantiene el checkout operativo
`codex/clipforge-core-rescue` y se envía a la integración remota existente.
Main, el core remoto y las candidatas `a4b2305`, `761e291` y `f103c04` no se mueven.
No hubo force-push, producción, StoryMotion, publicación ni modelos/planes pagos.

**Monitor en este entorno:** no está corriendo de forma permanente. Los workers de prueba
fueron acotados/`--once`, el servidor móvil local terminó y el restore no arrancó
workers. Hace falta un host supervisado, volumen durable, capacidad medida y
autorización de activación para una aceptación LIVE prolongada.

La fuente nueva ocupa ~92 MB por 90 s; cuatro horas con esa tasa rondarían
14,7 GB solo para un formato del original, por encima del cupo R2 configurado de
8 GB. El límite local LIVE de 2 GiB también impide prometer cuatro horas sin una
política de capacidad/retención aprobada. No se habilitó borrado automático ni se
contrató almacenamiento para ocultar ese límite.

Punto de reanudación: conservar este clip y sus checkpoints; no volver a producir
el mismo comentario para aumentar cantidades. Consultar el próximo LIVE permitido
y probar captura y chat nuevos cuando esté disponible. La captura VOD verificada
no permite declarar reparado o activado el funcionamiento LIVE continuo.
