# CLIPFORGE — ESTADO VERIFICADO

Fecha de comprobación: 2026-10-08. Este documento describe la reparación de Studio y sustituye las afirmaciones de finalización de documentos históricos. No acredita calidad comercial, ventas ni funcionamiento en Android físico.

## Rama, conservación e integración

- Rama destinada a revisión: `codex/clipforge-core-rescue`, cabeza original `8de5c1783b3f3ba06cc47ca3647aaee8c04a2336`.
- Sus 12 commits sobre `main` se conservan; no se reinicia ni se sobrescribe esa historia.
- Producción usa `codex/clipforge-agent-foundation`, cabeza comprobada `6d109f0ace41b3fa6008c82d45b0ae3744c7c51a`. Tiene 93 commits sobre el ancestro común `f3d8ca33fd57452d475898fdf3adac4be210087c` que faltaban en rescate.
- Se integraron en la copia de trabajo sus 105 archivos cambiados. Los conflictos se resolvieron conservando la validación de medios de rescate y las correcciones de CONVERSATION, KV, OAuth y procesamiento de publicaciones de foundation. Las integraciones permanecen disponibles en opciones avanzadas, con publicación OFF.
- El parche local anterior se conservó antes de editar. No se mezclaron ramas de experimentos abandonados ni se modificaron otros repositorios.
- Esta sesión dispone de una instantánea de archivos; no tiene un checkout Git local completo. Los hashes y padres se leen de GitHub. No se simula un commit local ni un PR.

## Cambios funcionales

1. Subida: el cliente principal utiliza `/api/videos/uploads`, fragmentos de 2 MiB, SHA-256, recuperación e idempotencia. El endpoint monolítico rechaza archivos declarados mayores de 2 MiB. No se eleva el buffer de Proxy a 1 GB.
2. Recuperación: se verifica cada fragmento retenido, incluida la parte central del archivo; hay cache en memoria si Android bloquea `localStorage`. ASSEMBLED se persiste antes de encolar. Un fallo en esa entrega no reemplaza el original. La limpieza no borra originales ni checkpoints encolados.
3. Interfaz: CLIPFORGE STUDIO muestra Pegar URL, Subir y editar video, Crear mejores clips y Crear historia con IA. La importación usa trabajos reales, presenta errores y ofrece la subida autorizada. No se eluden restricciones de yt-dlp.
4. Clips: tres por defecto, 30–60 segundos ajustables, límites de frases y exclusión de solapamientos. La puntuación sigue siendo heurística sobre transcripción y energía del audio, no una predicción de reproducciones. Cada resultado queda pendiente de revisión editorial.
5. Edición: se conserva la detección de silencios, montaje separado del original, transcripción y subtítulos. CONVERSATION preserva el contenido completo sobre fondo desenfocado usando `-filter_complex` y una única salida `[vout]`. No equivale a seguimiento facial automático. H.264/AAC, calidad BALANCED y tiempo máximo de 15 minutos por render de clip.
6. Historias: guion genérico de 6–12 escenas, continuidad mediante manifiesto visual, imágenes distintas, voz, movimiento, transiciones, música propia opcional y subtítulos. Adaptadores configurables de guion e imágenes OpenAI-compatible; ambos OFF por defecto. Autorización exclusivamente server-side, reservas de costo por historia, límites, errores y checkpoints. El proveedor acepta imágenes devueltas en base64; proveedores que solo devuelven una URL necesitan otro adaptador.
7. Honestidad de recursos: las imágenes propias se ofrecen explícitamente como montaje con recursos propios. Sin proveedor autorizado, el producto no anuncia una historia generada íntegramente por IA. No se generó ni se repitió la demostración maya.
8. Publicación: guardas OFF, sin worker de publicación ni smart publish en el arranque de rescate; actualización externa de metadatos también bloqueada. Se conserva su código para uso futuro autorizado.
9. CI: verificación de código y build, sin generación audiovisual automática. Los workflows de runtime y transcripción se conservan para ejecución manual con confirmación explícita de autorización.

