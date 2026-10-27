# ClipForge Studio — continuación comprobada del 27 de octubre de 2026

Código candidato: **`f103c04a91edcfe2c67de50fb18b2a2dbf187021`**.
Etiqueta: `clipforge-development-candidate-20261027.1`.
Referencia congelada: `preview/clipforge-studio-completion-20261027.1`.
Destino de integración: `work/clipforge-functional-review-20261025-5d025fe`.
Checkout operativo conservado: `codex/clipforge-core-rescue`, como exige AGENTS.

**Resultado:** motor compartido reparado y verificado localmente con medios
auténticos, APIs, workers y R2 reales. No se creó ni desplegó un servicio nuevo.
El acceso externo sigue `BLOCKED_EXTERNAL_AUTHORIZATION`; no hay URL nueva
certificada para el propietario. La traducción automática continúa `PARTIAL`.
Publicación, agente y monitor LIVE permanecen apagados. No se tocó StoryMotion.

## 1. Historial conservado y cambios

Se verificaron antes de escribir main, core, integración, `3459cfb`, `a4b2305`
y `761e291`, sus ancestros y el árbol de trabajo. No se cambiaron main, el core
remoto, producción ni las candidatas anteriores. No hubo reset ni force-push.

| Commit | Corrección comprobada |
| --- | --- |
| `22646b4` | Contexto/glosario de traducción, riesgos semánticos, historial y recuperación de pistas, controles móviles |
| `a9979d6` | Audio-only real, M4A/SRT y checkpoints ASR separados por configuración |
| `a943894` | Reapertura correcta de proyectos de audio y parada forzada de workers que ignoran SIGTERM |
| `74399f6` | Dedupe de acontecimientos por hash del original, restauración de identidad y revisión editorial sincronizada |
| `0659b2e` | Checkpoints de hasta 16 MiB y memoria acotada al listar proyectos largos |
| `e10b754` | Evitar aperturas truncadas y conservar resolución/formato con zoom por voz |
| `c0dc918` | Prueba móvil de revisión/descarga, distinción fuente/lote, plantilla congelada y requisitos de build |
| `f103c04` | Next.js 16.4.3 y dependencias corregidas; auditoría de vulnerabilidades en CI |

Referencias inmutables anteriores: `.4` =
`a4b23050b38f866720343cd44f1d039dc8f89689`; estable `.1` =
`761e291d72426bac647d513ac7e08ad75dcad9f1`; candidata `.2` =
`b6936e610e8cd0fafe05d4d326f57db9537b7d24`. La base de esta continuación fue
`3459cfb2983a03880b6eec8b1d1241aecfede3ab`. El commit posterior a este informe
solo documenta la entrega; no cambia los bytes de la candidata técnica.

Archivos afectados agrupados (el inventario exacto está en
`git diff --name-only 3459cfb..f103c04`):

- Traducción/subtítulos: `TranslationQualityService`, `LocalTranslationProvider`,
  `SubtitleService`, rutas de proyecto/subtítulos, `TranslationGlossary`,
  `ClipSubtitleEditor`, `editorial-warnings` y sus tipos/pruebas.
- Entrada y medios: `upload-policy`, `VideoProcessor`, `UrlIngestService`, rutas
  de subida/original, `MediaValidationService`, `ClipService`, `RenderService`,
  `JobStore`, `ManualClipEditor`, `UploadPanel`, `ProjectPipeline`, `MediaTools`.
- Selección/recuperación: `TranscriptionService`, workers, `transcript-normalizer`,
  `BestClipsService`, `ContentAnalysisService`, `TranscriptCandidateProvider`,
  `EditorialEventStore`, `PrivateClipReviewService`, `ProjectStore`,
  `ProjectRecoveryService`, `R2ObjectStore`, `ClipLibraryService`, accesos privados,
  `CloudClipLibrary`, `RecentProjects` y rutas de jobs/descargas.
- Runtime/QA: ambos supervisores, `child-shutdown`, Dockerfiles, build nativo,
  `render.audit-preview.yaml`, cinco scripts de aceptación nuevos, pruebas de
  regresión, `package.json`, lockfile y workflow de CI. README, AGENTS, plan y
  documentos de recuperación/despliegue tienen puntos de reanudación actualizados.

