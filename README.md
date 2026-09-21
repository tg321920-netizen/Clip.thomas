# ClipForge Multi

Repositorio principal de **ClipForge Multi**, una aplicación para convertir videos largos en clips verticales reales para TikTok, YouTube Shorts y Facebook Reels.

La aplicación está en:

```text
clipforge/
```

## Principio del proyecto

No se aceptan funciones simuladas. Upload, análisis, metadatos, transcripción, clips, progreso, edición y exportación deben estar respaldados por procesamiento real.

## Estado

La Fase 1 está en cierre:

- subida de video por streaming
- validación MP4/MOV/WebM
- FFprobe real
- FFmpeg real para miniatura
- reproducción del archivo fuente con HTTP Range
- persistencia local configurable
- historial de proyectos
- comprobación de FFmpeg, FFprobe y almacenamiento
- pruebas unitarias y flujo de prueba funcional preparado

Consulta `clipforge/README.md` y `clipforge/PROJECT_PLAN.md` para la documentación técnica y las fases.
