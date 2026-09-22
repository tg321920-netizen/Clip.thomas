import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { createClipFromCandidate } from "../clip/ClipService.mjs";
import { generateSubtitleTrack } from "../subtitles/SubtitleService.mjs";
import { createAutoEditProvider } from "./createAutoEditProvider.mjs";

const PLATFORM_SET = new Set(["TIKTOK", "YOUTUBE", "FACEBOOK"]);
const STYLE_SET = new Set(["CLEAN", "VIRAL", "KARAOKE"]);
const FRAMING_SET = new Set(["FILL", "FIT"]);
const QUALITY_SET = new Set(["FAST", "BALANCED", "HIGH"]);

export async function prepareAutoEdit(projectId, options = {}) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const candidates = project?.analysis?.candidates;
  if (
    project?.analysis?.status !== "COMPLETED" ||
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    throw new Error("Completed content analysis is required before Auto Edit.");
  }

  const provider =
    options.provider ||
    createAutoEditProvider({
      ...options,
      providerName: options.providerName,
      candidateId: options.candidateId,
      model: options.model,
    });

  const providerName = String(provider.name || "unknown");
  const providerModel =
    typeof provider.model === "string" && provider.model.trim()
      ? provider.model.trim()
      : null;

  const sourceKey = buildAutoEditSourceKey(project, {
    providerName,
    providerModel,
    candidateId: options.candidateId,
  });

  const existing = findCurrentAutoEditClip(project, sourceKey);
  if (existing) {
    return {
      clip: existing,
      plan: existing.autoEdit,
      reused: true,
    };
  }

  const rawPlan = await provider.prepare({
    project,
    candidates,
    transcript: project.transcript,
    options,
  });

  const plan = normalizeAutoEditPlan(rawPlan, project, {
    providerName,
    providerModel,
    sourceKey,
  });

  const created = await createClipFromCandidate(
    projectId,
    plan.candidateId,
    {
      framingMode: plan.framingMode,
      quality: plan.quality,
    },
  );

  const latest = await loadProjectFile(projectId);
  if (!latest) throw new Error("Project disappeared during Auto Edit.");

  const clip = latest.clips?.find((entry) => entry.id === created.clip.id);
  if (!clip) throw new Error("Prepared clip could not be reloaded.");

  clip.startTime = plan.startTime;
  clip.endTime = plan.endTime;
  clip.duration = round(plan.endTime - plan.startTime);
  clip.status = "DRAFT";
  clip.render = null;
  clip.subtitles = null;
  clip.error = null;
  clip.edit = {
    ...clip.edit,
    framingMode: plan.framingMode,
    quality: plan.quality,
    subtitlesEnabled: options.generateSubtitles !== false,
    subtitleStyle: plan.subtitleStyle,
  };
  clip.autoEdit = plan;
  clip.updatedAt = new Date().toISOString();

  await replaceProjectFile(projectId, latest);

  if (
    options.generateSubtitles !== false &&
    latest?.transcript?.status === "COMPLETED"
  ) {
    await generateSubtitleTrack(projectId, clip.id, {
      style: plan.subtitleStyle,
      enabled: true,
    });
  }

  const finalProject = await loadProjectFile(projectId);
  const finalClip = finalProject?.clips?.find((entry) => entry.id === clip.id);
  if (!finalClip) throw new Error("Auto Edit clip could not be finalized.");

  return {
    clip: finalClip,
    plan: finalClip.autoEdit,
    reused: false,
  };
}

export async function getLatestAutoEdit(projectId) {
  const project = await loadProjectFile(projectId);
  if (!project) return null;

  const clips = Array.isArray(project.clips) ? project.clips : [];

  return (
    [...clips]
      .filter((clip) => clip?.autoEdit?.createdAt)
      .sort(
        (a, b) =>
          Date.parse(b.autoEdit.createdAt) - Date.parse(a.autoEdit.createdAt),
      )[0] || null
  );
}

