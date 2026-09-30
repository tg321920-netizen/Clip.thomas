import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SourceService } from "../services/sources/SourceService.mjs";
import { ResearchEngine } from "../services/owned-content/ResearchEngine.mjs";
import { OriginalNewsScriptService } from "../services/owned-content/OriginalNewsScriptService.mjs";
import { RightsGuard } from "../services/owned-content/RightsGuard.mjs";
import { CoherenceGate } from "../services/owned-content/CoherenceGate.mjs";
import { ContentCostService } from "../services/owned-content/ContentCostService.mjs";
import { TrendHunterService } from "../services/owned-content/TrendHunterService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-owned-core-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try { await fn(); }
  finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("Research Engine uses multiple sources and never promotes rumor to FACT", async () => {
  await withStorage(async () => {
    const channelId = crypto.randomUUID();
    const sources = new SourceService();
    const first = await sources.create({ type: "TEXT", text: "On September 29, 2026, City Hall opened the new public shelter after the council vote. Officials said 120 beds are available. Rumor says a second building will open next week, but that has not been confirmed." });
    const second = await sources.create({ type: "TEXT", text: "City Hall opened the new public shelter on September 29, 2026 after a council vote. The municipality reported that the shelter has 120 beds. No official announcement confirms a second building." });
    const research = await new ResearchEngine({ sources }).research({
      channelId,
      topic: "City opens new public shelter after council vote",
      sourceIds: [first.id, second.id],
      who: ["City Hall"],
      where: ["the city"],
    });

    assert.equal(research.sources.length, 2);
    assert.ok(research.confirmedFacts.length >= 1);
    assert.ok(research.unconfirmed.some((claim) => /Rumor/i.test(claim.text)));
    assert.ok(research.unconfirmed.every((claim) => claim.type === "UNCONFIRMED"));
    assert.ok(research.confirmedFacts.every((claim) => claim.supportCount >= 2));
    assert.equal(research.discrepancies.length, 0);

    const script = new OriginalNewsScriptService().create({ research, language: "en-US", format: "SHORT" });
    assert.equal(script.status, "READY");
    assert.deepEqual(script.sections.slice(0, 2).map((section) => section.key), ["HOOK", "WHAT_HAPPENED"]);
    assert.equal(script.originality.directQuoteWords, 0);
    assert.ok(script.narration.includes("Why this matters") || script.sections.some((section) => section.key === "WHY_IT_MATTERS") || script.sections.some((section) => section.key === "CURRENT_INFO"));

    const rights = new RightsGuard();
    const unknown = await rights.register({
      channelId,
      mediaType: "VIDEO",
      rightsClass: "THIRD_PARTY_UNKNOWN",
      provenance: { sourceUrl: "https://example.com/video" },
    });
    assert.equal(unknown.reusable, false);
    assert.equal(unknown.reviewRequired, true);
    const owned = await rights.register({
      channelId,
      contentId: research.id,
      mediaType: "GRAPHIC",
      rightsClass: "OWNED",
      topicFingerprint: research.topicFingerprint,
      provenance: { owner: "ClipForge user", permissionNote: "Created locally." },
    });
    assert.equal(owned.reusable, true);

    const gate = new CoherenceGate().evaluate({
      research,
      script,
      visualPlan: {
        generatedOwnedGraphic: true,
        topicFingerprint: research.topicFingerprint,
        rightsReady: true,
        assets: [owned],
      },
      nearDuplicate: false,
    });
    assert.equal(gate.status, "PASS");
  });
});

test("Research Engine flags like-for-like numeric conflicts and Coherence Gate blocks their use", async () => {
  await withStorage(async () => {
    const channelId = crypto.randomUUID();
    const sources = new SourceService();
    const first = await sources.create({ type: "TEXT", text: "The new public shelter opened on September 29, 2026. The public shelter has 120 beds available for residents." });
    const second = await sources.create({ type: "TEXT", text: "The new public shelter opened on September 29, 2026. The public shelter has 100 beds available for residents." });
    const research = await new ResearchEngine({ sources }).research({
      channelId,
      topic: "Public shelter opens with disputed capacity",
      sourceIds: [first.id, second.id],
      who: ["City Hall"],
      where: ["the city"],
    });

    assert.equal(research.discrepancies.length, 1);
    const discrepancy = research.discrepancies[0];
    assert.ok(discrepancy.dimensions.includes("UNIT:bed"));
    assert.equal(discrepancy.claimIds.length, 2);

    const conflictClaimId = discrepancy.claimIds[0];
    const script = {
      id: crypto.randomUUID(),
      title: "Public shelter opens with disputed capacity",
      evidenceClaimIds: [conflictClaimId],
      sections: [{ key: "HOOK", evidenceClaimIds: [conflictClaimId], assertionType: "FACT" }],
      originality: { directQuoteWords: 0, sourceContributionRatio: 0.4 },
    };
    const gate = new CoherenceGate().evaluate({
      research,
      script,
      visualPlan: {
        generatedOwnedGraphic: true,
        topicFingerprint: research.topicFingerprint,
        rightsReady: true,
        assets: [],
      },
      nearDuplicate: false,
    });
    assert.equal(gate.status, "WAITING_REVIEW");
    assert.ok(gate.criticalFailures.includes("NO_UNRESOLVED_CONTRADICTION"));
  });
});

test("Trend Hunter never auto-selects publishing and classifies saturation", async () => {
  await withStorage(async () => {
    const service = new TrendHunterService();
    const channelId = crypto.randomUUID();
    const trend = await service.ingest({
      channelId,
      topic: "Major creator controversy",
      sourceCount: 5,
      growthScore: 20,
      saturationScore: 90,
      originalityPotential: 60,
      relevanceScore: 90,
    }, { niche: "creators influencers streamers" });
    assert.equal(trend.state, "SATURATED");
    assert.equal(trend.requiresHumanSelection, true);
    assert.equal(trend.selectedAt, null);
  });
});

test("zero paid budget allows local zero-cost work and blocks positive spend", async () => {
  await withStorage(async () => {
    const costs = new ContentCostService();
    const channelId = crypto.randomUUID();
    const zero = { dailyBudgetUsd: 0, monthlyBudgetUsd: 0, maxCostPerContentUsd: 0 };
    const free = await costs.budgetStatus(channelId, zero, { requestedCostUsd: 0 });
    assert.equal(free.allowed, true);
    const paid = await costs.budgetStatus(channelId, zero, { requestedCostUsd: 0.01 });
    assert.equal(paid.allowed, false);
    assert.ok(paid.reasons.includes("MAX_COST_PER_CONTENT"));
  });
});
