import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApprovalService } from "../services/approvals/ApprovalService.mjs";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { ContentGenerationRepository } from "../services/content-generation/ContentGenerationRepository.mjs";
import { MarketingPublishingHub } from "../services/publishing/MarketingPublishingHub.mjs";
import { effectiveDailyLimit } from "../services/scheduler/SchedulerService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-publish-guards-"));
  const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
  const previousFlag = process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  delete process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
  try {
    await fn();
  } finally {
    if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
    if (previousFlag === undefined) delete process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING;
    else process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING = previousFlag;
    await rm(root, { recursive: true, force: true });
  }
}

test("publishing guards prove dry-run idempotency, daily-limit minimum and REAL PUBLISHING OFF/ON gate", async () => {
  await withStorage(async () => {
    const channels = new ChannelService();
    const channel = await channels.createChannel({
      platform: "FACEBOOK",
      name: "Guard Test",
      timezone: "America/Costa_Rica",
      status: "CONNECTED",
      publishingEnabled: true,
      dailyLimit: 4,
    });
    await channels.updateStrategy(channel.id, { dailyPostLimit: 3 });
    const currentChannel = await channels.getChannel(channel.id);
    assert.equal(effectiveDailyLimit(currentChannel, { postsPerDay: 2 }), 2);

    const generationId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const content = new ContentGenerationRepository();
    await content.save({
      id: generationId,
      planId: crypto.randomUUID(),
      projectId: null,
      format: "VERTICAL_VIDEO",
      channels: ["FACEBOOK_REELS"],
      status: "APPROVED",
      requiresApproval: true,
      generationMode: "DETERMINISTIC",
      approvalId: crypto.randomUUID(),
      selectedVariantId: variantId,
      reviewNote: null,
      reviewedAt: new Date().toISOString(),
      variants: [{
        id: variantId,
        label: "A",
        angle: "PROBLEM",
        title: "Guard test",
        hook: "Hook",
        description: "Contenido autorizado para una simulación.",
        adCopy: "Contenido autorizado para una simulación.",
        cta: "Más información",
        hashtags: ["#test"],
        script: [], storyboard: [], subtitles: [], onScreenText: [], evidenceExtractionIds: [],
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const hub = new MarketingPublishingHub({ content, channels });
    const first = await hub.simulate({ generationId, platform: "FACEBOOK", channelId: channel.id });
    const duplicate = await hub.simulate({ generationId, platform: "FACEBOOK", channelId: channel.id });
    assert.equal(first.simulation.dryRun, true);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.simulation.id, first.simulation.id);

    const requested = await hub.requestPublicationApproval(first.simulation.id);
    await new ApprovalService().approve(requested.approval.id);

    await assert.rejects(
      () => hub.handoffToAuthorizedPublishing(first.simulation.id),
      /Real marketing publishing is disabled/i,
    );

    process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING = "true";
    await assert.rejects(
      () => hub.handoffToAuthorizedPublishing(first.simulation.id),
      /prepared ClipForge media clip is required/i,
    );
  });
});
