import { AutopilotRepository } from "./AutopilotRepository.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { JobStore } from "../JobStore.mjs";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { markClipQueued } from "../clip/ClipService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { SchedulerService } from "../scheduler/SchedulerService.mjs";

const PLATFORMS = new Set(["TIKTOK", "YOUTUBE", "FACEBOOK"]);
const MODES = new Set(["MANUAL", "AUTOPILOT"]);

export class AutopilotService {
  constructor(options = {}) {
    this.repository = options.repository || new AutopilotRepository();
    this.jobs = options.jobs || new JobStore();
    this.channels = options.channels || new ChannelService();
    this.publications = options.publications || new PublicationService({ channels: this.channels });
    this.scheduler = options.scheduler || new SchedulerService({
      publications: this.publications,
      channels: this.channels,
    });
  }

  async getConfig() {
    const existing = await this.repository.getConfig();
    if (existing) return normalizeConfig(existing, existing);

    const now = new Date().toISOString();
    const config = normalizeConfig(
      {
        enabled: false,
        mode: "MANUAL",
        approvalRequired: true,
        postsPerDay: 3,
        clipsPerSource: 3,
        minClipScore: 55,
        minClipDuration: 15,
        maxClipDuration: 60,
        targetClipDuration: 30,
        platforms: ["TIKTOK", "YOUTUBE", "FACEBOOK"],
        preferredTimes: ["09:00", "15:00", "20:00"],
        analyticsEnabled: true,
        learningEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
      null,
    );

    await this.repository.saveConfig(config);
    return config;
  }

  async updateConfig(input = {}) {
    const current = await this.getConfig();
    const updated = normalizeConfig(
      {
        ...current,
        ...input,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      },
      current,
    );

    await this.repository.saveConfig(updated);
    return updated;
  }

  async advanceProject(projectId, options = {}) {
    const config = options.config || (await this.getConfig());
    const allowManual = options.allowManual === true;

    if ((!config.enabled || config.mode !== "AUTOPILOT") && !allowManual) {
      return { projectId, state: "DISABLED", queuedJob: null, clipId: null, clipIds: [] };
    }

    let project = await loadProjectFile(projectId);
    if (!project) throw new Error("Project not found.");

    if (!isCompletedTranscript(project.transcript)) {
      const existing = await this.jobs.getTranscriptionJob(projectId);
      if (isTerminalFailure(existing)) {
        return failedState(projectId, "TRANSCRIPTION_FAILED", existing);
      }
      const job = existing && ["QUEUED", "PROCESSING"].includes(existing.status)
        ? existing
        : await this.jobs.enqueueTranscription(projectId, { restartCompleted: true });
      return { projectId, state: "WAITING_TRANSCRIPTION", queuedJob: job, clipId: null, clipIds: [] };
    }

    if (!isCompletedAnalysis(project.analysis)) {
      const existing = await this.jobs.getAnalysisJob(projectId);
      if (isTerminalFailure(existing)) {
        return failedState(projectId, "ANALYSIS_FAILED", existing);
      }
      const analysisPayload = {
        minDuration: config.minClipDuration,
        maxDuration: config.maxClipDuration,
        targetDuration: config.targetClipDuration,
        maxCandidates: Math.min(50, Math.max(10, config.clipsPerSource * 4)),
      };
      const job = existing && ["QUEUED", "PROCESSING"].includes(existing.status)
        ? existing
        : await this.jobs.enqueueAnalysis(projectId, analysisPayload, { restartCompleted: true });
      return { projectId, state: "WAITING_ANALYSIS", queuedJob: job, clipId: null, clipIds: [] };
    }

    const selectedCandidates = selectAutopilotCandidates(project, config);
    if (selectedCandidates.length === 0) {
      return {
        projectId,
        state: "NO_ELIGIBLE_MOMENTS",
        queuedJob: null,
        clipId: null,
        clipIds: [],
        error: `No candidate reached the configured minimum score (${config.minClipScore}).`,
      };
    }

    let autoEditJob = await this.jobs.getAutoEditJob(projectId);
    const failedCandidateIds = new Set(
      autoEditJob?.status === "COMPLETED" && Array.isArray(autoEditJob?.result?.partialFailures)
        ? autoEditJob.result.partialFailures.map((item) => item?.candidateId).filter(Boolean)
        : [],
    );
    const existingClips = autoEditClipsByCandidate(project);
    const missingCandidateIds = selectedCandidates
      .map((candidate) => candidate.id)
      .filter((id) => !existingClips.has(id) && !failedCandidateIds.has(id));

    if (missingCandidateIds.length > 0) {
      if (isTerminalFailure(autoEditJob)) {
        return failedState(projectId, "AUTO_EDIT_FAILED", autoEditJob);
      }
      if (!autoEditJob || !["QUEUED", "PROCESSING"].includes(autoEditJob.status)) {
        autoEditJob = await this.jobs.enqueueAutoEdit(
          projectId,
          {
            candidateIds: missingCandidateIds,
            clipCount: config.clipsPerSource,
            minScore: config.minClipScore,
            generateSubtitles: true,
          },
          { restartCompleted: true },
        );
      }
      return {
        projectId,
        state: "WAITING_AUTO_EDIT",
        queuedJob: autoEditJob,
        clipId: null,
        clipIds: [...existingClips.values()].map((clip) => clip.id),
        candidateIds: selectedCandidates.map((candidate) => candidate.id),
      };
    }

    project = await loadProjectFile(projectId);
    const clipsByCandidate = autoEditClipsByCandidate(project);
    const targetClips = selectedCandidates
      .map((candidate) => clipsByCandidate.get(candidate.id))
      .filter(Boolean);

    if (targetClips.length === 0) {
      return {
        projectId,
        state: "AUTO_EDIT_PARTIAL_FAILURE",
        queuedJob: null,
        clipId: null,
        clipIds: [],
        errors: autoEditJob?.result?.partialFailures || [],
      };
    }

    const renderJobs = [];
    for (const clip of targetClips) {
      if (clip.status === "READY" && clip.render?.relativePath) continue;

      let job = await this.jobs.getRenderJob(projectId, clip.id);
      if (isTerminalFailure(job)) continue;

      if (!job || !["QUEUED", "PROCESSING"].includes(job.status)) {
        await markClipQueued(projectId, clip.id);
        job = await this.jobs.enqueueRender(
          projectId,
          clip.id,
          { clipId: clip.id },
          { restartCompleted: true },
        );
      }
      renderJobs.push(job);
    }

    if (renderJobs.length > 0) {
      return {
        projectId,
        state: "WAITING_RENDER",
        queuedJob: renderJobs[0],
        queuedJobs: renderJobs,
        clipId: targetClips[0]?.id || null,
        clipIds: targetClips.map((clip) => clip.id),
      };
    }

    project = await loadProjectFile(projectId);
    const finalClipsByCandidate = autoEditClipsByCandidate(project);
    const readyClips = selectedCandidates
      .map((candidate) => finalClipsByCandidate.get(candidate.id))
      .filter((clip) => clip?.status === "READY" && clip?.render?.relativePath);

    if (readyClips.length === 0) {
      const failures = [];
      for (const clip of targetClips) {
        const job = await this.jobs.getRenderJob(projectId, clip.id);
        if (job?.status === "FAILED") failures.push({ clipId: clip.id, error: job.error });
      }
      return {
        projectId,
        state: "RENDER_FAILED",
        queuedJob: null,
        clipId: null,
        clipIds: targetClips.map((clip) => clip.id),
        errors: failures,
      };
    }

    const eligibleChannels = await this.getEligibleChannels(config);
    if (eligibleChannels.length === 0) {
      return {
        projectId,
        state: "READY_FOR_PUBLICATION",
        queuedJob: null,
        clipId: readyClips[0].id,
        clipIds: readyClips.map((clip) => clip.id),
        eligibleChannelIds: [],
        publicationIds: [],
        approvalRequired: config.approvalRequired,
      };
    }

    const publications = [];
    const scheduleResults = [];

    for (const clip of readyClips) {
      for (const channel of eligibleChannels) {
        const created = await this.publications.createForClip({
          projectId,
          clipId: clip.id,
          channelId: channel.id,
          approvalRequired: config.approvalRequired,
        });
        publications.push(created.publication);

        if (!config.approvalRequired) {
          let current = created.publication;
          if (current.status === "WAITING_APPROVAL") {
            current = await this.publications.approve(current.id);
          }
          scheduleResults.push(await this.scheduler.schedulePublication(current.id, config));
        }
      }
    }

    return {
      projectId,
      state: config.approvalRequired ? "WAITING_APPROVAL" : "PUBLICATIONS_SCHEDULED",
      queuedJob: null,
      clipId: readyClips[0].id,
      clipIds: readyClips.map((clip) => clip.id),
      eligibleChannelIds: eligibleChannels.map((channel) => channel.id),
      publicationIds: publications.map((publication) => publication.id),
      approvalRequired: config.approvalRequired,
      ...(scheduleResults.length > 0 ? { scheduleResults } : {}),
    };
  }

  async getEligibleChannels(config = null) {
    const effectiveConfig = config || (await this.getConfig());
    const channels = await this.channels.listChannels();
    const allowedPlatforms = new Set(effectiveConfig.platforms);

    return channels.filter(
      (channel) =>
        channel.status === "CONNECTED" &&
        channel.publishingEnabled === true &&
        Number(channel.dailyLimit || 0) > 0 &&
        allowedPlatforms.has(channel.platform),
    );
  }
}

export function normalizeConfig(input = {}, fallback = null) {
  const createdAt = typeof input.createdAt === "string" && input.createdAt
    ? input.createdAt
    : fallback?.createdAt || new Date().toISOString();
  const minClipDuration = boundedNumber(
    input.minClipDuration,
    5,
    120,
    fallback?.minClipDuration ?? 15,
  );
  const maxClipDuration = boundedNumber(
    input.maxClipDuration,
    minClipDuration,
    180,
    fallback?.maxClipDuration ?? Math.max(60, minClipDuration),
  );

  return {
    enabled: Boolean(input.enabled),
    mode: enumValue(input.mode, MODES, fallback?.mode || "MANUAL"),
    approvalRequired:
      typeof input.approvalRequired === "boolean"
        ? input.approvalRequired
        : fallback?.approvalRequired ?? true,
    postsPerDay: boundedInteger(input.postsPerDay, 1, 50, fallback?.postsPerDay || 3),
    clipsPerSource: boundedInteger(
      input.clipsPerSource,
      1,
      20,
      fallback?.clipsPerSource || 3,
    ),
    minClipScore: boundedInteger(
      input.minClipScore,
      0,
      100,
      fallback?.minClipScore ?? 55,
    ),
    minClipDuration,
    maxClipDuration,
    targetClipDuration: boundedNumber(
      input.targetClipDuration,
      minClipDuration,
      maxClipDuration,
      fallback?.targetClipDuration ?? Math.min(30, maxClipDuration),
    ),
    platforms: normalizePlatforms(
      input.platforms,
      fallback?.platforms || ["TIKTOK", "YOUTUBE", "FACEBOOK"],
    ),
    preferredTimes: normalizeTimes(
      input.preferredTimes,
      fallback?.preferredTimes || ["09:00", "15:00", "20:00"],
    ),
    analyticsEnabled:
      typeof input.analyticsEnabled === "boolean"
        ? input.analyticsEnabled
        : fallback?.analyticsEnabled ?? true,
    learningEnabled:
      typeof input.learningEnabled === "boolean"
        ? input.learningEnabled
        : fallback?.learningEnabled ?? true,
    createdAt,
    updatedAt:
      typeof input.updatedAt === "string" && input.updatedAt
        ? input.updatedAt
        : new Date().toISOString(),
  };
}

export function selectAutopilotCandidates(project, config) {
  const candidates = Array.isArray(project?.analysis?.candidates)
    ? project.analysis.candidates
    : [];
  return [...candidates]
    .filter((candidate) => Number(candidate.viralScore || 0) >= Number(config.minClipScore || 0))
    .filter((candidate) => {
      const duration = Number(candidate.duration || 0);
      return duration >= config.minClipDuration && duration <= config.maxClipDuration;
    })
    .sort(
      (a, b) =>
        Number(b.viralScore || 0) - Number(a.viralScore || 0) ||
        Number(a.startTime || 0) - Number(b.startTime || 0),
    )
    .slice(0, config.clipsPerSource);
}

function autoEditClipsByCandidate(project) {
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  const map = new Map();
  for (const clip of clips) {
    const candidateId = clip?.autoEdit?.candidateId;
    if (!candidateId) continue;
    const existing = map.get(candidateId);
    if (!existing || Date.parse(clip.updatedAt || 0) > Date.parse(existing.updatedAt || 0)) {
      map.set(candidateId, clip);
    }
  }
  return map;
}

function failedState(projectId, state, job) {
  return {
    projectId,
    state,
    queuedJob: job,
    clipId: null,
    clipIds: [],
    error: job?.error || `${state} after retry limit.`,
  };
}

function isTerminalFailure(job) {
  return Boolean(
    job?.status === "FAILED" && Number(job?.attempts || 0) >= Number(job?.maxAttempts || 3),
  );
}

function isCompletedTranscript(transcript) {
  return Boolean(
    transcript?.status === "COMPLETED" &&
      Array.isArray(transcript?.segments) &&
      transcript.segments.length > 0,
  );
}

function isCompletedAnalysis(analysis) {
  return Boolean(
    analysis?.status === "COMPLETED" &&
      Array.isArray(analysis?.candidates) &&
      analysis.candidates.length > 0,
  );
}

function normalizePlatforms(value, fallback) {
  const input = Array.isArray(value) ? value : fallback;
  const output = [];
  for (const item of input) {
    const platform = String(item || "").trim().toUpperCase();
    if (PLATFORMS.has(platform) && !output.includes(platform)) output.push(platform);
  }
  if (output.length === 0) {
    throw new Error("Autopilot must target at least one supported platform.");
  }
  return output;
}

function normalizeTimes(value, fallback) {
  const input = Array.isArray(value) ? value : fallback;
  const output = [];
  for (const item of input) {
    const time = String(item || "").trim();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error(`Invalid preferred time: ${time || "empty"}.`);
    }
    if (!output.includes(time)) output.push(time);
  }
  if (output.length === 0) throw new Error("Autopilot requires at least one preferred time.");
  return output;
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || "").trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(min, Math.min(max, number)));
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
