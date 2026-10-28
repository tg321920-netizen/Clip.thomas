# ClipForge: entrega técnica y punto de reanudación del 28 de octubre

**La misión de acceso desde Android continúa bloqueada: no existe una URL nueva
de editor verificada.** La candidata está fijada, pero no se creó ni desplegó
`clipforge-development-preview`. No se modificó producción, main, StoryMotion,
credenciales OAuth, originales ni respaldos. Publicación y monitor LIVE: OFF.

## Código conservado y candidata

- Inicio comprobado: `4fbb06184db60778df42438a9ad8e7604854f9a8`.
- Rama local obligatoria: `codex/clipforge-core-rescue`; no se cambió de checkout.
- Destino remoto de avances: `work/clipforge-functional-review-20261025-5d025fe`.
- Candidata nueva: `cc16902ec38dd367a1137e318fc2312293859fb7`.
- Tag nuevo: `clipforge-development-candidate-20261028.1`.
- Rama congelada nueva: `preview/clipforge-master-20261028.1`.
- Se conservaron sin mover 761e291, b6936e6, a4b2305 y f103c04, sus tags
  anteriores y el historial de integración. No se usó force-push.
- El código audiovisual validado es `91c25f7`; la candidata agrega únicamente
  documentación de operación y la referencia de `render.audit-preview.yaml`.
- `bad2f93` agrega un diagnóstico administrativo GET para el operador. Está
  separado del proceso web y no cambia el runtime de la candidata.

## Reparaciones implementadas

| Falla reproducida | Reparación y comprobación |
| --- | --- |
| Recuperación audio-only tratada como vídeo y resultados sin tipo de medio | Validación AUDIO y contrato común para resultados nuevos/recuperados. Dos M4A auténticos conservan SHA, tipo, SRT y revisión. |
| Reanudar un lote recreaba IDs y perdía correcciones | Se conservan ID, edición, pistas e historial; se registra PROCESSING antes de codificar y se conserva una revisión editorial concurrente. Regresiones de interrupción y reanudación. |
| Un mismo trabajo podía cambiar de fuente o parámetros sobre un checkpoint anterior | Solicitud inmutable por ID, HTTP 409 ante cambio y rechazo conservador del checkpoint incompatible. El lote anterior permanece recuperable. |
| Lotes automáticos ignoraban resolución/formato elegidos | Comparten validación de 9:16/16:9 y 720p/1080p con el editor manual. Calidad y encuadre llegan al renderer; no se reduce silenciosamente la resolución. |
| Selección aceptaba un intervalo medido como inaudible o un final explícitamente incompleto | Filtro conservador con razones de rechazo. La ausencia de chat/medición no se convierte en evidencia inventada ni aprobación. La calidad semántica sigue requiriendo revisión. |
| Traducciones locales con errores de sentido | Modelo opcional más reciente, revisión y hashes fijados, glosarios/contexto conservados; fallback a la salida directa cuando el contexto introduce riesgos detectables de cifras, negación o modalidad. |
| El historial ofrecía una descarga READY de una revisión ya invalidada | Refleja estado y subtítulos actuales, oculta MP4/ZIP obsoletos y conserva SRT y acceso al editor. No cambia retroactivamente el estado del trabajo histórico. |
| Reintentar desde candidatos recreaba un clip con FILL/BALANCED y geometría predeterminada | Reintenta el ID existente; editor de subtítulos permanece accesible en DRAFT/FAILED y se bloquea durante procesamiento. |
| Un flag de regeneración sin efecto provocaba otro encode | No se añade el flag al reusar una pista ya preparada. Reintento real reutiliza el MP4 verificado, con hash, geometría y texto idénticos. |
| Diagnóstico Render podía volver a atascarse sin conexión privada | Nuevo comando acotado GET, cero peticiones si falta el secreto, sin reintentos de autenticación ni cuerpos/valores secretos en la salida. Su transporte se probó con fixtures explícitos; no acredita acceso administrativo real. |

Archivos principales: `BestClipsService.mjs`, `ClipResult.mjs`,
`MediaResultRecovery.mjs`, `JobStore.mjs`, `EditorialQualityService.mjs`,
`ClipService.mjs`, `PrivateClipReviewService.mjs`, `SubtitleService.mjs`,
`LocalTranslationProvider.mjs`, `TranslationQualityService.mjs`,
`translate-subtitles.py`, `MediaTools.tsx`, `ProjectPipeline.tsx`,
`render-options.mjs`, `candidate-render-request.mjs` y las nuevas regresiones.

