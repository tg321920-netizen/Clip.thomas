import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { ContentFactoryService } from "../services/content-factory/ContentFactoryService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-owned-bootstrap-"));
  const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
  const previousBootstrap = process.env.CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  process.env.CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS = "true";
  try {
    await fn();
  } finally {
    if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
    if (previousBootstrap === undefined) delete process.env.CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS;
    else process.env.CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS = previousBootstrap;
    await rm(root, { recursive: true, force: true });
  }
}

test("bootstraps three owned content lines across supported platforms without enabling publishing", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const factory = new ContentFactoryService({ channels, bootstrapDefaults: true });

    const dashboard = await factory.listDashboard();

    assert.equal(dashboard.channels.length, 9);
    assert.deepEqual(
      [...new Set(dashboard.channels.map((item) => item.profile.lineKey))].sort(),
      ["ENTERTAINMENT_GOSSIP_ES", "LATAM_NEWS_ES", "US_NEWS_EN"].sort(),
    );
    assert.deepEqual(
      [...new Set(dashboard.channels.map((item) => item.channel.platform))].sort(),
      ["FACEBOOK", "TIKTOK", "YOUTUBE"].sort(),
    );

    for (const item of dashboard.channels) {
      assert.equal(item.channel.scope, "OWNED_CONTENT");
      assert.equal(item.channel.systemManaged, true);
      assert.equal(item.channel.status, "DISCONNECTED");
      assert.equal(item.channel.publishingEnabled, false);
      assert.equal(item.channel.dailyLimit, 0);
      assert.equal(item.profile.enabled, true);
      assert.equal(item.profile.budget.dailyBudgetUsd, 0);
      assert.equal(item.profile.budget.monthlyBudgetUsd, 0);
      assert.equal(item.profile.budget.maxCostPerContentUsd, 0);
    }
  });
});

test("bootstrap is idempotent and keeps deterministic channel ids", async () => {
  await withStorage(async () => {
    const factory = new ContentFactoryService({ bootstrapDefaults: true });

    const first = await factory.listDashboard();
    const second = await factory.listDashboard();

    assert.deepEqual(
      first.channels.map((item) => item.channel.id).sort(),
      second.channels.map((item) => item.channel.id).sort(),
    );
    assert.equal(new Set(second.channels.map((item) => item.channel.id)).size, 9);
  });
});

test("channel scopes isolate owned content from marketing by default", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const marketing = await channels.createChannel({
      platform: "YOUTUBE",
      name: "Business Marketing",
      timezone: "UTC",
    });

    const factory = new ContentFactoryService({ channels, bootstrapDefaults: true });
    const dashboard = await factory.listDashboard();

    assert.equal(marketing.scope, "MARKETING");
    assert.equal((await channels.listChannels({ scope: "MARKETING" })).length, 1);
    assert.equal((await channels.listChannels({ scope: "OWNED_CONTENT" })).length, 9);
    assert.equal(dashboard.channels.some((item) => item.channel.id === marketing.id), false);
  });
});
