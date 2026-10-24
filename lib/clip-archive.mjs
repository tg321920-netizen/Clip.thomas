import archiver from 'archiver';
import { stat } from 'node:fs/promises';
import { resolveStoragePath } from './storage-paths.mjs';

/** MP4 is already compressed. Stream a stored ZIP without buffering videos. */
export async function createClipArchive(project) {
  const clips = project?.clips?.filter(clip => clip.status === 'READY' && clip.render?.relativePath) || [];
  if (!clips.length) throw new Error('No hay clips terminados para descargar.');
  const files = [];
  for (const [index, clip] of clips.entries()) {
    const filename = resolveStoragePath(clip.render.relativePath);
    const info = await stat(filename);
    if (!info.isFile() || info.size <= 0) throw new Error('Un clip ya no está disponible en el almacenamiento.');
    files.push({ filename, name: `clip-${String(index + 1).padStart(2, '0')}.mp4` });
  }
  const archive = archiver('zip', { store: true });
  // Defer writes so the HTTP consumer can attach its error/backpressure handling.
  queueMicrotask(() => {
    for (const file of files) archive.file(file.filename, { name: file.name });
    void archive.finalize().catch(error => archive.destroy(error));
  });
  return archive;
}
