# Revisión funcional y reparaciones — 25 de octubre de 2026

Aplicación de la raíz, rama operativa `codex/clipforge-core-rescue`. Punto de partida local: `145c72bd9b548bb6d344f79fe81d0998a4d3fbec`. Se conservaron los vídeos anteriores, las integraciones y las protecciones de publicación. No se activaron publicaciones, modelos de pago, planes nuevos ni despliegues.

## Qué funciona y qué falta

| Área | Comprobación actual | Límite |
| --- | --- | --- |
| Historias originales en español | Flujo real con guion corregido, grabación, fotografías CC0, Whisper, subtítulos y MP4 vertical. La prueba nueva produjo 32 s, 1080 × 1920, H.264/AAC, decodificación completa y cero intervalos negros detectados. | Biblioteca de naturaleza por etiquetas, no visión general. Calidad editorial y escucha humana pendientes. |
| Grabación aportada | Subida desde Chromium móvil de WAV real >4 MB, lectura y procesamiento; hash del original conservado. | El audio de prueba se generó con Kokoro local: no es una voz humana ni una API de pago. |
| Transcripción española | Whisper base real en el flujo. También se evaluó el tiny incluido en el perfil Docker sobre la grabación autorizada: cobertura de coincidencias 93,51 %, distancia normalizada de palabras 7,79 %. | Una sola muestra no mide calidad general. Se observan errores como «bos» o «oja»; los subtítulos finales conservan el guion corregido. Los tiempos pueden incluir interpolación. |
| Importación y edición de vídeo | `phase1:e2e`, render, reencuadre y autoedición aprobados con archivos multimedia reales de prueba. | Los patrones de regresión no son demostraciones de contenido comercial. No se repitió una aceptación independiente de MOV y WebM ni de todos los códecs. |
| Selección de clips y agente | `agent:e2e` verifica decisiones, reanudación y renders con proveedor HTTP local explícito. | Las respuestas del modelo son fixtures; no se atribuye calidad editorial a una IA externa real. |
| Cancelación y recuperación | Botón móvil durante render; proceso nativo detenido; reanudación del mismo trabajo; reinicio SIGTERM del worker; resultado recuperado reutilizando una escena y la voz verificadas. | Se comprobó reinicio ordenado y pruebas de recuperación de leases; no recuperación durable de archivos tras perder una instancia efímera. |
| Historial | Un registro dañado se aísla y se muestra un aviso; los trabajos sanos siguen visibles y se procesan. | El contenido perdido de un JSON no se inventa. Recuperarlo requiere una copia o los recursos originales. |
| R2 privado | Descarga completa de un clip existente de 19.341.398 bytes, hash idéntico al original. Esta prueba no escribió ni borró objetos. | R2 conserva MP4 finales y registros de biblioteca, no toda la cola ni los proyectos editables. |
| Pantalla móvil | Chromium táctil de 393 × 851: crear, cancelar, reanudar, reproducir y descargar, sin desbordamiento ni errores JavaScript. | Android físico pendiente. |
| Publicación y OAuth | Publicación mantenida OFF; regresiones de aprobación y proveedores mock pasan. | No se publicó contenido ni se renovaron/validaron todas las cuentas OAuth reales. |
| Directos Kick/Twitch/YouTube | Se conservaron servicios y adaptadores. | No se capturó un directo externo en esta revisión ni se verificaron aquí permisos/tokens de las tres plataformas. |

## Fallos reproducidos y reparados

1. **Un trabajo dañado bloqueaba todo el historial y el worker.** `listMedia` y la recuperación propagaban errores de JSON de un registro al conjunto. Se reprodujo con un archivo truncado en almacenamiento aislado. Ahora se leen con concurrencia acotada, se conservan los archivos afectados, se devuelve un aviso y se continúa con los sanos. La consulta individual informa `JOB_METADATA_INVALID`/HTTP 409.
2. **Una cancelación podía convertirse después en FAILED.** Un error tardío del encoder sobrescribía CANCELLED. La regresión reprodujo exactamente `FAILED !== CANCELLED`. Ahora la cancelación tiene un marcador atómico ligado al intento; ni progreso, fallo ni finalización tardíos la convierten en éxito/error.
3. **No se podía cancelar un render activo.** API y UI solo admitían cancelar antes del procesamiento. Ahora aceptan PROCESSING/VALIDATING, detienen FFmpeg/Whisper/TTS y solicitudes HTTP del proveedor dentro del contexto del worker, y muestran «Deteniendo» hasta liberar el proceso. Se escala a SIGKILL si el proceso ignora SIGTERM. No se añaden permisos de shell al agente.
4. **Reintentos simultáneos competían por el mismo trabajo.** Cinco peticiones concurrentes producían cinco identificadores de intento. Se serializan reanudación/cancelación/claim por trabajo y se comprueba la generación del intento. La regresión exige un único intento y que un worker obsoleto no libere ni sobrescriba el nuevo lease.
5. **La parada del worker no detenía el proceso audiovisual activo.** SIGTERM/SIGINT ahora abortan el trabajo local y lo devuelven a cola con sus entradas y cachés verificadas. El reinicio nativo completo se probó, además de las pruebas de recuperación de proceso muerto.
6. **El contexto Docker podía incluir medios de aceptación.** Había aproximadamente 1,3 GB en `artifacts/` y no estaba excluido de `.dockerignore`. Se excluyeron artefactos, cobertura, bundles y cachés Python. No se borró contenido del propietario ni se afirmó haber recompilado los contenedores de producción.
7. **Los verificadores volcaban imágenes completas en los logs.** Los fotogramas base64 quedan desactivados por defecto; la evidencia visual sigue en archivos y puede habilitarse expresamente para diagnóstico con `CLIPFORGE_PRINT_REVIEW_FRAMES=true`.

