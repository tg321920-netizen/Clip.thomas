import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { extractWhisperAudio } from "./AudioExtractor.mjs";
import { WhisperCliProvider } from "./WhisperCliProvider.mjs";
import { WhisperCppProvider } from "./WhisperCppProvider.mjs";

const DEFAULT_CHUNK_SECONDS = 10 * 60;
const MIN_CHUNK_SECONDS = 60;
const MAX_CHUNK_SECONDS = 30 * 60;

export async function transcribeProject(projectId, options = {}) {
  let project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const sourceKey = getSourceKey(project);
  if (isTranscriptCurrent(project, sourceKey)) {
    return { transcript: project.transcript, reused: true };
  }

  const sourcePath = resolveStoragePath(project?.source?.relativePath);
  const transcriptDir = path.join(getStorageRoot(), "transcripts", projectId);
  const chunkDir = path.join(transcriptDir, "chunks");
  const chunkDurationSeconds = normalizeChunkDuration(
    options.chunkDurationSeconds ?? process.env.CLIPFORGE_TRANSCRIPTION_CHUNK_SECONDS,
  );
  const sourceDuration = Math.max(0, Number(project?.source?.durationSeconds || 0));
  const expectedChunks = buildChunkPlan(sourceDuration, chunkDurationSeconds);
  const provider = options.provider || createDefaultProvider(options);
  const providerMetadata = getDefaultProviderMetadata({ ...options, provider });
  const audioExtractor = options.audioExtractor || extractWhisperAudio;
  const startedAt = new Date().toISOString();

  await mkdir(chunkDir, { recursive: true });

  const resumable = canResumeTranscript(
    project.transcript,
    sourceKey,
    chunkDurationSeconds,
    expectedChunks,
  );

  if (!resumable) {
    project.transcript = {
      id: project?.transcript?.id || randomUUID(),
      projectId,
      videoId: getVideoId(project),
      status: "PROCESSING",
      provider: providerMetadata.provider,
      model: providerMetadata.model,
      language: null,
      text: "",
      durationSeconds: sourceDuration || undefined,
      segments: [],
      sourceKey,
      audioRelativePath: path.posix.join(
        "transcripts",
        projectId,
        "chunks",
        "chunk-0000.wav",
      ),
      progress: 0,
      chunkDurationSeconds,
      chunks: expectedChunks,
      createdAt: project?.transcript?.createdAt || startedAt,
      startedAt,
      completedAt: null,
      error: null,
    };
  } else {
    project.transcript = {
      ...project.transcript,
      status: "PROCESSING",
      provider: providerMetadata.provider,
      model: providerMetadata.model,
      startedAt: project.transcript.startedAt || startedAt,
      completedAt: null,
      error: null,
      chunks: project.transcript.chunks.map((chunk) =>
        chunk.status === "PROCESSING"
          ? { ...chunk, status: "PENDING", error: "Recovered interrupted chunk." }
          : chunk,
      ),
    };
  }

  await replaceProjectFile(projectId, project);

  try {
    for (let index = 0; index < project.transcript.chunks.length; index += 1) {
      const chunk = project.transcript.chunks[index];
      if (chunk.status === "COMPLETED") continue;

      const audioPath = path.join(
        chunkDir,
        `chunk-${String(index).padStart(4, "0")}.wav`,
      );

      chunk.status = "PROCESSING";
      chunk.attempts = Number(chunk.attempts || 0) + 1;
      chunk.error = null;
      project.transcript.status = "PROCESSING";
      project.transcript.error = null;
      await replaceProjectFile(projectId, project);

      try {
        await audioExtractor(sourcePath, audioPath, {
          startTime: chunk.startTime,
          duration: Math.max(0.001, chunk.endTime - chunk.startTime),
        });

        const result = await provider.transcribe(
          audioPath,
          path.join(chunkDir, `result-${String(index).padStart(4, "0")}`),
        );
        const shifted = shiftSegments(
          result.segments,
          chunk.startTime,
          project.transcript.segments.length,
        );

        project.transcript.segments.push(...shifted);
        project.transcript.text = project.transcript.segments
          .map((segment) => segment.text)
          .join(" ")
          .trim();
        project.transcript.language =
          project.transcript.language || result.language || null;
        project.transcript.provider = result.provider || project.transcript.provider;
        project.transcript.model = result.model || project.transcript.model;

        chunk.status = "COMPLETED";
        chunk.segmentCount = shifted.length;
        chunk.error = null;
        chunk.completedAt = new Date().toISOString();
        project.transcript.progress = calculateProgress(project.transcript.chunks);

        await replaceProjectFile(projectId, project);
        await rm(audioPath, { force: true }).catch(() => undefined);

        if (typeof options.onProgress === "function") {
          await options.onProgress(project.transcript.progress, {
            index,
            total: project.transcript.chunks.length,
            chunk: { ...chunk },
          });
        }
      } catch (error) {
        await rm(audioPath, { force: true }).catch(() => undefined);
        chunk.status = "FAILED";
        chunk.error = error instanceof Error ? error.message : String(error);
        chunk.completedAt = null;
        project.transcript.status = "FAILED";
        project.transcript.error = chunk.error;
        project.transcript.progress = calculateProgress(project.transcript.chunks);
        project.transcript.completedAt = new Date().toISOString();
        await replaceProjectFile(projectId, project);
        throw error;
      }
    }

    project.transcript.segments.sort(
      (a, b) => Number(a.startTime) - Number(b.startTime),
    );
    project.transcript.text = project.transcript.segments
      .map((segment) => segment.text)
      .join(" ")
      .trim();
    project.transcript.status = "COMPLETED";
    project.transcript.durationSeconds = sourceDuration || inferDuration(project.transcript.segments);
    project.transcript.progress = 100;
    project.transcript.completedAt = new Date().toISOString();
    project.transcript.error = null;

    await replaceProjectFile(projectId, project);
    return { transcript: project.transcript, reused: false };
  } catch (error) {
    // The failing chunk and partial progress were already persisted above. This
    // fallback covers provider/setup failures that happen outside a chunk body.
    project = (await loadProjectFile(projectId)) || project;
    if (project?.transcript?.status !== "FAILED") {
      project.transcript = {
        ...project.transcript,
        status: "FAILED",
        error: error instanceof Error ? error.message : "Transcription failed.",
        completedAt: new Date().toISOString(),
      };
      await replaceProjectFile(projectId, project);
    }
    throw error;
  }
}

