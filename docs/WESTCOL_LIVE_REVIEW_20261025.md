# Observación real de Westcol: 25 de octubre de 2026

Se abrió `https://kick.com/westcol` como espectador público, sin iniciar sesión, escribir mensajes ni publicar. La página confirmó el directo «LA EXPERIENCIA VIP DEL CLASICO DESDE EL ESTADIO, BARCELONA VS REAL MADRID». Canal `669746`, sala `669512`, directo `134235815`. El acceso de espectador no configura la integración oficial de Kick ni acredita derechos editoriales.

## Resultado de esta sesión

- Chat observado de **17:46:21 a 17:52:43 UTC**: **2.267 mensajes**, deduplicados por ID. Los contadores se agruparon cada diez segundos; los identificadores de participantes no se conservan en el fixture.
- Mayor intervalo dentro del vídeo: **17:49:10–17:49:20 UTC**, equivalente a **11:49:10–11:49:20 en Costa Rica**. **80 mensajes**, 55 participantes distintos y 18 textos distintos. Mediana de los seis intervalos anteriores: **53,5 mensajes**; aumento aproximado del **49,5 %**. Abundaban las reacciones repetidas. No superó el umbral de pico fuerte configurado; no se presenta como prueba de un momento viral.
- Captura solicitada: 360 s, segmentada a 60 s y escrita en disco. El origen terminó entregando **239,868 s** válidos en cuatro segmentos, **1280×720**, H.264/AAC, **98.362.795 bytes**. No se afirma que se capturaron seis minutos. El motivo del cierre anticipado del origen no quedó confirmado.
- La alineación usa `EXT-X-PROGRAM-DATE-TIME` y hora UTC de recepción. Hay incertidumbre de al menos diez segundos, además del retraso desconocido de las reacciones; no son marcas VOD certificadas.
- Whisper.cpp **base**, español, transcribió realmente el archivo: 92 segmentos. Hay errores claros en conversaciones y nombres propios. No se queman esos textos como subtítulos correctos.
- Se llamó al proveedor real **Z.ai / glm-4.6v-flash**, sin simulación ni cambio automático a modelos de pago. El intento terminó sin selecciones válidas: `AI_SELECTION_INVALID`. No hay clips aprobados verificables del modelo; su revisión visual no llegó a ejecutarse porque se detuvo antes. No se interpreta este resultado como prueba de calidad ni éxito editorial.
- Una descarga opcional de un modelo ASR gratuito mayor falló con HTTP 503; no se cambió el proveedor por otro de pago.

## Archivo para revisar

Se exportó **un borrador de revisión**, no un clip aprobado por el modelo, alrededor del intervalo más activo:

- Proyecto: `ada76bd3-c947-4bf5-929f-5ec47820eecb`.
- Clip: `ff0c3b22-bf62-4cc3-acc7-392816d0d22d`.
- Archivo: `artifacts/westcol-live-check/westcol-reaccion-chat-borrador.mp4`.
- Corte: segundos 180–210 del archivo capturado; **30 s**, **1080×1920**, H.264/yuv420p y AAC, **13.470.134 bytes**.
- SHA-256: `7d62cdc368c584806ff85939e2e657e152ac53e66a32420e2cc316a54f751de5`.
- Decodificación completa correcta; audio medido, pico −0,5 dB, media −18,6 dB; ninguna pantalla negra detectada. Se inspeccionaron fotogramas reales, incluido el encuadre vertical que conserva a los interlocutores con fondo desenfocado. No hay seguimiento facial acreditado.
- Audio de origen conservado sin narración añadida; subtítulos desactivados. Revisión `CHANGES_REQUIRED`: comprobar transcripción, contexto, comienzo/final y derechos antes de preparar publicación. Un contenedor válido no equivale a aprobación editorial.

El intento de archivado privado en R2 falló con **HTTP 503**. El MP4 y el proyecto locales se conservan. La comprobación de Render y la descarga del modelo también devolvieron 503; el cuerpo del error de conexión indica `upstream connect error ... remote address: envoy://cloudflare_https_tunnel/`. Es una observación de conectividad de este entorno, no una demostración de caída de Cloudflare/Render ni de claves incorrectas. Los diagnósticos administrados no tenían registros retenidos. No se cambió el proxy, TLS, planes, permisos ni producción para sortear el fallo. No se generó un enlace privado de descarga ni se afirma que este borrador esté guardado en R2.

## Cambios reutilizados en ClipForge

Los servicios existentes ya analizaban transcripción, RMS y cambios de escena; declaraban explícitamente ausente el chat. Se añade únicamente `ChatActivityService` para comparar agregados observados con una mediana móvil, penalizar repetición y conservar incertidumbre. No se instala otro agente ni aplicación.

`TranscriptCandidateProvider`, `ViralScoreService`, `BestClipsService` y `OpenAIContentProvider` reciben esta evidencia cuando existe en `project.liveObservation.chatActivityWindows`. La clave del punto de recuperación incluye esos datos. Sin chat, la puntuación y la declaración de evidencia ausente se conservan. La actividad tiene peso limitado y no sustituye contexto, transcripción, revisión o permisos. El modelo recibe agregados, no usuarios ni instrucciones del chat.

La captura y la observación de esta sesión se ejecutaron con herramientas locales optativas de comprobación, en `artifacts/westcol-live-check/`; **el botón normal de captura todavía no recoge chat automáticamente**. La integración duradera mediante eventos oficiales de Kick, receptor HTTPS verificado y monitor persistente queda pendiente. Esta sesión terminó: no se deja una promesa de vigilancia 24/7 ni de notificaciones configuradas.

## Reproducción y comprobaciones

`tests/fixtures/westcol-chat-20261025.json` conserva los 39 intervalos anónimos y su cobertura. Los primeros/últimos intervalos parciales se excluyen del cálculo de picos. La prueba reproduce los 80 mensajes y su mediana, además de comprobar arranque sin historial, huecos, repeticiones, contadores imposibles, reentregas y llegada de agregados al editor con modelo simulado explícito.

```bash
node --test tests/chat-activity.test.mjs tests/editor-agent.test.mjs
CLIPFORGE_RUN_MEDIA_TESTS=true npm run verify
npm run build
npm run render:e2e
npm run reframe:e2e
```

Resultado local final: **368 pruebas aprobadas, cero fallos y cero omitidas**, lint y TypeScript correctos, build de Next.js correcto, `render:e2e` y `reframe:e2e` aprobados. Estos tests de selección con respuestas locales no prueban la calidad del modelo real; su intento sin selecciones válidas se describe por separado arriba. Las evidencias multimedia reales quedan en `artifacts/westcol-live-check/`, fuera de Git. La rama sigue siendo `codex/clipforge-core-rescue`; publicación real apagada y producción sin modificar.
