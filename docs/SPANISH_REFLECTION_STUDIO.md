# Reflexiones originales en español — operación y límites

La aplicación está en la raíz. La rama de reparación es `codex/clipforge-core-rescue`. No se ha modificado producción ni habilitado publicación social.

## Flujo disponible

`relato original o grabación → escenas → fotografías propias/CC0 → voz local o grabación → Whisper español → alineación con el texto corregido → movimiento y fundidos → subtítulos ASS → H.264/AAC vertical → revisión → descarga/R2 privado`

Se reutilizan `SceneStoryService`, `JobStore`, el worker de medios, `LocalImageProvider`, Whisper, validación de MP4 y `ClipLibraryService`. Los adaptadores nuevos cubren funciones que no existían: voz neuronal local, medición/alineación de la narración completa y una biblioteca pequeña con procedencia verificable. No se instaló otra aplicación ni se sustituyeron ingesta, agente, noticias, OAuth o publicación.

## Desde el celular

Estos pasos requieren ejecutar **esta versión** de la web y el worker. No constituyen una afirmación de que la web antigua de Render ya recibió los cambios.

1. Abrir ClipForge y elegir **CREAR HISTORIA CON IA**.
2. Escribir el tema y el relato completo: aproximadamente 80–110 palabras, al menos tantas frases completas como escenas. Dejar activado **Reflexión corta: 30–45 s** y formato vertical.
3. Para empezar, elegir **Fotografías gratuitas de naturaleza (CC0)** y seis escenas. Sirve para reflexiones sobre semillas, raíces, crecimiento, caminos, pausas o amaneceres. Para otros temas, subir imágenes propias relacionadas: una distinta por escena.
4. Elegir **Kokoro local en español**, si el worker lo tiene instalado, o **Subir mi narración**. La grabación acepta WAV, MP3 y M4A, hasta 20 MB; se puede escuchar antes de generar y se muestra su duración. Una grabación de unos 30–44 segundos deja espacio para la pausa final del modo corto. Pegar también el texto corregido permite contrastarlo con el audio. Si falta texto se usa reconocimiento español, sujeto a revisión. El contador muestra las palabras del relato.
5. Confirmar los derechos de los recursos propios, conservar subtítulos y pulsar **Crear video con fotos gratuitas** o el botón de imágenes propias. El trabajo se ejecuta en el worker; se puede cerrar la página y volver a **Mis videos**.
6. Reproducirlo con sonido, revisar el final, subtítulos y **Revisar escenas y procedencia**. Descargar el MP4. **Clips guardados** permite reproducir/descargar la copia privada de R2; **Conservar** la protege de la retención automática.

La duración indicada en el formulario es orientativa: manda la lectura completa dentro de 30–45 segundos. Si no cabe, el trabajo solicita ajustar texto/grabación. No corta la voz ni acelera el audio para conseguir un resultado verde. eSpeak sigue disponible como voz básica, explícitamente pendiente de revisión; no se presenta como voz profesional.

## Instalación local gratuita

FFmpeg/FFprobe, whisper.cpp, fuentes con soporte español y Python deben existir en el worker. El instalador opcional está probado en Linux x86_64 con Python 3.12; no se ha validado su instalación en la imagen Docker de producción.

```bash
cd /workspace/Clip.thomas
bash scripts/install-local-story-voice.sh
source /workspace/clipforge-tools/activate.sh
export CLIPFORGE_LOCAL_TTS_COMMAND=/workspace/clipforge-tools/bin/kokoro-narration
export CLIPFORGE_LOCAL_TTS_MODEL_PATH=/workspace/clipforge-tools/kokoro-models/kokoro-v1.0.int8.onnx
export CLIPFORGE_LOCAL_TTS_VOICES_PATH=/workspace/clipforge-tools/kokoro-models/voices-v1.0.bin
export WHISPER_CPP_MODEL_PATH=/workspace/clipforge-tools/ggml-base.bin
export CLIPFORGE_AGENT_REAL_PUBLISHING=false
export CLIPFORGE_CONTENT_REAL_PUBLISHING=false
export CLIPFORGE_SMART_PUBLISH_ON_BOOT=false
export CLIPFORGE_AGENT_ENABLED=false
```

Los modelos y el entorno Python quedan fuera del repositorio. Las versiones Python están fijadas en `scripts/requirements-local-voice.txt`; las descargas tienen SHA-256 en el instalador. Se mantiene el proxy/CA del entorno, sin omitir TLS. No se consume una API de voz o modelo de pago.

Web y worker deben compartir `CLIPFORGE_STORAGE_DIR`. El supervisor existente `node scripts/render-runtime-free.mjs` arranca la web y workers; consultar su `--check` y la documentación de despliegue antes de usarlo. No ejecutar dos supervisores sobre la misma cola.

## Verificación reproducible