## 2. Fallos reales y resultado de las reparaciones

| Problema anterior | Comportamiento actual y límite |
| --- | --- |
| «Rice» se convertía en arroz; se traducían frases aisladas | Glosario por proyecto, contexto acotado y delimitadores conservadores. Si no se recuperan ambos delimitadores se usa la traducción directa real con advertencia. No se adivina texto faltante |
| Traducción de significado incorrecto podía parecer terminada | Toda traducción de máquina queda `REVIEW_REQUIRED`. Riesgos explícitos de cifras, negación, modalidad, omisiones, términos y expresiones ambiguas; no es certificación semántica |
| Editar/regenerar subtítulos perdía versiones o cambios de otra pestaña | Snapshots inmutables y comparación de revisión; conflicto 409 conserva lo anterior. Restaurar una pista no cambia el intervalo. Máximo 30 versiones/180 KB por clip: al alcanzarlo se pausa la edición sin borrar historial |
| Zoom forzaba 1080×1920 incluso solicitando 720p/16:9 | Dimensiones elegidas propagadas a zoompan; ventanas calculadas a los 30 fps de salida. La validación detectó el archivo incorrecto antes de READY; el render corregido pasó |
| Podcast solo de audio era tratado como vídeo inválido | FFprobe identifica audio real e ignora carátulas como pista de vídeo. Salida AAC/M4A, reproductor de audio y SRT, sin escenas inventadas |
| Al reabrir audio se mostraban controles de vídeo | El resumen de proyecto conserva `mediaKind`; UI y descarga mantienen identidad AUDIO |
| Cambio de idioma/modelo reutilizaba checkpoints ASR incompatibles | Identidad de transcripción ligada a configuración y exclusión de ejecución por proyecto. Se conservan chunks y tiempos; no se mezclan resultados de configuraciones distintas |
| Recortes repetidos tras nuevos lotes/restauración | Hash del archivo original y registro de acontecimientos; reconstrucción desde proyectos derivados restaurados. No es deduplicación semántica universal de todo R2 |
| Inicio de fuente dentro de una frase podía convertirse en candidato | Proveedor v6 descarta esa apertura en selección estricta; conserva el original y la opción manual. Es una regla conservadora, puede omitir candidatos válidos |
| «(applause)» aparecía como diálogo | Se retiran anotaciones ASR conocidas de los subtítulos procesados, sin cambiar la transcripción cruda ni inventar palabras |
| Rechazo R2 no se reflejaba en resultados locales | Sincronización de revisión y proyección actual de jobs. REJECTED no se confunde con render FAILED/READY; el archivo se conserva |
| Snapshots de 1,9 MB y listados concurrentes arriesgaban material largo | Checkpoints limitados explícitamente a 16 MiB, sin truncar transcripciones; listado con dos lecturas simultáneas y resúmenes sin texto largo |
| Supervisor no escalaba porque `.killed` ya era true | Se observa salida real; SIGKILL solo para hijos propios que no terminan tras la gracia. Regresión con proceso Node real que ignora SIGTERM |
| Dockerfile instalaba yt-dlp VCS sin git | Ausencia reproducida en la imagen base; se añadió git. Build Docker completo todavía `NOT_TESTED` |
| Modelos cacheados podían usarse sin comprobar bytes | SHA-256 de whisper tiny validado en build nativo y Docker gratuito |
| Auditoría de dependencias encontró alertas nuevas | Next 16.3.8→16.4.3, sharp 0.35.4→0.35.5, source-map-js 1.2.1→1.2.2, zod 4.6.5→4.6.6. ESLint config alineado. Auditoría final: cero vulnerabilidades conocidas informadas |

Las alertas registradas fueron GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r,
GHSA-673q-mjm6-r5xr, GHSA-wq5f-xc86-pv6w, GHSA-68fv-2mgg-jv7q y
GHSA-mrhx-c7xc-m3w5. El resultado de npm audit depende de su base de datos y
no constituye una auditoría de seguridad completa. La CI impide continuar si
se informa una vulnerabilidad alta/crítica.

## 3. Archivos auténticos nuevos y revisión