## Resultados auténticos de esta sesión

**Un MP4 nuevo de QA, no un clip nuevo de Westcol.** NASA/JFK auténtico y
autorizado, audio original, selección `transcript-heuristic-v6`, traducción
local real y subtítulos incrustados. Fuente idéntica comprobada por SHA antes
de reutilizar la transcripción real whisper.cpp small-q5_1 ya preservada.
No se simuló una transcripción ni una decisión de Z.ai.

- Proyecto: `fff77b99-1008-4a79-bb84-12e820579b6e`.
- Clip: `4e8a509f-936e-4e2b-9d33-ae1e47d0009e`.
- Intervalo: 18,08–44,12 s de la fuente local de 150 s, equivalente a
  498,08–524,12 s del original NASA (offset conservado: 480 s).
- Duración: **26,04 s**, 1280×720, H.264/AAC, audio medio −28,3 dB,
  decodificación completa, sin intervalos negros detectados.
- SHA-256: `4f1ae98589d5bade73d95d52865462416fa9c8e3386f306440a3f68cf54a40f0`.
- R2 privado: `7b8faff5cbe4059777e1d7fcd109e6876fdbe1f3ac1c0b211a339dc17ab58f96`.
- Archivo local: `artifacts/master-mission-20261028/automatic-mobile-WEcn9g/downloaded-automatic-720p.mp4`.
- SRT: mismo directorio, `translated-es.srt`.
- El contenido está identificado como QA para no aparecer como entrega del
  streamer en la biblioteca del propietario. Revisión editorial: PENDING;
  traducción: REVIEW_REQUIRED. No se publicó.

Chromium móvil autenticado subió la fuente mediante la API real, inició el lote,
cerró la pestaña durante el procesamiento y volvió para reproducir y descargar
MP4/SRT. Se verificó texto incrustado con OCR y se revisó un fotograma auténtico.
La copia descargada con acceso temporal R2 y la restauración aislada coincidieron
por SHA; la pista traducida se recuperó íntegra. El reintento posterior mantuvo
el mismo clip y no ejecutó otro encode, ASR ni traducción.

Tiempo local observado del lote: **31,576 s**, con ASR reutilizada. No es una
medición de Render ni de análisis completo de cuatro horas. La selección es
heurística y tiene limitaciones de contexto; no acredita viralidad ni aprobación.

## Westcol y conservación

La consulta pública permitida del canal respondió **OFFLINE** el 27 de octubre
a las 23:50:45 UTC. La API oficial del runtime quedó UNCONFIGURED porque
KICK_CLIENT_SECRET figura skipped; no se interpretó eso como falta de autorización
del propietario ni se eludieron controles. No se inició captura o chat nuevo.
Aceptación específica: **LIVE_NOT_TESTED**. Monitor persistente: **OFF**.

El borrador auténtico anterior se descargó nuevamente desde R2 y conservó:

- Archivo R2: `78d8194bdd363ae41f80216bfed9ea257a255a13e03e7e3565654f1ece068237`.
- SHA: `d3ed17a9b54d46015e89c0d98ca99148515eb608397c6a64508c1eb95c14fb8f`.
- Tamaño: 9.853.533 bytes; revisión PENDING. No se regeneró.

No hay MP4 nuevos de Westcol en esta sesión. No se observaron mensajes de chat
nuevos ni se atribuyeron reacciones a NASA o a los VOD archivados.

## Estado por capacidad

| Capacidad | Estado y límite |
| --- | --- |
| Recorte manual, MP4 y audio original | VERIFIED_LOCAL; aceptación previa preservada, sin dependencia de IA. |
| Lote automático y edición de resultados | VERIFIED_LOCAL; prueba auténtica nueva, heurísticas explicadas, revisión pendiente. |
| Audio-only M4A/SRT y recuperación | VERIFIED_LOCAL; dos archivos auténticos previos revalidados sin nuevos encodes. |
| Subtítulos originales EN/ES | VERIFIED_LOCAL de fases anteriores; no se repitieron sus renders aprobados. |
| Inglés→español local | VERIFIED_LOCAL técnicamente; PARTIAL en calidad editorial, siempre REVIEW_REQUIRED. |
| R2 privado y restauración confirmada | VERIFIED_LOCAL con servicio R2 real; no equivale a editor desplegado. |
| Android | Chromium móvil local comprobado; ANDROID_PHYSICAL_NOT_TESTED. |
| Editor externo nuevo | BLOCKED_EXTERNAL_AUTHORIZATION; no hay URL verificada. |
| Westcol LIVE/chat actual | LIVE_NOT_TESTED; no hay captura/chat nuevo. |
| Z.ai | NOT_TESTED en esta fase; no se repitió el 429 ni se gastaron créditos. |
| Monitor continuo | BLOCKED por host persistente/capacidad y activación específica; OFF. |
| Diarización, comprensión visual y calidad universal de selección | PARTIAL; no se afirma identificación fiable de personas, acontecimientos o emociones. |
| Doblaje español | PARTIAL/no integrado. c5053b9 y d5a654b no están disponibles localmente y GitHub devolvió 422. No se aplicaron parches antiguos, no hay UI/API/worker probado de doblaje. No bloquea el editor básico. |
| Publicación | OFF; no se publicaron videos ni se modificaron cuentas. |

