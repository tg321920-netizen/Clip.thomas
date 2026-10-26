# Reanudar: recuperación, render económico y Android

26 de octubre de 2026, UTC. Avance de código completado sin acceso administrativo
a Render, sin despliegues y sin modificar la candidata anterior.

## Punto de reanudación verificable

- Integración remota: work/clipforge-functional-review-20261025-5d025fe.
- Checkout local: codex/clipforge-core-rescue, según AGENTS.md.
- Base preservada: 774de6e0f94a16517f7a690f7c8b4128f10e152b.
- Código de esta fase: **40cd791ee2ca5f97d1eebb5bbd35a96aa1b0ca46**.
- Candidata anterior: 761e291d72426bac647d513ac7e08ad75dcad9f1;
  etiqueta clipforge-stable-candidate-20261026.1 sin mover.
- Código nuevo identificado como 2026.10.26.2-dev. No está desplegado.

Commits de código, conservados en orden:

1. 3ea20e08f352ec0de177fa2822122a619119127f: respaldo y recuperación R2.
2. 3b22e62163c555c24dbda7f3c656d2ae8ac7eae7: recursos y comprobantes de render.
3. b9ef21f3124e97439371bd74cace0c2b7f82c5bb: duración/contexto de sugerencias locales.
4. 6ba154c204efed58c8bb762411132f166544ae73: controles móviles y ensayo independiente.
5. 6548e60b540ccbf5d33faace4818ff40d6b35007: fuentes compartidas y archivo sin duplicación.
6. 40cd791ee2ca5f97d1eebb5bbd35a96aa1b0ca46: perfil limitado y protecciones de recuperación.

## Qué quedó comprobado

- R2 real: original, proyecto, intervalos, trabajos pausados y MP4 recuperados en
  una raíz vacía. SHA-256 coincidentes para el proyecto manual y el derivado real.
  No se volvieron a subir los originales o MP4 ya archivados.
- Se conservan fuentes compartidas por proyectos de clips y fuentes auto-videos.
  Los resultados elegibles pasan por la biblioteca existente antes del checkpoint:
  no se crean dos objetos cuando llegan el backup y el storage worker.
- Faltantes, corrupción, conflictos, rutas peligrosas y cupo lleno fallan de forma
  explícita sin sobrescribir datos ni borrar originales. Se protege la retención
  de resultados referenciados. Tokens/claves y queries firmadas se excluyen; el
  identificador público de un vídeo YouTube se conserva.
- Un fallo después del MP4 validado recupera final o parcial completo por hash
  y ajustes. Los parciales incompletos se reintentan; no se finge reanudar cualquier
  fotograma. Leases muertos se recuperan sin robar encoders vivos.
- Un codificador por defecto, backpressure sin consumir intentos y perfil
  EFFICIENT veryfast/CRF23, manteniendo 720p/1080p y horizontal/vertical.
- Prueba móvil local con APIs reales y R2: restaurar proyecto, recortar horizontal
  1280×720, matar worker/FFmpeg con SIGKILL, cerrar página, reiniciar worker,
  reproducir y descargar el resultado del segundo intento con hash coincidente.
- Una prueba separada de estado fallido local mostró correctamente la advertencia
  de copia no confirmada y worker detenido. No fue un fallo real de R2.
- Se reprodujo y corrigió el fallback de 301 s que ignoraba un máximo de 45 s.
  Se fortalecieron contexto de pregunta/intervención, silencios y deduplicación.
  Cinco sugerencias reales de 25–34,48 s, usando ASR ya conservado y mediciones
  audiovisuales reales. No se ejecutó diarización nueva ni se exigió chat.

## Rendimiento

Con cuatro CPU locales, 8 s de material real: EFFICIENT pasó de 8,23 a 4,74 s
en 1080p y de 5,01 a 3,50 s en 720p. No es rendimiento medido en Render.

Prueba NUEVA con límites reales de cgroup: Node 22.23.4, 0,1 CPU, 512 MiB,
web + ingesta + workers seriales + medidor, un hilo, EFFICIENT, 720×1280.
Un recorte real de 30 s llegó de encolado a READY en **304,908 s**; pico
**274,406 MiB**, sin OOM, exit 0, H.264/AAC y decodificación completa.
El conjunto arrancó y terminó en 354,397 s. El worker R2 no estuvo incluido.
Esto permite un recorte aislado lento; no acredita 1080p en 512 MiB, análisis
de cuatro horas en tiempo real, suspensión de Render ni servicio permanente.

## Verificación

- Antes de cambios: verify, 429 aprobadas y 6 opcionales omitidas.
- Build final: lint + TypeScript + **451 aprobadas, 0 fallidas, 6 opcionales
  omitidas de 457**, seguido de compilación Next 16.3.8 correcta.
- render:e2e y reframe:e2e aprobados como QA técnico, separados de los vídeos
  auténticos y sin contarlos como entregas del streamer.
- Chromium 393×851 con tacto: sin mocks de API; Android físico pendiente.
- Sin nuevas llamadas a Z.ai/modelos pagos. El 429 anterior no se reevaluó.
- Sin consultas repetidas a Render ni cambios de producción/publicación.
- CI del código confirmada en f25e138eb279ad6180125fadb30a55c21e8eed1c:
  [ClipForge CI aprobada](https://github.com/tg321920-netizen/Clip.thomas/actions/runs/40393982710).
  Un commit posterior solo enlaza este checkpoint desde AGENTS y el handoff;
  no cambia el código probado ni requiere repetir pruebas audiovisuales.

Evidencias preservadas:

- artifacts/project-recovery/{real-20261026,derived-real-20261026}/evidence.json.
- artifacts/project-recovery/root-archive-proof.json.
- artifacts/recovery-mobile/evidence.json, backup-error-ui.json y sus capturas.
- artifacts/render-profiles/real-20261026-b/evidence.json.
- artifacts/podcast-context/current/{evidence,measured-av}.json.
- Perfil limitado: /workspace/clipforge-tools/hosting-profile/efficient-512-20261026/
  result.json y container-state.json. El almacenamiento QA anterior se trasladó
  fuera del checkout conservando los archivos; no se cambiaron permisos ni
  borraron respaldos.

## Próximo trabajo, sin repetir pruebas ya aprobadas

Leer AGENTS.md, este checkpoint, PROJECT_RECOVERY.md, PRIVATE_DEVELOPMENT_TRIAL.md
y los documentos Westcol existentes. Verificar git status y SHA antes de escribir.
No volver a renderizar los eventos antiguos ni las pruebas de rendimiento.

render.development-preview.yaml prepara otro servicio, con Node 22, autenticación,
auto deploy off, un encoder/hilo y respaldo privado. La plantilla estable anterior
no se alteró. Primero hacer GET administrativo cuando exista RENDER_API_KEY;
después presentar la operación de ensayo para aprobación específica. No iniciar
otro diagnóstico sin una conexión cambiada.

El despliegue externo y la prueba desde Android físico siguen pendientes. Hasta
entonces, no dar una URL local como servicio para el propietario.
No se promete recuperar transferencias incompletas, cambios posteriores a la
última copia, cachés de audio o miniaturas. Metadatos: hasta 1,9 MB por checkpoint;
original 1 GiB; restauración 2 GiB; cupo global R2 de la aplicación 8 GB.

Mantener desactivados monitor permanente, captura y publicación. Conservar
StoryMotion, los originales, los checkpoints LIVE, chat, Z.ai y conectores.
No modificar main, mover la etiqueta estable, forzar push ni contratar servicios.
