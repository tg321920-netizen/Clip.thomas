import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { extractWhisperAudio } from "./AudioExtractor.mjs";
import { WhisperCliProvider } from "./WhisperCliProvider.mjs";
import { WhisperCppProvider } from "./WhisperCppProvider.mjs";

export async function transcribeProject(projectId, options = {}) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const sourceKey = getSourceKey(project);
  if (isTranscriptCurrent(project, sourceKey)) {
    return { transcript: project.transcript, reused: true };
  }

  const sourcePath = resolveStoragePath(project?.source?.relativePath);
  const transcriptDir = path.join(getStorageRoot(), "transcripts", projectId);
  const audioPath = path.join(transcriptDir, "audio.wav");

  await mkdir(transcriptDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const providerMetadata = getDefaultProviderMetadata(options);

  project.transcript = {
    id: project?.transcript?.id || randomUUID(),
    projectId,
    videoId: getVideoId(project),
    status: "PROCESSING",
    provider: providerMetadata.provider,
    model: providerMetadata.model,
    language: null,
    text: "",
    segments: [],
    sourceKey,
    audioRelativePath: path.posix.join("transcripts", projectId, "audio.wav"),
    createdAt: project?.transcript?.createdAt || startedAt,
    startedAt,
    completedAt: null,
    error: null,
  };

  await replaceProjectFile(projectId, project);

  try {
    await extractWhisperAudio(sourcePath, audioPath);

    const provider = options.provider || createDefaultProvider(options);
    const result = await provider.transcribe(audioPath, transcriptDir);

    project.transcript = {
      ...project.transcript,
      status: "COMPLETED",
      provider: result.provider,
      model: result.model,
      language: result.language,
      text: result.text,
      durationSeconds: result.durationSeconds,
      segments: result.segments,
      completedAt: new Date().toISOString(),
      error: null,
    };

    await replaceProjectFile(projectId, project);

    return { transcript: project.transcript, reused: false };
  } catch (error) {
    project.transcript = {
      ...project.transcript,
      status: "FAILED",
      error: error instanceof Error ? error.message : "Transcription failed.",
      completedAt: new Date().toISOString(),
    };

    await replaceProjectFile(projectId, project);
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
    return new WhisperCppProvider({
      language: options.language,
    });
  }

  return new WhisperCliProvider({
    model: options.model,
    language: options.language,
  });
}

function getDefaultProviderMetadata(options = {}) {
  if (options.provider) {
    return {
      provider: "transcription-provider",
      model: options.model || "custom",
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