## Traducción y recursos

Véase [LOCAL_TRANSLATION_MODELS.md](LOCAL_TRANSLATION_MODELS.md). El modelo nuevo
libre es opcional y no se instaló en Render. Mejoró los errores comparados de
oportunidad/temblor y preservó Rice mediante glosario; no hay garantía humana
universal. Las variantes y advertencias permanecen revisables.

Tres frases consumieron ~519 MiB RSS sólo en el traductor local, por lo que no
cabe junto a Next.js/workers en 512 MiB. La plantilla no lo instala. Sigue
ofreciendo 720p/1080p configurables, un render y un hilo; no promete 1080p o
transcripción sostenida bajo recursos insuficientes. No se repitió el benchmark
histórico de 305 s a 0,1 CPU. Falta medir el servidor real seleccionado.

No se activaron modelos/APIs de pago, no se cambiaron planes ni se hicieron compras. Los modelos locales no
tienen coste por llamada, pero requieren CPU/RAM. No puede calcularse un coste
real del hosting sin identificar cuenta/plan. R2 sigue sujeto al cupo existente;
guardar fuentes de cuatro horas diarias puede agotarlo rápidamente. El sistema
debe pausar por almacenamiento, nunca borrar originales para fingir coste cero.

## Despliegue bloqueado y operación concreta preparada

RENDER_API_KEY no está disponible en el runtime privado activo (revisión 4).
El diagnóstico nuevo devolvió `BLOCKED_MISSING_PRIVATE_BINDING`: **0 peticiones
administrativas, 0 mutaciones**. No se repitieron solicitudes 401.
Última consulta pública de los dos sitios existentes: login/API 503 y salud con
timeout; no determina cuenta, plan ni causa permanente del fallo.

**Única acción actual del propietario desde Android:** abrir la configuración
privada de este entorno, completar/vincular el requisito existente
`RENDER_API_KEY` como secreto de red para `api.render.com`, guardar/publicar y
aplicarlo al entorno. No enviarlo por chat ni agregarlo al servicio web ClipForge.
Las instrucciones de inicio actualizadas se guardaron como borrador del entorno;
no se consideraron aplicadas al runtime activo.

Después de esa acción, ejecutar primero `node scripts/render-admin-readonly.mjs`.
Sólo GET de propietarios/workspaces, servicios, último despliegue y nombres de
variables de los tres servicios ClipForge conocidos. No devuelve valores de
variables, correos ni cuerpos privados de error. Un 401/403 detiene ese diagnóstico.
Sus tests de transporte son fixtures explícitos, no una consulta a Render real.

**Operación para aprobación posterior:** crear exactamente un servicio web
independiente `clipforge-development-preview`, repositorio de la raíz actual,
rama congelada `preview/clipforge-master-20261028.1` en cc16902, Node 22.23.4,
plan free si el diagnóstico confirma disponibilidad/coste cero, una instancia,
auto-deploy OFF, autenticación de propietario obligatoria, R2 privado y
supervisor de workers según `render.audit-preview.yaml`. No agregar disco pago,
dominios, cron o recursos pagos. No tocar los dos servicios existentes.
Build: `bash scripts/render-native-free-build.sh`; arranque:
`node scripts/render-runtime-free.mjs`. Todos los flags de publicación,
agente y monitor permanecen false. La clave administrativa no se transfiere.

**Esta operación no está aprobada ni ejecutada.** Falta identificar workspace,
servicios/planes y presentar esa operación con sus datos reales para aprobación
específica. No se inventó un ownerId, serviceId ni URL futura.

