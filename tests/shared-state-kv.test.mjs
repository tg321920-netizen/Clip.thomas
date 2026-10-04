import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChannelRepository } from "../services/channels/ChannelRepository.mjs";
import { PublicationRepository } from "../services/publications/PublicationRepository.mjs";
import { recoverPersistedYouTubePublication } from "../services/publishing/SmartPublishJobService.mjs";

class MemoryKv {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    return this.map.get(key) || null;
  }

  async set(key, value) {
    this.map.set(key, value);
    return true;
  }

  async delete(key) {
    return this.map.delete(key);
  }
}

const channelId = "7e3c2a01-7d6f-4e9f-b461-8f7f1a3d2c90";
const publicationId = "11a3245f-3cf6-4c3d-a4fd-f97fc75bdd5a";
const projectId = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const clipId = "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-shared-state-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    await fn(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("channel and publication state recover from shared KV after local storage disappears", async () => {
  await withStorage(async (root) => {
    const kv = new MemoryKv();
    const channels = new ChannelRepository({ kv });
    const publications = new PublicationRepository({ kv });
    const now = new Date().toISOString();

    await channels.save({
      id: channelId,
      platform: "YOUTUBE",
      name: "Persisted YouTube",
      status: "CONNECTED",
      publishingEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    await publications.save({
      id: publicationId,
      idempotencyKey: `${clipId}:${channelId}`,
      projectId,
      clipId,
      channelId,
      platform: "YOUTUBE",
      title: "Persisted clip",
      status: "PUBLISHING",
      externalPostId: "youtube-video-123",
      externalPostUrl: "https://www.youtube.com/watch?v=youtube-video-123",
      createdAt: now,
      updatedAt: now,
    });

    await rm(path.join(root, "channels"), { recursive: true, force: true });
    await rm(path.join(root, "publications"), { recursive: true, force: true });

    const restartedChannels = new ChannelRepository({ kv });
    const restartedPublications = new PublicationRepository({ kv });

    const channel = await restartedChannels.get(channelId);
    const publication = await restartedPublications.get(publicationId);
    const listedChannels = await restartedChannels.list();
    const listedPublications = await restartedPublications.list({
      channelId,
    });

    assert.equal(channel?.status, "CONNECTED");
    assert.equal(channel?.publishingEnabled, true);
    assert.equal(publication?.status, "PUBLISHING");
    assert.equal(publication?.externalPostId, "youtube-video-123");
    assert.equal(listedChannels.some((item) => item.id === channelId), true);
    assert.equal(
      listedPublications.some((item) => item.id === publicationId),
      true,
    );
  });
});

test("smart publish safely resumes a persisted YouTube upload after restart", async () => {
  let refreshCalls = 0;
  const publishing = {
    publications: {
      async get(id) {
        assert.equal(id, publicationId);
        return {
          id,
          status: "PUBLISHING",
          externalPostId: "youtube-video-123",
          externalPostUrl: "https://www.youtube.com/watch?v=youtube-video-123",
        };
      },
    },
    async refreshPublicationStatus(id) {
      refreshCalls += 1;
      assert.equal(id, publicationId);
      return {
        publication: {
          id,
          status: "PUBLISHED",
          externalPostId: "youtube-video-123",
          externalPostUrl: "https://www.youtube.com/watch?v=youtube-video-123",
        },
      };
    },
  };

  const publication = await recoverPersistedYouTubePublication(
    {
      publicationId,
      stage: "YOUTUBE_PROCESSING",
    },
    publishing,
    {
      maxPolls: 1,
      pollMs: 0,
      sleepFn: async () => undefined,
    },
  );

  assert.equal(refreshCalls, 1);
  assert.equal(publication.status, "PUBLISHED");
  assert.equal(
    publication.externalPostUrl,
    "https://www.youtube.com/watch?v=youtube-video-123",
  );
});

test("smart publish refuses to duplicate an indeterminate upload after restart", async () => {
  let uploadCalls = 0;
  const publishing = {
    publications: {
      async get() {
        return {
          id: publicationId,
          status: "PUBLISHING",
          externalPostId: null,
        };
      },
    },
    async publishPublication() {
      uploadCalls += 1;
      throw new Error("must not upload");
    },
    async refreshPublicationStatus() {
      throw new Error("must not refresh without a video id");
    },
  };

  await assert.rejects(
    () =>
      recoverPersistedYouTubePublication(
        {
          publicationId,
          stage: "UPLOADING_TO_YOUTUBE",
        },
        publishing,
        {
          maxPolls: 1,
          pollMs: 0,
          sleepFn: async () => undefined,
        },
      ),
    /refusing an unsafe duplicate upload/i,
  );

  assert.equal(uploadCalls, 0);
});

test("smart publish can safely resume before upload when publication is still scheduled", async () => {
  let uploadCalls = 0;
  let refreshCalls = 0;
  const publishing = {
    publications: {
      async get() {
        return {
          id: publicationId,
          status: "SCHEDULED",
          externalPostId: null,
        };
      },
    },
    async publishPublication(id) {
      uploadCalls += 1;
      assert.equal(id, publicationId);
      return {
        publication: {
          id,
          status: "PUBLISHING",
          externalPostId: "youtube-video-safe-resume",
          externalPostUrl:
            "https://www.youtube.com/watch?v=youtube-video-safe-resume",
        },
      };
    },
    async refreshPublicationStatus(id) {
      refreshCalls += 1;
      return {
        publication: {
          id,
          status: "PUBLISHED",
          externalPostId: "youtube-video-safe-resume",
          externalPostUrl:
            "https://www.youtube.com/watch?v=youtube-video-safe-resume",
        },
      };
    },
  };

  const publication = await recoverPersistedYouTubePublication(
    {
      publicationId,
      stage: "UPLOADING_TO_YOUTUBE",
    },
    publishing,
    {
      maxPolls: 1,
      pollMs: 0,
      sleepFn: async () => undefined,
    },
  );

  assert.equal(uploadCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(publication.status, "PUBLISHED");
});
