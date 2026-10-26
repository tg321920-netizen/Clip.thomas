# ClipForge utilizable: entrega comprobada del editor móvil

26 de octubre de 2026, UTC. **Código probado en un servidor local de pruebas;
esta versión todavía no está desplegada en un sitio accesible desde Android.**
El bloqueo de alojamiento se describe al final. No confundir ese bloqueo con
una prueba de edición terminada: el flujo audiovisual sí se ejecutó completo.

## Versión y funciones

Código: `761e291d72426bac647d513ac7e08ad75dcad9f1`, etiqueta inmutable
`clipforge-stable-candidate-20261026.1`. Rama remota de integración:
`work/clipforge-functional-review-20261025-5d025fe`. Checkout local conservado
en `codex/clipforge-core-rescue`, conforme a `AGENTS.md`.

Se reutilizaron la subida reanudable, `ClipService`, `JobStore`, render-worker,
`RenderService`, la biblioteca R2 y la autenticación del propietario. El editor
anterior solo creaba clips desde candidatos: faltaba un intervalo manual que
no dependiera de Whisper o una IA. Ahora la misma ruta de clips admite ese caso,
valida derechos, tiempos, duración y huecos, y conserva el original.

| Función de esta versión | Resultado |
| --- | --- |
| Acceso del propietario | Formulario y cookie firmada comprobados; API sin sesión devuelve 401. |
| Subir MP4/MOV/WebM | Subida por fragmentos, validación en worker y reproducción del original. |
| Recorte manual | Inicio/final numéricos o desde la posición del reproductor, previsualización y encuadre seleccionable. |
| Generar MP4 | Worker y FFmpeg reales, sin necesitar Whisper ni Z.ai. |
| Consultar progreso | Estado de la cola y progreso del render; volver al proyecto después de cerrar la pestaña. |
| Descargar | MP4 local y copia privada R2 comprobados con hashes idénticos. |
| Renovar acceso privado | Enlace temporal renovado y descargado desde la interfaz móvil emulada. |
| Sugerir momentos | Cinco candidatos locales sobre transcripción real existente, audio RMS y cambios visuales medidos. No son cinco clips renderizados ni aprobados. |
| Ajustar candidatos | Botón «Ajustar este recorte» pasa los tiempos al editor manual. |

Los botones principales son **SUBIR Y EDITAR VIDEO → Elegir archivo → Subir
video → marcar inicio/final → confirmar autorización → Generar MP4 del
fragmento → Descargar recorte MP4**. Para regresar: **Abrir proyecto**. En la
biblioteca privada: reproducir, descargar y **Renovar acceso privado**. Estas
instrucciones corresponden a esta versión; no se atribuyen al sitio antiguo.

## Separación de versiones

`CLIPFORGE_RELEASE_CHANNEL=stable` es el valor por defecto. Deja disponibles
el editor manual, las sugerencias locales y la biblioteca. El monitor y las
historias no aparecen en la pantalla estable; sus workers no se arrancan desde
ese perfil. La API de historias rechaza nuevas ejecuciones en el perfil estable.
Los trabajos anteriores se conservan. Las selecciones `MEDIA_CLIPS` nuevas de
la versión estable usan heurísticas locales, incluso si la configuración general
de IA tiene otro proveedor. Un HTTP 429 no bloquea el recorte manual.

Para mostrar funciones experimentales se requieren ambos ajustes en **otro
despliegue**: `CLIPFORGE_RELEASE_CHANNEL=development` y
`CLIPFORGE_EXPERIMENTAL_FEATURES=true`. Eso no activa por sí solo la captura
permanente ni la publicación. Los tres controles de publicación permanecen OFF.

`render.stable-preview.yaml` prepara un ensayo separado, plan gratuito,
autenticación obligatoria y despliegue automático desactivado. Es una plantilla;
no creó un servicio. Se debe desplegar manualmente un commit revisado. Para
retroceder, seleccionar el commit/etiqueta anterior en el hosting; no mover la
etiqueta, revertir datos ni hacer force-push. Los cambios de desarrollo siguientes
no actualizan por sí solos esa versión.

## Prueba real ejecutada

`scripts/stable-android-e2e.mjs` exige un archivo existente autorizado y no tiene
fallback sintético. Se usó el original preservado del VOD de Westcol
`01a17413-f760-7067-aa90-2e6d458a1aa6`, proyecto fuente
`f20b4bb5-5f21-488e-9c74-391af17b6004`, SHA-256
`a53c477728d61778ceda6b7b33a7c86b6ab479333d6d9abc09e4e96e7dd08783`.
El clip demuestra el recorte manual sobre material autorizado; no se atribuye
a un detector viral, a chat nuevo ni a una captura LIVE nueva.

