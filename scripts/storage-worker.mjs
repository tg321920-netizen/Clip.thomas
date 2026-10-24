import { listProjectFiles } from '../lib/project-files.mjs';
import { ClipLibraryService, getClipLibraryStatus } from '../services/storage/ClipLibraryService.mjs';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getStorageRoot, resolveStoragePath } from '../lib/storage-paths.mjs';
import { createHash } from 'node:crypto';

if (!getClipLibraryStatus().configured) process.exit(0);
const service = new ClipLibraryService();
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(await service.cleanup({ dryRun: true })));
  process.exit(0);
}
const once = process.argv.includes('--once');
const receiptPath = path.join(getStorageRoot(), 'cloud-clip-receipts.json');
const destination = createHash('sha256').update(`${process.env.CLIPFORGE_R2_ACCOUNT_ID}/${process.env.CLIPFORGE_R2_BUCKET}`).digest('hex');
let receipts;
try { receipts = JSON.parse(await readFile(receiptPath, 'utf8')); } catch { receipts = {}; }
if (receipts.destination !== destination || !receipts.clips || typeof receipts.clips !== 'object') receipts = { destination, clips: {} };
receipts.failures ||= {};
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
do {
  try {
    if (once && Date.now() - Number(receipts.sweptAt || 0) < 60000) break;
    // The server-side library remains readable even when local projects vanish.
    if (Date.now() - Number(receipts.cleanedAt || 0) >= 3600000) {
      await service.cleanup(); receipts.cleanedAt = Date.now();
    }
    const projects = await listProjectFiles(1000);
    for (const project of projects) for (const clip of project.clips || []) {
      if (stopping) break;
      if (clip.render?.archiveEligible !== true || clip.status !== 'READY') continue;
      const key = `${project.id}/${clip.id}`;
      try {
        const file = await stat(resolveStoragePath(clip.render.relativePath));
        const fingerprint = `${file.ino}/${file.size}/${file.mtimeMs}`;
        const saved = receipts.clips[key];
        if (saved?.fingerprint === fingerprint && Date.now() - saved.checkedAt < 86400000) continue;
        const entry = await service.archive(project, clip);
        if (entry) { receipts.clips[key] = { fingerprint, checkedAt: Date.now(), archiveId: entry.id }; delete receipts.failures[key]; }
      }
      catch (error) {
        if (error.code === 'ENOENT' && receipts.clips[key]?.archiveId) { delete receipts.failures[key]; continue; }
        receipts.failures[key] = { code: error.code || 'STORAGE_UNAVAILABLE', at: Date.now() };
        console.warn('[clip-storage]', { code: error.code || 'STORAGE_UNAVAILABLE', message: 'No se confirmó el guardado. Se conserva el archivo local para reintentar.' });
      }
    }
    receipts.lastError = null;
  } catch (error) {
    receipts.lastError = { code: error.code || 'STORAGE_UNAVAILABLE', at: Date.now() };
    console.warn('[clip-storage]', { code: error.code || 'STORAGE_UNAVAILABLE', message: 'Mantenimiento detenido; no se completaron todas las operaciones.' });
  }
  receipts.sweptAt = Date.now();
  try {
    await mkdir(getStorageRoot(), { recursive: true });
    const temporary = `${receiptPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(receipts)); await rename(temporary, receiptPath);
  } catch { console.warn('[clip-storage] No se pudo guardar el estado de los reintentos.'); }
  if (!once && !stopping) await new Promise(resolve => setTimeout(resolve, 60000));
} while (!once && !stopping);
