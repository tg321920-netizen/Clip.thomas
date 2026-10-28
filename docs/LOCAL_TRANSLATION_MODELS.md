# Traducción local opcional: modelos y límites comprobados

El recorte manual, las descargas y los subtítulos originales no dependen de la
traducción. No hay instalación desde una petición HTTP ni cambio automático a
una API paga. La selección del modelo es una decisión de configuración privada
del worker; cambiarla no sustituye pistas ya guardadas sin regeneración explícita.

## Modelos conservados

El instalador anterior `scripts/install-local-translation.sh` conserva Argos
en_es 1.0. No se reemplazó ni borró ese modelo.

La alternativa nueva es **Helsinki-NLP/opus-mt-tc-big-en-es**, revisión
`8f4d4924189681076e9c642b2fd85278d793fd4d`, licencia **CC BY 4.0**.
Modelo y atribución: https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-es

Autores/proyecto: Jörg Tiedemann, Santhosh Thottingal y OPUS-MT. Véanse
*OPUS-MT – Building open translation services for the World* (2020) y
*The Tatoeba Translation Challenge* (2020), citados en el README conservado del
modelo. ClipForge convierte los pesos safetensors a CTranslate2 CPU int8;
no entrena otro modelo ni altera los originales del proyecto.

`scripts/models/opus-mt-tc-big-en-es.json` fija tamaño y SHA-256 de cada archivo
descargado. No se descargan pickle weights ni código remoto del repositorio del
modelo. La instalación conserva README, revisión, licencia y hashes del motor,
configuración, vocabulario y ambos tokenizadores. La inferencia verifica esos
hashes antes de aceptar una traducción. Un tokenizador alterado fue rechazado
en una prueba nativa aislada, sin filtrar el texto de entrada en el error.

## Instalación para el operador del servidor

No ejecutar en el teléfono ni en el ensayo gratuito de 512 MiB:

```bash
bash scripts/install-opus-local-translation.sh /ruta/de/herramientas
```

Requiere Python 3.11+, red para la instalación explícita, varios GB disponibles
y RAM para convertir el modelo. El runtime usa CTranslate2 y SentencePiece;
PyTorch/Transformers se necesitan para la conversión. No se inicia ningún servicio.
Configurar privadamente en el worker:

```text
CLIPFORGE_TRANSLATION_PYTHON=/ruta/de/herramientas/translation-opus-venv/bin/python
CLIPFORGE_TRANSLATION_MODEL_PATH=/ruta/de/herramientas/translation-opus-en-es-8f4d492
```

La inferencia es offline, un hilo CPU y lotes acotados. Medición local de tres
frases: **3,375 s**, máximo RSS **531.416 KiB (~519 MiB)**, sin incluir Next.js ni
otros workers. No mide Render ni garantiza ese tiempo en un servidor limitado.
Este traductor **no cabe junto a ClipForge en 512 MiB**. La plantilla gratuita
no lo instala; requiere un worker con capacidad medida adicional. No se cambió
ningún plan ni se compraron recursos.

## Evaluación y limitaciones

Comparación real, sin mocks ni API paga, contra el Argos existente:

| Caso NASA/JFK | Resultado nuevo observado |
| --- | --- |
| Rice/Texas | Conserva Rice; la referencia deportiva aún requiere contexto editorial. |
| opportunity … may never come again | «puede que nunca más llegue», conservando la posibilidad. |
| felt the ground shake | «sentido temblar el suelo», evitando «batido de tierra». |
| Negación, 15 millones y NASA | Conservados en un caso lingüístico de regresión explícito. |

La traducción contextual nueva también produjo una variante demasiado categórica:
«nunca puede volver». El pipeline v2 detecta esa diferencia de modalidad y conserva
la salida directa medida, con `CONTEXT_SEMANTIC_RISK_FALLBACK`. Hace lo mismo con
cambios detectables de negación, cifras o glosario; no fabrica una frase de reemplazo.
Se conserva el audio original y el estado **REVIEW_REQUIRED** en todos los casos.
Estas reglas detectan riesgos; no prueban equivalencia semántica universal.

La prueba móvil local generó un MP4 auténtico NASA con traducción de este modelo,
comprobó texto incrustado mediante OCR, descargó SRT y restauró la pista desde R2.
La transcripción real se reutilizó únicamente tras comprobar fuentes idénticas
por SHA-256. No acredita un podcast español nuevo, Android físico, doblaje ni
un despliegue externo.

Prueba reproducible de comparación, sin descargar modelos ni renderizar:

```bash
node scripts/translation-model-comparison-e2e.mjs \
  --candidate-model=/ruta/translation-opus-en-es-8f4d492 \
  --baseline-model=/ruta/translation-model-en-es
```

Requiere `CLIPFORGE_TRANSLATION_PYTHON`. La instalación nueva es opcional; conservar
los modelos previos permite volver a la configuración anterior sin perder pistas.
