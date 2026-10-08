# ClipForge: primera oportunidad económica

Fecha: 8 de octubre de 2026. Decisión provisional: **RECOMENDAR un piloto asistido de clips; POSPONER SaaS público e historias generativas.**

No hay un pedido pagado, interés de clientes medido, costo real por clip ni evaluación editorial comercial en esta auditoría. Este documento plantea un negocio que se puede probar; no declara que esté validado. La consulta de precios y reseñas actuales está bloqueada por la conexión de red del entorno. La [matriz competitiva](CLIPFORGE_COMPETITORS.md) distingue hipótesis y fuentes pendientes.

## Informe ejecutivo

1. **Construir primero:** entrega asistida de tres clips distintos, de 30–60 segundos, a partir de una grabación propia del cliente. Selección por transcripción, subtítulos limpios, formato vertical, títulos sugeridos, vista previa y MP4 descargable. Revisión humana obligatoria antes de entregar.
2. **Cliente ideal:** podcaster o formador en español que ya publica episodios/clases y quiere reutilizarlos. Priorizar audio claro, contenido hablado y una cámara estable; dejar videos musicales, montajes de turismo y fuentes 4K complejas fuera del primer piloto.
3. **Problema:** localizar fragmentos aprovechables, corregir texto, recortar, adaptar y comprobar cada exportación consume trabajo. Se vende ese resultado revisado. No se vende una predicción de reproducciones.
4. **Competidores:** OpusClip, Klap y Vizard orientan la comparación de extracción; Submagic y Captions, la del acabado. InVideo/Runway ayudan a comparar historias y video generativo. No se han comprobado precios o testimonios actuales en esta sesión.
5. **Diferenciación a probar:** revisión de español, edición discreta, trato directo y entrega sencilla desde Android. El idioma por sí solo no constituye una ventaja defendible. El cliente debe preferir que alguien resuelva la edición por él.
6. **Precios propuestos:** tres clips USD 30; ocho USD 75/mes; doce USD 105/mes. Son propuestas internas. Una ronda de correcciones; cambios de guion, nuevos originales y formatos adicionales se cotizan aparte. Sin cobros ni publicación de la oferta todavía.
7. **Costo propuesto:** presupuestos directos USD 2/5/7; tiempo humano objetivo 45/100/150 minutos. Todos son supuestos sin benchmark de material real. La tabla inferior incluye el trabajo del propietario como costo.
8. **Estado del código:** la rama conserva 12 commits sobre main. Hay subida reanudable, Whisper real, candidatos, subtítulos, validación técnica y descargas. Falta comprobar calidad editorial, encuadre y funcionamiento físico en Android. FIT conserva toda la imagen, con bandas; no sigue al hablante.
9. **Ingeniería:** detener generación audiovisual automática de CI; corregir límites de frases y recuperación; aclarar pantalla; verificar con material autorizado; corregir únicamente defectos observados en ese flujo.
10. **Prueba definitiva:** un video real autorizado produce tres clips entendibles y distintos, con título, duración, informe técnico, revisión editorial, reproducción y descarga en Android. Una transcripción de control o un MP4 sintético no cumple esta prueba.
11. **Riesgos:** Whisper tiny, ideas incompletas aunque terminen en punto, encuadre con bandas, supervisión excesiva, recursos limitados, pérdida de /tmp, red y permisos de herramientas, demanda y precios aún no validados.
12. **Decisión:** recomendar el experimento asistido. No anunciar disponibilidad comercial antes de pasar la prueba real. Historias y edición general quedan pospuestas.

## Elección con los pesos solicitados

Fórmula: vender × 0,30 + rapidez × 0,20 + bajo costo × 0,20 + calidad × 0,15 + captación × 0,15. Escala 0–5. **Todas las puntuaciones son juicios de planificación**, no cifras de ventas ni mediciones de calidad.

