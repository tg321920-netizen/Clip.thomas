# Rescate de captura y revisión de Westcol — 25 de octubre de 2026

## Resultado y alcance

**La captura de un VOD público autorizado volvió a funcionar con archivos nuevos verificables. No se declara reparada la captura del próximo directo ni una vigilancia 24/7.** Westcol estaba desconectado en la comprobación final del 25 de octubre a las 22:05:01 UTC (16:05:01 en Costa Rica): `SOURCE_OFFLINE`, etapa `SOURCE_STATE`.

Se produjeron **tres MP4 nuevos de clips**, correspondientes a **dos momentos distintos**: dos borradores de revisión elegidos con marcas reales del chat, transcripción y fotogramas, y una versión automática adicional de uno de esos momentos usada para probar los workers. No son tres acontecimientos independientes ni selecciones aprobadas por un modelo. Además se verificaron tres capturas fuente nuevas, de 90,072333 s, 90,078667 s y 60,048333 s. Los archivos de pruebas sintéticas y dos capturas duplicadas rechazadas no cuentan como entregas.

No hubo publicaciones sociales, despliegues, cambios de producción, compras, cambios de planes ni activación automática de modelos de pago.

## Historia preservada

Antes de escribir y nuevamente antes de entregar se verificaron:

| Referencia | SHA observado al comenzar |
| --- | --- |
| `origin/codex/clipforge-core-rescue` | `78acd95088e0bdb9dfc2669b53d1e21190bb8f5e` |
| `origin/work/clipforge-functional-review-20261025-5d025fe` | `66893b841df6d024da392cbae32751e3b4acf008` |
| HEAD local inicial, en `codex/clipforge-core-rescue` | `66893b841df6d024da392cbae32751e3b4acf008` |

`git rev-list --count 78acd950..66893b84` confirmó **23 commits**, todos conservados como antecesores. La aplicación de la raíz se reutilizó. `main`, la rama remota operativa y la carpeta histórica `clipforge/` no se modificaron. La entrega de código usa la rama remota de revisión existente mediante avance normal, sin force-push.

Commits de implementación:

- `bb0b76eb7c9ea33347e2c774086764656fb3c444`: transporte HLS, resolución pública de Kick, chat, reloj de recuperación y validaciones del editor.
- `bcee3566dcb56ec13735f96792c6638a3b60bce1`: monitor acotado, controles móviles y comprobación real de reproducción privada.
- El commit de este documento registra la evidencia final; `git log -1` identifica el SHA final sin inventar una referencia a sí mismo.

Se leyeron `AGENTS.md`, `docs/CLIP_EDITOR_AGENT.md`, `docs/WESTCOL_LIVE_REVIEW_20261025.md` y `docs/WESTCOL_COLLECTIVE_REACTIONS_20261025.md`. Los dos últimos siguen describiendo sus sesiones anteriores; este documento actualiza el estado actual.

## Diagnóstico comprobado y reparación

