import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { ContentFactoryService } from "../services/content-factory/ContentFactoryService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-owned-isolation-"));
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

test("US NEWS, LATAM NEWS and ENTERTAINMENT keep independent channel profiles", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const factory = new ContentFactoryService({ channels });
    const us = await channels.createChannel({ platform: "YOUTUBE", name: "US News", timezone: "America/New_York", status: "CONNECTED", publishingEnabled: true, dailyLimit: 2 });
    const latam = await channels.createChannel({ platform: "FACEBOOK", name: "Latam News", timezone: "America/Costa_Rica", status: "CONNECTED", publishingEnabled: true, dailyLimit: 3 });
    const entertainment = await channels.createChannel({ platform: "TIKTOK", name: "Entertainment", timezone: "America/Mexico_City", status: "CONNECTED", publishingEnabled: true, dailyLimit: 4 });

    await factory.configure(us.id, { enabled: true, lineKey: "US_NEWS_EN", postsPerDay: 2, budget: { dailyBudgetUsd: 1, monthlyBudgetUsd: 10, maxCostPerContentUsd: 0.25 }, editTemplate: { subtitleStyle: "CLEAN" } });
    await factory.configure(latam.id, { enabled: true, lineKey: "LATAM_NEWS_ES", postsPerDay: 3, budget: { dailyBudgetUsd: 0, monthlyBudgetUsd: 0, maxCostPerContentUsd: 0 }, editTemplate: { subtitleStyle: "VIRAL" } });
    await factory.configure(entertainment.id, { enabled: true, lineKey: "ENTERTAINMENT_GOSSIP_ES", postsPerDay: 4, strategyText: "Priorizar polémicas verificadas y fuentes directas.", editTemplate: { subtitleStyle: "KARAOKE" } });

    const a = await factory.getChannelView(us.id);
    const b = await factory.getChannelView(latam.id);
    const c = await factory.getChannelView(entertainment.id);

    assert.equal(a.profile.lineKey, "US_NEWS_EN");
    assert.equal(a.profile.language, "en-US");
    assert.equal(a.profile.targetCountry, "US");
    assert.equal(a.profile.voiceProfile, "US_NEWS_EN");
    assert.equal(a.profile.budget.dailyBudgetUsd, 1);
    assert.equal(a.profile.editTemplate.subtitleStyle, "CLEAN");

    assert.equal(b.profile.lineKey, "LATAM_NEWS_ES");
    assert.equal(b.profile.language, "es-419");
    assert.equal(b.profile.targetCountry, "LATAM");
    assert.equal(b.profile.voiceProfile, "LATAM_NEWS_ES");
    assert.equal(b.profile.budget.dailyBudgetUsd, 0);
    assert.equal(b.profile.editTemplate.subtitleStyle, "VIRAL");

    assert.equal(c.profile.lineKey, "ENTERTAINMENT_GOSSIP_ES");
    assert.equal(c.profile.voiceProfile, "ENTERTAINMENT_ES");
    assert.match(c.profile.strategyText, /polémicas verificadas/i);
    assert.equal(c.profile.editTemplate.subtitleStyle, "KARAOKE");

    assert.notDeepEqual(a.profile.rules, c.profile.rules);
    assert.notEqual(a.profile.language, c.profile.language);
    assert.equal(a.realPublishingEnabled, false);
    assert.equal(b.realPublishingEnabled, false);
    assert.equal(c.realPublishingEnabled, false);
  });
});