- Proyecto subido por la interfaz: `d4f37a11-072d-4274-9665-33be9a8bb409`.
- Clip: `60a85455-94fc-44f6-b2b2-7b7bad6a4bcb`; intervalo 50–80 s del original preservado.
- Resultado: **30 s, 1080×1920, H.264/AAC, yuv420p**, decodificación completa correcta, audio medio −16,8 dB / pico −0,6 dB, sin intervalos negros completos detectados. FIT conserva toda la imagen con márgenes.
- SHA-256: `e42218c895e8dc54fb3f6c04b26a4481f1ee6dc714f0e893dc786e109852ddd6`.
- Biblioteca R2 privada: `72a09caf38280395a00c50451ae8e0723963c0a7dd8e72cc7a546ba7120c3689`; conservado, revisión pendiente, selección manual.
- La copia descargada de R2 correlacionó 0,999864 con el audio del recorte original. No se creó narración artificial.
- Se cerró la pestaña tras encolar el trabajo. El worker terminó; al regresar al historial se pudo reproducir y descargar el MP4.
- Chromium con tacto y viewport 393×851; APIs reales, sin mocks ni desbordamiento horizontal. **Android físico pendiente**.
- Se deshabilitaron Whisper y las claves de IA en el proceso de prueba manual: no hubo transcripción ni llamadas externas a modelos.
- Para la prueba posterior de candidatos se reutilizó la transcripción real Whisper.cpp del archivo idéntico, tras comprobar su SHA. Se midieron de nuevo audio/escenas. No se fingió una nueva transcripción ni evaluación de Z.ai.
- Después de reforzar las escrituras concurrentes se revalidó y reutilizó el MP4 existente sin recodificar: hash, candidatos y demás campos del proyecto conservados.

Evidencia local: `artifacts/stable-android/evidence.json`, `audio-proof.json`,
`manual-mobile.png` y `run-DJUPie/{manual-downloaded,r2-downloaded}.mp4`.
No se guardan credenciales o enlaces firmados en Git. Se añadió regresión para
que transcripción, análisis y nuevos recortes no sobrescriban cambios de los
otros procesos al guardar un proyecto.

Verificación final: `npm run build` incluye lint, TypeScript y suite;
**429 aprobadas, 0 fallidas, 6 pruebas nativas optativas omitidas de 435**.
La aceptación audiovisual anterior es real y separada de esas omisiones.
No se volvieron a generar fixtures de render/reframe como entregables.

## Límites y alojamiento

- Subida actual: **1 GiB** máximo, MP4/MOV/WebM. Durante la transferencia inicial debe mantenerse acceso al archivo en Android; la subida interrumpida puede reanudarse con el mismo archivo.
- Recorte manual: 0,5–180 s dentro del vídeo y del audio disponible. La selección automática es orientativa y requiere revisar transcripción/contexto.
- La prueba local produjo 1080×1920. La plantilla gratuita propone 720×1280 para reducir recursos: ese hosting y archivos largos todavía necesitan una medición real; no extrapolar los 4 CPU y 32 GiB del ejecutor a Render gratuito.
- Cerrar el teléfono no cancela un trabajo ya guardado. Continúa **mientras el servidor y sus archivos estén disponibles**. El filesystem gratuito `/tmp` no garantiza supervivencia a reemplazos, suspensión o reinicios de instancia.
- R2 conserva los clips terminados. No ejecuta workers ni convierte automáticamente los proyectos/colas/originales locales en datos persistentes. No se promete continuar después de perder esos datos.
- El ensayo no borró clips ajenos ni respaldos; el worker de almacenamiento se ejecutó con retención desactivada. No se contrataron servicios, compraron modelos ni modificó producción.

Se consultaron desde este ejecutor `https://clipforge-studio-trial.onrender.com`
y `https://clipforge-runtime-free.onrender.com`: las consultas de salud agotaron
40 s cada una; un reintento al primero agotó 50 s sin recibir bytes. Eso no
demuestra que el sitio esté caído para todos, pero impide certificarlo como URL
utilizable o comprobar allí subida/render/descarga. Evidencia:
`artifacts/stable-android/deployed-health.json`.

**Bloqueo para poner esta versión en línea:** no hay conector administrativo ni
credencial de Render/Vercel disponible en esta sesión, ni un puerto público de
preview proporcionado por el entorno. Las credenciales S3 de R2 no administran
el hosting. No se inventa una URL ni se presenta localhost como acceso Android.
Hace falta acceso administrativo al hosting para desplegar el ensayo privado
gratuito preparado y verificarlo externamente. Actualizar el sitio público
requiere además la autorización concreta del propietario. No se puede completar
esa parte solamente con un push de GitHub.

## Desarrollo conservado de Westcol

`c5c5958` añade preferencia por chat medido, margen configurable de reacción
(8 s por defecto, señalado como hipótesis), alternativa audiovisual con límites
de frase y evidencias de audio/escenas, y conservación de buckets al reconectar.
La conexión pública real de chat se abrió durante 15 s, con cero mensajes
recibidos mientras el canal estaba OFFLINE. No son reacciones observadas.
Consulta pública del canal: 13:39 UTC, OFFLINE; vía oficial sin configurar.
Monitor permanente desactivado; aceptación **LIVE_NOT_TESTED**. Z.ai conserva
su último HTTP 429 pendiente de nueva evaluación; no se repitió la llamada.
