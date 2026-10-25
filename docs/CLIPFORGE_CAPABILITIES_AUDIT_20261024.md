# ClipForge — auditoría acotada de capacidades (2026-10-24)

**Repositorio:** tg321920-netizen/Clip.thomas
**Rama de revisión e integración:** `codex/clipforge-core-rescue`
**Producción:** sin cambios; publicación real permanece OFF en el rescate. No se autorizaron APIs pagas.

## Documentos solicitados y alcance

- Leído `AGENTS.md` (rescue y foundation): respetar raíz como aplicación canónica, secretos privados, guardas de publicación, no force push.
- `docs/CLIP_EDITOR_AGENT.md` y `docs/CAPABILITIES_REVIEW_PROMPT_ES.md`: **no existen** en el árbol remoto inspeccionado de `main`, `codex/clipforge-agent-foundation` ni `codex/clipforge-core-rescue`. No se inventó su contenido.
- Se leyó `docs/CLIPFORGE_STUDIO_VERIFICATION.md`, `docs/CLIPFORGE_ACCEPTANCE.md`, `docs/FINAL_EXTERNAL_HANDOFF.md`, scripts de E2E y servicios efectivos.

## Cuatro niveles de evidencia

| Capacidad | Implementado en la raíz | Prueba real disponible | Desplegado/usable hoy | Límite |
|---|---|---|---|---|
| Subida, cola y FFprobe | Sí | Integridad de fragmentos en pruebas; `phase1:e2e` histórico | Rama de rescate no acreditada en producción | Subida desde Android físico por aprobar |
| Whisper | Sí, CLI y cpp | CI 2026-10-08: audio español sintetizado realmente transcrito por whisper.cpp tiny, 672 segmentos en 20 min | Dependiente del runtime y binarios/modelo | Títulos con errores graves; inglés no comprobado en este ensayo |
| Selección de mejores momentos | Heurística de texto/energía, exclusión de solapamiento | Tres clips reales de 106,7 / 90 / 90 s; **no** cinco de 30 s | No demostrada para un podcast comercial | No interpreta fotogramas ni entiende realmente el contexto; ViralScore no predice vistas |
| Clips MP4 + audio | FFmpeg, H.264, AAC, CONVERSATION 9:16 | Tres archivos extraídos de artefacto 11561610253; FFprobe H.264/AAC 360x640, decodificación completa `ffmpeg -xerror` PASS | No probados desde Android físico | Resolución CI baja, video fuente sintético, no calidad comercial |
| Subtítulos originales | Sí, `SubtitleService` deriva cues de Whisper | Subtítulos visibles en render de prueba; texto español presenta errores | No se comprobó UI móvil real | Revisión editorial obligatoria |
| Traducción subtitulada | No hay flujo E2E verificado | Ninguna | No declarar operativa | No confundir reconocimiento lingüístico con traducción |
| Doblaje ES↔EN | No hay flujo E2E verificado | Ninguna | No declarar operativo | TTS eSpeak para historias/noticias no es doblaje con sincronía |
| Análisis de fotogramas | No en selector BestClips | Ninguna | No | Requiere pipeline explícito e inspección multimodal |
| Podcasts | Entradas, clips y renders | Prueba 20 min con voz ficticia y video patrón | Aceptación comercial pendiente | Voces/sujetos reales, cortes con sentido |
| Entretenimiento y gaming | Ingesta/edición genérica | Sin E2E por género | No validado por género | Copyright, escenas visuales, ruido, múltiples interlocutores |
| Noticias | News Mode y eSpeak locales | E2E histórico de video | No afirmar actualidad editorial ni licencias | Fuentes y comprobación factual |
| Motivación | Edición genérica | Sin E2E por género | No validado por género | Originalidad, contexto y permiso de voz |
| Almacenamiento de medios | Paths locales, estados KV parciales | Pruebas de durabilidad local | R2 NO conectado | KV no retiene MP4; Render Free efímero |
| Publicación | Providers y guardas | Pruebas simuladas/dry-run | OFF, no publicación autorizada | OAuth, permisos, estado remoto y derechos |

## Evidencia descargada y repetible

- CI: https://github.com/tg321920-netizen/Clip.thomas/actions/runs/37800544784
- Artefacto: https://github.com/tg321920-netizen/Clip.thomas/actions/runs/37800544784/artifacts/11561610253
- Revisión de MP4 del artefacto: `clip-1.mp4` 106,7 s; `clip-2.mp4` 90 s; `clip-3.mp4` 90 s, todos H.264 y AAC a 360x640. Decodificación completa con FFmpeg sin errores.
- **No son cinco clips de ~30 s**; el origen es una narración ficticia en español. Los títulos de Whisper tiny incluyen texto ininteligible. Pasa estructura, no calidad editorial.
- Otros E2E y pruebas unitarias usan proveedores simulados; no prueban llamadas exitosas ni costos del modelo Z.ai/OpenAI real.

