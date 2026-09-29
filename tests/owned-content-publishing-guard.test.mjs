import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { replaceProjectFile } from "../lib/project-files.mjs";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { PublicationService } from "../services/publications/PublicationService.mjs";
import { PublishingService } from "../services/publishing/PublishingService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-owned-publish-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  const previousSwitch = process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  delete process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;
  try { await fn(); }
  finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    if (previousSwitch === undefined) delete process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;
    else process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING = previousSwitch;
    await rm(root, { recursive: true, force: true });
  }
}

test("PublishingService blocks a scheduled owned-content project while REAL PUBLISHING is OFF", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const channel = await channels.createChannel({ platform: "YOUTUBE", name: "Owned News", timezone: "UTC", status: "CONNECTED", publishingEnabled: true, dailyLimit: 1 });
    const projectId = crypto.randomUUID();
    const clipId = crypto.randomUUID();
    const now = new Date().toISOString();
    await replaceProjectFile(projectId, {
      id: projectId,
      createdAt: now,
      source: { projectId, originalName: "owned.mp4", storedName: "owned.mp4", sizeBytes: 1000, durationSeconds: 30, width: 1080, height: 1920, fps: 30, codec: "h264", container: "mp4", aspectRatio: "9:16", posterUrl: "", sourceUrl: "", relativePath: `clips/${projectId}/${clipId}.mp4` },
      ownedContent: { channelId: channel.id, topic: "Example story" },
      clips: [{
        id: clipId, projectId, candidateId: "owned-content", startTime: 0, endTime: 30, duration: 30,
        status: "READY", edit: { framingMode: "FILL", subtitlesEnabled: true, subtitleStyle: "CLEAN", quality: "BALANCED" },
        subtitles: null, autoEdit: null, autoReframe: null,
        render: { relativePath: `clips/${projectId}/${clipId}.mp4`, sourceUrl: "", width: 1080, height: 1920, codec: "h264", container: "mp4", sizeBytes: 1000, subtitlesBurned: true },
        createdAt: now, updatedAt: now, error: null,
      }],
    });

    const publications = new PublicationService({ channels });
    const created = await publications.createForClip({ projectId, clipId, channelId: channel.id, approvalRequired: true });
    await publications.approve(created.publication.id, { consent: true });
    const scheduledAt = new Date(Date.now() + 120_000).toISOString();
    await publications.schedule(created.publication.id, scheduledAt);

    const publishing = new PublishingService({
      publications,
      channels,
      credentials: { isConfigured: () => false, get: async () => null },
      oauth: { getValidCredentials: async () => null },
      providerFactory: () => ({ requirements: () => ({}), publish: async () => { throw new Error("provider should not be called"); } }),
    });

    await assert.rejects(
      () => publishing.publishPublication(created.publication.id, { now: new Date(Date.now() + 180_000) }),
      /real publishing is OFF/i,
    );

    process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING = "true";
    await assert.rejects(
      () => publishing.publishPublication(created.publication.id, { now: new Date(Date.now() + 180_000) }),
      /OAuth credentials are not configured/i,
    );
  });
});