1. **HTTP 400 con direcciones largas:** una prueba con un servidor local y FFmpeg real demostró que su cliente HTTP transmite como máximo 4095 caracteres del destino de una petición. Una dirección de prueba de más de 9000 caracteres quedó truncada y el servidor respondió 400. El nuevo transporte HLS conserva la dirección completa mediante Node/Undici y entrega a FFmpeg una dirección corta, exclusivamente en loopback. Reescribe referencias relativas, variantes, mapas y rangos sin alterar firmas. Mantiene el proxy y la verificación TLS. Se rechazan direcciones privadas, redirecciones inseguras y fuentes cifradas.
2. **Límite de esa conclusión:** no se conservó la petición firmada del fallo antiguo de Westcol; por tanto, no se demuestra que aquel 400 concreto tuviera exactamente esta causa. La regresión reproduce y corrige una causa real de 400. El directo ya estaba terminado cuando pudo validarse la reparación con medio externo; la nueva captura real utiliza su VOD. El diagnóstico registra etapa, código HTTP y longitud, sin URL, cabeceras o cuerpo privados.
3. **Intervalos VOD repetidos:** dos intentos con desplazamientos grandes mediante `-ss` devolvieron el mismo inicio: SHA-256 `4b8cdb2106821b655710470d9c869274a0fa76f0472a0d0cde302c6daf1e8990`. Se rechazaron los proyectos `b1958b19-f96c-44b8-bfc6-d3d9daa09ba8` y `94379255-1637-4df7-a81e-25a94cb0f0bb`; el editor ahora rechaza fuentes marcadas como inválidas. El transporte selecciona el intervalo de segmentos del VOD antes de que FFmpeg lo abra y conserva su reloj y secuencias. Las nuevas ventanas tienen contenidos y hashes diferentes.
4. **Recuperación:** se preservan y decodifican los fragmentos completos, se apartan los dañados y se guarda un diario UTC atómico. Una captura ya completa se recompone sin solicitar de nuevo el origen. Si la interrupción deja un fragmento dentro de un segmento HLS, se continúa desde el siguiente segmento del origen: puede existir un hueco, registrado explícitamente. Los candidatos no pueden cruzarlo. No se promete continuidad perfecta de una señal interrumpida.
5. **Duraciones:** una prueba a 5 fps mostró que copiar paquetes puede dejar una pequeña cola de vídeo más larga que el audio. Se miden ambas pistas y la selección final no puede terminar después de ninguna. El render final mantiene la validación estricta de duración y sincronización. Se conservan los archivos fuente originales.

`KickLiveAdapter` y `LiveSourceService` mantienen la identificación por API oficial/OAuth. `KickPublicSourceService` resuelve por separado los metadatos y medios que entrega el reproductor público. **Una respuesta LIVE o una dirección resuelta no significan captura exitosa.** La pantalla distingue la consulta oficial, la resolución pública y el trabajo multimedia. No se declara un canal OAuth conectado a partir de acceso público.

## Capturas externas verificadas

Fuente: `https://kick.com/westcol/videos/01a17413-f760-7067-aa90-2e6d458a1aa6`. Canal `669746`, sala `669512`, comienzo declarado `2026-10-25T17:20:28Z`, duración declarada 10310 s. Es la grabación del directo del estadio; no un fixture.

| Proyecto | Ventana solicitada | Duración real | Bytes | SHA-256 de la fuente |
| --- | --- | --- | --- | --- |
| `7d7d67bd-1c74-4414-8121-fad64f39c597` | 6240 s, aproximadamente 90 s | 90,072333 s | 92.042.620 | `2be90fd88a0e723146afde972727bd498b207fc2adca49cf4b81b77113a9d8bc` |
| `2f7f745e-aa8f-4ffd-8500-9171c38fb414` | 6488 s, aproximadamente 90 s | 90,078667 s | 92.027.836 | `0417a6d985090abe62fafa949d7989d98433c49096c1219cb1352c47852a7257` |
| `3b463263-42ea-4e77-a73f-96ce8a2049bb` | 6488 s, aproximadamente 60 s, workers reales | 60,048333 s | 61.493.240 | Registrado con la ingesta y validación de aceptación |

Las tres fuentes tienen vídeo 1920×1080, H.264 y audio AAC; pasaron decodificación completa. El comienzo se aproxima al segmento HLS disponible y se alinea mediante `EXT-X-PROGRAM-DATE-TIME`, no mediante la suposición de que coincide exactamente con el desplazamiento pedido.

Se ejecutó Whisper.cpp **small-q5_1** realmente, en español y con dos hilos. Persisten errores de nombres y palabras; no se quemaron como subtítulos correctos ni se cambió el modelo predeterminado de producción. Se revisaron fotogramas reales de las dos ventanas. No se acredita seguimiento continuo de protagonistas ni evaluación auditiva humana.

## Chat y decisiones editoriales

