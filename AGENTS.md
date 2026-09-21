# ClipForge Multi — instrucciones para agentes

Estas reglas aplican a todo el repositorio.

## Objetivo

Construir ClipForge Multi como una herramienta real para:

UPLOAD VIDEO → ANALYZE → FIND INTERESTING MOMENTS → GENERATE CLIPS → EDIT → SUBTITLES → ADAPT TO 9:16 → CHOOSE PLATFORMS → EXPORT.

## Regla principal

Nunca implementar funcionalidad falsa.

No crear:
- progreso simulado;
- metadatos inventados;
- transcripciones inventadas;
- ViralScore sin señales reales;
- clips de demostración presentados como resultados;
- exportaciones falsas;
- botones que aparenten funcionar sin backend real.

Si una dependencia no está disponible, mostrar el estado real y fallar de forma explícita.

## Stack

- Next.js + TypeScript + Tailwind
- FFmpeg + FFprobe
- Whisper o faster-whisper para transcripción real
- worker separado para procesamiento pesado
- persistencia simple/local primero; infraestructura adicional solo cuando sea necesaria

## Orden obligatorio de trabajo

1. Upload + FFprobe + FFmpeg
2. Whisper + transcripción real
3. Análisis + candidatos + ViralScore
4. Preview + timeline + trim
5. Mini editor no destructivo
6. Subtítulos
7. Auto Edit
8. Render 9:16
9. Perfiles TikTok/Shorts/Reels
10. Multi-export
11. Batch
12. Auto-reframe
13. Podcast layouts
14. Traducción + TTS
15. Streams/chat

No saltar fases para aparentar progreso.

## Validación

Antes de avanzar de fase:
- lint;
- typecheck;
- tests;
- build;
- prueba funcional real del flujo implementado.

Si algo falla, corregirlo antes de avanzar.

## Seguridad

- validar extensión, MIME, tamaño, nombres, rutas y parámetros;
- no concatenar entrada de usuario en comandos shell;
- usar argumentos separados con spawn/execFile;
- prevenir path traversal;
- no guardar secretos en Git;
- documentar claves solo en .env.example;
- no borrar originales sin confirmación explícita.

## Arquitectura

Mantener lógica pesada fuera de React. Preferir:
- components/
- editor/
- services/
- workers/
- lib/
- types/
- utils/
- app/api/

Servicios previstos:
- VideoProcessor
- TranscriptionService
- AudioAnalyzer
- ClipDetector
- ViralScoreService
- SubtitleService
- EditorService
- RenderService
- ExportService

## Cambios

Antes de modificar:
1. inspeccionar el repositorio y el código existente;
2. reutilizar lo que ya funciona;
3. evitar refactors gigantes sin necesidad;
4. no inventar credenciales;
5. mantener commits pequeños y descriptivos.

El objetivo inicial es conseguir que un video real entre al sistema y termine en un clip real editable y exportable; después se amplía.
