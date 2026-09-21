# ClipForge Multi — plan de ejecución

Regla principal: no simular funciones. Cada fase debe producir resultados reales antes de avanzar.

## Fases

1. **Upload + FFprobe** — subida por streaming, validación, metadatos reales y persistencia local.
2. **Whisper** — extracción de audio y transcripción con timestamps.
3. **Detección de clips** — candidatos de 15–60 s y ViralScore explicable.
4. **Preview + timeline** — reproducción, trim y seek.
5. **Mini editor** — cortes, split, delete, undo/redo, texto, framing y audio.
6. **Subtítulos** — edición y estilos CLEAN/VIRAL/KARAOKE.
7. **Auto Edit** — vertical, silencios, captions, audio y hook.
8. **Render 9:16** — salida 1080×1920 con FFmpeg.
9. **Perfiles de plataforma** — TikTok, Shorts y Reels.
10. **Multi-export** — exportaciones reales por plataforma.
11. **Batch**.
12. **Auto-reframe**.
13. **Layouts de podcast**.
14. **Traducción + TTS**.
15. **Streams + chat**.

## Criterio para avanzar

Después de cada fase: lint, typecheck, pruebas disponibles, build y prueba funcional real. Si algo falla, se corrige antes de continuar.
