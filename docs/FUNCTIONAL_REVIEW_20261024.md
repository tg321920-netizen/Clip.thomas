# Revisión funcional de ClipForge — 24 de octubre de 2026

## Dictamen

El flujo local de subida, procesamiento, transcripción, selección, render, reproducción y descarga quedó comprobado con nuevas ejecuciones. **No se certifica que toda la misión ni producción estén al 100 %.** Faltan pruebas con cuentas/directos autorizados, infraestructura remota y funciones que ya figuraban pendientes. No se hicieron publicaciones, despliegues, cambios de planes ni push.

Se trabajó sobre `codex/clipforge-finalization-live-clipping-20261024`, partiendo de `50395b31c255df602c71a8d763aafb5c11361d92`, con árbol limpio al iniciar.

## Defectos encontrados y mejoras

1. **Recuperación de lotes parciales.** El worker consultaba recoverMediaResult antes de BestClipsService. Si solo había un clip de tres, el helper lanzaba error, impidiendo aprovechar el checkpoint que BestClipsService ya sabía reanudar. Ahora devuelve control al servicio. La aceptación audiovisual interrumpe deliberadamente el lote después del primer MP4 persistido y termina los otros dos conservando el ID del primero. Nunca considera el subconjunto una entrega completa.
2. **Cancelación durante resolución de enlace.** La señal llegaba a FFmpeg, pero no al proceso que resolvía la URL con yt-dlp. Ahora se propaga también al resolver y se conserva AbortError. Una regresión arranca un ejecutable controlado de larga duración, lo cancela y comprueba que su PID termina. No se contacta una plataforma durante esa prueba.
3. **Reanudación desde historial móvil.** Una captura cancelada perdía su botón de reanudar al recargar la página. El historial ahora ofrece esa acción para CANCELLED, conservando el control del lock en servidor. Se verifica su presencia con un trabajo cancelado persistido mediante el store real antes de iniciar la prueba.
4. **Accesibilidad de selección.** La primera aceptación móvil no pudo localizar de forma inequívoca el selector del perfil. Se añadió un nombre accesible explícito y se comprobó su uso en navegador. También se corrigió el texto de creación de un único clip.
5. **Cobertura que atraviesa la UI.** Se añadió scripts/mobile-upload-e2e.mjs. Usa un runtime y almacenamiento aislados, APIs reales de la aplicación, ingesta, cola, Whisper y render; no intercepta peticiones ni fabrica estados de éxito. Comprueba la descarga por el navegador y que el reproductor decodifica y avanza. El workflow manual de aceptación ahora incluye esta prueba.
6. **Señales audiovisuales comprobadas.** Una nueva prueba genera un corte negro→blanco y un cambio de volumen conocidos, y exige detectar el corte cerca de 5 s y una diferencia RMS superior a 20 dB. No basta con obtener arrays o puntajes aparentemente válidos.

## Resultados nuevos

| Comprobación ejecutada | Resultado |
| --- | --- |
| Baseline antes de cambios | 298 aprobadas, 0 fallidas, 0 omitidas |
| Suite final con CLIPFORGE_RUN_MEDIA_TESTS=true | **300 aprobadas, 0 fallidas, 0 omitidas** |
| ESLint | Aprobado |
| TypeScript | Aprobado |
| Build de producción | Aprobado; suite incluida entonces: 299. La prueba adicional de señales se ejecutó individualmente y después dentro de la suite final de 300 |
| phase1:e2e | Aprobado: servidor/HTTP, subida y metadatos reales |
| render:e2e | Aprobado |
| reframe:e2e | Aprobado; el modo existente sigue siendo zoom por actividad de voz, no tracking visual de personas |
| autoedit:e2e | Aprobado |
| news:e2e | Aprobado con TTS y render real |
| owned-content:e2e | Aprobado con aprobación/dry run; no envío externo |
| live-clipping-e2e | Aprobado con Whisper real, interrupción y reanudación parcial, tres renders, OCR, original conservado, recuperación completa y ZIP |
| Navegador móvil + MP4 | Aprobado sin mocks: fuente propia de 184,911 s, subida→workers→Whisper→clip→descarga→reproducción |
| Navegador móvil + MOV | Aprobado sin mocks: fragmento propio de 45 s→MP4 1080×1920 H.264/AAC |
| Navegador móvil + WebM | Aprobado sin mocks: fragmento propio de 45 s VP9/Opus→MP4 1080×1920 H.264/AAC |

