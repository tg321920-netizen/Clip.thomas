# ClipForge Multi — plan de ejecución

Regla principal: no simular funciones. Cada fase debe producir resultados reales antes de considerarse terminada.

## MVP de propietario único

La implementación y su aceptación se distinguen en [la entrega actual](docs/STUDIO_COMPLETION_20261027.md) y la [auditoría anterior](docs/FULL_SYSTEM_AUDIT_20261026.md). Tener código o CI aprobada no acredita disponibilidad para el propietario.

| Capacidad | Estado actual |
| --- | --- |
| Subida, FFprobe, recorte manual, cola, MP4 y descarga | VERIFIED_LOCAL |
| ASR español/inglés y candidatos locales sobre material real | VERIFIED_LOCAL; calidad editorial PARTIAL |
| Subtítulos originales, SRT y corrección móvil | VERIFIED_LOCAL |
| Podcasts de solo audio, M4A, SRT, selección local y recuperación | VERIFIED_LOCAL sobre grabación auténtica de 90 s; material de horas no certificado |
| Glosario, contexto, historial y detección de riesgos de traducción | VERIFIED_LOCAL; no certifica equivalencia semántica |
| Traducción inglés-español automática | PARTIAL: necesita revisión de nombres y significado |
| Traducción corregida, render y recuperación R2 | VERIFIED_LOCAL |
| Ensayo privado independiente | READY_FOR_DEPLOYMENT para ensayo manual; BLOCKED_EXTERNAL_AUTHORIZATION para crearlo |
| Acceso del propietario desde Android por Internet | BLOCKED |
| Captura LIVE y observación de chat actuales | NOT_TESTED / LIVE_NOT_TESTED |
| Seguimiento de protagonistas, doblaje y otras fuentes no evaluadas | PARTIAL o NOT_TESTED según la matriz |
| Publicación real y OAuth social | BLOCKED; publicación OFF |

Se conservan los demás módulos y la historia de sus pruebas. No se certifica operación permanente, Android físico, precisión universal de ASR ni calidad comercial de todos los géneros.

## Activación externa necesaria

Estas tareas no son código faltante y no se pueden completar con valores inventados:

- provisionar/aprobar el runtime persistente de producción y su disco;
- definir la clave de acceso del propietario para ese runtime;
- crear/aprobar las apps de TikTok, Google/YouTube y Meta;
- registrar redirect URI y secretos OAuth reales;
- conectar las cuentas solo cuando se autorice la fase social; la publicación permanece OFF.

## Mejoras posteriores al MVP

No bloquean el uso inicial de ClipForge:

- seguimiento visual multi-persona que identifique automáticamente qué rostro habla;
- persistencia compartida y aislamiento multi-tenant para convertirlo en SaaS;
- analytics adicionales de TikTok/Facebook según scopes y revisión disponibles;
- webhooks/n8n opcionales;
- mejoras de voz TTS, B-roll y modelos de análisis.

## Criterio de validación

Antes de integrar cambios: lint, typecheck, tests, build y E2E relevantes. Los despliegues se consideran válidos únicamente cuando CI está verde y el entorno correspondiente reporta estado saludable para las capacidades que ejecutará.
