# Auditoría de Live Clipping — 24 de octubre de 2026

Se inspeccionaron los proyectos secuencialmente en directorios de herramientas fuera de la aplicación. No se instalaron sus aplicaciones, interfaces, orquestadores ni publicadores. Las implementaciones añadidas a ClipForge son propias, basadas en sus servicios existentes y en primitivas documentadas de FFmpeg.

| Proyecto y URL | Commit examinado | Licencia comprobada | Rutas examinadas | Decisión |
| --- | --- | --- | --- | --- |
| [Streamliner-AI](https://github.com/oeilsimple/Streamliner-AI) | `d6d92b4e9ad707dac09c7c10f8e2411028022033` | `pyproject.toml` y README declaran MIT; **no existe LICENSE** en este checkout | `src/streamliner/{monitor,downloader,worker,detector}.py`, `scripts/` inventariado (token de publicación no integrado), README, pyproject | No copiar código hasta aclarar licencia. Adoptar el principio de consumir segmentos cerrados y separar captura/procesamiento. ClipForge lo implementa en UrlIngestService + JobStore. |
| [LXGIC Clipper](https://github.com/lxgicstudios/lxgic-clipper) | `bd9ec9b372af4a1e475139ca39d151e731828d9a` | LICENSE MIT, LXGIC Studios 2026 | `scripts/{record-stream,detect-highlights,clip-and-format,clipper-agent}.sh` | Sin copiar scripts. Medir RMS y cortes visuales con FFmpeg en los servicios existentes; conservar contexto de transcripción y deduplicación. Rechazar Postiz/OpenClaw como dependencias y no adoptar sus fallbacks que silencian fallos de análisis. |
| [Clipit](https://github.com/kyle-pilon/clipit) | `afdf5dc0c68b9ff3693e38c535518339db86b7f4` | LICENSE MIT, Kyle 2026 | `main.py`, `requirements.txt`, README, QUICKSTART, `src/analyzer/highlight_detector.py` | QUICKSTART y código indican detección de audio/transcripción pendiente (TODO/arrays vacíos). No importar ese detector ni PyTorch/librosa como otra aplicación. Conservar el pipeline propio; añadir checkpoints de render para no repetir los clips terminados. |
| [Clips Kitty / clips-studio](https://github.com/ColinGPT9/clips-studio) | `33fe54b45415e525910038a1571bf362f00db2b0` | Motor AGPL-3.0-or-later. `sdk/python/LICENSE` MIT. `examples/pipelines/{scene-cut-highlights,keyword-rater}/LICENSE` MIT | README, LICENSE, `docs/developers/{sdk,steps}.md`, SDK LICENSE, ejemplos citados, descripción de selección/edición | No copiar ni enlazar el motor, tracking ni app AGPL. SDK y dos ejemplos tienen licencia MIT separada, pero no son necesarios para la arquitectura Node actual y no se incorporan. `transcript-highlights` importa el motor y no está dentro de esa excepción MIT. |

## Integración verificable

- Captura: segmentos MPEG-TS cerrados → MP4 de fuente por segmento → trabajo MEDIA_CLIPS existente. IDs deterministas evitan duplicados al recuperar.
- Señales: AudioEnergyService mide RMS y cambios visuales a baja resolución; TranscriptCandidateProvider mantiene frases completas, ventanas y deduplicación textual. ViralScoreService explica los aportes y enumera señales ausentes.
- Recuperación: duraciones reales de FFprobe, conservación de segmentos, cancelación que no puede ser revertida por un worker atrasado, reutilización de renders validados.
- Ningún código de terceros se ha copiado a estos módulos. No se atribuye reconocimiento de emociones, jugadas, hablantes o chat a una heurística de energía/cortes.

## APIs oficiales revisadas

- Kick: [documentación](https://docs.kick.com), [OpenAPI actual](https://api.kick.com/swagger/doc.yaml), KickEngineering/KickDevDocs `54e18f50b5a2d640ec12ab4b6c745ec05eda35e0`, `apis/channels.md`, `apis/livestreams.md`. GET `/public/v1/channels?slug=` proporciona `stream.is_live`; exige token válido y scopes adecuados. No se utiliza ni expone una clave de emisión de la respuesta.
- Twitch: [referencia](https://dev.twitch.tv/docs/api/reference/), consultada el 24/10/2026. Helix Get Streams acepta `user_login` con app/user token y Client-Id. La referencia actual también documenta **Create Clip From VOD** (`POST /helix/videos/clips`, broadcaster/editor y scopes), además de Create Clip. Esas operaciones crean clips nativos en Twitch: no se invocan durante esta misión y no equivalen a un render MP4 independiente.
- YouTube: [videos.list](https://developers.google.com/youtube/v3/docs/videos/list), consulta `snippet,liveStreamingDetails`. Diferencia LIVE, SCHEDULED, ENDED y VOD. Los metadatos de Data API no conceden derechos de descarga ni proporcionan por sí mismos un MP4.

Los tres adaptadores oficiales tienen pruebas con respuestas simuladas, incluyendo ausencia de credenciales y estados desconectados. **No** constituyen una prueba contra una cuenta real. La obtención del medio se mantiene separada, mediante una fuente accesible y autorizada; no se eluden DRM, sesiones privadas ni rechazos de acceso.
