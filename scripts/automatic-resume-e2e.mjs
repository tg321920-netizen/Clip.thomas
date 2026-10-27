// Reuse an authorized completed audio batch in an isolated root. Real decode
// and renderer checkpoints; no new selection, ASR, encoding, R2 writes or API.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, link, copyFile } from 'node:fs/promises';
import { BestClipsService } from '../services/analysis/BestClipsService.mjs';
import { hashFile } from '../services/ingest/ResumableUploadStore.mjs';
import { loadProjectFile } from '../lib/project-files.mjs';
import { withMediaExecution } from '../lib/media-execution.mjs';
import { isProjectId } from '../lib/project-id.mjs';

const argument = process.argv.find(value => value.startsWith('--source-project='))?.slice(17);
if (!argument || !process.argv.includes('--rights-confirmed')) throw new Error('Use --source-project=PATH and --rights-confirmed with a completed authorized audio batch.');
const sourceFile = path.resolve(argument);
if (!sourceFile.startsWith(path.resolve('artifacts') + path.sep)) throw new Error('Use a retained acceptance project under artifacts.');
const sourceRoot = path.dirname(path.dirname(sourceFile)), project = JSON.parse(await readFile(sourceFile, 'utf8'));
assert.ok(isProjectId(project.id) && isProjectId(project.clipsOrigin?.projectId));
assert.equal(project.source.mediaKind, 'AUDIO'); assert.ok(project.clips.length);
const original = JSON.parse(await readFile(path.join(sourceRoot, 'projects', project.clipsOrigin.projectId + '.json'), 'utf8'));
const job = JSON.parse(await readFile(path.join(sourceRoot, 'jobs', 'bestclips-' + project.id + '.json'), 'utf8'));
const parent = path.resolve('artifacts/master-mission-20261028'); await mkdir(parent, { recursive: true });
const run = await mkdtemp(path.join(parent, 'automatic-resume-')), root = path.join(run, 'storage');
const before = [], files = new Set([original.source.relativePath, project.source.relativePath]);
for (const clip of project.clips) { assert.equal(clip.status, 'READY'); files.add(clip.render.relativePath); before.push(await hashFile(path.resolve(sourceRoot, clip.render.relativePath))); }
for (const relative of files) {
  const source = path.resolve(sourceRoot, relative), target = path.resolve(root, relative);
  assert.ok(source.startsWith(sourceRoot + path.sep) && target.startsWith(root + path.sep));
  await mkdir(path.dirname(target), { recursive: true }); await link(source, target);
}
for (const clip of project.clips) {
  const relative = clip.render.relativePath.replace(/render\.mp4$/, 'render-proof.json');
  await copyFile(path.resolve(sourceRoot, relative), path.resolve(root, relative));
}
const resumed = project.clips.find(clip => clip.editorialReview?.status !== 'REJECTED'); assert.ok(resumed?.subtitles?.cues?.length);
resumed.status = 'DRAFT';
const changedText = resumed.subtitles.cues[0].text + ' [isolated QA draft, not an editorial correction]';
resumed.subtitles.cues[0].text = changedText;
await mkdir(path.join(root, 'projects'), { recursive: true });
await writeFile(path.join(root, 'projects', original.id + '.json'), JSON.stringify(original));
await writeFile(path.join(root, 'projects', project.id + '.json'), JSON.stringify(project));
process.env.CLIPFORGE_STORAGE_DIR = root;
const controller = new AbortController(); let encoderAttempted = false;
const provider = { name: project.analysis.provider, model: project.analysis.model || null, visionEnabled: false,
  analyze: async () => assert.fail('A cached editorial decision must not make another selection/model call') };
await withMediaExecution(controller.signal, () => new BestClipsService({ provider, width: 1080, height: 1920 }).render(project.id, job.payload), record => {
  if (record.encoder) { encoderAttempted = true; controller.abort(new Error('An unexpected encode was stopped.')); }
});
assert.equal(encoderAttempted, false);
const saved = await loadProjectFile(project.id), recovered = saved.clips.find(clip => clip.id === resumed.id);
assert.equal(saved.clips.length, project.clips.length); assert.equal(recovered.subtitles.cues[0].text, changedText);
assert.equal(recovered.render.recoveredWithoutEncoding, true);
for (let index = 0; index < project.clips.length; index++) assert.equal(await hashFile(path.join(root, project.clips[index].render.relativePath)), before[index]);
const evidence = { checkedAt: new Date().toISOString(), passed: true, run, source: 'CACHED_AUTHORIZED_AUDIO_NASA', realMedia: true,
  projectId: project.id, clipIdPreserved: resumed.id, subtitleDraftPreserved: true, recoveredWithoutEncoding: true, hashes: before,
  newClips: 0, newEncodes: 0, newAsr: 0, externalModelCalls: 0, newSelection: false, r2Writes: 0,
  qaTextOnlyInIsolatedProject: true, editorialOwnerApproval: false, physicalAndroid: false, publicDeployment: false };
await writeFile(path.join(run, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
