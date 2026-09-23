import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ChannelService,
  normalizeStrategy,
  normalizeTimezone,
} from "../services/channels/ChannelService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-channels-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("creates, lists and updates channels with a default strategy", async () => {
  await withStorage(async () => {
    const service = new ChannelService();

    const created = await service.createChannel({
      platform: "TIKTOK",
      name: "TikTok principal",
      timezone: "America/Costa_Rica",
      dailyLimit: 3,
    });

    assert.equal(created.platform, "TIKTOK");
    assert.equal(created.status, "DISCONNECTED");
    assert.equal(created.publishingEnabled, false);
    assert.equal(created.userId, null);
    assert.equal(created.strategy.channelId, created.id);
    assert.equal(created.strategy.dailyPostLimit, 3);

    const listed = await service.listChannels();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);

    const updated = await service.updateChannel(created.id, {
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 5,
    });

    assert.equal(updated.status, "CONNECTED");
    assert.equal(updated.publishingEnabled, true);
    assert.equal(updated.dailyLimit, 5);
  });
});

test("publishing cannot be enabled while channel is disconnected", async () => {
  await withStorage(async () => {
    const service = new ChannelService();
    const created = await service.createChannel({
      platform: "YOUTUBE",
      name: "Shorts",
      timezone: "UTC",
    });

    await assert.rejects(
      () =>
        service.updateChannel(created.id, {
          publishingEnabled: true,
        }),
      /cannot be enabled/i,
    );
  });
});

test("editorial strategy keeps independent channel instructions", async () => {
  await withStorage(async () => {
    const service = new ChannelService();
    const created = await service.createChannel({
      platform: "FACEBOOK",
      name: "Reels historias",
      timezone: "America/Mexico_City",
    });

    const strategy = await service.updateStrategy(created.id, {
      name: "Impacto",
      description: "Historias y momentos sorprendentes.",
      systemPrompt: "Prefiere historias claras y evita contenido sin contexto.",
      preferredMinDuration: 20,
      preferredMaxDuration: 45,
      dailyPostLimit: 2,
      preferredTopics: ["historias", "sorpresa", "Historias"],
      avoidTopics: ["política", "contenido sin contexto"],
    });

    assert.equal(strategy.name, "Impacto");
    assert.equal(strategy.preferredMinDuration, 20);
    assert.equal(strategy.preferredMaxDuration, 45);
    assert.equal(strategy.dailyPostLimit, 2);
    assert.deepEqual(strategy.preferredTopics, ["historias", "sorpresa"]);
    assert.deepEqual(strategy.avoidTopics, ["política", "contenido sin contexto"]);
  });
});

test("platform and timezone validation reject unsupported values", async () => {
  await withStorage(async () => {
    const service = new ChannelService();

    await assert.rejects(
      () => service.createChannel({ platform: "MYSPACE", name: "x" }),
      /unsupported platform/i,
    );

    assert.throws(() => normalizeTimezone("Not/A_Real_Zone"), /timezone is invalid/i);
  });
});

test("strategy duration and limits are bounded", () => {
  const strategy = normalizeStrategy(
    "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6",
    {
      preferredMinDuration: 30,
      preferredMaxDuration: 10,
      dailyPostLimit: 999,
    },
  );

  assert.equal(strategy.preferredMinDuration, 30);
  assert.equal(strategy.preferredMaxDuration, 30);
  assert.equal(strategy.dailyPostLimit, 50);
});