Tras aprobación y despliegue: verificar SHA servido, login, subida de archivo
auténtico, recorte manual sin ASR, worker/render, R2, descarga íntegra, cierre de
pestaña y recuperación. Si el plan gratuito no alcanza, presentar una alternativa
medida y su coste antes de contratar. R2 no ejecuta workers ni evita suspensión.

## Uso desde Android cuando el ensayo esté verificado

1. Abrir la URL que se compruebe después del despliegue e iniciar sesión.
2. **Subir y editar video**: subir material autorizado, reproducirlo, marcar
   inicio/final, formato/resolución y crear el recorte; no requiere IA.
3. **Crear mejores clips**: elegir cantidad, duración, formato, calidad y modo
   de subtítulos. Sin traductor disponible, elegir original o sin subtítulos.
4. En **Mis videos**, reproducir/descargar; **Revisar cortes y subtítulos** abre
   la edición del clip guardado. Un borrador no muestra un MP4 obsoleto disponible.
5. Descargar SRT, comparar traducción con inglés/audio y conservar o rechazar
   desde la biblioteca. Renovar enlaces privados sin renderizar otra vez.

Cerrar Chrome no detuvo el trabajo en el runtime local probado. La supervivencia
de un reemplazo de instancia alcanza sólo el último respaldo confirmado, no las
subidas parciales ni cambios posteriores. Restaurar primero en espacio aislado,
comprobar hashes y evitar reemplazar un estado más reciente. Falta probar el
host externo y Android físico; no hay garantía 24/7 sobre un servicio gratuito.

## Verificaciones y commits

- `npm run verify`: **552 tests, 545 aprobados, 0 fallidos, 7 opcionales omitidos**.
  Las omisiones no se contaron como aprobaciones. La prueba nativa nueva de
  integridad Marian se ejecutó aparte y pasó; las otras omisiones de la suite
  general conservan su evidencia histórica y no se reejecutaron por rutina.
- Build local aprobado y CI Node 22 del código audiovisual 91c25f7 aprobada:
  https://github.com/tg321920-netizen/Clip.thomas/actions/runs/40606328171
  CI adicional Node 22 con el diagnóstico del operador bad2f93: aprobada,
  https://github.com/tg321920-netizen/Clip.thomas/actions/runs/40607067686
- `render:e2e` y `reframe:e2e`: aprobados, fixtures sintéticos de QA explícitos,
  nunca contados como archivos auténticos del streamer.
- Prueba móvil auténtica nueva, reintento sin encode, comparación de modelos,
  rechazo de tokenizador alterado y recuperación R2: aprobados.
- Auditoría npm de producción: 0 vulnerabilidades reportadas. No certifica
  ausencia de toda vulnerabilidad. CI también ejecutó auditoría de dependencias.
- Cuatro plantillas Render válidas contra el esquema oficial conservado;
  candidata/auth/flags/admin-key-exclusion comprobados. No es un despliegue.
- Referencias congeladas anteriores intactas; búsqueda exacta de tres valores
  privados configurados en 37 archivos cambiados: 0 coincidencias, sin imprimirlos.

Commits de esta fase: `29db333`, `08be5f2`, `2ee6dee`, `36e9d82`, `665a78a`,
`8193b3d`, `9297004`, `0b93493`, `91c25f7`, `cc16902`, `bad2f93`.
El commit posterior de este informe conserva el checkpoint; comprobar HEAD real
al retomar. Main remoto sigue f3d8ca3; core remoto sigue 78acd95.

Evidencia resumida sin secretos ni URLs firmadas:
[evidence/MASTER_MISSION_20261028.json](evidence/MASTER_MISSION_20261028.json).
Evidencia amplia/medios: `artifacts/master-mission-20261028/`, excluida de Git.
Los MP4 auténticos y el checkpoint nuevo están además en R2 privado.

## Reanudar sin repetir trabajo

Leer AGENTS, este informe, las instrucciones LIVE y los informes anteriores.
No regenerar los MP4 aceptados ni mover tags. Si se corrige código nuevo, usar
commits posteriores en el checkout operativo y push explícito a integración.
El ensayo congelado sigue independiente de los avances del operador.

Primero desbloquear la conexión privada Render y ejecutar sólo GET. Si sigue
ausente, no repetir diagnósticos ni prometer una URL. Mantener bloqueado sólo el
despliegue/infraestructura y continuar reparaciones reproducibles independientes.
La aceptación final de producto no se ha alcanzado: requiere el editor externo,
Android físico y una prueba LIVE real cuando haya fuente e infraestructura.