Los navegadores se ejecutaron con viewport 393×851, táctil y modo móvil, con Chromium en Linux. **No equivale a una prueba en un teléfono Android físico.** Las fuentes son narración original sintetizada e imagen de prueba; no se ha evaluado precisión editorial sobre todos los tipos de grabaciones reales de teléfono.

## Evidencia y reproducción

Artefactos locales ignorados por Git:

- `artifacts/live-clipping/evidence.json`: `partialCheckpointResume=true`, `checkpointReuse=true`, OCR aprobado y tres clips de 31,68 / 31,78 / 27,92 s. `clips.zip` contiene los MP4.
- `artifacts/mobile-upload/evidence.json`, `artifacts/mobile-upload-mov/evidence.json` y `artifacts/mobile-upload-webm/evidence.json`: `mocks=false`, validación de archivo y `browserPlayback=true`. Sus directorios run-* conservan logs y resultados aislados.

```bash
cd /workspace/Clip.thomas
source /workspace/clipforge-tools/activate.sh
CLIPFORGE_REDIS_URL= REDIS_URL= CLIPFORGE_RUN_MEDIA_TESTS=true npm run build
WHISPER_LANGUAGE=en node scripts/live-clipping-e2e.mjs
node scripts/mobile-upload-e2e.mjs
```

El último comando inicia y detiene su propio supervisor en el puerto 3120. Admite CLIPFORGE_TEST_VIDEO y CLIPFORGE_TEST_OUTPUT para repetir el mismo flujo con otro archivo autorizado y otro directorio de evidencia. No modifica el almacenamiento normal del propietario ni elimina originales. Las pruebas MOV/WebM usaron conversiones de 45 s de la fuente sintética propia.

## Lo que impide certificar el 100 %

- No hay una URL concreta de directo/VOD autorizado para probar captura externa. Las consultas oficiales de Kick/Twitch/YouTube están probadas por contrato; no con cuentas reales en esta revisión.
- La inspección de presencia, sin mostrar valores, no encontró KICK_ACCESS_TOKEN, TWITCH_CLIENT_ID, TWITCH_ACCESS_TOKEN ni YOUTUBE_API_KEY inyectados en esta ejecución. Los requisitos guardados en el panel de secretos no prueban que haya valores aplicados. Pueden omitirse para trabajar con videos locales y no habilitan publicación automática.
- Redis no está configurado en este proceso; no se pudo acreditar salud, caducidad o recuperación de una base remota. Los medios siguen necesitando almacenamiento durable; /tmp de Render gratuito no lo proporciona.
- No se probaron llamadas pagadas Z.ai. No se probaron despliegues Render/Vercel ni GitHub Actions remoto.
- Siguen pendientes seguimiento visual del hablante/multipersona, contexto/deduplicación visual entre segmentos y recuperación automática del VOD posterior. Las pruebas locales de captura segmentada no garantizan ocho horas de directo ni continuidad 24/7.
- Whisper tiny puede reconocer palabras incorrectamente. OCR demuestra que el texto se ve, no que toda la transcripción sea exacta ni que cada selección tenga calidad editorial. Se conserva la revisión humana.

Publicación permanece OFF por configuración y por la guarda central. Una prueba local aprobada no se presenta como una conexión OAuth, publicación o despliegue de producción exitosos.
