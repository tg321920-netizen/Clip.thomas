import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { JobStore } from "../services/JobStore.mjs";
import { PublicationService } from "../services/publications/PublicationService.mjs";
import { PublishingService } from "../services/publishing/PublishingService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const CLIP_ID = "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-publishing-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    await mkdir(path.join(root, "projects"), { recursive: true });
    await mkdir(path.join(root, "clips", PROJECT_ID, CLIP_ID), { recursive: true });
    await fn(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function seedProject(root) {
  const relativePath = `clips/${PROJECT_ID}/${CLIP_ID}/render.mp4`;
  await writeFile(path.join(root, relativePath), Buffer.alloc(4096, 5));

  await writeFile(
    path.join(root, "projects", `${PROJECT_ID}.json`),
    JSON.stringify(
      {
        id: PROJECT_ID,
        createdAt: "2030-01-01T00:00:00.000Z",
        source: {
          projectId: PROJECT_ID,
          videoId: "d5944590-af07-41d8-ad70-4863bb8d83ac",
          originalName: "source.mp4",
          storedName: "source.mp4",
          relativePath: `uploads/${PROJECT_ID}/source.mp4`,
        },
        analysis: {
          candidates: [
            {
              id: "candidate-0001",
              title: "Título",
              text: "Texto del clip",
            },
          ],
        },
        clips: [
          {
            id: CLIP_ID,
            candidateId: "candidate-0001",
            duration: 25,
            status: "READY",
            render: {
              relativePath,
              width: 1080,
              height: 1920,
              sizeBytes: 4096,
            },
            autoEdit: {
              title: "Título Auto Edit",
              description: "Descripción Auto Edit",
              hashtags: ["#clipforge"],
            },
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

test("editing publication metadata resets approval and consent", async () => {
  await withStorage(async (root) => {
    await seedProject(root);
    const channels = new ChannelService();
    const channel = await channels.createChannel({
      platform: "TIKTOK",
      name: "TikTok",
      timezone: "UTC",
      status: "CONNECTED",
      publishingEnabled: true,
    });
    const publications = new PublicationService({ channels });
    const created = await publications.createForClip({
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      channelId: channel.id,
      approvalRequired: true,
    });

    const approved = await publications.approve(created.publication.id, {
      consent: true,
      platformSettings: {
        privacyLevel: "SELF_ONLY",
        publicVideoUrl: "https://media.example.com/clip.mp4",
      },
    });
    assert.ok(approved.consentAt);
    assert.ok(approved.metadataApprovedAt);

    const edited = await publications.updateDraft(created.publication.id, {
      description: "Texto que el usuario editó antes de publicar.",
    });

    assert.equal(edited.status, "WAITING_APPROVAL");
    assert.equal(edited.consentAt, null);
    assert.equal(edited.metadataApprovedAt, null);
  });
});

test("PublishingService submits a due scheduled publication through injected credentials/provider", async () => {
  await withStorage(async (root) => {
    await seedProject(root);
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
    await publications.schedule(
      created.publication.id,
      "2030-01-01T09:00:00.000Z",
    );

    const providerCalls = [];
    const service = new PublishingService({
      publications,
      channels,
      credentials: {
        isConfigured() {
          return true;
        },
        async get(channelId) {
          assert.equal(channelId, channel.id);
          return { accessToken: "test-token" };
        },
      },
      providerFactory(platform) {
        assert.equal(platform, "YOUTUBE");
        return {
          requirements() {
            return { oauthScopes: ["youtube.upload"] };
          },
          async publish(context) {
            providerCalls.push(context);
            return {
              externalPostId: "youtube-post-123",
              providerStatus: "PUBLISHED",
            };
          },
        };
      },
    });

    const result = await service.publishPublication(created.publication.id, {
      now: new Date("2030-01-01T09:01:00.000Z"),
    });

    assert.equal(result.publication.status, "PUBLISHED");
    assert.equal(result.publication.externalPostId, "youtube-post-123");
    assert.equal(providerCalls.length, 1);
    assert.match(providerCalls[0].media.filePath, /render\.mp4$/);
  });
});

test("PUBLISH_POST jobs are unique per publication", async () => {
  await withStorage(async () => {
    const store = new JobStore();
    const publicationA = "9f3d14d5-69f7-4acb-b687-f2b50fbf4d79";
    const publicationB = "e11fe2cf-638e-427b-bfb9-6f42af2de104";

    const first = await store.enqueuePublish(PROJECT_ID, publicationA);
    const duplicate = await store.enqueuePublish(PROJECT_ID, publicationA);
    const second = await store.enqueuePublish(PROJECT_ID, publicationB);

    assert.equal(first.id, duplicate.id);
    assert.notEqual(first.id, second.id);

    const claimed = await store.claimNext(["PUBLISH_POST"]);
    assert.equal(claimed?.type, "PUBLISH_POST");
    assert.ok([publicationA, publicationB].includes(claimed?.entityId));
  });
});
