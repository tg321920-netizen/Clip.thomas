import { createHash, randomUUID } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chatEvidenceForWindow } from '../analysis/ChatActivityService.mjs';
import { clipMediaOrigin } from '../../lib/clip-media-origin.mjs';
import { isProjectId } from '../../lib/project-id.mjs';
import { getStorageRoot } from '../../lib/storage-paths.mjs';
import { signPrivateClip } from './SignedMediaAccess.mjs';
import { parseByteRange } from '../../lib/http-range.mjs';
import { R2ObjectStore, readR2Config, storageError } from './R2ObjectStore.mjs';
import { loadProjectFile, updateProjectFile } from '../../lib/project-files.mjs';

const PREFIX = 'clipforge-managed/v1/';
const RECORDS = `${PREFIX}records/`;
const EXPIRED = `${PREFIX}expired/`;
const LOCK = `${PREFIX}control/writer.json`;
const DAY = 86400000;
const MAX_FILE = 512 * 1024 * 1024;
const validId = id => /^[a-f0-9]{64}$/.test(String(id));
const recordKey = id => `${RECORDS}${id}.json`;
const mediaKey = id => `${PREFIX}media/${id}.mp4`;

export function getClipLibraryStatus(env = process.env) {
  try {
    const config = readR2Config(env);
    return { configured: Boolean(config), provider: config ? 'R2' : 'LOCAL', retentionDays: 30,
      message: config ? 'Los clips nuevos se guardarán en la nube por 30 días. Marca Conservar para protegerlos.' : 'Guardado en nube pendiente de configurar. Los archivos locales dependen de esta instancia.' };
  } catch { return { configured: false, provider: 'R2', retentionDays: 30, message: 'Falta completar la configuración del almacenamiento privado.' }; }
}

export async function readClipArchiveHealth({ root = getStorageRoot(), env = process.env } = {}) {
  const config = readR2Config(env);
  if (!config) return { pendingCount: 0 };
  try {
    const raw = await readFile(/* turbopackIgnore: true */ path.join(root, 'cloud-clip-receipts.json'), 'utf8');
    if (raw.length > 2_000_000) throw new Error('oversized receipt');
    const receipts = JSON.parse(raw);
    const destination = createHash('sha256').update(`${config.accountId}/${config.bucket}`).digest('hex');
    if (receipts.destination !== destination) return { pendingCount: 0 };
    const pendingCount = Object.keys(receipts.failures || {}).length;
    return { pendingCount, warning: pendingCount ? `${pendingCount} clips necesitan reintentar el guardado. Los archivos locales se conservan.` : receipts.lastError ? 'El último mantenimiento del almacenamiento falló. Se reintentará automáticamente.' : undefined };
  } catch (error) {
    return { pendingCount: 0, warning: error.code === 'ENOENT' ? undefined : 'No se pudo consultar el estado de los guardados pendientes.' };
  }
}

function validateRecord(record, id) {
  if (!validId(id) || record?.id !== id || record?.managedBy !== 'clipforge-v1' || !isProjectId(record.projectId) || !isProjectId(record.clipId)
    || record.objectKey !== mediaKey(id) || !/^[a-f0-9]{64}$/.test(record.sha256) || typeof record.objectEtag !== 'string' || !['READY', 'DELETED'].includes(record.status)
    || typeof record.keep !== 'boolean' || !Number.isFinite(Date.parse(record.expiresAt)) || !Number.isFinite(Date.parse(record.createdAt))
    || createHash('sha256').update(`${record.projectId}/${record.clipId}/${record.sha256}`).digest('hex') !== id
    || !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes <= 0 || record.sizeBytes > MAX_FILE) {
    throw storageError('STORAGE_INVALID', 'Hay un registro inválido. La limpieza se detuvo para proteger los archivos.');
  }
  return record;
}