Fuente de dominio público NASA/JFK:
[grabación original](https://commons.wikimedia.org/wiki/File:President_Kennedy_speech_on_the_space_effort_at_Rice_University,_September_12,_1962.ogv).
No se descargó ni regeneró el mismo entregable anterior para aumentar cantidad.
Estos archivos verifican cambios concretos de audio, disposición y reencuadre;
**no son Westcol ni una selección viral aprobada por IA o por el propietario**.

| Resultado | Intervalo en fuente completa | Archivo local, relativo al repositorio | SHA-256 |
| --- | --- | --- | --- |
| MP4 16 s, 1280×720, H.264/AAC, inglés original visible arriba; decisión de acelerar el programa espacial | 559,28–575,28 s | `artifacts/completion-20261027/layout-24FWYK/storage/clips/161bdec6-6f95-4788-83bb-48381cd664ed/27e36bef-ac61-4a83-b31c-8cbdce289b8f/render.mp4` | `78c26d25aa5e4d04b2b4f31a97a4c70f8999e9913ebbc5421985a60bdd952b14` |
| M4A automático 34,96 s: espacio, paz, conocimiento y armas; heurística local; PENDING | 332,48–367,44 s | `artifacts/completion-20261027/audio-2JuT5b/storage/clips/b158f3dc-b134-4814-8f44-4031671b60b7/f36655a2-32f8-4ece-83db-74b534fe66bb/render.mp4` | `4808c9bbc457429e117502e1319a4448dbea06fb2318e48365995c697ffe8ea5` |
| M4A manual 18 s, prueba del editor, historial y traducción revisable | 310–328 s | `artifacts/completion-20261027/audio-2JuT5b/storage/clips/6dd11446-6b5b-486e-80e5-317ff5a34b09/a4b1937c-119f-45ca-939d-fd1abfbe7096/render.mp4` | `f8ebf904d1d40676cd7bfe837b83e98ed2810ac6711b627f04927f64f935ea0e` |

Los paths internos históricos terminan en `render.mp4`; la API reconoce AUDIO,
sirve `audio/mp4` y descarga con extensión `.m4a`. No contienen pista visual.
El SRT del vídeo está también en `layout-24FWYK/original-en.srt`.

**Conteo exacto:** un MP4 de vídeo nuevo y tres archivos de solo audio generados.
Del lote automático de dos, se retiene **uno** para revisión; el otro (30,68 s,
inicio truncado en 300 s) fue REJECTED por Codex QA y se preservó. El recorte
manual se solapa con ese rechazo y no cuenta como otro acontecimiento.
Ninguno está aprobado por el propietario; no hubo publicación ni doblaje.

R2 privado, IDs recuperables desde la biblioteca autenticada:

- Vídeo: `439dfc571efd3403f82e651b3d091b5f6925cb2b34b341f5ba1e8aa1c76d53b2`.
- Audio automático retenido: `4c7a623920f4a70808db51005429708ad248a1d7d1cd83a5445f5ff38383cc4b`.
- Audio manual: `ea65cb94976e568a13e8de438e023c87cbc44435af70ff9789a2c3cb98f7bdc1`.
- Audio rechazado preservado: `b092d10208b55575a2f6250eb578951296cd5a48d0f0258ace3c6a6cb5802c27`.

No se publican enlaces firmados en este documento. La aplicación permite
«Renovar acceso privado» sin renderizar de nuevo. Se verificaron descarga y
restauración a raíces vacías con los mismos hashes, glosario e historial.

## 4. Calidad de traducción y selección

Evaluación offline real CT2/SentencePiece, no mock ni API:
`artifacts/completion-20261027/translation-real-evaluation.json`.
Modelo SHA `d5771f823c9dd7eedcf9367c116aede65613a194f761a81826351e2bccb194c4`.

- «Why does rice play Texas?» deja de convertir Rice en arroz con el glosario.
  Sigue necesitando contexto editorial para una expresión deportiva natural.
- «may never come again» aún produce «volver a empezar»; fallback y riesgo de
  expresión idiomática visibles. No se acepta como traducción correcta.
- «felt the ground shake» aún produce «batido de tierra»; riesgo de expresión
  ambigua marcado. El contexto no arregla mágicamente las limitaciones del modelo.
- En el caso evaluado se conservaron 15, NASA y la negación. Las reglas no
  reconocen universalmente todos los nombres, cifras o errores de significado.
- Se conservan original, traducción directa/contextual, advertencias e historial.
  El usuario puede corregir/restaurar pistas y descargar sus SRT desde el móvil.

La prueba de audio utilizó ASR real whisper.cpp tiny en inglés; puede contener
errores. Las pruebas previas de ASR español/inglés y los dos vídeos NASA/JFK
corregidos se conservaron. No se certifica transcripción humana ni doblaje.
La selección nueva se identifica `LOCAL_HEURISTIC`, con motivo, puntuación,
fuente, tiempos y carencias de evidencia. Hubo audio medido y transcripción real;
no hubo chat, fotogramas para audio-only, ni evaluación de Z.ai. Un pico de
energía no equivale a un acontecimiento confirmado. El zoom por voz no identifica
rostros ni hablantes; las conversaciones de varios participantes siguen PARTIAL.

## 5. Pruebas y evidencia reproducible

| Verificación | Resultado y alcance |
| --- | --- |
| `npm ci` con lockfile actualizado | PASSED en Node 22.23.4 |
| `npm run verify` | **496 totales, 490 aprobadas, 0 fallidas, 6 omitidas**; regresiones nuevas de traducción, audio, recuperación, revisión, dimensiones y workers |
| `npm run build` | PASSED con Next 16.4.3 / Node 22; verificación adicional tras el parche dev de zod también PASSED |
| `npm audit --json` | 0 alertas conocidas finales, incluyendo dependencias de desarrollo |
| `npm run render:e2e` | PASSED, QA sintético identificado: render/conversation, audio, subtítulos, 1080×1920; no entregable del streamer |
| `npm run reframe:e2e` | PASSED, QA sintético identificado: ventanas, zoom y render; no seguimiento visual demostrado |
| Podcast auténtico por Chromium móvil → API → worker → M4A/SRT → R2 | PASSED; idioma inglés real, traducción local, edición y restauración de pistas; ningún mock de API |
| Análisis/selección automática del podcast → worker → R2 → restauración/dedupe | PASSED técnico; un resultado retenido y uno rechazado tras revisión de límites |
| MP4 auténtico con estilo, conversación y zoom | PASSED; FFprobe, decodificación completa, ninguna ventana negra detectada y revisión de fotogramas a 2 y 10 s |
| Chromium móvil contra Next 16.4.3 y R2 | PASSED a 393×851, táctil: login, 401 anónimo, reapertura audio/vídeo, reproducción, descargas MP4/M4A/SRT, rechazo visible, controles ≥44 px, renovación y hash R2; sin error JS ni overflow horizontal |
| Restauración R2 | PASSED en directorios aislados: originales, medios finales y metadatos; conflictos no pisan una versión local distinta |
| Esquema oficial guardado de Render y bash | PASSED para cuatro YAML y sintaxis de build; no aprovisiona recursos |
| Trazas de bundle | 111 manifiestos inspeccionados: 0 paths de storage/artifacts/.git/.env incluidos; persiste advertencia de tracing dinámico |
| Docker completo, ensayo Render y Android físico | NOT_TESTED / BLOCKED según dependencia; no se atribuye éxito |

Las seis omisiones son pruebas nativas optativas de escenas/audio, HLS largo,
reanudación VOD, segmentos cerrados, captura >120 s y cancelación real de un
encode. No se cuentan como aprobadas ni se repiten las pruebas de captura que
no cambiaron. Las pruebas ligeras de sus mecanismos sí forman parte de verify.

Los errores encontrados durante aceptación se conservaron: reapertura de audio,
salida zoom con dimensiones equivocadas, conflicto al restaurar sobre una copia
local diferente y un error de tipo del resumen móvil corregido antes del build.
Los fixtures de transporte/modelo están identificados como tales; no prueban LIVE
ni calidad editorial de un modelo real.

Evidencia local bajo `artifacts/completion-20261027/` (medios/logs no se suben a Git):
`final-code-verify.log`, `final-node22-patched-build.log`, `npm-audit-final.json`,
`render-e2e-final.log`, `reframe-e2e-final.log`, `render-schema-final.json`,
`deployment-traces-final.json`, `audio-2JuT5b/evidence.json`,
`audio-2JuT5b/automatic-evidence-before-review.json`, `automatic-evidence.json`,
`boundary-analysis-v6.json`, `readonly-mobile-evidence.json`,
`layout-24FWYK/evidence.json` y sus fotogramas. No contienen claves ni URLs firmadas.

Los scripts nuevos tienen opt-in de fuente autorizada y/o raíces de aceptación:
`audio-editor-e2e.mjs`, `audio-selection-e2e.mjs`, `caption-layout-e2e.mjs`,
`translation-quality-e2e.mjs`, `mobile-review-readonly-e2e.mjs`.
Los modos de reanudación comprueban/reutilizan medios terminados, sin generar
otra copia para aparentar progreso. No ejecutar de nuevo una aceptación sin
una modificación o hipótesis que lo justifique.

## 6. Recursos, persistencia y límites

- Render nuevo 16 s/1280×720/CONVERSATION/zoom/subtítulos: **7,133 s locales**,
  un hilo, preset eficiente, Node 22. No es un benchmark de Render. La fuente
  auténtica es 352×240: exportar a 720p no recupera detalle inexistente.
- Lote inicial de dos M4A: 3,385 s locales con ASR previamente obtenido y audio
  medido; no equivale a transcribir todo el material ni a renderizar vídeo.
- `manualSeconds=0.002` del ensayo reanudado y `elapsedSeconds=8.179` de la
  revisión automática son tiempos de verificación/reutilización, **no encoding**.
- Correlación del audio manual con su intervalo original: 0,9999149.
  Se comprobaron pistas/duración; no se certifica sincronía perceptual universal.
- Pico observado de suma de RSS del árbol de procesos: 555536 KiB (~542,5 MiB),
  incluye páginas compartidas varias veces y no es un pico de cgroup. Backup
  desactivado durante esa medición. No demuestra caber en 512 MiB.
- Se mantiene la medición histórica 30 s/720p → 304,908 s con 0,1 CPU/512 MiB.
  No se repitió ni se presenta como rendimiento del hosting actual.
- Render máximo configurado uno; modelos/inferencias y otros workers también
  requieren capacidad. Sin medición conjunta no se garantiza el perfil gratuito.
- ASR ya era por chunks con checkpoints: se reutilizó, no se creó otro motor.
  La identidad nueva evita mezclar ajustes. El original se lee por procesos,
  sin cargar un vídeo de horas entero en memoria. No hubo aceptación nueva de 4 h.
- Original ≤1 GiB, snapshot ≤16 MiB, restauración ≤2 GiB, hasta 100 clips y
  100 jobs/proyecto, cupo R2 del proyecto 8 GB; staging con margen de 128 MiB.
  Material de varias horas puede superar estos límites; falla explícitamente.
- Cerrar Chrome no detiene un worker del servidor. Suspender/reemplazar la
  instancia sí puede detenerlo y perder `/tmp`; solo una copia confirmada R2
  permite recuperar los archivos. Una subida inconclusa no tiene esa garantía.
- Recuperación deja trabajo incompleto en WAITING_RESOURCE para reanudarlo
  explícitamente. READY requiere archivo y validación. No se restauran locks
  antiguos, credenciales, publicaciones ni monitor. Se preservan copias previas.

## 7. Westcol y pruebas LIVE

Consulta pública permitida del 27/10 a las 02:55 UTC: **OFFLINE**. La consulta
oficial estaba UNCONFIGURED; no se inventó un identificador de sesión. Estado
**LIVE_NOT_TESTED**, monitor/captura apagados, cero chat observado y cero clips
nuevos de Westcol en esta fase. No se llamó Z.ai; el HTTP 429 anterior no fue
reevaluado ni se cambió a otro modelo de pago.

Los tres clips reales anteriores (VIP, Nike, reloj) se descargaron de R2 solo
para verificar sus SHA-256: idénticos, `keep=true`, revisión PENDING. Evidencia
`westcol-preserved-r2.json`; no hubo renders ni nuevas selecciones. Se conservan
HLS, chat, sincronización, colas, dedupe y respaldo existentes. No se promete un
observador permanente ni se amplía acceso/DRM. Hace falta una transmisión
autorizada accesible y un runtime persistente para completar esa aceptación.

## 8. Render y operación administrativa pendiente

Estado **BLOCKED_EXTERNAL_AUTHORIZATION**. La clave no está presente en el
entorno activo ni vinculada en su configuración observada (revisión 4). No se
buscaron secretos fuera de ese mecanismo, no hubo llamadas administrativas
repetidas, POST, creación de servicios, despliegues ni cambios de plan.

Dos GET públicos de salud, 27/10 04:15 UTC, agotaron timeout de 12 s:
`clipforge-studio-trial.onrender.com` y `clipforge-runtime-free.onrender.com`.
Eso no demuestra una caída permanente ni identifica el plan o cuenta. La
observación histórica `e1045df` no prueba la versión servida ahora. No se declara
ninguna función nueva VERIFIED_DEPLOYED.

**Única acción administrativa inmediata del propietario desde Android:**
vincular privadamente `RENDER_API_KEY` para `api.render.com` al entorno activo de
Codex y aplicar esa configuración. No enviarla por chat. Después, Codex puede
hacer GET de cuenta, servicios, recursos y despliegues para concretar costes.
La clave administrativa nunca se copia al proceso web de ClipForge.

**Operación preparada, no aprobada ni ejecutada:** crear un único servicio
independiente `clipforge-development-preview`, Node 22.23.4, región Virginia,
propuesta free (sin upgrade automático), una instancia, desde
`preview/clipforge-studio-completion-20261027.1` = `f103c04a91edcfe2c67de50fb18b2a2dbf187021`.
Usar `render.audit-preview.yaml`: build nativo y supervisor existentes, auth
obligatoria, clave de propietario privada, sesión generada, R2 privado, backup
activado, un render/hilo, auto-deploy OFF, publicación/agente/LIVE OFF. Traducción
local opcional no instalada por esta plantilla. Antes de crear, presentar el
resultado GET y pedir aprobación de esta operación concreta. Si el free no está
disponible o requiere pago, mantener bloqueado; no aceptar cargos por defecto.

No se contrató nada ni se consumieron APIs de pago: inferencia local y R2
existente. No es posible ofrecer una cotización de los recursos reales de la
cuenta sin acceso administrativo. El plan gratuito efímero no garantiza 24/7,
tiempo de render práctico ni supervivencia sin backup. Una alternativa es un
runtime ya disponible con FFmpeg y volumen durable; hay que medir su capacidad
y aprobarlo antes de usarlo. R2 guarda objetos, no ejecuta el worker.

Rollback: conservar candidata anterior y respaldos, pausar workers, comprobar
compatibilidad de metadatos y restaurar una copia aislada; no montar una versión
antigua sobre el único original nuevo ni rebobinar checkpoints. Un rollback de
software no deshace los datos. No hay auto-deploy del desarrollo sobre el ensayo.

## 9. Uso desde Android y matriz de aceptación

No hace falta Termux. Una vez autorizado y comprobado el servidor:

1. Abrir su URL real, introducir la clave de propietario y elegir Subir material.
2. Esperar subida y validación del original; reproducirlo antes de recortar.
3. En Recorte manual marcar inicio/final, formato y resolución disponibles.
   Para audio se omiten los controles visuales y se descarga M4A.
4. Elegir sin subtítulos, originales ES/EN o traducción EN→ES cuando esté
   configurada. Agregar nombres/terminología en el glosario antes de traducir.
5. Generar y consultar progreso. Guardar el proyecto y comprobar fecha de
   respaldo confirmado; volver desde Mis proyectos, distinguiendo Fuente/Lote.
6. Revisar texto, riesgos y contexto; editar/restaurar subtítulos sin mover el
   intervalo. Si estaban incrustados, volver a renderizar ese mismo clip.
   Un cambio de SRT de audio no vuelve a codificarlo.
7. Reproducir, descargar MP4/M4A/SRT y usar Renovar acceso privado si caduca.
   Rechazar o pedir otro recorte; PENDING no significa aprobado automáticamente.

**ANDROID_PHYSICAL_NOT_TESTED:** en el teléfono comprobar login, subida propia,
recorte, reproducción con sonido, descarga en Chrome/Archivos, SRT y renovación.
Iniciar un trabajo, cerrar Chrome, regresar y comprobar resultado/checkpoint.
No probar pérdida de disco en producción. La emulación comprobó APIs y media,
pero no los permisos, reproductor ni gestor de descargas de un Android físico.

| Capacidad | Estado de esta entrega |
| --- | --- |
| Motor de vídeo manual, formatos, MP4, audio original, SRT y R2 | VERIFIED_LOCAL; no disponible externamente por esta candidata |
| Audio-only manual/automático, reproducción M4A, historial y recuperación | VERIFIED_LOCAL sobre una grabación auténtica; generalización editorial PARTIAL |
| Subtítulos originales ES/EN y corrección | VERIFIED_LOCAL con evidencia actual/previa preservada; ASR puede equivocarse |
| EN→ES con glosario/contexto e historial | Transporte/mecánica VERIFIED_LOCAL; calidad semántica PARTIAL/REVIEW_REQUIRED |
| Selección automática de momentos, varios participantes y material de horas | PARTIAL; no certifica editor humano ni identificación universal de hablantes |
| Rostros, seguimiento visual inteligente y doblaje | PARTIAL/NOT_TESTED; no se hicieron estas afirmaciones |
| Recuperación de copias R2 confirmadas en staging | VERIFIED_LOCAL contra R2 real; no reinicio de Render probado |
| Monitor Westcol, chat actual y captura LIVE nueva | LIVE_NOT_TESTED; monitor OFF, no observación continua |
| Ensayo privado, Android externo y recursos reales del hosting | BLOCKED_EXTERNAL_AUTHORIZATION |
| Android físico | ANDROID_PHYSICAL_NOT_TESTED |
| Candidata de código y configuración de ensayo manual | READY_FOR_DEPLOYMENT para ensayo autorizado; capacidad total free sin certificar |
| Publicación social | OFF, sin ejecución ni cambios de credenciales |

El siguiente trabajo no es volver a renderizar NASA: vincular Render, diagnosticar
GET, aprobar el ensayo concreto y comprobar desde fuera login → subida real →
recorte → worker → R2 → reproducción/descarga. Solo esa aceptación permite
promover una función a VERIFIED_DEPLOYED.

## 10. Cierre tras recuperar el entorno

La desconexión del entorno interrumpió el primer intento de cierre. Tras volver
la conexión se comprobaron el árbol, los ocho commits de código, sus evidencias
y el SHA del MP4, sin volver a renderizar. El informe quedó en el commit
`3bd011312ed88bb481ec9266c1ad137849094770` y se envió mediante push atómico normal
a la rama de integración, junto con la rama y etiqueta nuevas fijadas a
`f103c04a91edcfe2c67de50fb18b2a2dbf187021`. El core remoto, main y las etiquetas
anteriores mantuvieron sus SHA. El árbol local estaba limpio después del commit.

[ClipForge CI 40500740981](https://github.com/tg321920-netizen/Clip.thomas/actions/runs/40500740981)
comprobó ese envío en GitHub: `npm ci`, auditoría (cero alertas), verify
(496 totales / 490 aprobadas / cero fallidas / seis omitidas) y build aprobados.
Los logs y resumen están en `artifacts/completion-20261027/github-ci-3bd0113.*`.
Este añadido documental no cambia el código de la candidata ni requiere otro
render o despliegue. No se ejecutaron los workflows audiovisuales optativos.

Existe además un bundle Git local verificado con toda la historia y el informe
inicial: `/workspace/clipforge-studio-completion-20261027-3bd0113.bundle`.
No sustituye los originales R2 ni se borraron los bundles anteriores.

Nueva consulta pública de Westcol a las **12:40 UTC del 27/10: OFFLINE**,
registrada en `westcol-status-resume.json`. Sin captura, chat ni modelos nuevos;
se mantiene `LIVE_NOT_TESTED`. `RENDER_API_KEY` continuaba ausente al reanudar.
El entorno de desarrollo recuperado no equivale a un servidor de ensayo público:
la acción administrativa pendiente sigue siendo la descrita en la sección 8.
