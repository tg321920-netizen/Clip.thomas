# Recuperación de proyectos de edición

Implementación de desarrollo posterior a la candidata inmutable 761e291.
No se desplegó ni activó en producción.

El respaldo LIVE existente está ligado a sesiones, segmentos TS y una allowlist
de checkpoints LIVE. No recupera las subidas WebM/MOV ni las colas manuales.
ProjectRecoveryService reutiliza R2ObjectStore, la exclusión CAS y el cupo global
de ClipLibraryService para cubrir ese caso sin alterar el monitor.

## Activación en un ensayo autorizado

- CLIPFORGE_MEDIA_STORAGE_PROVIDER=r2 y las cuatro variables R2 privadas existentes.
- CLIPFORGE_PROJECT_BACKUP_ENABLED=true.
- CLIPFORGE_PROJECT_BACKUP_AUTO=true (opcional; false permite solo solicitudes).
- npm run worker:project-backup para un supervisor distinto del render.

El runtime gratuito arranca ese worker separado únicamente con el flag y R2.
La interfaz «Respaldo privado de proyectos» solicita copias y recupera proyectos
que faltan en la instancia. Los controles permanecen detrás de la autenticación
existente. Guardar un intervalo no significa que ya esté archivado: hay que
consultar la fecha de la última copia confirmada.

Se guardan original, proyecto, transcripción/análisis incluidos en sus metadatos,
intervalos, cola de render/transcripción/análisis y MP4 completos. Se excluyen
credenciales, leases, operaciones de publicación, cabeceras y queries firmadas.
Los originales idénticos se direccionan por SHA-256 y se reutilizan también los
originales LIVE/VOD existentes. Los MP4 ya archivados se referencian sin copiarlos.
La limpieza de clips protege resultados referenciados por checkpoints actuales.
No se borran originales, checkpoints anteriores ni respaldos.

La recuperación descarga en staging, comprueba todos los hashes y valida los MP4,
rechaza rutas peligrosas/conflictos, publica el proyecto al final y deja los
trabajos incompletos en WAITING_RESOURCE. Se reanudan explícitamente desde el editor.
No restaura locks ni inicia modelos, publicación o captura. Un MP4 completo se
reutiliza; un render interrumpido no se considera terminado.

El límite es 1 GiB por archivo original, 2 GiB por recuperación y el cupo global
R2 de 8 GB. La restauración exige espacio para staging y 128 MiB de margen.
No es un backup de todo el servidor ni de transferencias todavía incompletas.
Los cambios posteriores al último checkpoint confirmado pueden perderse.
R2 no evita que Render suspenda sus procesos ni ejecuta workers por sí mismo.

CLI para una raíz nueva, con workers detenidos:

    npm run project:restore -- --project=UUID --target=/ruta/nueva --workers-paused

## Evidencia real del 26 de octubre de 2026

artifacts/project-recovery/real-20261026/evidence.json: proyecto autorizado
d4f37a11-072d-4274-9665-33be9a8bb409 restaurado desde R2 a un directorio vacío.
Original 153431864 bytes, SHA a53c477728d61778ceda6b7b33a7c86b6ab479333d6d9abc09e4e96e7dd08783.
MP4 5878840 bytes, SHA e42218c895e8dc54fb3f6c04b26a4481f1ee6dc714f0e893dc786e109852ddd6.
Intervalo 50–80 s y resultado READY conservados. Cero renders y cero escrituras
de medios: solo metadatos R2. La repetición reutilizó el mismo checkpoint.
Es pérdida de filesystem simulada con R2 real; no un reinicio de Render ni una
prueba en Android físico.