export class ClipLibraryService {
  constructor({ store, now = Date.now, maxBytes = 8_000_000_000 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 8_000_000_000) throw new Error('El cupo de la biblioteca debe ser como máximo 8 GB.');
    this.store = store || new R2ObjectStore(); this.now = now; this.maxBytes = maxBytes;
  }
  // Server-only shared CAS lease/quota for original-source archival. Capture
  // never enters this lease; it is held solely by the archive worker.
  async withStorageWriter(action) { return this.#withWriter(action); }
  async assertStorageQuota(extra, signal) { return this.#assertQuota(extra, signal); }
  async #read(id, signal) {
    if (!validId(id)) throw storageError('STORAGE_NOT_FOUND', 'Clip no encontrado.');
    const result = await this.store.getJson(recordKey(id), { signal });
    return result ? { record: validateRecord(result.value, id), etag: result.etag } : null;
  }
  async #all(signal) {
    const keys = await this.store.list(RECORDS, { signal });
    const entries = [];
    // Bounded concurrency and fail closed on corrupt records.
    for (let index = 0; index < keys.length; index += 8) {
      const batch = await Promise.all(keys.slice(index, index + 8).map(async item => {
        const id = item.key.slice(RECORDS.length, -5);
        if (!item.key.endsWith('.json') || !validId(id)) throw storageError('STORAGE_INVALID', 'La biblioteca contiene un registro desconocido.');
        return this.#read(id, signal);
      }));
      entries.push(...batch.filter(Boolean));
    }
    return entries;
  }
  async #withWriter(action) {
    const deadline = this.now() + 20 * 60 * 1000;
    const previous = await this.store.getJson(LOCK);
    if (previous && (!Number.isFinite(previous.value?.expiresAt) || !(previous.value.owner === null || typeof previous.value.owner === 'string'))) throw storageError('STORAGE_INVALID', 'El registro de exclusión no es válido. Se detuvo el mantenimiento.');
    if (previous?.value?.owner && previous.value.expiresAt > this.now()) throw storageError('STORAGE_BUSY', 'Se está guardando otro archivo. Reintenta en unos momentos.');
    const owner = randomUUID();
    const lease = await this.store.putJson(LOCK, { owner, expiresAt: deadline }, previous ? { ifMatch: previous.etag } : { ifAbsent: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000); timer.unref?.();
    try { return await action(controller.signal); }
    finally {
      clearTimeout(timer);
      // CAS prevents a delayed writer from releasing someone else's lease.
      await this.store.putJson(LOCK, { owner: null, expiresAt: 0 }, { ifMatch: lease.etag }).catch(() => {});
    }
  }
  async #assertQuota(extra, signal) {
    // Include every object in this bucket, not only ClipForge's objects.
    const objects = await this.store.list('', { signal });
    const used = objects.reduce((sum, item) => sum + Number(item.size || 0), 0);
    if (!Number.isFinite(used) || used + extra > this.maxBytes) throw storageError('STORAGE_QUOTA', 'Se alcanzó el límite de almacenamiento. El clip local se conserva; los protegidos no se borran.');
    return used;
  }
  async archive(project, clip, {root=getStorageRoot()} = {}) {
    // Opt in only new RenderService results. Never adopt/delete legacy files.
    if (clip?.render?.archiveEligible !== true || clip.status !== 'READY' || clip.render.validation?.valid !== true) return null;
    const clipPath = clip.render.relativePath === `clips/${project?.id}/${clip.id}/render.mp4`;
    const storyPath = project?.story && clip.candidateId === 'story' && clip.render.relativePath === `stories/${project.id}/render.mp4` && project.source?.relativePath === clip.render.relativePath;
    if (!isProjectId(project?.id) || !isProjectId(clip.id) || !(clipPath || storyPath)) throw storageError('STORAGE_INVALID', 'La ruta del clip no corresponde a su proyecto.');
    // The exact project/clip path was validated above. A recovery worker can
    // archive another explicit storage root without mutating process.env.
    const file = await open(/* turbopackIgnore: true */ path.join(path.resolve(root),clip.render.relativePath), 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size <= 0 || info.size > MAX_FILE) throw storageError('STORAGE_LIMIT', 'El clip supera el límite de 512 MB para guardarlo en la nube.');
      const sha = createHash('sha256'), md5 = createHash('md5');
      for await (const chunk of file.createReadStream({ autoClose: false, start: 0 })) { sha.update(chunk); md5.update(chunk); }
      const sha256 = sha.digest('hex'), contentMd5 = md5.digest('base64');
      const id = createHash('sha256').update(`${project.id}/${clip.id}/${sha256}`).digest('hex');
      return await this.#withWriter(async signal => {
        const tombstone = await this.store.getJson(`${EXPIRED}${id}.json`, { signal });
        if (tombstone) {
          const expired = validateRecord(tombstone.value, id);
          if (expired.status !== 'DELETED' || expired.keep) throw storageError('STORAGE_INVALID', 'El marcador de vencimiento no es válido.');
          return this.publicEntry(expired);
        }
        const existing = await this.#read(id, signal);
        // An expired version stays expired: maintenance cannot resurrect it.
        if (existing?.record.status === 'DELETED') return this.publicEntry(existing.record);
        if (existing && !existing.record.keep && Date.parse(existing.record.expiresAt) <= this.now()) return this.publicEntry({ ...existing.record, status: 'DELETED' });
        const remote = await this.store.head(mediaKey(id), { signal });
        const origin = existing?.record.origin?.kind === 'TECHNICAL_TEST' ? existing.record.origin : clipMediaOrigin(project);
        if (existing && remote?.size === info.size && remote.metadata?.sha256 === sha256 && remote.etag === existing.record.objectEtag) {
          if(!existing.record.context || JSON.stringify(existing.record.origin)!==JSON.stringify(origin)){const updated={...existing.record,origin,context:clipContext(project,clip)};await this.store.putJson(recordKey(id),updated,{ifMatch:existing.etag,signal});return this.publicEntry(updated);}
          return this.publicEntry(existing.record);
        }
        if (!remote) {
          await this.#assertQuota(info.size + 8192, signal);
          const stream = file.createReadStream({ autoClose: false, start: 0 });
          try { await this.store.put(mediaKey(id), stream, { length: info.size, type: clip.render.mediaKind === 'AUDIO' ? 'audio/mp4' : 'video/mp4', md5: contentMd5, metadata: { sha256, managed: 'clipforge-v1' }, ifAbsent: true, signal }); }
          finally { stream.destroy(); }
        } else {
          // A previous attempt may have uploaded the object but lost its index.
          // Verify its actual bytes before adopting it; metadata alone is not proof.
          const recovered = await this.store.get(mediaKey(id), { ifMatch: remote.etag, signal });
          const digest = createHash('sha256'); let recoveredSize = 0;
          if (!recovered) throw storageError('STORAGE_INTEGRITY', 'La copia cambió durante la recuperación.');
          for await (const chunk of recovered.body) {
            recoveredSize += chunk.length;
            if (recoveredSize > info.size) { recovered.body.destroy(); throw storageError('STORAGE_INTEGRITY', 'La copia guardada tiene un tamaño distinto.'); }
            digest.update(chunk);
          }
          if (recoveredSize !== info.size || digest.digest('hex') !== sha256) throw storageError('STORAGE_INTEGRITY', 'La copia guardada no coincide con el render local.');
        }
        const verified = await this.store.head(mediaKey(id), { signal });
        if (verified?.size !== info.size || verified.metadata?.sha256 !== sha256) throw storageError('STORAGE_INTEGRITY', 'No se confirmó la integridad de la copia. El archivo local se conserva.');
        const now = new Date(this.now()).toISOString();
        const record = existing ? { ...existing.record, origin, objectEtag: verified.etag } : { id, managedBy: 'clipforge-v1', mediaKind: clip.render.mediaKind === 'AUDIO' ? 'AUDIO' : 'VIDEO', projectId: project.id, clipId: clip.id, objectKey: mediaKey(id), sha256,
          sizeBytes: info.size, objectEtag: verified.etag, createdAt: now, expiresAt: new Date(this.now() + 30 * DAY).toISOString(), keep: false, status: 'READY',
          origin, review: {status:'PENDING'}, context:clipContext(project,clip),
          title: String(clip.title || project.source?.originalName || 'Clip').slice(0, 300), reason: String(clip.reason || '').slice(0, 2000), duration: Number(clip.duration) || 0 };
        await this.store.putJson(recordKey(id), record, existing ? { ifMatch: existing.etag, signal } : { ifAbsent: true, signal });
        return this.publicEntry(record);
      });
    } finally { await file.close(); }
  }
  publicEntry(record) {
    return { id: record.id, mediaKind: record.mediaKind === 'AUDIO' ? 'AUDIO' : 'VIDEO', projectId: record.projectId, clipId: record.clipId, title: record.title, reason: record.reason,
      duration: record.duration, sha256:record.sha256, sizeBytes: record.sizeBytes, createdAt: record.createdAt, expiresAt: record.keep ? null : record.expiresAt,
      keep: record.keep, status: record.status, origin:record.origin || {kind:'VIDEO',sourceKind:'UNKNOWN'}, review:record.review || {status:'PENDING'}, context:record.context || null, recut:record.recut || null, sourceUrl: `/api/media/library/${record.id}/source`, downloadUrl: `/api/media/library/${record.id}/source?download=1` };
  }
  async list({includeTechnicalTests=false}={}) {
    const entries = await this.#all();
    const used = (await this.store.list('')).reduce((sum, item) => sum + Number(item.size || 0), 0);
    return { clips: entries.filter(e => e.record.status === 'READY' && (includeTechnicalTests || e.record.origin?.kind !== 'TECHNICAL_TEST')).map(e => this.publicEntry(e.record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200), usedBytes: used, maxBytes: this.maxBytes };
  }
  async setKeep(id, keep) {
    if (typeof keep !== 'boolean') throw storageError('STORAGE_INVALID', 'Indica si deseas conservar el clip.');
    return this.#withWriter(async signal => {
      const entry = await this.#read(id, signal);
      if (!entry || entry.record.status !== 'READY') throw storageError('STORAGE_NOT_FOUND', 'El clip ya no está disponible.');
      const remote = await this.store.head(entry.record.objectKey, { signal });
      if (!remote) throw storageError('STORAGE_NOT_FOUND', 'El clip ya no está disponible.');
      if (remote.size !== entry.record.sizeBytes || remote.metadata?.sha256 !== entry.record.sha256 || remote.etag !== entry.record.objectEtag) throw storageError('STORAGE_INTEGRITY', 'La copia guardada cambió. No se confirmó su conservación.');
      const updated = { ...entry.record, keep, ...(keep ? {} : { expiresAt: new Date(this.now() + 30 * DAY).toISOString() }) };
      await this.store.putJson(recordKey(id), updated, { ifMatch: entry.etag, signal });
      return this.publicEntry(updated);
    });
  }
  async identity(id) {
    const entry=await this.#read(id);
    if(!entry || entry.record.status!== 'READY')throw storageError('STORAGE_NOT_FOUND','El clip ya no está disponible.');
    return this.publicEntry(entry.record);
  }
  async setReview(id,status,recut=null) {
    if(!['PENDING','REJECTED','RECUT_REQUESTED'].includes(status))throw storageError('STORAGE_INVALID','Revisión no válida.');
    const saved=await this.#withWriter(async signal=>{
      const entry=await this.#read(id,signal);if(!entry || entry.record.status!=='READY')throw storageError('STORAGE_NOT_FOUND','El clip ya no está disponible.');
      const updated={...entry.record,review:{status,reviewedAt:new Date(this.now()).toISOString()},...(recut?{recut}:{})};
      await this.store.putJson(recordKey(id),updated,{ifMatch:entry.etag,signal});return this.publicEntry(updated);
    });
    try {
      if(await loadProjectFile(saved.projectId))await updateProjectFile(saved.projectId,project=>{
        const clip=project.clips?.find(c=>c.id===saved.clipId);if(clip)clip.editorialReview={...clip.editorialReview,status,reviewedAt:new Date(this.now()).toISOString()};
      });
    } catch { return {...saved,reviewSyncWarning:'La revisión está guardada en R2; falta sincronizar el proyecto local. Reintenta cuando vuelva a estar disponible.'}; }
    return saved;
  }
  async temporaryAccess(id,options={}) {
    const entry=await this.#read(id);if(!entry || entry.record.status!=='READY')throw storageError('STORAGE_NOT_FOUND','El clip ya no está disponible.');
    const object=await this.store.head(mediaKey(id));
    if(object?.etag!==entry.record.objectEtag || object?.metadata?.sha256!==entry.record.sha256 || object?.size!==entry.record.sizeBytes)throw storageError('STORAGE_INTEGRITY','La copia privada no pudo verificarse.');
    return signPrivateClip(id,{...options,mediaKind:entry.record.mediaKind});
  }
  async source(id, range) {
    const entry = await this.#read(id);
    if (!entry || entry.record.status !== 'READY') throw storageError('STORAGE_NOT_FOUND', 'El clip ya no está disponible.');
    const record = entry.record;
    const parsed = range ? parseByteRange(range, record.sizeBytes) : null;
    if (range && !parsed) throw Object.assign(storageError('STORAGE_RANGE', 'El intervalo solicitado no es válido.'), { size: record.sizeBytes });
    const result = await this.store.get(record.objectKey, { range: parsed ? `bytes=${parsed.start}-${parsed.end}` : undefined, ifMatch: record.objectEtag });
    if (!result) throw storageError('STORAGE_NOT_FOUND', 'No se encontró el archivo guardado.');
    return { ...result, record: this.publicEntry(record) };
  }
  async cleanup({ dryRun = false } = {}) {
    return this.#withWriter(async signal => {
      const entries = await this.#all(signal);
      // Completed MP4 may also be the only result referenced by a project
      // recovery checkpoint. Never expire a file still needed by that backup.
      const references=new Set();
      const recoveryKeys=(await this.store.list('clipforge-managed/v1/project-recovery/',{signal}))
        .filter(row=>/^clipforge-managed\/v1\/project-recovery\/[a-f0-9-]{36}\.json$/.test(row.key));
      for(const row of recoveryKeys){
        const manifest=(await this.store.getJson(row.key,{signal}))?.value;
        if(manifest?.version!==1||!isProjectId(manifest.id)||row.key!=='clipforge-managed/v1/project-recovery/'+manifest.id+'.json'||!Array.isArray(manifest.outputs))throw storageError('STORAGE_INVALID','El respaldo de proyectos no pudo comprobarse. Se detuvo la limpieza.');
        for(const file of manifest.outputs)references.add(file.key);
      }
      const expired = entries.filter(e => e.record.status === 'READY' && !e.record.keep && !references.has(e.record.objectKey) && Date.parse(e.record.expiresAt) <= this.now());
      const removed = [];
      for (const entry of expired) {
        signal.throwIfAborted();
        if (!dryRun) {
          const remote = await this.store.head(entry.record.objectKey, { signal });
          if (remote && (remote.etag !== entry.record.objectEtag || remote.size !== entry.record.sizeBytes || remote.metadata?.sha256 !== entry.record.sha256)) throw storageError('STORAGE_INTEGRITY', 'La copia guardada cambió. Se detuvo la limpieza para protegerla.');
          await this.store.delete(entry.record.objectKey, { signal });
          const tombstoneKey = `${EXPIRED}${entry.record.id}.json`;
          const tombstone = await this.store.getJson(tombstoneKey, { signal });
          if (tombstone) validateRecord(tombstone.value, entry.record.id);
          else await this.store.putJson(tombstoneKey, { ...entry.record, status: 'DELETED', deletedAt: new Date(this.now()).toISOString() }, { ifAbsent: true, signal });
          // Keep tombstones outside the active index so listing and polling do
          // not grow in cost with every expired clip, while retries stay safe.
          await this.store.delete(recordKey(entry.record.id), { signal });
        }
        removed.push(entry.record.id);
      }
      return { dryRun, removed };
    });
  }
}