export function buildAutoEditSourceKey(project, options = {}) {
  const analysis = project?.analysis;
  const transcript = project?.transcript;

  return [
    analysis?.id || "",
    analysis?.completedAt || "",
    transcript?.id || "",
    transcript?.completedAt || "",
    options.providerName || "",
    options.providerModel || "",
    options.candidateId || "auto",
  ].join(":");
}

export function normalizeAutoEditPlan(rawPlan, project, metadata = {}) {
  const candidates = project?.analysis?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("Auto Edit has no candidates to validate.");
  }

  const candidateId = String(rawPlan?.candidateId || "").trim();
  const candidate = candidates.find((entry) => entry.id === candidateId);

  if (!candidate) {
    throw new Error("Auto Edit provider selected an unknown candidate.");
  }

  const candidateStart = Number(candidate.startTime);
  const candidateEnd = Number(candidate.endTime);

  let startTime = clampNumber(
    rawPlan?.startTime,
    candidateStart,
    candidateEnd,
    candidateStart,
  );
  let endTime = clampNumber(
    rawPlan?.endTime,
    candidateStart,
    candidateEnd,
    candidateEnd,
  );

  if (endTime - startTime < 5) {
    startTime = candidateStart;
    endTime = candidateEnd;
  }

  const hashtags = normalizeHashtags(rawPlan?.hashtags);
  const recommendedPlatforms = normalizePlatforms(rawPlan?.recommendedPlatforms);
  const subtitleStyle = enumValue(
    rawPlan?.subtitleStyle,
    STYLE_SET,
    "VIRAL",
  );
  const framingMode = enumValue(
    rawPlan?.framingMode,
    FRAMING_SET,
    "FILL",
  );
  const quality = enumValue(
    rawPlan?.quality,
    QUALITY_SET,
    "BALANCED",
  );

  return {
    provider: metadata.providerName || "unknown",
    model: metadata.providerModel || null,
    sourceKey: metadata.sourceKey || "",
    candidateId: candidate.id,
    startTime: round(startTime),
    endTime: round(endTime),
    duration: round(endTime - startTime),
    title: cleanText(rawPlan?.title, candidate.title, 120),
    hook: cleanText(rawPlan?.hook, candidate.hook, 180),
    description: cleanText(rawPlan?.description, candidate.text, 500),
    hashtags,
    onScreenText: cleanText(
      rawPlan?.onScreenText,
      rawPlan?.hook || candidate.hook,
      100,
    ),
    recommendedPlatforms,
    subtitleStyle,
    framingMode,
    quality,
    reason: cleanText(
      rawPlan?.reason,
      candidate.reason || "Auto Edit candidate selection.",
      500,
    ),
    createdAt: new Date().toISOString(),
  };
}

function findCurrentAutoEditClip(project, sourceKey) {
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  return (
    clips.find(
      (clip) =>
        clip?.autoEdit?.sourceKey === sourceKey &&
        clip?.autoEdit?.candidateId === clip?.candidateId,
    ) || null
  );
}

function normalizeHashtags(value) {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set();
  const tags = [];

  for (const item of input) {
    const raw = String(item || "")
      .replace(/^#+/, "")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_]/gu, "")
      .slice(0, 40);

    if (!raw) continue;

    const tag = `#${raw}`;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tags.push(tag);
    if (tags.length >= 8) break;
  }

  return tags.length > 0 ? tags : ["#contenido"];
}

function normalizePlatforms(value) {
  const input = Array.isArray(value) ? value : [];
  const output = [];

  for (const item of input) {
    const platform = String(item || "").trim().toUpperCase();
    if (PLATFORM_SET.has(platform) && !output.includes(platform)) {
      output.push(platform);
    }
  }

  return output.length > 0
    ? output
    : ["TIKTOK", "YOUTUBE", "FACEBOOK"];
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || "").trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cleanText(value, fallback, maxLength) {
  const text = String(value || fallback || "")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1)}…`
    : text;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
