# Auditoría de la rama existente

Fecha: 8 de octubre de 2026. Repositorio único: tg321920-netizen/Clip.thomas.

Rama inspeccionada: `codex/clipforge-core-rescue` en `8de5c1783b3f3ba06cc47ca3647aaee8c04a2336`.
Main: `f3d8ca33fd57452d475898fdf3adac4be210087c`.
Comparación GitHub: **ahead 12, behind 0; 71 archivos; 2.031 líneas añadidas y 235 retiradas**. Los seis JPG de las escenas son binarios y no están contados como líneas.

No se ha borrado, reiniciado, rebasado ni fusionado ninguna rama. La clonación quedó bloqueada por la red; los archivos necesarios se leyeron desde el SHA exacto usando el conector y se guardaron en un snapshot parcial local. No se presenta como un clon completo ni se fabrica historia Git local.

## Los doce commits conservados

| SHA | Fecha UTC | Mensaje |
|---|---|---|
| 8de5c1783b3f | 2026-10-08T16:44:55Z | test: review actual readable captions and use natural Spanish fixture pacing |
| a285664ff2c6 | 2026-10-08T16:30:16Z | fix: use complete Whisper segment timing unless word alignment is requested |
| abc13c172316 | 2026-10-08T16:18:08Z | ci: bound media package downloads and avoid stalled runner installs |
| a02c5641cad5 | 2026-10-08T16:08:13Z | fix: preserve full Whisper captions and recover verified render checkpoints |
| 43f32781b04d | 2026-10-08T15:56:18Z | test: verify H264 playback with Chrome and voice plus music assembly |
| 5fc873f395e2 | 2026-10-08T15:49:21Z | fix: route Vercel media to server runtime and prepare rescue pull request |
| 1ac9419c4572 | 2026-10-08T15:44:47Z | fix: recover interrupted media jobs and verify visible synchronized subtitles |
| 9be22074ca4e | 2026-10-08T15:29:17Z | test: real mobile browser playback downloads and server restart |
| 51892203865a | 2026-10-08T15:24:37Z | fix: clip-relative subtitle timing and sentence selection with real Whisper acceptance |
| 82eb8b28a5ca | 2026-10-08T15:17:56Z | feat: connect three mobile video tools to durable validated jobs |
| 39162dd0f74f | 2026-10-08T15:10:05Z | feat: persistent scene stories and complete video editing with real media acceptance |
| e5179b2d88c5 | 2026-10-08T14:46:26Z | fix: resume file uploads and validate real MP4 outputs with publishing off |

## Cambios observados respecto de main

- Ingesta: ResumableUploadStore, SHA-256 por fragmento, capability por sesión, reconstrucción atómica, writeAll y cliente Android; máximo actual 1 GiB por archivo y fragmentos de 2 MiB.
- Video: MediaValidationService, normalización de tiempo/FPS, ASS relativo al clip, audio, decodificación, negro y descargas con Range.
- Clips: BestClipsService, agrupación de frases, heurística sobre texto y energía acústica, eliminación de duplicados; no estadísticas de vistas ni modelos públicos de un competidor.
- Edición: VideoAutoEditService recorta silencios con márgenes y vuelve a transcribir cuando necesita subtítulos; no es un editor general que garantice montaje profesional.
- Historias: SceneStoryService produce varias escenas con recursos elegidos, voz local y movimiento; plantilla maya y recursos de control existentes, sin generación general de guion/imagen activada.
- Operación: estados persistidos, locks y recuperación con identidad del worker. Persistencia local no equivale a disco durable de producción.
- Interfaz: tres módulos, historial, subida y puente al runtime. La pantalla original inicia en historia maya y clips de 90–180 s.
- Publicación: bloqueada en la rama y retirada de supervisores. No se demuestra que producción tenga ese cambio.
- CI: ejecución automática de múltiples renders, Whisper y demos con cada push; preparación automática de PR tras esas pruebas.

## Defectos concretos y reparación preparada

1. Selección: podía cerrar en una cola incompleta y recurrir a todo el texto fuera de los límites. El modo estricto de clips exige cierre de frase, inicio tras cierre anterior y no usa ese fallback. Puntuación y puntuación ortográfica no prueban significado autónomo; revisión humana pendiente.
2. Recuperación: reconstruía un resultado sin títulos, duración, motivo y tiempos; una entrega de un clip también cambiaba la forma de respuesta. Se preservan esos metadatos, se valida cada archivo y se rechaza un checkpoint con cantidad distinta a la pedida.
3. Fuente de interfaz: elegir otro archivo borraba el resultado del componente de subida pero no el proyecto del formulario de clips. Se limpia el origen del formulario y se deshabilita crear clips hasta disponer del nuevo original.
4. Prioridad y calidad: clips por defecto, 30–60 s y movimiento suave; preset BALANCED en lugar de FAST. La mejor compresión es una configuración, no calidad visual comprobada, y su CPU debe medirse.
5. Costos: el CI principal pasa a código/build, sin scripts E2E audiovisuales ni creación automática de PR. Una prueba de captura larga que generaba un MP4 dentro de npm test queda explícitamente desactivada por defecto.

## Acceso y comprobaciones

GitHub devuelve admin/push para la cuenta propietaria. Esto no demuestra que todas las herramientas del conector tengan permisos de escritura: se debe observar una escritura real antes de afirmarlo.

Render devuelve un solo workspace, My Workspace (tea-d2bvocfdiees73f5gpv0), pero get_selected_workspace exige confirmación del usuario antes de consultarlo. La pregunta está pendiente. No se han consultado servicios, variables secretas, facturas ni logs de clientes. No se cambió producción. render.yaml declara main y /tmp/clipforge; el blueprint no demuestra la configuración actual del servicio conectado.

El CI previo documenta aceptación técnica con fuentes sintéticas y emulación. Se conserva como antecedente, sin tomarlo como validación comercial, Android físico o resultado de las reparaciones presentes. En esta sesión no se generó audiovisual ni se ejecutó CI remoto.

## Fuentes realmente leídas

- [Comparación en GitHub](https://github.com/tg321920-netizen/Clip.thomas/compare/main...codex/clipforge-core-rescue), obtenida mediante el conector el 8 de octubre de 2026.
- [Árbol del SHA inspeccionado](https://github.com/tg321920-netizen/Clip.thomas/tree/8de5c1783b3f3ba06cc47ca3647aaee8c04a2336).
- AGENTS.md, docs/CORE_RESCUE_AUDIT.md, docs/CORE_RESCUE_PR.md, workflows y servicios citados, leídos en ese SHA.
- Metadata/permisos del repositorio y lista de workspaces de Render, con herramientas de solo lectura en la misma fecha.

Para reproducir el alcance exacto, consultar el manifiesto de archivos y el parche del paquete de revisión. La rama remota debe actualizarse únicamente por avance normal sobre su head comprobado, sin force/reset; revalidar si aparece trabajo nuevo.