Antes, el contador de chat era una herramienta de observación separada. Ahora `UrlIngestService` abre `KickChatSource` automáticamente al capturar un canal Kick LIVE, filtra la sala, deduplica mensajes y alinea los agregados numéricos con el reloj real de los segmentos. Solo se almacenan contadores y fechas, sin textos, tokens ni identidades. La observación local puede copiarse a R2 para recuperar después las marcas del mismo VOD. Los fallos de chat/archivo se distinguen de los de vídeo.

La conexión pública de chat se suscribió realmente en esta sesión, pero recibió **cero mensajes** durante la comprobación breve con el canal desconectado. Esto no demuestra un pico nuevo ni una sesión LIVE sostenida. Las marcas utilizadas proceden de la observación real anterior de **2815 mensajes**, conservada en `tests/fixtures/westcol-collective-chat-20261025.json` y en el registro privado. Ese fixture reproduce contadores históricos; no es vídeo ni chat actual simulado como si fuera nuevo.

- **19:04:50 UTC / 13:04:50 Costa Rica:** reacción compartida por 20 cuentas distintas. Se preparó el borrador de prueba de cámara y explicación de la zona VIP.
- **19:09:00 UTC / 13:09:00 Costa Rica:** reacción compartida por 31 cuentas distintas. Se preparó el borrador sobre bromas con un colega y un contrato con Nike. El título no presenta la broma como patrocinio comprobado.

La selección combina transcripción, límites de frase, energía RMS, cambios de escena y chat cuando existe. Se rechazan solapamientos, repeticiones del mismo pico UTC y cortes que atraviesen huecos o excedan el audio. El monitor transmite también las marcas ya tratadas entre lotes. No hay cuota diaria de cinco: hasta diez por lote, menos si falta material independiente. Las heurísticas no reconocen emociones o viralidad de manera infalible.

### Modelo real y simulaciones

Se llamó al modelo real configurado **Z.ai / glm-4.6v-flash**, sin cambiar a otro de pago:

| Fuente | Resultado real |
| --- | --- |
| Primera ventana | `AI_PROVIDER_INVALID_JSON` |
| Segunda ventana | Selección inválida (`AI_SELECTION_INVALID`), trabajo detenido en `WAITING_RESOURCE` |

**Cero clips aprobados por el modelo real.** Su segunda etapa visual no completó una revisión aprobada. Los tests con proveedor inyectado/simulado comprueban contratos y errores; no se cuentan como evaluación del modelo. El recorte automático de 29 s usa heurísticas locales y Whisper real, sin llamada a un LLM.

## MP4 nuevos y R2 privado

Todos son H.264/yuv420p + AAC, 1080×1920, 30 fps, audio original y revisión editorial `PENDING`. La decodificación, duración de pistas y detección de negro pasaron; no se detectaron intervalos negros. Son borradores, no una afirmación de calidad editorial aprobada.

| Uso | Duración | Bytes | ID de biblioteca privada R2 |
| --- | --- | --- | --- |
| Borrador: cámara en zona VIP | 27,6 s | 11.330.461 | `fdbf5529b6ef764bce8a1bf81fe957da8f5ae2f445b1573968ac8ff906f8fa42` |
| Borrador: bromas sobre Nike | 30 s | 17.095.653 | `f6e83ab7269ed68c5c460cc8ebd41ff08d5a532a41347129a25b900201e09084` |
| QA: versión automática del segundo momento | 29 s | 14.046.011 | `ab54ba4c58da16b644ba5430d9b2d1eae8f9bd4b43c1d427d5a16eff0758aa14` |

Claves: `clipforge-managed/v1/media/<ID>.mp4`, índices privados en `clipforge-managed/v1/records/<ID>.json`. Retención ordinaria hasta el 24 de noviembre de 2026; no se activó una tarea de borrado durante esta misión. El bucket sigue privado. Los originales de captura permanecen locales; archivar un clip en R2 no vuelve durables sus colas, proyectos o fuentes originales.