function clipContext(project,clip){
  const start=Number(clip.startTime),end=Number(clip.endTime),segments=project.transcript?.segments || [];
  const text=(a,b)=>segments.filter(s=>s.endTime>a&&s.startTime<b).map(s=>s.text).join(' ').slice(0,2500);
  const origin=clipMediaOrigin(project),capture=project.source?.capture || {},observation=project.liveObservation || {};
  const ranges=capture.sourceRanges || (observation.sourceStartUtc?[{offsetSeconds:0,sourceStartUtc:observation.sourceStartUtc}]:[]);
  const utcAt=time=>{const range=[...ranges].reverse().find(r=>r.offsetSeconds<=time);return range&&Number.isFinite(Date.parse(range.sourceStartUtc))?new Date(Date.parse(range.sourceStartUtc)+(time-range.offsetSeconds)*1000).toISOString():null;};
  const base=capture.vodStartSeconds;
  const reference=clip.sourceReference || {sourceUrl:origin.sourceUrl||null,sourceId:origin.sourceId||null,sourceKind:origin.sourceKind,
    startUtc:utcAt(start),endUtc:utcAt(end),vodStartSeconds:Number.isFinite(base)?base+start:null,vodEndSeconds:Number.isFinite(base)?base+end:null};
  const candidate=project.analysis?.candidates?.find(c=>c.id===clip.candidateId);
  return {sourceReference:reference,chatEvidence:clip.chatEvidence||candidate?.chatEvidence||chatEvidenceForWindow(clip,observation.chatActivityWindows||[]),startTime:start,endTime:end,sourceDuration:project.source?.durationSeconds,sourceId:project.liveObservation?.source?.sourceId || null,
    analysisKind:clip.editorialReview?.analysisKind || (clip.aiAssessment?'MODEL_SELECTION':'MANUAL_OR_UNVERIFIED'),
    before:text(Math.max(0,start-15),start),transcript:text(start,end),after:text(end,end+15),transcriptWarning:'Transcripción automática: puede contener errores.',
    subtitlesEnabled:clip.edit?.subtitlesEnabled===true};
}