| Oportunidad | Vender 30% | Rapidez 20% | Bajo costo 20% | Calidad 15% | Captación 15% | Resultado |
|---|---:|---:|---:|---:|---:|---:|
| A. Clips con revisión humana | 4 | 4 | 4 | 3 | 4 | **3,85** |
| B. Edición automática general | 3 | 3 | 4 | 3 | 3 | **3,20** |
| C. Historias con IA | 2 | 2 | 2 | 2 | 2 | **2,00** |

**A:** vender 4 porque el resultado es concreto y repetible, aunque ClipForge no tenga compradores; rapidez 4 por la reutilización del flujo existente, descontando validación Android pendiente; bajo costo 4 porque usa audio e imagen originales y cómputo local, sin generarlos; calidad 3 porque selección, transcripción y framing aún requieren revisión; captación 4 porque se puede encontrar a creadores que ya publican entrevistas y presentarles una muestra pertinente.

**B:** vender 3 porque «editar profesionalmente» es una promesa amplia y difícil de acotar; rapidez 3 porque cortar silencios no resuelve ritmo, narrativa y selección de planos; bajo costo 4 por FFmpeg y originales; calidad 3 porque cada tipo de video exige decisiones diferentes; captación 3 porque hay que explicar y cotizar cada encargo.

**C:** vender 2 porque no se ha identificado un comprador recurrente específico; rapidez 2 porque faltan guion general, recursos coherentes y voz convincente; bajo costo 2 porque imágenes, voz premium y reintentos pueden elevarlo; calidad 2 porque movimiento de imágenes no equivale a una historia convincente; captación 2 porque un resultado genérico compite con muchas alternativas.

Principal: A asistida. Secundaria futura: corrección de silencios y audio de los clips aprobados, con edición no destructiva. No incorporar nuevos proveedores de imágenes, doblaje, publicación ni analítica. La oferta asistida es un modo de entregar A, no una cuarta oportunidad con demanda demostrada.

## Paquetes y economía por encargo

Límites comerciales propuestos: prueba, un original de hasta 30 minutos; ocho clips, hasta 120 minutos al mes; doce, hasta 180. Máximo actual del código: **1 GiB por archivo**. Usar originales de hasta 1080p y dividir encargos mensuales en fuentes de hasta 30 minutos. Ese límite de duración es una condición de la propuesta, todavía no una validación automática del backend. Clips de 30–60 s; sin publicación, traducción, B-roll generado ni revisiones ilimitadas. Si no hay suficientes momentos apropiados, se informa antes de prometer el paquete.

Modelo conservador de planificación: costo equivalente de CPU **USD 0,60/h**, no una tarifa consultada de Render; reserva de almacenamiento, transferencia y reprocesamiento. Una hora de trabajo del propietario vale **USD 10**, supuesto que debe ajustarse. Los presupuestos de CPU incluyen transcripción, escaneo de audio, render y comprobaciones; no se han medido en hardware real.

| Paquete | Precio | CPU estimada total | Tope presupuestado de cómputo/archivos | Revisión y operación humanas | Costo humano a USD 10/h | Margen bruto estimado incluyendo trabajo | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| 3 clips | 30 | 0,5–1,25 h | 2 | 45 min | 7,50 | **20,50** | 68,3% |
| 8 clips/mes | 75 | 2–5 h | 5 | 100 min | 16,67 | **53,33** | 71,1% |
| 12 clips/mes | 105 | 3–7,5 h | 7 | 150 min | 25,00 | **73,00** | 69,5% |

Estos márgenes preceden gastos fijos, impuestos y captación. Reservando además **3% del precio + USD 0,30** para cobro —colchón hipotético, no tarifa de una pasarela—, la contribución sería USD 19,30/50,78/69,55. No se ha contratado ni configurado una pasarela.

| Gastos fijos hipotéticos/mes | Paquetes de 3 necesarios | Paquetes de 8 necesarios | Paquetes de 12 necesarios |
|---|---:|---:|---:|
| USD 10 | 1 | 1 | 1 |
| USD 25 | 2 | 1 | 1 |
| USD 50 | 3 | 1 | 1 |