## Evidencia y límites

Los logs se conservan en `artifacts/studio-verification/` del paquete local. No se necesita ejecutar comandos desde el teléfono.

| Comprobación | Resultado observado |
|---|---|
| Suite completa sin renders | FAIL: 74 de 75 archivos pasan; falla `vercel-ignore-build.test.mjs` |
| Causa del fallo restante | El subproceso Node no entrega stdout en esta ejecución restringida. Las cuatro mismas invocaciones del CLI, ejecutadas desde Python, pasan sus códigos y mensajes. El test original se conserva; esto no convierte la suite en PASS |
| Regresiones enfocadas | PASS: 51 casos de cliente, handlers, reanudación, integridad, proveedores, escenas, almacenamiento, filtros y recuperación |
| Sintaxis de módulos Node | PASS en la revisión local; no sustituye TypeScript/build |
| YAML de workflows | PASS: parseo local |
| Lint | FAIL de ejecución: `eslint` no instalado, exit 127 |
| TypeScript | FAIL de ejecución: `tsc` no instalado, exit 127 |
| Build | FAIL de ejecución: la verificación previa se detiene por falta de `eslint`, exit 127 |
| Dependencias | Sin `node_modules`; instalación offline falla por cache vacía. La conexión de red del shell no está disponible. No se alteran los tests para ocultar este bloqueo |
| Transferencia mayor de 10 MB | PASS en código: handlers reales reconstruyen 73.900.000 bytes en 36 fragmentos, con interrupción, reinicio, SHA-256 exacto y un solo trabajo encolado |
| Cliente de subida | PASS en código: más de 10 MB, pausa, reanudación sin localStorage y rechazo de un centro de archivo modificado |
| Validez del MP4 original | NO VERIFICADO con material real: los bytes opacos de integridad son rechazados por FFprobe antes de generar poster/proyecto |
| Importación URL externa | NO VERIFICADO; interfaz y servicios conectados, sin importación externa nueva |
| Edición y extracción de clips reales | NO VERIFICADO; no se autorizó render nuevo |
| Historia con imágenes nuevas de IA | NO VERIFICADO; adaptador probado con mocks, sin proveedor activo ni llamadas pagas |
| Android físico | NO VERIFICADO |
| Render del código reparado | NO VERIFICADO; servicio de producción no modificado |
| Descarga/reproducción MP4 en Android | NO VERIFICADO |
| Producción | NO MODIFICADA |
| Gastos, servicios nuevos y publicaciones | NO ACTIVADOS |

No se puede declarar terminada una aplicación comercial mientras falten build, ensayo desplegado autorizado y pruebas audiovisuales/editoriales reales.

## Almacenamiento

El servicio observado es gratuito y no muestra disco persistente. En Render Free los archivos pueden perderse al reiniciar, desplegar o suspender la instancia. Tener `CLIPFORGE_STORAGE_DIR` configurado no demuestra persistencia. La bandera `CLIPFORGE_STORAGE_PERSISTENT=true` solo debe usarse después de verificar un montaje real; `/tmp` siempre se clasifica como temporal.

`render.studio-trial.yaml` es una propuesta de ensayo aislado, gratuito, con despliegue automático desactivado. No se ha creado ni desplegado ese servicio. El disco de `render.production.yaml` es otra propuesta existente que sigue sin activarse. Para clientes reales se necesitan tanto medios persistentes como estado recuperable de proyectos/trabajos; el KV de credenciales no conserva los MP4.

R2 Standard: USD 0,015/GB-mes; 10 GB-mes gratis, 1 millón de operaciones A y 10 millones B gratis; después USD 4,50/millón A y USD 0,36/millón B; egreso gratuito. Ejemplo orientativo: 20 GB-mes, tras 10 gratis, USD 0,15 solo por almacenamiento, sujeto a medición, redondeo, operaciones e impuestos. R2 requiere un adaptador de objetos y migración de referencias de archivos, además de estado durable; no está activado ni se presenta como integrado.

