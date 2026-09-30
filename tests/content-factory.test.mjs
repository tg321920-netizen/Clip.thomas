import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrandService } from "../services/branding/BrandService.mjs";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { ContentFactoryService } from "../services/content-factory/ContentFactoryService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-factory-"));
  const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
  const previousPublishing = process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  delete process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;
  try {
    await fn();
  } finally {
    if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
    if (previousPublishing === undefined) delete process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;
    else process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING = previousPublishing;
    await rm(root, { recursive: true, force: true });
  }
}

test("Content Factory keeps owned channel configuration independent while reusing Channel and Brand services", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const brands = new BrandService();
    const factory = new ContentFactoryService({ channels, brands, bootstrapDefaults: false });

    const us = await channels.createChannel({
      platform: "YOUTUBE",
      name: "US News",
      timezone: "America/New_York",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 2,
    });
    const latam = await channels.createChannel({
      platform: "FACEBOOK",
      name: "Latam News",
      timezone: "America/Costa_Rica",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 3,
    });
    const usBrand = await brands.create({ name: "US Brand", tone: "Direct and factual" });
    const latamBrand = await brands.create({ name: "Latam Brand", tone: "Claro y neutral" });

    await factory.configure(us.id, {
      enabled: true,
      lineKey: "US_NEWS_EN",
      brandId: usBrand.id,
      postsPerDay: 2,
      preferredTimes: ["08:00", "17:00"],
      editTemplate: { framingMode: "FILL", quality: "HIGH", subtitleStyle: "CLEAN" },
      budget: { dailyBudgetUsd: 1, monthlyBudgetUsd: 10, maxCostPerContentUsd: 0.25 },
    });
    await factory.configure(latam.id, {
      enabled: true,
      lineKey: "LATAM_NEWS_ES",
      brandId: latamBrand.id,
      postsPerDay: 3,
      preferredTimes: ["09:00", "18:00"],
      editTemplate: { framingMode: "FIT", quality: "BALANCED", subtitleStyle: "VIRAL" },
      budget: { dailyBudgetUsd: 0, monthlyBudgetUsd: 0, maxCostPerContentUsd: 0 },
    });

    const first = await factory.getChannelView(us.id);
    const second = await factory.getChannelView(latam.id);

    assert.equal(first.profile.scope, "OWNED_CONTENT");
    assert.equal(second.profile.scope, "OWNED_CONTENT");
    assert.equal(first.profile.lineKey, "US_NEWS_EN");
    assert.equal(second.profile.lineKey, "LATAM_NEWS_ES");
    assert.equal(first.profile.brandId, usBrand.id);
    assert.equal(second.profile.brandId, latamBrand.id);
    assert.equal(first.profile.language, "en-US");
    assert.equal(second.profile.language, "es-419");
    assert.equal(first.profile.targetCountry, "US");
    assert.equal(second.profile.targetCountry, "LATAM");
    assert.equal(first.profile.voiceProfile, "US_NEWS_EN");
    assert.equal(second.profile.voiceProfile, "LATAM_NEWS_ES");
    assert.deepEqual(first.profile.editTemplate, { framingMode: "FILL", quality: "HIGH", subtitleStyle: "CLEAN" });
    assert.deepEqual(second.profile.editTemplate, { framingMode: "FIT", quality: "BALANCED", subtitleStyle: "VIRAL" });
    assert.equal(first.profile.budget.dailyBudgetUsd, 1);
    assert.equal(second.profile.budget.dailyBudgetUsd, 0);
    assert.equal(first.channel.dailyLimit, 2);
    assert.equal(second.channel.dailyLimit, 3);
    assert.equal(first.realPublishingEnabled, false);

    const dashboard = await factory.listDashboard();
    assert.equal(dashboard.scope, "OWNED_CONTENT");
    assert.equal(dashboard.presets.length, 3);
    assert.equal(dashboard.channels.length, 2);
    assert.deepEqual(Object.keys(dashboard.totals).sort(), [
      "failed", "pending", "processing", "published", "ready", "scheduled", "waitingApproval",
    ].sort());
  });
});

test("Content Factory does not fall back to the business-marketing workflow", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const factory = new ContentFactoryService({ channels, bootstrapDefaults: false });
    const channel = await channels.createChannel({
      platform: "TIKTOK",
      name: "Owned Entertainment",
      timezone: "America/Costa_Rica",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 1,
    });

    await factory.configure(channel.id, { enabled: true, lineKey: "ENTERTAINMENT_GOSSIP_ES" });

    await assert.rejects(
      () => factory.start(channel.id, {
        topic: "Example story",
        sources: [{ type: "TEXT", text: "Only one source is intentionally insufficient." }],
      }),
      /at least two independent sources/i,
    );

    const view = await factory.getChannelView(channel.id);
    assert.equal(view.profile.scope, "OWNED_CONTENT");
    assert.equal(view.profile.lineKey, "ENTERTAINMENT_GOSSIP_ES");
    assert.equal(view.profile.voiceProfile, "ENTERTAINMENT_ES");
  });
});
