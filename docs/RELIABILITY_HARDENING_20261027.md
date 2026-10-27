# ClipForge: recuperación, concurrencia y edición móvil — 27/10/2026

Código comprobado: `54a08da4f2d9acc3a2ade0e4fdf3c31624ddef90`.
Destino remoto: `work/clipforge-functional-review-20261025-5d025fe`.
Checkout operativo conservado: `codex/clipforge-core-rescue`.
Base: `54dcc897f3207bfe061a5c923e4aa598e791d9c8`.

Se corrigieron errores reproducibles en seis conjuntos de código. No hubo
despliegue, publicación, compras, cambio de credenciales, IA externa ni clips
nuevos de Westcol. Esto mejora áreas comprobadas; no certifica ausencia universal
de fallos ni termina las dependencias de alojamiento y LIVE.

## Fallos y correcciones

| Antes | Ahora y evidencia |
| --- | --- |
| Un bloqueo vacío o truncado dejado por un proceso muerto detenía indefinidamente render, respaldo o estado | Recuperación conservadora de bloqueos antiguos incompletos; los recientes y los dueños vivos siguen protegidos. Tres escenarios de bloqueo/escritura fallaron antes del arreglo |
| Una sustitución JSON fallida dejaba temporales y una escritura de dueño fallida podía retener el bloqueo | Se cierran los handles y se limpian los temporales propios, conservando el registro anterior |
| Captura/importación recuperaba un proceso vivo por la edad del heartbeat | Leases con PID, arranque del sistema y comienzo del proceso; no se roba un dueño vivo por lentitud. Se mantiene lectura de timestamps anteriores |
| Morir entre reclamar y guardar PROCESSING dejaba una subida QUEUED bloqueada | El dueño muerto se recupera también antes de PROCESSING; reclamación, reintento y recuperación comparten exclusión por trabajo |
| Un heartbeat tardío recreaba un lock ya liberado | Se actualiza el inode existente; no se crea otro bloqueo después de terminar |
| Un intento viejo podía completar/fallar sobre otro reanudado o quitarle su lock | Identidad de reclamación por intento y comprobación al finalizar; respuestas obsoletas conservan el intento vigente |
| Análisis, transcripción y otros workers tenían protección menor que render | La misma identidad y serialización protege las colas comunes; se recuperan trabajos huérfanos y se limita la repetición tras muertes del worker |
| Una actualización atrasada de progreso podía devolver COMPLETED a PROCESSING | Actualizaciones terminales y de progreso serializadas; 100 % se reserva para finalización |
| Refrescar un clip borraba el texto de subtítulos que se estaba escribiendo | El editor conserva su identidad y borrador. Avisa de otra versión guardada, conserva el texto tras conflicto 409 y permite cargarla descartando explícitamente el borrador |
| Una subida retenida solo reconocía un PID, que podía reutilizarse tras reiniciar | Los nuevos locks conservan identidad de proceso y nonce. Los locks numéricos antiguos siguen protegidos conservadoramente; no se inventa su identidad histórica |
| Un original podía borrarse cuando todavía lo finalizaba ingestión | El guard comprueba también la cola de ingestión y conserva archivos en uso |
| Una transcripción ajena de más de 2 MB bloqueaba cualquier eliminación | El guard admite el límite de metadatos de recuperación de 16 MiB, comprobándolo antes y después de leer; lo inválido sigue fallando de forma segura |
| Un JSON de ingestión dañado detenía todas las importaciones o desaparecía del historial | Validación de identidad, aislamiento del registro, conservación de sus bytes y aviso recuperable en biblioteca/estado móvil. No se exponen su contenido ni URLs privadas |

Los locks coordinan procesos de **un host y volumen compartido**. No constituyen
una cola distribuida ni supervisionan por sí solos un proceso vivo bloqueado.
Un supervisor debe terminar/reiniciar procesos que no puedan recuperarse.

## Pruebas de esta continuación

- `npm run verify` inicial: 507 pruebas, 501 aprobadas, cero fallidas, seis
  optativas omitidas por defecto.
- `npm run build` final, que incluye verify: **535 pruebas, 529 aprobadas,
  cero fallidas, seis optativas fuera de la suite ligera**; Next 16.4.3 aprobado.
  Hay 28 regresiones nuevas. Runtime local: Node 24.19.0; la CI usa Node 22.
- HLS + recuperación + política de ingestión con pruebas nativas habilitadas:
  **27 aprobadas, cero fallidas/omitidas**. Incluye las dos optativas HLS,
  FFmpeg/HTTP 400 por request largo y reanudación sin repetir segmentos.
- Las otras cuatro pruebas audiovisuales optativas: **PASSED**, en una ejecución
  de seis tests nativos/supervisión con cero fallidos u omitidos. Cubren energía
  y escenas medidas, segmentos cerrados, captura de 125 s y cancelación de un
  encode real. Sumadas a las dos HLS, las seis omisiones de la suite ligera
  quedaron ejecutadas y aprobadas por separado; no se contabilizan como
  aprobadas dentro de la ejecución que las omitió.
- `render:e2e` y `reframe:e2e`: **PASSED**. Son fixtures sintéticos de QA,
  con audio/subtítulos/CONVERSATION/zoom; no son clips de un streamer.
