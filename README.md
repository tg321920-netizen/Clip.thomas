# ClipForge Multi

Aplicación para convertir videos largos en clips verticales reales para TikTok, YouTube Shorts y Facebook Reels.

La aplicación Next.js vive **directamente en la raíz del repositorio** para que GitHub y Vercel construyan exactamente el mismo código.

## Principio del proyecto

No se aceptan funciones simuladas. Upload, análisis, metadatos, transcripción, clips, progreso, edición y exportación deben estar respaldados por procesamiento real.

## Estado

**Fase 1 en cierre:**

- subida de video por streaming;
- validación MP4/MOV/WebM en cliente y servidor;
- FFprobe real;
- FFmpeg real para miniatura;
- reproducción del archivo fuente con HTTP Range;
- almacenamiento configurable;
- historial local de proyectos;
- comprobación de FFmpeg, FFprobe y storage;
- tests de políticas de upload, rangos HTTP y protección contra path traversal;
- prueba funcional de extremo a extremo preparada con un video generado realmente por FFmpeg.

## Ejecutar

```bash
npm ci
npm run dev
```

## Validar

```bash
npm run verify
npm run build
npm run phase1:e2e
```

`npm run phase1:e2e` genera un video real de prueba, levanta la aplicación, lo sube, valida metadatos de FFprobe, miniatura de FFmpeg, reproducción por HTTP Range y persistencia del proyecto. GitHub Actions usa exactamente este mismo script para evitar pruebas duplicadas o simuladas.

El script `build` también ejecuta lint, typecheck y tests antes de compilar Next.js.

Consulta `PROJECT_PLAN.md` para las fases y `AGENTS.md` para las reglas que deben seguir los agentes de programación.