Se reutilizaron `JobStore`, workers, proveedores y rutas existentes. `lib/media-execution.mjs` aporta el contexto de cancelación que faltaba entre las distintas capas nativas/HTTP; sin él los servicios existentes no podían detener juntos sus subprocesos. No se reemplazó ClipForge ni se creó una segunda aplicación.

## Evidencia y reproducción

Comandos ejecutados con publicación apagada y Redis de producción aislado:

```bash
source /workspace/clipforge-tools/activate.sh
CLIPFORGE_RUN_MEDIA_TESTS=true CLIPFORGE_REDIS_URL= REDIS_URL= npm run build
npm run render:e2e
npm run reframe:e2e
npm run autoedit:e2e
npm run agent:e2e
npm run phase1:e2e
npm run news:e2e
npm run owned-content:e2e
node scripts/media-control-e2e.mjs --r2
```

Resultado local: **361 pruebas aprobadas**, cero fallos y cero omisiones con el flag audiovisual, lint, TypeScript y build aprobados. Las siete regresiones e2e existentes pasan. Las pruebas de cancelación mataron un hijo que ignoraba SIGTERM, un FFmpeg codificando realmente y una petición HTTP local; esta última no consume una API externa.

La aceptación móvil nueva usa datos aislados en `artifacts/media-control/run-lu8WFz/`. Recibos: `evidence.json`, logs de los tres workers, captura `mobile-review.png`, fotogramas de subtítulos y `reflexion-recuperada.mp4`. El aviso de metadatos dañados de esa captura corresponde a un **fixture creado en la prueba**, no a una afirmación de pérdida de trabajos reales del propietario.

Secuencia verificada: crear desde el formulario → esperar un encoder activo → cancelar desde el botón → comprobar que terminó → reanudar desde el botón → reiniciar el segundo worker con SIGTERM → procesar de nuevo → READY → reproducir y descargar. El resultado reutilizó una escena y la narración, mantuvo el texto completo y la pista AAC, y se verificó su hash de descarga. Se comprobó Range HTTP 206. La prueba R2 fue lectura íntegra y comparación de hash de un MP4 privado existente.

Se corrigieron dos fallos del propio verificador antes de la ejecución aprobada: descubrimiento del PID nativo mediante `/proc`, sustituido por IDs observados directamente al arrancar los subprocesos; y una lectura R2 que heredaba el aislamiento LOCAL de la prueba, sustituida por el cliente explícito con la configuración privada capturada antes del aislamiento. Esos fallos no se presentaron como errores de permisos de R2 ni como éxitos anteriores.

## Web pública y CI

Se consultó `/api/health` de `https://clipforge-studio-trial.onrender.com` sin modificarlo. El primer intento agotó 20 s; el segundo respondió HTTP 200: `status=ok`, `publishing=OFF`, `mediaReady=true`, FFmpeg/FFprobe y almacenamiento escribible. La versión declarada fue **`e1045dfae859e773ac65f4b12b1ef1ed10e20a3a`**, anterior a las reparaciones locales.

La rama remota `main` sigue en **`f3d8ca33fd57452d475898fdf3adac4be210087c`**. Las ejecuciones públicas recientes [ClipForge CI 36774056356](https://github.com/tg321920-netizen/Clip.thomas/actions/runs/36774056356) y [Render Runtime 36774056340](https://github.com/tg321920-netizen/Clip.thomas/actions/runs/36774056340) declaraban `success`. No hay evidencia aquí para afirmar que la CI actual de main esté fallando. El sitio desplegado y la rama revisada no son la misma versión.

`render.yaml` apunta a `main`, plan gratuito y `Dockerfile.free`. Ese perfil instala Whisper tiny y eSpeak; no incluye automáticamente la instalación local Kokoro verificada en este entorno. Un despliegue no debe anunciar voz neuronal configurada ni capacidad de 1080p continuo en 512 MB sin comprobarlas en ese runtime. No se cambió el servicio, su plan, las variables de producción ni la rama desplegada.

## Uso del control reparado

En esta versión, **Mis videos → Cancelar** funciona también mientras se procesa. Esperar a que deje de indicar «Deteniendo» y pulsar **Reanudar**. Los fallos de recurso mantienen **Reintentar**; si el mensaje pide corregir guion o grabación, ajustar la solicitud antes de crear otro vídeo. La biblioteca R2 permite recuperar los MP4 finales conservados, aunque no estén los archivos locales originales.

La web pública todavía necesita recibir una actualización autorizada. Siguen pendientes Android físico, revisión editorial humana, persistencia completa y comprobación de capacidad del runtime gratuito. No se declara que toda la plataforma esté al 100 %.