- Procesos Node reales de ingestión y análisis: se mantuvo el dueño vivo,
  se terminó con SIGKILL y se recuperó una sola reclamación. No se arrancó un
  modelo ni se hizo una captura externa para estas regresiones.
- Chromium móvil 393×851, sesión real de propietario y APIs locales reales:
  **PASSED** para borrador, refresh, conflictos, carga de versión y aviso de
  metadatos dañados. Sin mocks de API, nuevos renders ni modificación del medio
  cacheado. Los textos añadidos por QA solo existen en su raíz aislada.
- R2 privado real + Chromium móvil: **PASSED** para reproducción, renovación
  y descarga del clip Westcol existente; SHA-256 idéntico. Acceso anónimo 401,
  sin errores JS ni desbordamiento. No se modificó revisión ni encoló otro corte.
- 111 manifiestos de tracing inspeccionados: cero archivos de `storage/`,
  `artifacts/`, `.git` o `.env` incluidos. Persiste la advertencia de tracing
  dinámico; no se interpreta un build exitoso como auditoría universal.

La CI de este código **PASSED**, con Node 22, instalación, auditoría, verify
(535 totales, 529 aprobadas, cero fallidas, seis optativas omitidas) y build:
[40598538652](https://github.com/tg321920-netizen/Clip.thomas/actions/runs/40598538652).
Las pruebas fallidas anteriores y los resultados actuales se conservan bajo
`artifacts/hardening-20261027/`; no se sustituyeron por logs supuestamente verdes.

## Clip auténtico preservado

Se conserva el borrador de Westcol de 30,56 s del informe
[WESTCOL_CAPTURE_RECHECK_20261027.md](WESTCOL_CAPTURE_RECHECK_20261027.md).
Esta fase produjo **cero clips reales nuevos**, sin regenerar el comentario,
VIP, Nike o reloj para aumentar cantidades.

- ID privado R2:
  `78d8194bdd363ae41f80216bfed9ea257a255a13e03e7e3565654f1ece068237`.
- SHA-256:
  `d3ed17a9b54d46015e89c0d98ca99148515eb608397c6a64508c1eb95c14fb8f`.
- Descarga comprobada otra vez:
  `artifacts/hardening-20261027/private-westcol-mobile/renewed-private.mp4`.
- Fuente VOD auténtica, audio original, revisión PENDING, sin subtítulos
  inventados y sin chat atribuido a ese intervalo.

Consulta móvil del 27/10 a las 22:55 UTC: **OFFLINE**. Estado LIVE_NOT_TESTED;
monitor OFF, captura permanente OFF y cero mensajes nuevos de chat observados.
La prueba HLS propia no acredita un directo real de Westcol.

## Estado y límites pendientes

| Área | Estado preciso |
| --- | --- |
| Recuperación/concurrencia reparada | VERIFIED_LOCAL con disco, procesos reales y regresiones; no reinicio de Render |
| Revisión móvil y descarga R2 | VERIFIED_LOCAL con R2 real; ANDROID_PHYSICAL_NOT_TESTED |
| Transcripción/traducción/selección | Se preserva la aceptación anterior; la calidad editorial y traducción siguen PARTIAL/REVIEW_REQUIRED, sin nueva evaluación de modelo |
| LIVE y chat actuales | LIVE_NOT_TESTED; monitor apagado, sin observación nueva |
| Versión nueva disponible al propietario por Internet | BLOCKED_EXTERNAL_AUTHORIZATION; sin despliegue nuevo ni URL inventada |
| Uso 24/7 y cuatro horas diarias | NOT_TESTED; requiere host supervisado, almacenamiento/capacidad medidos y autorización |

Cerrar Chrome no cancela un trabajo del servidor. El texto todavía sin guardar
no es un checkpoint: esta reparación protege el refresco, no promete recuperar
un borrador tras cerrar la pestaña. Suspender/reemplazar el servidor puede perder
archivos locales; solo un respaldo R2 confirmado permite recuperarlos. No se
probó un reinicio real del hosting ni se alteró la retención de originales.

La clave administrativa de Render no figura entre las credenciales vinculadas
al entorno activo. El siguiente desbloqueo externo sigue siendo conectarla
privadamente para `api.render.com`; después corresponde diagnóstico GET y
aprobación concreta del ensayo independiente. No se hizo otra petición 401,
no se trasladó una clave al proceso web y no se crearon servicios.

## Commits y reanudación

| Commit | Cambio |
| --- | --- |
| `cc5cb08` | Bloqueos incompletos y limpieza de escrituras atómicas |
| `bead50b` | Leases, reclamaciones y recuperación de ingestión |
| `58226bd` | Concurrencia y recuperación de las colas comunes |
| `85b38c3` | Borradores de subtítulos y prueba móvil con APIs reales |
| `8ddc6a2` | Identidad de subida, fuentes en uso y metadatos largos |
| `54a08da` | Registros de ingestión dañados aislados y visibles |

El commit posterior solo registra este informe y los puntos de reanudación.
Se conservan main, core remoto, candidatas congeladas, originales, R2 y
StoryMotion. No hay force-push ni modificación de producción; PUBLISHING = OFF.
Para continuar, partir del historial real, conservar estos medios y probar el
próximo LIVE autorizado o el ensayo privado cuando existan sus dependencias.
No repetir renders ni entregar fixtures como resultados del streamer.