export function isTranscriptCurrent(project, sourceKey = getSourceKey(project)) {
  const transcript = project?.transcript;
  return Boolean(
    transcript &&
      transcript.status === "COMPLETED" &&
      transcript.sourceKey === sourceKey &&
      Array.isArray(transcript.segments) &&
      transcript.segments.length > 0,
  );
}

export function getSourceKey(project) {
  const source = project?.source;
  if (!source) return "";
  return [
    source.storedName || "",
    Number(source.sizeBytes || 0),
    Number(source.durationSeconds || 0),
  ].join(":");
}

export function createDefaultProvider(options = {}) {
  const providerKind = String(process.env.WHISPER_PROVIDER || "cli")
    .trim()
    .toLowerCase();

  if (providerKind === "cpp" || providerKind === "whisper.cpp") {
    return new WhisperCppProvider({ language: options.language });
  }

  return new WhisperCliProvider({
    model: options.model,
    language: options.language,
  });
}

export function buildChunkPlan(durationSeconds, chunkDurationSeconds = DEFAULT_CHUNK_SECONDS) {
  const duration = Number(durationSeconds);
  const chunkSize = normalizeChunkDuration(chunkDurationSeconds);

  if (!Number.isFinite(duration) || duration <= 0) {
    return [newChunk(0, 0, chunkSize)];
  }

  const chunks = [];
  for (let start = 0, index = 0; start < duration; start += chunkSize, index += 1) {
    chunks.push(newChunk(index, start, Math.min(duration, start + chunkSize)));
  }
  return chunks;
}

export function shiftSegments(segments, offsetSeconds, existingCount = 0) {
  if (!Array.isArray(segments)) return [];
  const offset = Number(offsetSeconds) || 0;

  return segments
    .map((segment, index) => {
      const startTime = Number(segment?.startTime);
      const endTime = Number(segment?.endTime);
      const text = String(segment?.text || "").trim();
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime || !text) {
        return null;
      }

      const words = Array.isArray(segment.words)
        ? segment.words
            .map((word) => ({
              ...word,
              startTime: round(Number(word.startTime) + offset),
              endTime: round(Number(word.endTime) + offset),
            }))
            .filter(
              (word) =>
                Number.isFinite(word.startTime) &&
                Number.isFinite(word.endTime) &&
                word.endTime > word.startTime,
            )
        : [];

      return {
        ...segment,
        id: `segment-${String(existingCount + index + 1).padStart(6, "0")}`,
        startTime: round(startTime + offset),
        endTime: round(endTime + offset),
        text,
        ...(words.length > 0 ? { words } : {}),
      };
    })
    .filter(Boolean);
}

function canResumeTranscript(transcript, sourceKey, chunkDurationSeconds, expectedChunks) {
  return Boolean(
    transcript &&
      transcript.sourceKey === sourceKey &&
      Number(transcript.chunkDurationSeconds) === Number(chunkDurationSeconds) &&
      Array.isArray(transcript.chunks) &&
      transcript.chunks.length === expectedChunks.length &&
      Array.isArray(transcript.segments),
  );
}

function newChunk(index, startTime, endTime) {
  return {
    index,
    startTime: round(startTime),
    endTime: round(endTime),
    status: "PENDING",
    attempts: 0,
    segmentCount: 0,
    error: null,
    completedAt: null,
  };
}

function calculateProgress(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return 0;
  const completed = chunks.filter((chunk) => chunk.status === "COMPLETED").length;
  return Math.round((completed / chunks.length) * 100);
}

function normalizeChunkDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_CHUNK_SECONDS;
  return Math.round(Math.max(MIN_CHUNK_SECONDS, Math.min(MAX_CHUNK_SECONDS, number)));
}

function getDefaultProviderMetadata(options = {}) {
  if (options.provider) {
    return {
      provider: String(options.provider.name || "transcription-provider"),
      model: String(options.provider.model || options.model || "custom"),
    };
  }

  const providerKind = String(process.env.WHISPER_PROVIDER || "cli")
    .trim()
    .toLowerCase();
  if (providerKind === "cpp" || providerKind === "whisper.cpp") {
    const modelPath = String(process.env.WHISPER_CPP_MODEL_PATH || "").trim();
    return {
      provider: "whisper.cpp",
      model: modelPath ? path.basename(modelPath) : "whisper.cpp",
    };
  }

  return {
    provider: "whisper-cli",
    model: options.model || process.env.WHISPER_MODEL?.trim() || "base",
  };
}

function getVideoId(project) {
  return project?.source?.videoId || project?.source?.projectId || project?.id;
}

function inferDuration(segments) {
  return round(
    (Array.isArray(segments) ? segments : []).reduce(
      (max, segment) => Math.max(max, Number(segment?.endTime) || 0),
      0,
    ),
  );
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