Fórmula: techo(gastos fijos / contribución por paquete). No son facturas actuales. Si los fijos fueran cero, no hay un mínimo para cubrirlos, pero el tiempo humano sigue teniendo costo. No mezclar meses y paquetes sin contar carga de trabajo y fuentes incluidas.

**Archivos:** a 4 Mbit/s, 30 minutos de video ocupan aproximadamente 900 MB, más el audio; verificar el tamaño real contra 1 GiB. WAV mono 16 kHz/16 bits añade aproximadamente 57,6 MB por 30 minutos. Tres clips de 45 s a 3 Mbit/s de video + 160 kbit/s de audio serían unos 53,3 MB; ocho, 142,2 MB; doce, 213,3 MB. Son cálculos por bitrate, no tamaños medidos: CRF cambia según la escena. Reservar aproximadamente 4 GiB de disco temporal por encargo activo para fragmentos, original, audio y salida. Mantener un solo trabajo pesado simultáneo durante el piloto. No se ha comprobado que el servicio actual disponga de ese disco o RAM.

**IA:** el camino seleccionado usa Whisper local y heurísticas: costo de API previsto USD 0; la CPU no es gratuita por definición. Tiny puede exigir correcciones caras. Antes de pagar por otro modelo, medir errores y minutos de corrección. Si un proveedor fuera necesario, calcular minutos de origen × tarifa vigente, sumar análisis y reintentos y pedir autorización. No citar precios de API sin consulta.

**Regla para rechazar encargos:** contribución después de trabajo humano y reserva de cobro menor al 50% del precio, o costo directo fuera de USD 2/5/7, obliga a reducir alcance, subir precio o no aceptar. A USD 10/h, superar aproximadamente 70/180/250 minutos humanos por paquete rompería ese objetivo. Si tres clips toman dos horas, no venderlos por USD 20. Si la hora del propietario vale USD 20, el modelo debe recalcularse; no esconder ese costo como «gratis».

## Tres segmentos para validar

| Segmento | Problema y frecuencia | Presupuesto probable —hipótesis— | Dónde encontrar prospectos | Demostración y primera oferta |
|---|---|---|---|---|
| Podcasters/entrevistadores pequeños | Episodio semanal o quincenal; poco tiempo para seleccionar y subtitular | USD 30 de prueba; USD 75–105/mes si publican regularmente | Canales públicos de YouTube con entrevistas recientes; comunidades de podcast con permiso del administrador; presentaciones de conocidos | Tres ideas distintas de un episodio suyo autorizado; prueba USD 30 |
| Formadores y creadores de cursos | Convertir explicaciones de clases en piezas que se entiendan fuera del curso; semanal o por lanzamiento | USD 30 de prueba; USD 75–120/mes como hipótesis | Profesores que ya publican clases/webinars, asociaciones y comunidades educativas donde se permitan ofertas | Tres explicaciones autocontenidas, términos y nombres corregidos; prueba USD 30 |
| Consultores y negocios con charlas grabadas | Extraer consejos o respuestas que expliquen sus servicios; mensual o por campaña | USD 30–40 de prueba; USD 100–150 por encargo acotado, hipótesis | Webinars de negocios, asociaciones empresariales, agencias que ya atienden esos clientes | Tres consejos útiles sin afirmaciones inventadas; presupuesto según original |

Podcasters: «Estoy preparando un servicio que convierte entrevistas en tres clips con subtítulos revisados en español. Si te interesa, podemos revisar una muestra hecha con material autorizado. La prueba propuesta cuesta USD 30 y no promete reproducciones.» Objeciones: ya uso una herramienta, quiero corregir títulos, temo cortes de contexto. Razón a probar: menos revisión y archivos terminados. Medir si acepta ver una muestra, explica un problema actual y considera una propuesta concreta.

Formadores: «Podemos reutilizar una clase tuya en tres explicaciones breves que se entiendan por sí solas. Revisamos vocabulario y el final de cada idea antes de entregar.» Objeciones: nombres técnicos mal transcritos, pérdida de rigor, permisos del curso. Medir aprobación de contenido, voluntad de pagar USD 30 y frecuencia de nuevas clases.

