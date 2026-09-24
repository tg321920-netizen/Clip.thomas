import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { AIUsageService } from "../ai/AIUsageService.mjs";
import { AutopilotService } from "../autopilot/AutopilotService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PerformanceAnalyzer } from "../learning/PerformanceAnalyzer.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";

export class DashboardService {
  constructor(options = {}) {
    this.autopilot = options.autopilot || new AutopilotService();
    this.channels = options.channels || new ChannelService();
    this.publications = options.publications || new PublicationService();
    this.performance = options.performance || new PerformanceAnalyzer();
    this.aiUsage = options.aiUsage || new AIUsageService();
  }

  async getSnapshot(options = {}) {
    const now = options.now || new Date();
    const [config, channels, publications, jobs, performance, aiUsage] =
      await Promise.all([
        this.autopilot.getConfig(),
        this.channels.listChannels(),
        this.publications.list(),
        listJobs(),
        this.performance.analyze(),
        this.aiUsage.summary(),
      ]);

    const channelById = new Map(channels.map((channel) => [channel.id, channel]));
    const todayPosts = publications.filter((publication) => {
      if (!new Set(["SCHEDULED", "PUBLISHING", "PUBLISHED"]).has(publication.status)) {
        return false;
      }
      const timestamp = publication.publishedAt || publication.scheduledAt;
      const channel = channelById.get(publication.channelId);
      return isSameLocalDay(timestamp, now, channel?.timezone || "UTC");
    });

    const approvals = publications
      .filter((publication) => publication.status === "WAITING_APPROVAL")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, 30);

    const upcoming = publications
      .filter((publication) => publication.status === "SCHEDULED" && publication.scheduledAt)
      .filter((publication) => Date.parse(publication.scheduledAt) >= now.getTime() - 60_000)
      .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
      .slice(0, 30);

    const failedPublications = publications
      .filter((publication) => publication.status === "FAILED")
      .slice(-30)
      .reverse();
    const failedJobs = jobs
      .filter((job) => job.status === "FAILED")
      .slice(-30)
      .reverse();

    return {
      generatedAt: new Date().toISOString(),
      config,
      summary: {
        connectedChannels: channels.filter((channel) => channel.status === "CONNECTED").length,
        publishingChannels: channels.filter(
          (channel) => channel.status === "CONNECTED" && channel.publishingEnabled === true,
        ).length,
        todayPosts: todayPosts.length,
        approvalCount: approvals.length,
        upcomingCount: upcoming.length,
        queueCount: jobs.filter((job) => ["QUEUED", "PROCESSING"].includes(job.status)).length,
        errorCount: failedPublications.length + failedJobs.length,
        publishedTotal: publications.filter((publication) => publication.status === "PUBLISHED").length,
      },
      aiUsage,
      channels: channels.map((channel) => ({
        id: channel.id,
        platform: channel.platform,
        name: channel.name,
        status: channel.status,
        publishingEnabled: channel.publishingEnabled,
        dailyLimit: channel.dailyLimit,
        timezone: channel.timezone,
      })),
      queue: jobs
        .filter((job) => ["QUEUED", "PROCESSING"].includes(job.status))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .slice(0, 50),
      approvals,
      upcoming,
      errors: {
        publications: failedPublications,
        jobs: failedJobs,
      },
      performance: {
        sampleCount: performance.sampleCount,
        recommendations: performance.recommendations,
        disclaimer: performance.disclaimer,
      },
    };
  }
}

async function listJobs() {
  const directory = path.join(getStorageRoot(), "jobs");
  await mkdir(directory, { recursive: true });
  const names = await readdir(directory);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          const value = JSON.parse(await readFile(path.join(directory, name), "utf8"));
          return sanitizeJob(value);
        } catch {
          return null;
        }
      }),
  );
  return records.filter(Boolean).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function sanitizeJob(job) {
  if (!job || typeof job !== "object" || typeof job.id !== "string") return null;
  return {
    id: job.id,
    type: job.type || "UNKNOWN",
    projectId: job.projectId || null,
    entityId: job.entityId || null,
    status: job.status || "UNKNOWN",
    progress: Number(job.progress || 0),
    attempts: Number(job.attempts || 0),
    error: job.error || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
    nextAttemptAt: job.nextAttemptAt || null,
  };
}

function isSameLocalDay(value, now, timezone) {
  if (!value) return false;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return false;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(instant) === formatter.format(now);
  } catch {
    return false;
  }
}