```bash
CLIPFORGE_RUN_MEDIA_TESTS=true npm run verify
CLIPFORGE_RUN_MEDIA_TESTS=true npm run build
npm run render:e2e
npm run reframe:e2e
npm run agent:e2e
npm run reflection:e2e -- --r2
CHROMIUM_PATH=/usr/bin/chromium node scripts/mobile-reflection-e2e.mjs
node scripts/story-memory-e2e.mjs
```

Las pruebas de reflexión y móvil usan historias originales incluidas en `scripts/fixtures/spanish-reflections.json`, fotos reales de la biblioteca, Kokoro y Whisper reales. `--r2` requiere los bindings privados existentes y crea solo objetos de prueba nuevos; nunca publica ni elimina archivos ajenos. La prueba móvil requiere el `latest.json` de la primera prueba y una compilación vigente. Su narración subida procede de Kokoro y se identifica como **fixture de grabación, no grabación humana**. No intercepta ni simula respuestas de la API web. El benchmark de memoria usa el primer MP4 real, `python3` y el pico RSS registrado por el kernel Linux para cada proceso. Compara dos codificaciones y decodificaciones; no certifica la memoria agregada del servidor.

Las pruebas generan MP4, fotogramas, logs, validación y recibos en `artifacts/spanish-reflections/`, excluido de Git. La prueba técnica del agente usa respuestas de modelo simuladas; no evalúa un modelo comercial real.

## Límites que siguen vigentes

- Selección visual por etiquetas en ocho fotos de naturaleza, sin repetir. No es reconocimiento visual general ni generación automática de imágenes para cualquier historia. Temas sin correspondencia se detienen y piden recursos propios.
- Whisper base comete errores. Se conserva el texto corregido del autor, se compara con el reconocimiento y se miden anclas temporales. Algunas palabras se interpolan; no es alineación fonética perfecta. Se rechaza cobertura insuficiente, negaciones importantes sin confirmar y final no confirmado. La aprobación editorial sigue pendiente.
- La voz neuronal mejora la alternativa básica, pero su acento, prosodia y atractivo comercial necesitan escucharse. No hay garantía de resultados profesionales ni de rendimiento comercial. No se habilitaron doblaje, traducción ni clonación de voz.
- R2 conserva **MP4 finales y metadatos de biblioteca**, no todos los originales ni la cola de trabajos. Retención predeterminada de 30 días salvo **Conservar**. Con `/tmp` efímero pueden perderse proyectos editables, entradas y trabajos. Hace falta un volumen durable o solución equivalente para recuperación completa.
- El render 1080p consume CPU y memoria; las transiciones usan dos decodificadores y cachés verificadas. Estas pruebas no certifican que Render gratuito pueda ejecutar web, voz, Whisper y render simultáneamente ni mantener disponibilidad continua. Los pesos no cuestan por uso; la máquina y almacenamiento sí pueden tener coste/límites.
- La prueba móvil usa Chromium de 393 × 851 con controles táctiles. No sustituye una prueba en un Android físico. No se desplegó esta rama en producción.
- Ningún vídeo ha sido publicado en Facebook, YouTube u otra red. Preparar y descargar no equivale a publicar.

## Licencias

Fotografías CC0: `public/story-library/LICENSES.md`, con fuente, autor y hash de cada archivo. Son ilustraciones, no evidencias de hechos de las historias.

Kokoro v1.0: pesos declarados **Apache-2.0** por [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M). Conversión y runtime [thewh1teagle/kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx), **MIT**. Se conservan ambos textos en `docs/licenses/`. Los hashes fijan los archivos recibidos por HTTPS del release del autor; no se presentan como una firma independiente del proveedor.

Se conserva la atribución de los datos CC BY declarados en la ficha original de Kokoro: [Koniwa](https://github.com/koniwa/koniwa), `tnc`, CC BY 3.0, menos de una hora; y [SIWIS](https://datashare.ed.ac.uk/handle/10283/2353), CC BY 4.0, menos de once horas. La ficha indica incorporación posterior al 22-11-2024. La salida no es una grabación del dataset ni una imitación solicitada de un creador.

Se descartó la voz Piper davefx probada inicialmente: aunque su ficha menciona un dataset CC0, su ascendencia Lessac declara restricciones de investigación. No forma parte de la entrega comercial ni del instalador final.

La comprobación más reciente, incluida la creación completa desde móvil y las mediciones de memoria, está en [SPANISH_REFLECTION_REFINEMENT_20261025.md](SPANISH_REFLECTION_REFINEMENT_20261025.md).

La revisión posterior de historial, cancelación de procesos y reinicio recuperable está en [CLIPFORGE_FUNCTIONAL_REVIEW_20261025.md](CLIPFORGE_FUNCTIONAL_REVIEW_20261025.md). En **Mis videos** se puede cancelar durante el render; **Reanudar** se habilita cuando el proceso anterior terminó. Los registros dañados muestran un aviso y no bloquean los demás trabajos.
