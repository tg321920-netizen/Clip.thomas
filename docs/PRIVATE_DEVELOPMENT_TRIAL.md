Actualización del 28 de octubre: la propuesta vigente usa
`render.audit-preview.yaml` y la nueva referencia congelada
`preview/clipforge-master-20261028.1`. Consultar
[MASTER_MISSION_20261028.md](MASTER_MISSION_20261028.md).
No se creó ni desplegó el servicio. Las referencias anteriores se conservan.

# Ensayo privado preparado, sin crear servicios

Actualización del 27 de octubre: consultar `STUDIO_COMPLETION_20261027.md` y
`render.audit-preview.yaml` para la candidata nueva .1 del 27. Las candidatas
.4, .2 y estable del 26 y las referencias históricas de este documento se
conservan sin moverlas; ninguna de ellas acredita un despliegue del ensayo.
La operación propuesta vigente usa `preview/clipforge-studio-completion-20261027.1`.

No hubo nueva consulta administrativa a Render durante esta fase. RENDER_API_KEY
sigue siendo una dependencia externa, no un motivo para detener las mejoras.
Cuando la conexión esté disponible, el primer uso será diagnóstico GET.
Desplegar, crear un servicio o cambiar producción requiere otra aprobación.

## Dos versiones independientes

- Candidata anterior: etiqueta inmutable clipforge-stable-candidate-20261026.1,
  commit 761e291d72426bac647d513ac7e08ad75dcad9f1.
- Integración de desarrollo: rama work/clipforge-functional-review-20261025-5d025fe,
  versión de código 2026.10.26.2-dev. Revisar su SHA final antes de desplegar.
- Candidata del ensayo: etiqueta nueva clipforge-development-candidate-20261026.2
  y rama congelada preview/clipforge-android-20261026.2. Ambas deben señalar el
  mismo SHA revisado. No moverlas cuando continúe el desarrollo.
  SHA fijado: b6936e610e8cd0fafe05d4d326f57db9537b7d24.
  La aplicación coincide con el código aprobado en 986ab90; la preparación nueva
  cambia únicamente la referencia de despliegue y documentación.
- render.stable-preview.yaml no se alteró.
- render.development-preview.yaml propone OTRO servicio, autoDeployTrigger off,
  propietario autenticado, publicación/agente/captura desactivados y R2 privado.
  Mantiene el conjunto de funciones manuales del perfil stable, sin promover el
  nuevo código a la candidata anterior.

## Operación concreta propuesta para una aprobación posterior

Crear un único ensayo clipforge-development-preview, plan free, Node 22.23.4,
desde el SHA de clipforge-development-candidate-20261026.2 y su rama congelada.
Comprobar nuevamente la igualdad de tag/rama/SHA antes de crear el servicio.
Usar la plantilla de
desarrollo, sin actualizar los dos sitios existentes ni habilitar auto deploy.
No ejecutar todavía esa operación.

Se trata de una URL web accesible por Internet con autenticación del propietario,
no de una red privada de Render. El contenido y los archivos siguen protegidos.
El servicio no existe todavía; no se debe anticipar una URL.

## Auditoría de preparación del 26 de octubre

La plantilla pasó el esquema JSON oficial de Render y la revisión de flags,
Node 22, un encoder/hilo, R2 y autenticación. No se repitieron builds o renders:
la aplicación no cambió respecto del código ya comprobado.

Los dos endpoints de salud existentes respondieron 200. El principal conserva
e1045dfae859e773ac65f4b12b1ef1ed10e20a3a y su login responde 200; el otro no
informa SHA. No se comprobó allí edición con credenciales de propietario.

RENDER_API_KEY no está vinculada al runtime y su requisito privado figura sin
valor guardado. No se enviaron peticiones administrativas ni nuevos 401.
La conexión permite primero GET de servicio/despliegues; no autoriza creación.
Después del diagnóstico se requiere aprobación específica del ensayo.

El repositorio se comprobó público y no archivado. Para un ensayo independiente
puede utilizarse la cuenta actual de Render del propietario: no es obligatorio
recuperar la cuenta del servicio antiguo. El primer diagnóstico debe identificar
la cuenta/workspace mediante GET autorizado. Que el servicio antiguo no sea
accesible en otra cuenta no demuestra que la clave sea inválida.

Actualización de acceso, 26 de octubre a las 21:16 UTC: ambos sitios respondieron
200 en salud y login, y 401 en proyectos sin sesión. El principal sigue en
e1045dfae859e773ac65f4b12b1ef1ed10e20a3a; el secundario no informa SHA.
No informan el heartbeat nuevo: no se deduce que sus workers estén detenidos.
Hubo 503 iniciales en login/proyectos durante la primera consulta concurrente;
tras esperar la respuesta de salud se obtuvo 200/401. Eso es compatible con un
arranque inicial, pero no demuestra su causa sin acceso administrativo.

