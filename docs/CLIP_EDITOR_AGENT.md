# Agente editor: configuración y alcance comprobable

El agente existente tiene decisiones estructuradas, una lista cerrada de herramientas, aprobaciones y persistencia. Sin embargo, `BestClipsService` instanciaba directamente `TranscriptCandidateProvider`: configurar Z.ai no hacía que ese flujo usara IA. `OpenAIContentProvider` ya podía ordenar candidatos reales, pero no recibía energía/escenas/contexto ni fotogramas y completaba rankings inválidos con heurísticas. Se amplían esos componentes y se añade solamente el muestreo visual acotado que faltaba; no se instala otra aplicación.

## Flujo

`ZaiAgentProvider → AgentRuntimeService → AgentOrchestrator → AgentToolRegistry.clips.prepare → JobStore MEDIA_CLIPS → media-worker → BestClipsService → OpenAIContentProvider configurado para Z.ai → RenderService → storage-worker/R2 → revisión`

La herramienta del agente sólo utiliza el proyecto y los ajustes guardados por el propietario en `task.context.clipping`, incluyendo `rightsConfirmed`. El modelo no puede autorizar una fuente, cambiar ese proyecto mediante sus argumentos ni entregar rutas locales o URLs para capturarlas. El trabajo tiene identidad determinista por ejecución/proyecto/ajustes; reiterarlo no duplica el render. El estado COMPLETED del agente significa que encoló un trabajo verificable: el MP4 requiere READY y validación posterior. La salida de finalización se obtiene de la herramienta, no de una afirmación libre del modelo.

El editor usa transcripción real, contexto anterior/posterior y señales de energía/cambios de escena. La primera solicitud ordena candidatos existentes; la segunda examina fotogramas de hasta diez candidatos sin solapamiento. Extrae como máximo 24 JPEG de hasta 384×384, con límites de archivo/payload y limpieza de su directorio temporal. Son imágenes aisladas, no reconocimiento continuo de jugadas, identidad de personas ni emociones. Los IDs y tiempos permanecen vinculados a los candidatos originales.

Los rankings vacíos, IDs inventados y recortes marcados como incompletos o engañosos no se sustituyen silenciosamente por resultados supuestamente elegidos por IA. Se conservan las señales, el modelo, los fotogramas usados, las advertencias y la revisión pendiente. Una decisión ya persistida se reutiliza tras una interrupción con el mismo modelo y ajustes; cambiar modelo, visión o transcripción invalida ese punto de recuperación. Los contadores reales de tokens se registran en AIUsageService sin inventar costos ausentes.

## Primera configuración

Guardar en Variables de entorno privadas del servidor:

```dotenv
CLIPFORGE_AGENT_PROVIDER=zai
CLIPFORGE_AGENT_MODE=SEMI_AUTO
CLIPFORGE_AGENT_ENABLED=false
CLIPFORGE_ZAI_BASE_URL=https://api.z.ai/api/paas/v4
CLIPFORGE_ZAI_MODEL=glm-4.6v-flash
CLIPFORGE_EDITOR_MODEL=glm-4.6v-flash
CLIPFORGE_EDITOR_VISION=true
# CLIPFORGE_ZAI_API_KEY: introducir únicamente en el editor privado.
CLIPFORGE_AGENT_REAL_PUBLISHING=false
CLIPFORGE_CONTENT_REAL_PUBLISHING=false
CLIPFORGE_SMART_PUBLISH_ON_BOOT=false
```

No pegar claves en Description, Git, chat, comandos o informes. El plan Coding no equivale a acceso a la API general. Los ciclos recurrentes quedan apagados; las tareas manuales funcionan desde `/autopilot` → Agente editor → Preparar clips para revisión. Elegir un proyecto importado/subido, cantidad (cinco por defecto), duración (30 s por defecto), perfil y confirmación de derechos/envío al proveedor. El progreso y los MP4 se consultan en Mis videos de la página principal. Se necesitan el servidor multimedia y sus workers: guardar este borrador no despliega la aplicación.

El análisis manual global permanece `heuristic` por defecto; la herramienta del agente selecciona `zai` explícitamente. Después de validar la API se puede configurar `CLIPFORGE_ANALYSIS_PROVIDER=zai` para los trabajos normales/live. No hay fallback automático a un modelo de pago. Un fallo deja el trabajo visible para revisión/reintento. El modelo debe seguir disponible para la cuenta y dentro de sus límites de servicio.

