# ClipForge Multi — plan de ejecución

Regla principal: no simular funciones. Cada fase debe producir resultados reales antes de considerarse terminada.

## MVP de propietario único

Las fases necesarias para trabajar con ClipForge como herramienta propia ya están implementadas y verificadas en código:

1. **Upload + FFprobe** — completado.
2. **Whisper** — completado con worker y E2E real.
3. **Detección de clips** — completado con candidatos configurables y ViralScore explicable.
4. **Preview + flujo de clips** — completado.
5. **Edición no destructiva** — completada para el flujo actual.
6. **Subtítulos** — completados con estilos CLEAN/VIRAL/KARAOKE.
7. **Auto Edit** — completado.
8. **Render 9:16** — completado a 1080×1920 con FFmpeg.
9. **Perfiles/canales** — completados para TikTok, YouTube y Facebook.
10. **Publicación preparada y providers oficiales** — completados a nivel de código; la prueba en vivo requiere OAuth real.
11. **Batch / cantidad de clips** — completado; cambiar la cantidad invalida y repite el análisis cuando corresponde.
12. **Auto-reframe V1** — completado con zoom reactivo a voz.
13. **News Mode / TTS** — completado.
14. **Captura manual de streams/pantalla** — completada cuando el navegador ofrece `getDisplayMedia`.
15. **Autopilot, scheduler, analytics y aprendizaje** — completados para el MVP de propietario único.
16. **Runtime persistente** — Docker y Blueprint Render implementados y verificados por CI.

## Activación externa necesaria

Estas tareas no son código faltante y no se pueden completar con valores inventados:

- provisionar/aprobar el runtime persistente de producción y su disco;
- definir la clave de acceso del propietario para ese runtime;
- crear/aprobar las apps de TikTok, Google/YouTube y Meta;
- registrar redirect URI y secretos OAuth reales;
- conectar las cuentas y realizar una publicación controlada por plataforma.

## Mejoras posteriores al MVP

No bloquean el uso inicial de ClipForge:

- seguimiento visual multi-persona que identifique automáticamente qué rostro habla;
- persistencia compartida y aislamiento multi-tenant para convertirlo en SaaS;
- analytics adicionales de TikTok/Facebook según scopes y revisión disponibles;
- webhooks/n8n opcionales;
- mejoras de voz TTS, B-roll y modelos de análisis.

## Criterio de validación

Antes de integrar cambios: lint, typecheck, tests, build y E2E relevantes. Los despliegues se consideran válidos únicamente cuando CI está verde y el entorno correspondiente reporta estado saludable para las capacidades que ejecutará.