Se corrigió scripts/deployed-runtime-check.mjs: antes aceptaba cualquier versión
no vacía con publicación OFF como reparación desplegada. Ahora exige SHA completo
exacto, medios disponibles, heartbeat observado, login y API protegida. Usa solo
GET públicos mediante el proxy existente y guarda evidencia sin secretos ni
sobrescribir la anterior. Aun si pasa, el editor queda NOT_VERIFIED hasta la prueba
autenticada de subida/render/descarga. Uso por el operador:

    node scripts/deployed-runtime-check.mjs --url=https://HOST --expected-commit=SHA_COMPLETO

Diez regresiones específicas cubren versión antigua, worker no observado,
arranque inicial, acceso sin sesión, respuestas inválidas y redacción de datos.
Las evidencias públicas actuales están en artifacts/android-activation/
{studio,runtime}-warmed-preflight-20261026.json. La candidata b6936e6 y la etiqueta
anterior 761e291 se conservan sin cambios. RENDER_API_KEY sigue sin vincularse:
cero consultas administrativas, despliegues o nuevos renders en esta comprobación.

El plan gratuito ofrece recursos limitados y filesystem efímero. Se propone
720×1280 por defecto, un codificador/hilo y respaldo separado. Un perfil local equivalente completó un recorte 720p de 30 s en 304,908 s desde encolar hasta READY
y 274,406 MiB, sin el worker R2. El propietario puede elegir 1080p; su viabilidad requiere medir memoria y CPU del servidor
completo. HIGH/1080p no está certificado para 512 MiB. Una medición local de RSS
individual no sustituye esa verificación. No se promete trabajo permanente.

## Variables y comandos

Valores privados que debe recibir exclusivamente el servidor:
CLIPFORGE_OWNER_ACCESS_KEY, CLIPFORGE_SESSION_KEY y las variables existentes
CLIPFORGE_R2_ACCOUNT_ID, CLIPFORGE_R2_BUCKET, CLIPFORGE_R2_ACCESS_KEY_ID,
CLIPFORGE_R2_SECRET_ACCESS_KEY. Nunca copiarlos a Description, Git o el navegador.
RENDER_API_KEY administra el hosting: no debe entregarse al proceso web.
No se necesita Z.ai ni OAuth social para recortar manualmente.

Construcción: bash scripts/render-native-free-build.sh.
Arranque: node scripts/render-runtime-free.mjs.
Chequeo completo de binarios: node scripts/render-runtime-free.mjs --check.
Ese chequeo incluye Whisper/TTS. Para el recorte manual, FFmpeg/FFprobe y los
workers son obligatorios; la ausencia de modelos no acredita un fallo del editor.
Salud: GET /api/health confirma versión, FFmpeg/FFprobe y supervisor observado.
GET /api/projects/recovery autenticado informa el worker de respaldo y errores.

El respaldo se habilita con CLIPFORGE_PROJECT_BACKUP_ENABLED=true. La copia
automática usa hasta tres intentos con backoff por estado de proyecto; después
espera un cambio o reintento explícito. No depende del ciclo serial del editor.
Un fallo de ese worker opcional no apaga el editor manual.
CLIPFORGE_STORAGE_RETENTION_ENABLED=false mantiene la limpieza automática apagada.

## Aceptación externa todavía pendiente

Después del despliegue autorizado, comprobar desde fuera: login, API protegida,
subida real, preview, recorte, progreso, cierre de pestaña, MP4 y descarga. Elegir
primero un archivo corto autorizado. Medir 720p y después 1080p si cabe, conservar
hashes, tiempo real y memoria del conjunto de procesos.

Verificar copia confirmada antes de probar reinicio de una instancia de ensayo.
Restaurar desde el panel, comprobar hashes, intervalos y colas pausadas. No reiniciar
producción ni borrar originales para simular un fallo. El propietario completa
la prueba en Android físico; Chromium emulado se informa por separado.

## Rollback

1. Mantener intactos el servicio anterior, su commit, secretos y almacenamiento.
2. Pausar nuevos trabajos del ensayo y confirmar los respaldos pendientes.
3. Volver al despliegue anterior revisado en el hosting, sin force-push ni mover tags.
4. Conservar R2 y datos locales. No restaurar un checkpoint viejo sobre trabajo nuevo.
5. No entregar trabajos horizontales pendientes a un worker anterior que ignore
   esos ajustes. Mantenerlos pausados o terminarlos con el código de desarrollo.

El disco gratis no conserva originales y colas por sí solo. Solo se recupera lo
archivado en el último checkpoint confirmado. Subidas incompletas y cambios
posteriores siguen expuestos. R2 no ejecuta workers ni impide una suspensión.
