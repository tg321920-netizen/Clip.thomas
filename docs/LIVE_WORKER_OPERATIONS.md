# Operación de captura y respaldo en un único servidor

Configuración preparada para revisión. No se instaló, activó ni desplegó infraestructura. El monitor real y la publicación continúan apagados. Vercel por sí solo y Render gratuito con `/tmp/clipforge` no proporcionan esta infraestructura permanente.

## Requisitos reales

- Node 22+, FFmpeg/FFprobe, yt-dlp y Whisper.cpp con modelo local verificado.
- Un proceso permanente por worker y un volumen **realmente persistente y compartido en el mismo host** para `CLIPFORGE_STORAGE_DIR`.
- Servidor web ClipForge con autenticación del propietario. Si Vercel sirve la interfaz, sus llamadas deben llegar a ese backend; no crear una segunda cola local en funciones efímeras.
- Credenciales privadas de R2 ya configuradas en el servidor. No ponerlas en Description, Git, el navegador o este documento.
- Autorización de captura del canal, permisos de plataforma y revisión humana de resultados.

No hay una instancia gratuita permanente verificada para esta cuenta. Un equipo propio ya disponible puede ejecutar los workers sin contratar alojamiento, pero necesita alimentación, conexión, disco y supervisión. Esta sesión cloud de desarrollo no es un despliegue 24/7. Los 34 GB de RAM de este ejecutor no describen los recursos del Render gratuito. Falta medir CPU/RAM con cuatro horas reales; Whisper pequeño y varios renders simultáneos no están certificados para 512 MB.

## Procesos separados

| Proceso | Comando | Responsabilidad |
| --- | --- | --- |
| Monitor | `npm run worker:live-monitor` | Comprueba únicamente Westcol y encola sesiones; no renderiza ni archiva. |
| Captura | `npm run worker:live-capture` | Un FFmpeg por sesión; originales TS cerrados, reloj UTC y chat agregado. |
| Ingesta | `npm run worker:ingest` | Materializa ventanas acotadas de contexto y drena la cola aun sin R2. |
| Medios | `npm run worker:media` | Whisper, selección local explícita y render de clips. |
| Recortes manuales | `npm run worker:render` | Reutiliza `RENDER_CLIP`; conserva la primera versión. |
| Archivo | `npm run worker:live-archive` | Respalda originales, clips y checkpoints; nunca borra originales. |

Todos deben ver el mismo directorio. Las exclusiones locales incluyen PID, arranque y proceso; no son locks distribuidos entre máquinas. Redis/OAuth existentes permanecen intactos, pero no convierten automáticamente esta cola de archivos en una cola distribuida.

Los ajustes seguros por defecto son:

```dotenv
CLIPFORGE_LIVE_MONITOR_ENABLED=false
CLIPFORGE_LIVE_CAPTURE_ENABLED=false
CLIPFORGE_LIVE_RIGHTS_CONFIRMED=false
CLIPFORGE_STORAGE_PERSISTENT=false
CLIPFORGE_AGENT_ENABLED=false
CLIPFORGE_AGENT_REAL_PUBLISHING=false
CLIPFORGE_CONTENT_REAL_PUBLISHING=false
CLIPFORGE_SMART_PUBLISH_ON_BOOT=false
CLIPFORGE_ANALYSIS_PROVIDER=heuristic
```

No cambiar los cuatro primeros a `true` hasta comprobar infraestructura y autorización. El monitor programa análisis local, no llamadas periódicas a un modelo de pago. La evaluación puntual del modelo gratuito queda separada del monitor. Los conectores sociales no se activan.

`deploy/systemd/clipforge-worker@.service` es una plantilla sin instalar. Requiere adaptar usuario, rutas, montaje y archivo privado `/etc/clipforge/worker.env`; Node y las herramientas deben existir previamente. Las instancias previstas son `live-monitor`, `live-capture`, `ingest`, `media`, `render` y `live-archive`. No copiar ni habilitar servicios en producción durante esta misión.

## Límites y pérdidas

- Sesiones de hasta seis horas; segmentos originales de 60 segundos por defecto. El ensamblado usa como máximo tres segmentos contiguos para contexto.
- Cola de materialización/selección/render acotada a seis trabajos en cola/procesando por sesión. Las incidencias WAITING_RESOURCE/FAILED se conservan aparte; este contador no es un límite global entre varias sesiones. Una cola llena difiere análisis; el capturador continúa únicamente mientras exista disco.
- Límite local actual de 2 GiB de medios y al menos 1 GiB libre. El directorio incluye originales, ventanas materializadas y renders: no equivale a 2 GiB adicionales por worker.
- Archivo R2 con límite conservador de 8 GB del bucket; hasta tres intentos de archivar cada original, con espera. No contratar espacio ni borrar originales para seguir.
- Los checkpoints tienen límites de cantidad/tamaño. Consultar su fecha y cantidad de originales confirmados: no implican que todo lo más reciente ya esté respaldado.
- Una interrupción que supera la ventana disponible del HLS produce un intervalo perdido, registrado con sus tiempos. No inventar continuidad ni recortar conversaciones cruzando ese hueco.
- Una sesión acotada terminada no demuestra ausencia de huecos durante relevos de seis horas ni operación 24/7. Falta esa prueba prolongada real.

La copia TS original se conserva incluso si su extracción final resulta inválida; el archivo se aparta para diagnóstico. SHA-256 y decodificación completa determinan qué datos pueden reutilizarse. El chat contiene contadores por ventanas, no historiales de participantes. El reloj conserva incertidumbre y retraso de reacción desconocido.

## Recuperación privada

Detener los workers antes de restaurar. Elegir un directorio nuevo; una colisión con datos diferentes se rechaza y no se sobrescribe:

```bash
npm run live:restore -- --session=ID_DE_SESION --target=/srv/clipforge/restaurado --workers-paused
```

El comando descarga únicamente las rutas permitidas por el manifiesto privado y verifica tamaño/SHA-256; los MP4 se decodifican. No restaura leases ni arranca procesos. El monitor restaurado queda pausado. Los originales que nunca llegaron a R2 aparecen como ausentes; no se declaran recuperados. Las ventanas completadas se reconstruyen desde sus TS cuando corresponda, reutilizando el resultado existente del editor para evitar otro render.

El panel móvil permite pausar monitor/captura y reintentar trabajos fallidos. La pausa del propietario es durable: no se quita al reiniciar un worker. Reanudar el monitor requiere revisión del checkpoint local con los workers detenidos y retirar explícitamente `pausedByOwner`; no eliminar el checkpoint ni sus índices para reanudar.

## Pruebas reproducibles

Las pruebas nativas requieren autorización audiovisual. La prueba integral hace escrituras reales en el R2 configurado y exige además su opt-in separado:

```bash
npm ci
npm run verify
npm run build
npm run render:e2e
npm run reframe:e2e
CLIPFORGE_RUN_MEDIA_TESTS=true npm run live:continuity:e2e
CLIPFORGE_RUN_MEDIA_TESTS=true CLIPFORGE_RUN_R2_TESTS=true npm run live:pipeline:e2e
npm run mobile:stability:e2e
```

La continuidad usa un HLS propio que avanza en tiempo real durante unos 100 segundos, un HTTP 503 y una interrupción mayor que su ventana. La integración utiliza narración sintética propia, chat simulado, Whisper real, selección heurística y R2 real. Es material técnico, no una selección de Westcol ni un vídeo comercial. La prueba móvil adicional espera los originales reales descritos en el informe; usa Chromium de 393×851, no Android físico.