Negocios/consultores: «Si ya tienes una charla grabada, podemos preparar tres consejos en vertical con texto revisado y MP4 descargable. El alcance y las correcciones se acuerdan antes.» Objeciones: necesito anuncios y B-roll, identidad visual, más revisiones. No ofrecer montaje promocional completo al precio de extracción. Validar si el contenido hablado basta para su objetivo.

No se ha creado una lista de personas ni se ha contactado a nadie. Tras aprobación del propietario: localizar diez prospectos compatibles en un solo segmento; contactar individualmente por un canal donde esté permitido, ofrecer demostración solo a quienes acepten, registrar respuesta exacta y propuesta. Diez es un tamaño inicial de experimento, no una predicción de conversión. No requiere que el propietario aparezca ante una cámara.

Proceso: **contacto autorizado → muestra autorizada → alcance y precio → entrega revisada → opinión concreta → propuesta recurrente**. Registrar qué clip usaría, qué cambiaría, cuánto tiempo ahorró y si repetiría un pedido al mismo precio. «Me gusta» no demuestra intención de pago; el primer pago recibido demuestra un pedido, no toda la demanda del mercado.

## Plan mínimo de ingeniería y lanzamiento

1. Preparado: CI sin generación automática; selección estricta por límites de frases; recuperación de metadatos; entrada principal de clips y prevención de origen anterior al elegir otro archivo.
2. Pendiente: dependencias, lint, TypeScript y build en un entorno con red; confirmar configuración real de Render antes de actualizar la rama si pudiera desplegar automáticamente. No fusionar ni desplegar.
3. Pendiente: [prueba autorizada](CLIPFORGE_ACCEPTANCE.md) con fuente real. Medir transcripción, tiempo por etapa, pico de RAM, CPU, espacio, clips y revisión. No agregar infraestructura antes de conocer el cuello de botella.
4. Pendiente: revisar cada clip. Corregir título, texto y límites con el editor existente. FIT no constituye reencuadre del hablante: verificar si la composición sirve al cliente; si no, ajustar encuadre con revisión o posponer la entrega. El módulo de zoom por intervalos de voz no detecta caras.
5. Pendiente: demostrar reproducción, reanudación, estado y descarga desde Android físico. Galería únicamente con estas piezas aprobadas y etiqueta «Ejemplo autorizado»; todavía no hay piezas comerciales para poblarla.
6. Pendiente: lanzar el pequeño experimento de venta únicamente con aprobación. Sin nuevas redes sociales, pasarelas, proveedores ni paneles.

## Indicadores que se deben registrar

| Indicador | Estado actual | Evidencia requerida |
|---|---|---|
| Costo real por clip | No medido | CPU, archivos y transferencias medidos; factura si hay API; costo humano aparte |
| Tiempo de procesamiento | No medido con fuente real | Inicio/fin por etapa; separar cola de procesamiento |
| Porcentaje de trabajos completados | No hay muestra comercial | Intentos, completados y errores sobre el mismo conjunto, sin ocultar fallos |
| Calidad editorial | Pendiente | Tres revisiones firmadas, decisiones y correcciones |
| Minutos de revisión humana | No medidos | Cronómetro, selección/corrección/revisión/entrega por separado |
| Entrega desde Android físico | Pendiente | Dispositivo/navegador, reproducción y archivo guardado |
| Interés y pedidos | Sin contactos ni pagos | Conversaciones autorizadas y pedido/pago verificable |
| Margen y recurrencia | Solo modelo | Costos reales de un pedido y posterior repetición pagada |

Conservar originales. Proponer retención y respaldo antes de manejar pedidos recurrentes; no borrar originales para ahorrar espacio sin autorización. `/tmp` no ofrece entrega durable después de reemplazar una instancia. No subir recursos de Render para resolver un fallo que todavía no se ha medido.
