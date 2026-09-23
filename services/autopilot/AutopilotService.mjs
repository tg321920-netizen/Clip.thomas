import { AutopilotRepository } from "./AutopilotRepository.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { JobStore } from "../JobStore.mjs";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { markClipQueued } from "../clip/ClipService.mjs";

const PLATFORMS = new Set(["TIKTOK", "YOUTUBE", "FACEBOOK"]);
const MODES = new Set(["MANUAL", "AUTOPILOT"]);

export class AutopilotService {
  constructor(options = {}) {
    this.repository = options.repository || new AutopilotRepository();
    this.jobs = options.jobs || new JobStore();
    this.channels = options.channels || new ChannelService();
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

    if (!config.enabled || config.mode !== "AUTOPILOT") {
      if (!allowManual) {
        return {
          projectId,
          state: "DISABLED",
          queuedJob: null,
          clipId: null,
        };
      }
    }

    const project = await loadProjectFile(projectId);
    if (!project) throw new Error("Project not found.");

    if (!isCompletedTranscript(project.transcript)) {
      const job = await this.jobs.enqueueTranscription(projectId);
      return {
        projectId,
        state: "WAITING_TRANSCRIPTION",
        queuedJob: job,
        clipId: null,
      };
    }

    if (!isCompletedAnalysis(project.analysis)) {
      const job = await this.jobs.enqueueAnalysis(projectId, {}, {
        restartCompleted: true,
      });
      return {
        projectId,
        state: "WAITING_ANALYSIS",
        queuedJob: job,
        clipId: null,
      };
    }

    const autoEditClip = latestAutoEditClip(project);
    if (!autoEditClip) {
      const job = await this.jobs.enqueueAutoEdit(
        projectId,
        { generateSubtitles: true },
        { restartCompleted: true },
      );
      return {
        projectId,
        state: "WAITING_AUTO_EDIT",
        queuedJob: job,
        clipId: null,
      };
    }

    if (autoEditClip.status !== "READY" || !autoEditClip.render?.relativePath) {
      const existingRenderJob = await this.jobs.getRenderJob(
        projectId,
        autoEditClip.id,
      );

      if (
        autoEditClip.status === "QUEUED" ||
        autoEditClip.status === "RENDERING"
      ) {
        return {
          projectId,
          state: "WAITING_RENDER",
          queuedJob: existingRenderJob,
          clipId: autoEditClip.id,
        };
      }

      await markClipQueued(projectId, autoEditClip.id);
      const job = await this.jobs.enqueueRender(
        projectId,
        autoEditClip.id,
        { clipId: autoEditClip.id },
        { restartCompleted: true },
      );

      return {
        projectId,
        state: "WAITING_RENDER",
        queuedJob: job,
        clipId: autoEditClip.id,
      };
    }

    const eligibleChannels = await this.getEligibleChannels(config);

    return {
      projectId,
      state: "READY_FOR_PUBLICATION",
      queuedJob: null,
      clipId: autoEditClip.id,
      eligibleChannelIds: eligibleChannels.map((channel) => channel.id),
      approvalRequired: config.approvalRequired,
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
  const createdAt =
    typeof input.createdAt === "string" && input.createdAt
      ? input.createdAt
      : fallback?.createdAt || new Date().toISOString();

  return {
    enabled: Boolean(input.enabled),
    mode: enumValue(input.mode, MODES, fallback?.mode || "MANUAL"),
    approvalRequired:
      typeof input.approvalRequired === "boolean"
        ? input.approvalRequired
        : fallback?.approvalRequired ?? true,
    postsPerDay: boundedInteger(
      input.postsPerDay,
      1,
      50,
      fallback?.postsPerDay || 3,
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

function latestAutoEditClip(project) {
  const clips = Array.isArray(project?.clips) ? project.clips : [];

  return (
    [...clips]
      .filter((clip) => clip?.autoEdit?.createdAt)
      .sort(
        (a, b) =>
          Date.parse(b.autoEdit.createdAt) - Date.parse(a.autoEdit.createdAt),
      )[0] || null
  );
}

function normalizePlatforms(value, fallback) {
  const input = Array.isArray(value) ? value : fallback;
  const output = [];

  for (const item of input) {
    const platform = String(item || "").trim().toUpperCase();
    if (PLATFORMS.has(platform) && !output.includes(platform)) {
      output.push(platform);
    }
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

  if (output.length === 0) {
    throw new Error("Autopilot requires at least one preferred time.");
  }

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