## Precio consultado y repositorio estudiado

Consulta del 24 de octubre de 2026, hora de Costa Rica:

| Modelo Z.ai | Entrada / millón tokens | Salida / millón tokens | Uso propuesto |
| --- | --- | --- | --- |
| GLM-4.6V-Flash | Gratis | Gratis | Primera evaluación: decisiones y revisión multimodal |
| GLM-4.6V-FlashX | USD 0,04 | USD 0,40 | Alternativa visual de pago, sólo tras selección explícita |
| GLM-5.3-Flash | USD 0,15 | USD 0,50 | Alternativa de decisiones de pago, separada del editor visual |

Fuentes: [tarifas oficiales](https://docs.z.ai/guides/overview/pricing) y [capacidades GLM-4.6V](https://docs.z.ai/guides/vlm/glm-4.6v). No se garantiza gratuidad perpetua ni disponibilidad ilimitada; alojamiento, FFmpeg y almacenamiento tienen límites separados. Los límites de solicitudes/payload/pasos no son un límite de facturación mensual del proveedor. No se realizaron llamadas externas de IA ni se contrató un plan en esta fase.

Se examinó [LangGraph.js](https://github.com/langchain-ai/langgraphjs), commit `c6675bf03f353ff32fb2ee0a82adb3541c0aee40`, `LICENSE`, `README.md` y `libs/langgraph-core/README.md`; licencia MIT comprobada. Ofrece orquestación con estado e intervención humana. ClipForge ya dispone de esas piezas y conectores: se conserva su agente, evitando un segundo sistema de trabajos/memoria. No se copió código de LangGraph ni se agregó una dependencia. La licencia del framework no aporta por sí sola capacidad editorial al modelo.

## Verificación y límites de la evaluación

```bash
npm run verify
npm run build
npm run agent:e2e
npm run render:e2e
npm run reframe:e2e
CLIPFORGE_TEST_BASE_URL=http://127.0.0.1:3135 node scripts/mobile-agent-e2e.mjs
```

Los localhost anteriores son exclusivamente para el ejecutor de pruebas, no enlaces para el propietario. `agent:e2e` crea/reutiliza la fuente audiovisual propia de `live-clipping-e2e`, con transcripción Whisper real, y usa un servidor HTTP local con respuestas de modelo explícitas. Ejecuta el agente, la cola y el worker reales, extrae JPEG, valida dos MP4 H.264/AAC y comprueba recuperación de un render parcial sin otra solicitud de ranking. Guarda evidencia en `artifacts/editor-agent/`. No toca R2 ni APIs externas. La prueba móvil usa fixtures explícitos en Chromium a 393×851; no acredita un Android físico ni la calidad de un modelo.

Falta añadir la clave privada y hacer una evaluación real: usar videos autorizados con momentos anotados por una persona, incluir conversación interesante sin gritos y reacciones ruidosas sin contexto, comparar los cinco primeros candidatos, revisar inicio/conclusión, redundancia y precisión de sus razones. Mostrar el resultado aunque la calidad sea insuficiente. Un test de integración verde no demuestra eficacia editorial.

La nueva pantalla prepara clips de proyectos existentes; no inicia grabación automática de Westcol ni acredita su permiso. Las capturas continuas de cuatro horas, seguimiento real del protagonista, contexto/duplicados entre segmentos y disponibilidad 24/7 siguen siendo trabajos distintos. R2 almacena los renders finales según su política; no conserva automáticamente los proyectos originales ni repara la publicación del entorno de Codex.

La verificación final completó lint, TypeScript, 340 pruebas sin fallos ni omisiones, build, agent:e2e, render:e2e, reframe:e2e y las comprobaciones móviles de agente y biblioteca. Se archivó uno de los MP4 sintéticos en el R2 privado configurado por el propietario y se verificaron descarga por SHA-256, rangos, lectura sin archivos locales, idempotencia y «Conservar». La prueba detectó y corrigió un conflicto de versiones JSON comprimidas, descrito en FREE_CLIP_STORAGE.md. Esa comprobación de almacenamiento es real; no convierte las respuestas locales del modelo en una evaluación editorial de Z.ai. La API externa y el despliegue de esta versión siguen pendientes.