La revisión móvil real, a las **22:04:29 UTC**, abrió los dos primeros archivos mediante las rutas de biblioteca de la aplicación y R2 real: el reproductor avanzó con dimensiones correctas, Range respondió 206 y las descargas completas coincidieron con los originales:

- Cámara: SHA-256 `a0b4a9b2855fe6854859131a520981a5c46fbbc9c64bb1ebf08718ccd8b8b483`.
- Nike: SHA-256 `cd74a6377b40adeafe82750e0b299d5d1024aca81c9d094da82711367e70b2cd`.

Se usó Chromium 393×851 con interacción táctil, sin mocks de API, sin desbordamiento horizontal ni errores JavaScript. **No hubo acceso a un Android físico.** El servidor de revisión fue exclusivamente local, se cerró después y no reemplazó producción. Los controles móviles se probaron adicionalmente con fixtures explícitos para cancelación, reanudación y biblioteca.

Archivos/evidencia locales de esta sesión:

- `artifacts/capture-rescue-delivery/2026-10-25T21-40-19-827Z/1-westcol-borrador.mp4`
- `artifacts/capture-rescue-delivery/2026-10-25T21-40-19-827Z/2-westcol-borrador.mp4`
- En ese directorio: `evidence.json`, `mobile/evidence.json`, capturas de pantalla y descargas verificadas.
- `artifacts/kick-worker-acceptance/68beca7c-cbbd-4161-86ad-eefae85ddddc/evidence.json`: captura, Whisper, selección, render, reanudación del test y archivo privado con workers reales. El estado multimedia correcto es `READY`, distinto del `COMPLETED` de ingesta.

`artifacts/` permanece fuera de Git. Los enlaces temporales privados se entregan al propietario y no se guardan en documentos versionados.

## Estado exacto del monitor

`LiveMonitorService` añade supervisión de las colas existentes porque `LiveSourceService` solo consulta estado y `IngestJobStore` solo representa trabajos individuales. No se instala otro agente o aplicación. `scripts/live-monitor-worker.mjs` está **preparado y probado con fixtures de estado**, pero **desactivado y sin despliegue**. La comprobación real `npm run worker:live-monitor:once` terminó con `DISABLED`, `activeJobId:null`, `publication:OFF`.

Dependencias para activarlo en una instalación futura autorizada:

1. Un proceso Node persistente y un **volumen duradero**, común a servidor, monitor, ingesta y medios. Declarar `CLIPFORGE_STORAGE_PERSISTENT=true` solo después de comprobar ese volumen. `/tmp` y Render gratuito no satisfacen esa condición; R2 para clips no la sustituye.
2. FFmpeg/FFprobe, Whisper.cpp y modelo, acceso normal permitido a Kick y R2 privado configurado. El transporte público de Kick puede cambiar; no equivale a un contrato de API oficial ni a OAuth.
3. En esos procesos, `CLIPFORGE_ANALYSIS_PROVIDER=heuristic`; los trabajos del monitor además fijan ese proveedor en su payload, para no activar una API paga por herencia de configuración.
4. Confirmación de fuente autorizada mediante `CLIPFORGE_LIVE_RIGHTS_CONFIRMED=true` y activación deliberada `CLIPFORGE_LIVE_MONITOR_ENABLED=true`. Todos los controles de publicación permanecen `false`.
5. Ejecutar `npm run worker:ingest`, `npm run worker:media` y `npm run worker:live-monitor` bajo el supervisor del servidor. No se arrancan solos al abrir o cerrar este chat.

El monitor consulta cada 30 s, encola capturas acotadas de 300 s, admite hasta diez clips y recupera en VOD solo reacciones pendientes de la misma transmisión. Evita encolar de nuevo tras reinicios mediante ID determinista y checkpoint. Si falta un job/checkpoint válido, almacenamiento, análisis local o confirmación, se detiene de forma explícita. El archivo privado de clips terminados se verifica antes de avanzar. No tiene herramientas de publicación ni cambia modelos.

