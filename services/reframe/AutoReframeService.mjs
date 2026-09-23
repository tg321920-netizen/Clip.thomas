import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";

const MODE = "SPEECH_ZOOM";
const BASIS = "TRANSCRIPT_SPEECH_ACTIVITY";

export async function getAutoReframe(projectId, clipId) {
  const project = await loadProjectFile(projectId);
  if (!project) return null;

  const clip = findClip(project, clipId);
  if (!clip) return null;

  return clip.autoReframe || null;
}

export async function applySpeechFocus(projectId, clipId, options = {}) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const clip = findClip(project, clipId);
  if (!clip) throw new Error("Clip not found.");

  const transcript = project.transcript;
  if (
    !transcript ||
    transcript.status !== "COMPLETED" ||
    !Array.isArray(transcript.segments) ||
    transcript.segments.length === 0
  ) {
    throw new Error("A completed transcript is required for speech focus.");
  }

  const config = normalizeAutoReframeOptions(options);
  const windows = buildSpeechWindows(transcript, clip, config);

  if (windows.length === 0) {
    throw new Error("No speech activity overlaps this clip.");
  }

  const now = new Date().toISOString();
  const previous = clip.autoReframe;

  clip.autoReframe = {
    enabled: true,
    mode: MODE,
    basis: BASIS,
    speakerAware: false,
    subjectMode: "CENTERED_SUBJECT",
    zoom: config.zoom,
    attackMs: config.attackMs,
    releaseMs: config.releaseMs,
    mergeGapMs: config.mergeGapMs,
    paddingBeforeMs: config.paddingBeforeMs,
    paddingAfterMs: config.paddingAfterMs,
    sourceTranscriptId: String(transcript.id || ""),
    windows,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };

  clip.edit = {
    ...clip.edit,
    autoReframeEnabled: true,
  };

  invalidateRender(clip);
  await replaceProjectFile(projectId, project);

  return clip.autoReframe;
}

export async function disableAutoReframe(projectId, clipId) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const clip = findClip(project, clipId);
  if (!clip) throw new Error("Clip not found.");

  if (!clip.autoReframe && !clip.edit?.autoReframeEnabled) {
    return null;
  }

  if (clip.autoReframe) {
    clip.autoReframe = {
      ...clip.autoReframe,
      enabled: false,
      updatedAt: new Date().toISOString(),
    };
  }

  clip.edit = {
    ...clip.edit,
    autoReframeEnabled: false,
  };

  invalidateRender(clip);
  await replaceProjectFile(projectId, project);

  return clip.autoReframe;
}

export function buildSpeechWindows(transcript, clip, options = {}) {
  const config = normalizeAutoReframeOptions(options);
  const clipStart = Number(clip?.startTime);
  const clipEnd = Number(clip?.endTime);
  const clipDuration = Number(clip?.duration);

  if (
    !Number.isFinite(clipStart) ||
    !Number.isFinite(clipEnd) ||
    !Number.isFinite(clipDuration) ||
    clipEnd <= clipStart ||
    clipDuration <= 0
  ) {
    throw new Error("Clip timing is invalid.");
  }

  const paddingBefore = config.paddingBeforeMs / 1000;
  const paddingAfter = config.paddingAfterMs / 1000;
  const mergeGap = config.mergeGapMs / 1000;

  const raw = (transcript?.segments || [])
    .map((segment) => {
      const start = Number(segment?.startTime);
      const end = Number(segment?.endTime);
      const text = String(segment?.text || "").trim();

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= clipStart ||
        start >= clipEnd ||
        !text
      ) {
        return null;
      }

      return {
        startTime: round(
          Math.max(0, Math.max(start, clipStart) - clipStart - paddingBefore),
        ),
        endTime: round(
          Math.min(
            clipDuration,
            Math.min(end, clipEnd) - clipStart + paddingAfter,
          ),
        ),
        focusX: 0.5,
        focusY: 0.44,
      };
    })
    .filter(Boolean)
    .filter((window) => window.endTime > window.startTime)
    .sort((a, b) => a.startTime - b.startTime);

  const merged = [];

  for (const window of raw) {
    const previous = merged[merged.length - 1];

    if (previous && window.startTime - previous.endTime <= mergeGap) {
      previous.endTime = round(Math.max(previous.endTime, window.endTime));
      continue;
    }

    merged.push({ ...window });
  }

  return merged.slice(0, 32);
}

export function buildSpeechZoomFilter(plan, fpsValue) {
  if (!plan?.enabled || plan.mode !== MODE) return "";

  const windows = Array.isArray(plan.windows) ? plan.windows : [];
  if (windows.length === 0) return "";

  const fps = clampNumber(fpsValue, 12, 60, 30);
  const zoom = clampNumber(plan.zoom, 1.03, 1.35, 1.12);
  const attackMs = clampNumber(plan.attackMs, 80, 1200, 180);
  const releaseMs = clampNumber(plan.releaseMs, 80, 1600, 260);

  const activeConditions = windows
    .map((window) => {
      const startFrame = Math.max(0, Math.floor(Number(window.startTime) * fps));
      const endFrame = Math.max(
        startFrame,
        Math.ceil(Number(window.endTime) * fps),
      );
      return `between(on,${startFrame},${endFrame})`;
    })
    .filter(Boolean);

  if (activeConditions.length === 0) return "";

  const active =
    activeConditions.length === 1
      ? activeConditions[0]
      : `gt(${activeConditions.join("+")},0)`;

  const attackStep = round((zoom - 1) / Math.max(1, (attackMs / 1000) * fps), 6);
  const releaseStep = round((zoom - 1) / Math.max(1, (releaseMs / 1000) * fps), 6);

  const zoomExpression = `if(${active},min(max(pzoom,1)+${attackStep},${zoom}),max(pzoom-${releaseStep},1))`;

  return [
    `zoompan=z='${zoomExpression}'`,
    "x='iw/2-(iw/zoom/2)'",
    "y='ih*0.44-(ih/zoom/2)'",
    "d=1",
    "s=1080x1920",
    `fps=${round(fps, 3)}`,
  ].join(":");
}

export function normalizeAutoReframeOptions(options = {}) {
  return {
    zoom: clampNumber(options.zoom, 1.03, 1.35, 1.12),
    attackMs: clampNumber(options.attackMs, 80, 1200, 180),
    releaseMs: clampNumber(options.releaseMs, 80, 1600, 260),
    mergeGapMs: clampNumber(options.mergeGapMs, 0, 2000, 450),
    paddingBeforeMs: clampNumber(options.paddingBeforeMs, 0, 1200, 160),
    paddingAfterMs: clampNumber(options.paddingAfterMs, 0, 1600, 240),
  };
}

function findClip(project, clipId) {
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  return clips.find((clip) => clip.id === clipId) || null;
}

function invalidateRender(clip) {
  clip.status = "DRAFT";
  clip.render = null;
  clip.error = null;
  clip.updatedAt = new Date().toISOString();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