## Proveedores de imágenes: costo observado, no gasto efectuado

Para salida vertical 1024×1536 de calidad media, los precios oficiales consultados el 2026-10-08 son:

| Modelo | Salida por imagen | 6 escenas | 12 escenas |
|---|---:|---:|---:|
| GPT Image 1 Mini | USD 0,015 | USD 0,09 | USD 0,18 |
| GPT Image 1 | USD 0,063 | USD 0,378 | USD 0,756 |

Estos importes no incluyen los tokens de entrada, guion, regeneraciones, voz, CPU, almacenamiento ni revisión humana. La implementación reserva estimaciones conservadoras configuradas por el operador; eso NO impone un tope monetario en la cuenta del proveedor. Un timeout puede haber sido cobrado, por lo que consume reserva y no se reintenta automáticamente. Se debe configurar un presupuesto del proveedor y revisar tarifas antes de autorizar uso real. No se presupone acceso gratuito ni créditos existentes. BFL es una alternativa con contrato distinto que requiere adaptador; no se anuncia como compatible ya implementado.

Fuentes oficiales, consultadas 2026-10-08:

- [Next.js: Proxy buffer de 10 MB](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize).
- [Render Free: filesystem y discos](https://render.com/docs/free).
- [Cloudflare R2: precios](https://developers.cloudflare.com/r2/pricing/).
- [GPT Image 1 Mini: precios](https://developers.openai.com/api/docs/models/gpt-image-1-mini).
- [GPT Image 1: precios](https://developers.openai.com/api/docs/models/gpt-image-1).
- [API de generación de imágenes](https://developers.openai.com/api/docs/guides/image-generation).
- [BFL: opciones y tarifas](https://bfl.ai/pricing).

## Prueba de ensayo preparada, pendiente de autorización

1. Completar lint, TypeScript y build en un entorno con dependencias; conservar el fallo de guard si persiste fuera del sandbox. Revisar el commit/PR concreto antes de cambiar Render.
2. Autorizar un ensayo aislado usando el blueprint preparado. Confirmar claves de propietario existentes y límites; no cambiar `clipforge-runtime-free` ni `storymotion`.
3. Subir desde Android `1000227410.mp4`, aproximadamente 73,9 MB, propio o autorizado. Pausar una vez, reanudar y comparar SHA-256/FFprobe/proyecto único. Esta es la primera aceptación exigida y no genera un video nuevo.
4. Con un original autorizado y una aprobación separada, generar UN lote de tres clips distintos de 30–60 s. Sin material suficiente, detener y pedir ajuste, sin completar con clips repetidos. Límite: un intento inicial por pieza; conservar parciales/logs ante fallo, diagnosticar antes de autorizar otro render. Render de clip: máximo 15 minutos. Medir tiempo y costo reales.
5. Historia: seis imágenes diferentes, idea propia y relato original. Imágenes propias permiten probar montaje sin gasto externo; eso no valida generación IA. La prueba completa de IA exige proveedor, costo máximo y autorización explícitos, seis imágenes nuevas, voz y subtítulos.
6. Probar UNA URL compatible y autorizada; registrar la causa real si la plataforma la bloquea. No cookies obtenidas sin permiso ni elusión de controles.
7. Descargar los MP4 al teléfono y reproducir completos. Registrar resolución, pistas, duración, decodificación y sincronía; realizar además revisión visual y auditiva de ideas completas, encuadre, legibilidad, audio, imágenes y transiciones.

El propietario no tiene que ejecutar Termux ni comandos. Las autorizaciones pendientes corresponden al ensayo, archivos reales y generación audiovisual, no a las reparaciones de código ya realizadas.

## Negocio

Se conservan las hipótesis USD 30/3 clips, USD 75/8 mensuales y USD 105/12 mensuales. No hay pedidos, ingresos ni demanda comprobados. La primera entrega vendible depende de calidad editorial, persistencia fiable, tiempo de supervisión y costo medido; no del número de commits ni de tests.
