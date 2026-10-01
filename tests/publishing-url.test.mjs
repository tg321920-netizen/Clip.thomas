import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { PublicationService } from "../services/publications/PublicationService.mjs";
import { PublishingService } from "../services/publishing/PublishingService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const CLIP_ID = "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b";

test("PublishingService persists a real provider post URL alongside the external id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-publish-url-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  const previousRealPublishing = process.env.CLIPFORGE_AGENT_REAL_PUBLISHING;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = "true";

  try {
    const relativePath = `clips/${PROJECT_ID}/${CLIP_ID}/render.mp4`;
    await mkdir(path.join(root, "projects"), { recursive: true });
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), Buffer.alloc(1024, 7));
    await writeFile(
      path.join(root, "projects", `${PROJECT_ID}.json`),
      JSON.stringify({
        id: PROJECT_ID,
        createdAt: new Date().toISOString(),
        clips: [{
          id: CLIP_ID,
          candidateId: "candidate-1",
          duration: 25,
          status: "READY",
          render: { relativePath, width: 1080, height: 1920, sizeBytes: 1024 },
        }],
      }),
      "utf8",
    );

    const channels = new ChannelService();
    const channel = await channels.createChannel({
      platform: "YOUTUBE",
      name: "YouTube",
      timezone: "UTC",
      status: "CONNECTED",
      publishingEnabled: true,
    });
    const publications = new PublicationService({ channels });
    const created = await publications.createForClip({
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      channelId: channel.id,
      approvalRequired: false,
    });
    const scheduledAt = new Date(Date.now() + 30_000).toISOString();
    await publications.schedule(created.publication.id, scheduledAt);

    const service = new PublishingService({
      publications,
      channels,
      credentials: {
        isConfigured() { return true; },
        async get() { return { accessToken: "test-token" }; },
      },
      providerFactory() {
        return {
          requirements() { return {}; },
          async publish() {
            return {
              externalPostId: "youtube-video-123",
              externalPostUrl: "https://www.youtube.com/watch?v=youtube-video-123",
              providerStatus: "PUBLISHED",
            };
          },
        };
      },
    });

    const result = await service.publishPublication(created.publication.id, {
      now: new Date(Date.now() + 60_000),
    });

    assert.equal(result.publication.status, "PUBLISHED");
    assert.equal(result.publication.externalPostId, "youtube-video-123");
    assert.equal(
      result.publication.externalPostUrl,
      "https://www.youtube.com/watch?v=youtube-video-123",
    );
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    if (previousRealPublishing === undefined) delete process.env.CLIPFORGE_AGENT_REAL_PUBLISHING;
    else process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = previousRealPublishing;
    await rm(root, { recursive: true, force: true });
  }
});
