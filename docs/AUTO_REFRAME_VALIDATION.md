# Auto Focus / Auto Reframe validation

Esta fase valida una primera versión real y no simulada de Auto Focus para clips.

## Alcance V1

- Detecta tramos hablados usando `TranscriptSegment` ya generado por Whisper.
- Genera ventanas relativas al clip y fusiona pausas cortas para evitar zoom nervioso.
- Aplica zoom progresivo mediante FFmpeg `zoompan` durante los tramos hablados.
- Mantiene salida 1080×1920.
- No sobrescribe el video fuente.
- Cada cambio invalida el render previo y encola un nuevo `RENDER_CLIP`.
- La UI permite activar/desactivar y escoger intensidad de zoom.

## Límite explícito

La V1 no identifica todavía cuál rostro está hablando cuando hay varias personas. `speakerAware=false` queda persistido de forma explícita para evitar presentar esa capacidad como terminada.

El siguiente nivel requerirá un `ActiveSpeakerDetector` visual que produzca posiciones de rostro/sujeto verificadas antes de mover el encuadre entre personas.

## Validación automática

`npm run reframe:e2e` genera un video real, aplica Auto Focus, renderiza con FFmpeg, verifica 1080×1920, duración, progreso, metadata `autoReframeApplied=true` y confirma por hash que el original no cambió.
