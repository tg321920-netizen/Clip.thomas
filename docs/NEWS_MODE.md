# ClipForge News Mode

## Objetivo

News Mode convierte una transcripción existente en un video-resumen vertical narrado sin inventar hechos fuera de la fuente.

Flujo actual:

1. Video subido y procesado por ClipForge.
2. Whisper genera `TranscriptSegment` reales.
3. `NewsSummaryService` selecciona segmentos con mayor densidad informativa.
4. Se crea un `NewsBrief` con categoría, plantilla, titular, resumen, narración, puntos clave y evidencia fuente.
5. `RENDER_NEWS` se encola y un worker separado ejecuta el trabajo pesado.
6. `EspeakNewsTtsProvider` genera narración WAV real en el worker.
7. `NewsRenderService` usa la miniatura real del proyecto como imagen base, crea una plantilla ASS y renderiza MP4 H.264/AAC 1080×1920 con FFmpeg.
8. El resultado se reproduce mediante una ruta HTTP Range dedicada.

## Resumen sin alucinaciones

La V1 usa resumen extractivo: el guion de narración está compuesto por texto que ya aparece en `TranscriptSegment`. Cada `NewsBrief` conserva `sourceEvidence` con `segmentId`, tiempos y texto fuente.

Esto evita afirmar que una IA verificó o inventó datos que no estaban en el material original.

## Categorías y plantillas iniciales

- `BREAKING` → plantilla `BREAKING`
- `TECH` → plantilla `TECH`
- `SPORTS` → plantilla `SPORTS`
- `ECONOMY` → plantilla `ECONOMY`
- `POLITICS` → plantilla `CLEAN`
- `ENTERTAINMENT` → plantilla `CLEAN`
- `GENERAL` → plantilla `CLEAN`

La UI permite forzar una plantilla o dejar la selección automática.

## Audio

La primera implementación usa `espeak-ng` como provider local y comprobable. Es una voz funcional, no una voz comercial de alta calidad.

Variables:

- `ESPEAK_NG_PATH`
- `CLIPFORGE_NEWS_VOICE`
- `CLIPFORGE_NEWS_TTS_SPEED`

La arquitectura permite sustituir este provider más adelante por OpenAI, ElevenLabs u otro TTS autorizado sin cambiar `NewsService` ni la UI.

## Imagen

La V1 reutiliza `poster.jpg` generado por ClipForge a partir del video fuente. No descarga imágenes de terceros ni asume derechos sobre material externo.

En una fase posterior puede añadirse un `NewsAssetProvider` para:

- imágenes propias subidas por el usuario;
- bibliotecas con licencia;
- imágenes generadas;
- B-roll autorizado.

## Render

Salida actual:

- 1080×1920;
- H.264;
- AAC;
- imagen principal sobre fondo desenfocado;
- categoría, titular y resumen en ASS;
- narración sintetizada;
- `faststart` para reproducción web.

Los procesos FFmpeg/TTS corren fuera del request HTTP mediante `news-worker.mjs`.

## Seguridad y límites

- No se ejecutan comandos mediante `shell: true`.
- No se guardan secretos en el proyecto.
- La V1 no verifica hechos contra Internet; resume el material fuente.
- La V1 no descarga automáticamente imágenes o videos de medios de noticias.
- El worker de producción debe tener FFmpeg, FFprobe y un provider TTS instalado/configurado.