## Corrección aplicada

`BestClipsService` ya no fuerza un fallo cuando pide cinco clips y encuentra solo tres intervalos completos sin solapamiento: devuelve los tres, registra `requestedCount`, `deliveredCount`, `partial` y `shortfallReason`, sin rellenar con intervalos repetidos. Si hay cero candidatos, sigue fallando de modo explícito. Los clips siguen con `editorialReview.status=PENDING`. Hay regresiones unitarias para cantidades parciales, duplicados y rangos inválidos. Esto no añade valoración de fotogramas ni un modelo de IA real.

## Protocolo de aceptación pendiente (cinco × ~30 segundos)

1. Elegir **un** material autorizado (podcast, entrevista, gameplay propio o noticia propia) con fuente y permiso documentados.
2. FFprobe del original; una transcripción real ES y otra EN, con muestras verificadas por persona (nombres, contexto y marcas de tiempo). Un caso no prueba el otro idioma.
3. Formar candidatos de aprox. 25–40 s: frase inicial autónoma, desarrollo y cierre completo. Documentar inicio/fin, por qué se eligió, hipótesis de gancho, audio y fotogramas inicial/central/final. Filtrar ideas duplicadas y límites inconclusos.
4. Si solo dos o tres candidatos superan revisión, entregar esos dos o tres. Nunca forzar cinco.
5. Render 9:16, comprobar codec, pistas, duration, full decode, sincronía percibida, subtítulos legibles, audio y encuadre; aprobar desde Android físico.
6. Habilitar almacenamiento privado R2 solamente con adaptador, permisos mínimos, descarga firmada, borrado/retención explícitos, claves ya aprobadas y prueba de recuperación. Nunca publicar objetos anónimos.
7. Ensayar proveedores reales solo si ya están autorizados y presupuestados; registrar fallos reales. No sustituir pruebas de red por mocks.

## Dimensionamiento orientativo — 4 h/día, 5 clips/día

- 120 h de fuentes y 150 clips por 30 días; supervisión editorial aparte.
- Modo local gratuito de modelos: Whisper tiny/cpp y heurística; costos variables del modelo de selección $0 pero calidad no garantizada. No se presuponen traducción ni doblaje.
- Render mensual base de referencia: 1 CPU/2 GB **USD 40**, 2 CPU/4 GB **USD 75** según https://render.com/pricing ; no se compró ni verificó throughput continuo de 4 h diarias en esa máquina.
- R2 Standard (no integrado): 10 GB-mes gratis, luego **USD 0,015/GB-mes**, https://developers.cloudflare.com/r2/pricing/ . Si se retienen 60–220 GB-mes, almacenamiento aproximado **USD 0,75–3,15** + operaciones/red y redondeos, sin asumir que los archivos pesan siempre lo mismo.
- Capacidad y costo real dependen del bitrate de las fuentes, concurrencia, modelo Whisper, caching, costos ocultos, límites de free-tier y tiempo humano. Un piloto medido es requisito antes de comprometer 150 videos.
- No hay costos de Z.ai, TTS externo, R2 ni ventas efectuadas en esta auditoría.

## Sugerencia comercial

Priorizar clips **propios o licenciados**, especialmente entrevistas cortas y consejos de motivación para español en Facebook Reels + YouTube Shorts; probar un canal inglés separado solo cuando exista revisión en ese idioma. TikTok sirve de distribución, pero los cortes de 30 s no cumplen la duración mínima del programa Creator Rewards (1 min). Facebook prioriza contenido original; YouTube sanciona reutilización sin aportes sustanciales. Evitar venta de «clips robados» o garantizar RPM.

## Pendientes de acceso/validación

- Render requiere selección explícita del workspace en el conector; no se leyó el estado de servicio hoy ni sus secretos. La verificación local no representa despliegue.
- Vercel `clip-thomas`: últimos deployments de feature `CANCELED`; despliegue de producción `main` identificado en `READY`. La rama rescue y sus correcciones no están verificadas en producción.
- Reproducción real en Android, aceptación visual y auditiva, ES/EN real, análisis de fotogramas, R2 privado, prueba del modelo de selección externo y presupuesto medido continúan pendientes.
