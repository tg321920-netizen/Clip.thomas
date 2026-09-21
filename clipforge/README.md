# ClipForge Multi

Aplicación para convertir videos largos en clips verticales para TikTok, YouTube Shorts y Facebook Reels.

## Estado actual

**Fase 1 en implementación:** subida real por streaming + análisis real con FFprobe.

La interfaz no inventa metadatos ni simula análisis. El porcentaje mostrado durante la subida proviene de los bytes enviados por el navegador.

## Requisitos locales

- Node.js compatible con Next.js 16
- npm
- FFmpeg/FFprobe instalado y disponible como `ffprobe`

Si FFprobe está en otra ruta, define `FFPROBE_PATH` en el entorno antes de iniciar la aplicación.

## Ejecutar

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Comprobaciones

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Flujo de Fase 1

1. El navegador envía el archivo directamente en el cuerpo HTTP.
2. El servidor escribe los bytes a disco progresivamente; no usa `request.formData()`, por lo que no necesita cargar el video completo en memoria.
3. Se validan extensión, MIME, tamaño declarado y tamaño realmente recibido.
4. El archivo se guarda con un UUID y una extensión permitida; el nombre original nunca se usa para construir la ruta.
5. FFprobe se ejecuta con `spawn` y argumentos separados, sin concatenar entrada del usuario a un shell.
6. Se leen duración, resolución, FPS, códec, contenedor y relación de aspecto reales.
7. Se persiste un registro JSON local del proyecto en `storage/projects`.

Los videos quedan en `storage/uploads/{projectId}`. `storage/` está ignorado por Git.

## Arquitectura

- `app/`: interfaz y rutas API
- `components/`: componentes de UI
- `services/VideoProcessor.ts`: FFprobe
- `services/ProjectStore.ts`: persistencia local de proyectos
- `lib/upload-policy.mjs`: reglas de seguridad de subida
- `types/`: tipos compartidos

## Nota sobre despliegue

Esta fase está diseñada primero para un entorno con disco y FFprobe disponible. Vercel puede alojar la interfaz y APIs ligeras, pero el procesamiento pesado de video se moverá a un worker independiente antes de producción.

## Siguientes fases

Después de comprobar un video real de extremo a extremo: Whisper, detección de momentos, ViralScore, editor no destructivo, subtítulos, 9:16 y exportaciones por plataforma.
