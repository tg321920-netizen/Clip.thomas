# Capacidades y prompt de revisión de ClipForge

## Estado comprobado en el entorno de desarrollo

Revisión del 24 de octubre de 2026, hora de Costa Rica. Estos resultados corresponden a la rama de integración; no acreditan que la web de producción tenga esta versión desplegada.

| Área | Capacidad existente | Límite de lo comprobado |
| --- | --- | --- |
| Videos existentes | Importación/subida, transcripción, candidatos, corte, subtítulos y render MP4 | Hay pruebas con fuentes propias y MP4 reales; cada URL externa depende del acceso y herramientas de su plataforma |
| Selección editorial | Cinco perfiles: gaming, podcast, entretenimiento, noticias y motivación; transcripción, contexto, energía de audio y fotogramas acotados | Son señales para ordenar candidatos, no reconocimiento infalible de eventos ni garantía de viralidad |
| Cantidad y duración | Solicitar cinco clips de unos 30 s y ajustar cantidad/duración | La fuente debe contener suficientes ideas completas; no se garantiza siempre entregar cinco buenos clips |
| Agente Z.ai | Credencial configurada; respuesta HTTP 200 y decisión JSON válida | La ejecución completa con el modelo real se detuvo por saturación del proveedor; todavía falta evaluar su selección editorial |
| MP4 y encuadre | H.264/AAC, formato vertical, subtítulos y audio original | El flujo del agente se probó a 360×640 para reducir recursos; no acredita seguimiento del protagonista, cambio fiable de hablante o pantalla dividida automática |
| Archivo privado | Subida y recuperación real de un MP4 de prueba en R2, integridad, rangos y Conservar | La retención de 30 días se aplica a clips sin protección; no equivale a copia de seguridad de todos los originales y trabajos |
| Directos | Adaptadores y trabajos segmentados para Kick, Twitch y YouTube | No se acredita el flujo completo de las tres plataformas ni captura continua de cuatro horas/24×7 |
| Revisión móvil | Pruebas de interfaz de agente y biblioteca con Chromium en tamaño móvil | No sustituye una prueba en un Android físico ni acredita que la versión esté desplegada |
| Publicación | Preparación y revisión con conectores existentes | Publicación real desactivada; no se publicó contenido |

### Qué contenido conviene probar primero

- **Podcasts y entrevistas:** ideas completas, historias, declaraciones y desacuerdos que se entiendan sin el episodio completo. Requieren transcripción clara y contexto.
- **Entretenimiento e IRL:** anécdotas, humor y reacciones con preparación y desenlace. Los gritos por sí solos no justifican el recorte.
- **Gaming:** jugadas y reacciones como candidatos. El sistema aún no acredita comprensión fiable de reglas, marcador o resultado de una partida.
- **Noticias:** declaraciones y acontecimientos con fuente, fecha y contexto. Deben revisarse hechos y posibles recortes engañosos antes de publicar.
- **Motivación y educación:** consejos, explicaciones e ideas que incluyan su conclusión. La etiqueta del perfil no garantiza exactitud de la afirmación.

### Idiomas

Whisper puede detectar el idioma original o recibir un idioma configurado. Español e inglés son objetivos apropiados para la primera evaluación; todavía no hay una comparación editorial bilingüe documentada que garantice la calidad ante jerga, acentos, música o varias voces. El soporte multilingüe del modelo no significa que todos sus idiomas estén probados en esta aplicación.

Los subtítulos del clipping siguen la transcripción y se conserva el audio original. Traducir subtítulos, producir versiones en otro idioma y doblar el audio son funciones diferentes: este flujo no las tiene verificadas. La presencia de TTS para contenido original no demuestra doblaje de clips.

Para auditarlo de nuevo y avanzar sin promesas falsas, usar el prompt siguiente. La evidencia y las limitaciones técnicas del agente están en [CLIP_EDITOR_AGENT.md](CLIP_EDITOR_AGENT.md).

## Prompt para copiar

Copiar el bloque siguiente en Codex con acceso al repositorio y al entorno configurado. Es una auditoría del sistema existente, no una orden de publicar ni una promesa de soporte universal de idiomas o directos.

