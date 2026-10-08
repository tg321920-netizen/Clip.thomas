# Prueba definitiva y autorización pendiente

Fecha: 8 de octubre de 2026. **NO EJECUTADA. No hay tres clips comerciales aprobados.**

Se propone una sola prueba de entrega de A: **un original real → exactamente tres clips distintos**. El propósito es comprobar utilidad editorial, costo de producción y entrega desde Android. No probar historias, edición general ni viralidad con el mismo material. No repetir el ejemplo maya ni generar fuentes sintéticas nuevas.

## Insumos y decisiones antes de ejecutar

- Un video de 10–30 minutos propio del propietario o con permiso explícito; ≤1 GiB, audio claro y hasta 1080p para acotar recursos. Preferir una entrevista o explicación con tres ideas aprovechables. No está disponible en esta sesión.
- Constancia del permiso para usar el original y, separadamente, para mostrar los clips como ejemplos a prospectos. Ser dueño de un archivo no demuestra autorización de exhibición comercial de todos los participantes.
- Confirmar idioma, público, temas que deben evitarse, nombre/términos que deben escribirse correctamente y si se acepta el encuadre que conserva toda la imagen. El sistema no detecta actualmente al hablante.
- Autorización del propietario para esta generación audiovisual concreta. Este documento no constituye autorización.
- Entorno de ejecución con Whisper/FFmpeg, espacio suficiente y sesión de prueba. Si se necesita desplegar, pagar o aumentar recursos, obtener autorización separada sobre el cambio concreto. No modificar producción para iniciar esta prueba.

## Límite del intento

Un origen, una transcripción inicial y un lote de tres exportaciones. Nada de renderizar variantes hasta obtener un resultado bonito. Presupuesto propuesto: **USD 2 como máximo en costos directos**, ninguna API de pago; **60 minutos de tiempo total de procesamiento** y **10 minutos por render**, a confirmar según el entorno. Reservar hasta 4 GiB temporales y un solo trabajo pesado simultáneo. Estos son límites del protocolo de prueba, no temporizadores ya impuestos por todas las rutas de producción.

Si falta Whisper, espacio, permiso o conectividad: detener antes de generar. Si falla una etapa: conservar log, etapa, comandos con argumentos sin secretos, uso de recursos y archivos parciales; explicar una hipótesis concreta. Corregir y comprobar la unidad afectada. No iniciar otro render sin revisión del diagnóstico y nueva autorización sobre el intento adicional. No sobrescribir ni borrar el original.

El agente ejecutará el trabajo aprobado; el propietario no necesita operar terminales desde Android. Las instrucciones técnicas de abajo sirven como lista de comprobación del agente, no como tareas de programación para el propietario.

## Secuencia acotada

1. Inspeccionar fuente con FFprobe y escuchar/ver muestras de inicio, medio y final. Confirmar que el material permite tres mensajes completos; no prometer una cantidad que el origen no permite.
2. Subir desde Android al entorno de prueba autorizado. Interrumpir la transferencia una vez y reanudar con el mismo archivo; comprobar integridad y que no se repiten fragmentos recibidos. Distinguir esta prueba de la recuperación del worker.
3. Transcribir una vez. Revisar errores en nombres, acentos y términos de los tres candidatos, conservando la transcripción original y las correcciones.
4. Seleccionar tres momentos con límites reales. Revisión previa al render: mensaje propio, comienzo útil, final completo, sin solapamiento temporal ni repetición sustancial de la idea. La puntuación heurística no aprueba la selección.
5. Exportar 9:16 H.264/yuv420p y AAC, 30–60 segundos, subtítulos limpios y movimiento suave. Resolución a acordar: 720×1280 para el primer intento de menor costo, o 1080×1920 si los recursos comprobados lo permiten. No asegurar calidad de encuadre por el tamaño del archivo.
6. Ejecutar validación técnica y revisión editorial por separado. Si algo necesita corrección, registrar el defecto; no dar por terminada la aceptación.
7. Desde Android físico, reproducir cada MP4, cerrar/reabrir la página, descargar y reproducir el archivo descargado. Guardar evidencia de dispositivo/navegador, resultado y notas. Emulación de Pixel/Chrome no reemplaza este paso.

