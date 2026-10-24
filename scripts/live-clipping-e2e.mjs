// Own synthetic audiovisual fixture; real local speech recognition and rendering.
import assert from 'node:assert/strict';
import { verifySubtitleFrame, selectSubtitleReviewCue } from './verify-subtitle-frame.mjs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createClipArchive } from '../lib/clip-archive.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { EspeakNewsTtsProvider } from '../services/news/EspeakNewsTtsProvider.mjs';
import { runMedia, probeMediaFile, validateMp4 } from '../services/media-processing/MediaValidationService.mjs';
import { BestClipsService } from '../services/analysis/BestClipsService.mjs';
import { replaceProjectFile, loadProjectFile } from '../lib/project-files.mjs';
import { hashFile } from '../services/ingest/ResumableUploadStore.mjs';

const output = path.resolve('artifacts/live-clipping');
const root = path.join(output, 'storage');
process.env.CLIPFORGE_STORAGE_DIR = root;
process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = 'false';
process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING = 'false';
process.env.CLIPFORGE_SMART_PUBLISH_ON_BOOT = 'false';
const id = randomUUID(), renderedId = randomUUID();
const directory = path.join(root, 'uploads', id);
await mkdir(directory, { recursive: true });
const text = [
  'Why does a local video editor need a reliable recovery system? A recording can take hours, while a connection can fail in a single second. The safest design stores small completed segments on disk. After a restart, the worker checks the actual duration of each file. It resumes from verified material instead of downloading everything again. This saves bandwidth and protects work already completed. A missing file is reported as missing, rather than displayed as a successful export.',
  'Consider the difference between a loud reaction and an interesting conversation. A person may speak quietly while explaining a surprising discovery. Audio energy alone would miss that moment. Transcript context helps identify a complete question and its answer. Scene changes can provide another measurable signal, but they do not prove that a sporting event or emotional reaction occurred. Every suggested clip still needs editorial review. A score is an explanation of evidence, never a promise of popularity.',
  'A practical mobile interface should make important controls easy to reach. The owner needs to see whether a recording is active, stop it, inspect errors, and download the finished file. Closing a browser tab should not cancel work on the server. However, pressing cancel should really stop the recorder. The system must distinguish those two actions. Large buttons and readable error messages matter more than decorative animations when someone is managing video from a phone.',
  'There is also a critical difference between metadata and permission. An official platform interface can say that a channel is live without giving anyone the right to reuse its footage. The creator must own the material or have authorization. Private streams and protected media must remain protected. When access is denied, a useful editor explains the restriction and offers an authorized upload. It does not pretend that a failed download produced a real clip.',
  'Finally, a finished video should be tested as a file. The container must open, the picture must decode, and the audio must remain synchronized. Subtitles should follow the spoken words and stay inside the frame. A vertical export should preserve the original audio unless the editor explicitly changes it. Before delivery, the owner should review the beginning and ending to make sure the idea remains complete. Automatic processing can prepare options, while the human makes the final decision.',
].join(' ');
const audio = path.join(directory, 'narration.wav');
await new EspeakNewsTtsProvider({ voice: 'en', speed: 130 }).synthesize({ text, outputPath: audio });
const source = path.join(directory, 'source.mp4');
await runMedia('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10', '-i', audio, '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', source]);
const probe = await probeMediaFile(source);
assert.ok(probe.duration >= 180, `Expected several minutes, received ${probe.duration}s`);
const checksum = await hashFile(source);
await replaceProjectFile(id, { id, createdAt: new Date().toISOString(), source: { projectId: id, originalName: 'authorized-original-narration.mp4', relativePath: `uploads/${id}/source.mp4`, sizeBytes: (await stat(source)).size, durationSeconds: probe.duration, width: 640, height: 360, hasAudio: true }, clips: [] });
const service = new BestClipsService();
const input = { projectId: id, count: 3, minDuration: 15, maxDuration: 45, targetDuration: 30, subtitles: true, contentProfile: 'PODCAST' };
const result = await service.render(renderedId, input, async (_status, stage, progress) => console.log(stage, progress));
assert.equal(result.clips.length, 3);
const project = await loadProjectFile(renderedId);
assert.equal(project.transcript.status, 'COMPLETED');
assert.ok(project.transcript.segments.length > 0);
for (const clip of project.clips) {
  await validateMp4(path.join(root, clip.render.relativePath), { width: 1080, height: 1920, duration: clip.duration, requireAudio: true });
  assert.ok(clip.subtitles.cues.length > 0);
}
for (let a = 0; a < result.clips.length; a++) for (let b = a + 1; b < result.clips.length; b++) {
  assert.ok(Math.min(result.clips[a].endTime, result.clips[b].endTime) <= Math.max(result.clips[a].startTime, result.clips[b].startTime));
}
assert.equal(await hashFile(source), checksum, 'Original file must remain intact');
const subtitleEvidence = await verifySubtitleFrame({ file: path.join(root, project.clips[0].render.relativePath), cue: selectSubtitleReviewCue(project.clips[0].subtitles.cues), width: 1080, height: 1920, output: path.join(output, 'subtitle-review') });
const resumed = await service.render(renderedId, input);
assert.deepEqual(resumed.clips.map(clip => clip.clipId), result.clips.map(clip => clip.clipId), 'Validated render checkpoints must be reused');
const archivePath = path.join(output, 'clips.zip');
await pipeline(await createClipArchive(project), createWriteStream(archivePath));
await runMedia('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert len(z.namelist())==3; assert z.testzip() is None; assert all(n.endswith(".mp4") for n in z.namelist())', archivePath]);
await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ passed: true, subtitleEvidence, checkpointReuse: true, fixture: 'Original synthesized narration; no external footage or mock transcription.', originalDuration: probe.duration, originalSha256: checksum, result, transcriptProvider: project.transcript.provider, publication: 'DISABLED' }, null, 2));
console.log('Live clipping local media pipeline PASSED', result.clips.map(clip => ({ file: clip.relativePath, duration: clip.duration })));