```text
Actuá como auditor técnico y editor audiovisual de ClipForge. Analizá lo que YA está montado en tg321920-netizen/Clip.thomas, sobre la rama de integración actual. La aplicación está en la raíz; clipforge/ es histórica. Leé AGENTS.md y docs/CLIP_EDITOR_AGENT.md antes de modificar. Reutilizá los servicios y credenciales del servidor sin mostrar claves ni duplicar la aplicación.

Objetivo: determinar qué tipos de clips puedo producir hoy, en qué idiomas, con qué calidad y a qué costo. Distinguí IMPLEMENTADO, PROBADO AQUÍ, DESPLEGADO EN MI WEB y PENDIENTE. Documentá los SHA reales y no declares 100% funcional por pruebas simuladas.

1. Fuentes y contenidos
- Verificá subida MP4/MOV/WebM, URLs autorizadas y adaptadores independientes de Kick, Twitch y YouTube.
- Evaluá gaming, podcasts/entrevistas, entretenimiento/IRL/humor, noticias con contexto y motivación/educación.
- Para cada tipo indicá señales disponibles, limitaciones y ejemplos de buenos y malos recortes. La energía de audio, los fotogramas y una puntuación no prueban emociones, jugadas o viralidad.
- Separá importar VOD, capturar segmentos en vivo, crear clips nativos y exportar MP4. Comprobá permisos por fuente; ninguna API o clave de almacenamiento concede derechos sobre Westcol u otro creador.

2. Idiomas
- Comprobá español latino e inglés con fixtures propios y transcripción real de Whisper; registrá proveedor, modelo y calidad ante jerga, ruido y música.
- Distinguí idioma hablado, transcripción, subtítulos, metadatos y audio de salida. No supongas que transcribir también traduce o dobla.
- Enumerá otros idiomas sólo tras verificar soporte y marcar si se probaron. Conservá el audio original. Si falta traducción de subtítulos o doblaje, indicá PENDIENTE y su costo, sin simularlo.

3. Agente y selección
- Reutilizá ZaiAgentProvider → AgentRuntimeService → AgentOrchestrator → AgentToolRegistry y los workers existentes.
- Revisá el modelo realmente configurado, su formato JSON, límites y respuestas de API. Conservá el modo manual; SEMI_AUTO para preparar clips.
- Solicitá cinco clips de aproximadamente 30 s, ajustables a 15/30/45/60/90 s, con perfil, formato vertical y subtítulos.
- Elegí ideas completas por transcripción/contexto, señales medidas y fotogramas. Evitá solapamientos y contenido repetido. Explicá cada selección y la evidencia ausente; devolvé menos candidatos si no hay suficientes buenos.
- Compará la selección real con momentos anotados por una persona. Separá esta evaluación de las pruebas con respuestas de modelo simuladas.

4. Exportación y almacenamiento
- Procesá un video propio de varios minutos. Verificá con FFprobe y decodificación los tiempos, duración, H.264/AAC, audio, formato vertical y subtítulos visibles.
- Comprobá reproducción y descarga desde una vista móvil, cancelación, reintento y recuperación sin volver a consumir IA innecesariamente.
- Verificá R2 privado: MP4, descarga íntegra, rangos, retención de 30 días, Conservar y límite de biblioteca de 8 GB. No borres originales ni archivos ajenos. Aclarar que R2 no recupera todos los proyectos/trabajos locales.
- No prometas capturas continuas de cuatro horas o disponibilidad 24/7 hasta medir CPU, RAM, disco, retención, estabilidad y costo del servidor.

5. Controles y entrega
- Mantené CLIPFORGE_AGENT_REAL_PUBLISHING=false, CLIPFORGE_CONTENT_REAL_PUBLISHING=false y CLIPFORGE_SMART_PUBLISH_ON_BOOT=false. No publiques ni programes campañas reales. No compres servicios ni cambies modelos de pago automáticamente.
- Ejecutá los checks pertinentes existentes; distinguí fallos, omisiones, fixtures, pruebas reales de API y despliegue. Corregí errores autorizados y guardá avances en commits sin tocar main ni hacer force-push.
- Entregá una tabla por tipo de contenido, otra por idioma, resultados de pruebas, clips reales producidos, límites, presupuesto mensual para 4 h/día y 5 clips/día, y pasos concretos de uso desde Android. Usá precios oficiales y separá IA, cómputo, almacenamiento y transferencia. Si falta un requisito externo, completá lo independiente y explicá exactamente qué falta.
```
