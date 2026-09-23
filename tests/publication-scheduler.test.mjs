import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { PublicationService } from "../services/publications/PublicationService.mjs";
import {
  SchedulerService,
  effectiveDailyLimit,
  findNextSlot,
  zonedDateTimeToUtc,
} from "../services/scheduler/SchedulerService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const CLIP_ID = "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-publications-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    await mkdir(path.join(root, "projects"), { recursive: true });
    await fn(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function seedProject(root) {
  const project = {
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
          title: "Título candidato",
          text: "Texto candidato",
        },
      ],
    },
    clips: [
      {
        id: CLIP_ID,
        candidateId: "candidate-0001",
        status: "READY",
        render: {
          relativePath: `clips/${PROJECT_ID}/${CLIP_ID}/render.mp4`,
        },
        autoEdit: {
          title: "Título Auto Edit",
          description: "Descripción preparada para publicar.",
          hashtags: ["#clipforge", "#video"],
        },
      },
    ],
  };

  await writeFile(
    path.join(root, "projects", `${PROJECT_ID}.json`),
    JSON.stringify(project, null, 2),
    "utf8",
  );
}

test("Publication creation is idempotent per clip and channel", async () => {
  await withStorage(async (root) => {
    await seedProject(root);
    const channels = new ChannelService();
    const channel = await channels.createChannel({
      platform: "TIKTOK",
      name: "TikTok A",
      timezone: "America/Costa_Rica",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 3,
    });
    const publications = new PublicationService({ channels });

    const first = await publications.createForClip({
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      channelId: channel.id,
      approvalRequired: true,
    });
    const second = await publications.createForClip({
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      channelId: channel.id,
      approvalRequired: true,
    });

    assert.equal(first.publication.status, "WAITING_APPROVAL");
    assert.equal(second.reused, true);
    assert.equal(second.publication.id, first.publication.id);
    assert.equal(first.publication.title, "Título Auto Edit");
    assert.deepEqual(first.publication.hashtags, ["#clipforge", "#video"]);
  });
});

test("waiting approval is never scheduled automatically", async () => {
  await withStorage(async (root) => {
    await seedProject(root);
    const channels = new ChannelService();
    const channel = await channels.createChannel({
      platform: "YOUTUBE",
      name: "Shorts",
      timezone: "UTC",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 2,
    });
    const publications = new PublicationService({ channels });
    const scheduler = new SchedulerService({ publications, channels });

    const created = await publications.createForClip({
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      channelId: channel.id,
      approvalRequired: true,
    });

    const result = await scheduler.schedulePublication(
      created.publication.id,
      {
        postsPerDay: 2,
        preferredTimes: ["09:00", "17:00"],
      },
      { now: new Date("2030-01-01T08:00:00.000Z") },
    );

    assert.equal(result.scheduled, false);
    assert.equal(result.reason, "WAITING_APPROVAL");
    assert.equal(result.publication.scheduledAt, null);
  });
});

test("approved publication is scheduled in channel timezone", async () => {
  await withStorage(async (root) => {
    await seedProject(root);
    const channels = new ChannelService();
    const channel = await channels.createChannel({
      platform: "FACEBOOK",
      name: "Reels",
      timezone: "America/Costa_Rica",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 2,
      strategy: { dailyPostLimit: 2 },
    });
    const publications = new PublicationService({ channels });
    const scheduler = new SchedulerService({ publications, channels });

    const created = await publications.createForClip({
      projectId: PROJECT_ID,
      clipId: CLIP_ID,
      channelId: channel.id,
      approvalRequired: true,
    });
    await publications.approve(created.publication.id);

    const result = await scheduler.schedulePublication(
      created.publication.id,
      {
        postsPerDay: 2,
        preferredTimes: ["09:00", "15:00"],
      },
      { now: new Date("2030-01-01T13:00:00.000Z") },
    );

    assert.equal(result.scheduled, true);
    assert.equal(result.publication.status, "SCHEDULED");
    assert.equal(result.publication.scheduledAt, "2030-01-01T15:00:00.000Z");
  });
});

test("scheduler respects daily limits and moves to the next local day", () => {
  const channel = {
    id: "0f99f199-192d-4900-95c6-dbbb60130ee8",
    status: "CONNECTED",
    publishingEnabled: true,
    dailyLimit: 1,
    timezone: "America/Costa_Rica",
    strategy: { dailyPostLimit: 3 },
  };
  const config = {
    postsPerDay: 4,
    preferredTimes: ["09:00", "15:00"],
  };
  const publications = [
    {
      status: "SCHEDULED",
      scheduledAt: "2030-01-01T15:00:00.000Z",
    },
  ];

  const slot = findNextSlot({
    channel,
    config,
    publications,
    now: new Date("2030-01-01T13:00:00.000Z"),
    horizonDays: 3,
  });

  assert.equal(effectiveDailyLimit(channel, config), 1);
  assert.equal(slot?.toISOString(), "2030-01-02T15:00:00.000Z");
});

test("timezone conversion handles UTC and Costa Rica local time", () => {
  assert.equal(
    zonedDateTimeToUtc(
      { year: 2030, month: 1, day: 1, hour: 9, minute: 0 },
      "UTC",
    )?.toISOString(),
    "2030-01-01T09:00:00.000Z",
  );

  assert.equal(
    zonedDateTimeToUtc(
      { year: 2030, month: 1, day: 1, hour: 9, minute: 0 },
      "America/Costa_Rica",
    )?.toISOString(),
    "2030-01-01T15:00:00.000Z",
  );
});