## Evaluación técnica por clip

| Comprobación | Evidencia | Resultado inicial |
|---|---|---|
| MP4 existe y no está vacío | Tamaño real y SHA-256 | PENDIENTE |
| Video H.264/yuv420p | Streams de FFprobe | PENDIENTE |
| Audio AAC presente y audible | Stream y escucha | PENDIENTE |
| Duración y resolución acordadas | Tiempo real frente a intervalo original | PENDIENTE |
| Decodificación completa | FFmpeg -xerror y log | PENDIENTE |
| Duraciones de pistas coherentes | Diferencia de duración ≤0,4 s | PENDIENTE |
| Sin corrupción/pantallas negras accidentales | Decodificación, blackdetect y revisión | PENDIENTE |
| Vista previa y descarga reales | URL de sesión, MIME, Range y archivo guardado | PENDIENTE |

La igualdad de duración de las pistas **no prueba sincronía perceptual**. Subtítulos ASS quemados **no prueban legibilidad**. Ambos se revisan mirando y escuchando el clip.

## Evaluación editorial humana por clip

Responder **APROBADO / CORREGIR**, con una nota verificable para cada punto:

1. El mensaje se entiende sin escuchar el episodio completo.
2. El comienzo plantea algo útil/interesante sin inventar un hook.
3. Hay desarrollo lógico y cierre.
4. No se corta una frase o condición que cambie el significado.
5. El encuadre muestra correctamente al hablante o material necesario.
6. Los subtítulos se leen en una pantalla de teléfono, respetan márgenes y escriben bien nombres/términos.
7. El audio tiene nivel agradable y no contiene cortes bruscos.
8. No aparecen pantallas vacías o negras accidentales.
9. Cortes, movimiento y transiciones resultan naturales; labios, voz y subtítulos coinciden al observarlos.
10. El propietario considera la pieza suficientemente cuidada para enseñarla al prospecto concreto.

Para entregar: todos los puntos aprobados y evaluación firmada con nombre/fecha. Una marca técnica READY conserva **revisión editorial PENDING**. No inventar una aprobación humana ni convertir un score en aprobación.

## Entrega a revisar

| Pieza | Título | Duración | MP4/vista previa/descarga | Informe técnico | Revisión editorial |
|---|---|---|---|---|---|
| Clip 1 | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| Clip 2 | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| Clip 3 | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |

Guardar por encargo: ID y checksum del origen; IDs de trabajos y clips; inicio/fin y duración real; título; URLs válidas dentro de la sesión autorizada; evidencia técnica; texto corregido; aprobación editorial; CPU/RAM/disco/transferencias; tiempo de revisión y entrega. Separar tiempo en cola, procesamiento, corrección y revisión humana.

Prueba económica posterior, únicamente autorizada: presentar esta muestra, ofrecer el paquete acotado y registrar respuesta/pedido/pago. Una descarga correcta demuestra funcionamiento técnico; una muestra aprobada demuestra esa pieza; un pedido pagado demuestra ese pedido. Ninguno permite afirmar ingresos futuros garantizados.

## Revisión del código antes del piloto

- Completar lint, TypeScript y build: pendientes por falta de dependencias/red en esta sesión.
- Prueba de Vercel basada en spawnSync: bloqueada localmente por EPERM; conservar log y verificar en entorno compatible.
- Pruebas de límites editoriales y recuperación: ejecutadas sin render; no prueban Whisper, imágenes o audio reales.
- La prueba antigua de captura larga solo se habilita con CLIPFORGE_RUN_MEDIA_TESTS=true tras autorización específica. No activarla para poner verde la suite.
- Los scripts E2E históricos de tres módulos se conservan, pero no son la aceptación comercial de esta versión y ya no los invoca el CI principal. Otros workflows solo presentes en main/ramas chatgpt no se han activado ni modificado.