**Límites importantes:** supervisor de un solo host, no un sistema distribuido; las colas y su checkpoint son locales y requieren volumen real. Espera al editor y a R2 antes del siguiente lote, por lo que **puede dejar huecos entre lotes**. La recuperación VOD depende de que el vídeo público correspondiente siga disponible y de disponer de marcas observadas; no reconstruye chat perdido ni momentos nunca observados. A 2 GiB de medios locales o menos de 1 GiB libre deja de capturar sin borrar archivos. No se demostró operación sostenida 24/7, notificaciones push, ni rendimiento suficiente para cuatro horas diarias. La caducidad de un servicio de bases de datos externo no se verificó en esta fase y no se presupone vigente para este monitor.

## Uso desde el teléfono y reproducción de pruebas

Los cambios de interfaz aún necesitan desplegarse por separado; **no se modificó producción**. En una instalación que use este código:

1. Abrir **Pegar URL o directo → Directo activo**. Pegar el canal activo o el enlace de un VOD de Kick autorizado. Consultar el estado; la fuente pública y OAuth se muestran por separado.
2. Elegir duración de captura, comienzo del VOD (0 para LIVE), generación automática, hasta diez clips, aproximadamente 30 s, perfil y opcionalmente **solo reacciones observadas del chat**. Los subtítulos están desactivados inicialmente para revisión.
3. Confirmar autorización, capturar y revisar **Mis videos / Clips guardados**. Reproducir, descargar el MP4 y revisar contexto y derechos. Preparar publicación después; esta misión no publica.

Prueba externa optativa, con fuente pública todavía disponible y autorización del operador:

```bash
CLIPFORGE_RUN_EXTERNAL_MEDIA_TESTS=true npm run kick:capture:e2e -- \
  --rights-confirmed \
  --source=https://kick.com/westcol/videos/01a17413-f760-7067-aa90-2e6d458a1aa6 \
  --start=6488 --seconds=60 \
  --observations=tests/fixtures/westcol-collective-chat-20261025.json
```

Se necesita Whisper.cpp configurado y R2 si se desea comprobar el archivo remoto. La prueba usa almacenamiento local aislado y fuerza publicación desactivada. Los contadores del fixture son históricos reales; el vídeo se obtiene nuevamente de la fuente externa. `--resume=artifacts/kick-worker-acceptance/<id>` reutiliza un trabajo ya terminado y verifica sus archivos, sin volver a capturarlo. Para la prueba móvil real: `CLIPFORGE_REVIEW_EVIDENCE=<evidence.json de los borradores> node scripts/mobile-kick-review-e2e.mjs --ui-regressions`.

Verificaciones finales locales:

| Comprobación | Resultado |
| --- | --- |
| Baseline previo | 376 pruebas aprobadas |
| `CLIPFORGE_RUN_MEDIA_TESTS=true npm run verify`, ejecutado por el build | **401 aprobadas, 0 fallidas, 0 omitidas** |
| `CLIPFORGE_RUN_MEDIA_TESTS=true npm run build` | Correcto, incluido TypeScript y build Next.js |
| `npm run render:e2e` | Correcto: MP4, audio, subtítulos y CONVERSATION 1080×1920 |
| `npm run reframe:e2e` | Correcto: enfoque/zoom y salida 1080×1920 |
| Prueba externa Kick + workers | Captura 60,048333 s y clip 29 s, Whisper real, heurística, R2 confirmado |
| Revisión móvil real + R2 | Dos borradores reproducidos y descargados con hashes idénticos |
| UI móvil con fixtures separados | Cancelación, reanudación, biblioteca y derechos correctos |

Las pruebas audiovisuales sintéticas verifican regresiones, no la calidad comercial de Westcol. La nueva ejecución remota de GitHub Actions es independiente de estos resultados locales; no se presume aprobada por una ejecución anterior.
