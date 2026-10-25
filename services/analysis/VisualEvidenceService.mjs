import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { runMedia } from "../media-processing/MediaValidationService.mjs";

/** Bounded still frames, not motion recognition or speaker tracking. */
export async function sampleCandidateFrames(project, candidates) {
  const duration = Number(project?.source?.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("La fuente visual no tiene una duración válida.");
  const source = resolveStoragePath(project.source.relativePath);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "clipforge-editor-frames-"));
  const frames = [];
  let bytes = 0;
  try {
    const shortlist = candidates.slice(0, 10);
    for (const candidate of shortlist) {
      const { startTime: start, endTime: end } = candidate;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + 0.1 || end <= start) throw new Error("La evidencia visual tiene tiempos fuera de la fuente.");
      for (const fraction of shortlist.length > 8 ? [0.2, 0.8] : [0.1, 0.5, 0.9]) {
        const time = Math.min(duration - 0.05, start + (end - start) * fraction);
        const target = path.join(temporary, `${frames.length}.jpg`);
        await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-ss", String(time), "-i", source,
          "-an", "-frames:v", "1", "-vf", "scale=384:384:force_original_aspect_ratio=decrease", "-q:v", "7", "-threads", "1", target], { timeoutMs: 12000 });
        const info = await stat(target);
        bytes += info.size;
        if (!info.size || info.size > 190000 || bytes > 1_400_000) throw new Error("La evidencia visual supera su límite de tamaño.");
        const image = await readFile(target);
        frames.push({ candidateId: candidate.id, time: Math.round(time * 1000) / 1000, dataUrl: `data:image/jpeg;base64,${image.toString("base64")}` });
      }
    }
    return frames;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
