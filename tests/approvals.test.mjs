import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContentGenerationRepository } from "../services/content-generation/ContentGenerationRepository.mjs";
import { ApprovalService } from "../services/approvals/ApprovalService.mjs";
import { InternalNotificationService } from "../services/notifications/InternalNotificationService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-approvals-"));
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

async function saveGeneration(repository, variantCount = 3) {
  const now = "2026-09-28T12:00:00.000Z";
  const record = {
    id: randomUUID(),
    planId: randomUUID(),
    projectId: PROJECT_ID,
    format: "VERTICAL_VIDEO",
    channels: ["FACEBOOK_REELS", "INSTAGRAM_REELS"],
    status: "DRAFT",
    requiresApproval: true,
    generationMode: "DETERMINISTIC",
    variants: Array.from({ length: variantCount }, (_value, index) => ({
      id: randomUUID(),
      label: ["A", "B", "C"][index],
      angle: ["PROBLEM", "DEMONSTRATION", "BENEFIT"][index],
      title: `Variant ${index + 1}`,
      hook: "Hook",
      description: "Description",
      adCopy: "Copy",
      cta: "CTA",
      hashtags: [],
      script: [],
      storyboard: [],
      subtitles: [],
      onScreenText: [],
      evidenceExtractionIds: [],
    })),
    approvalId: null,
    selectedVariantId: null,
    reviewNote: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await repository.save(record);
  return record;
}

test("requesting content approval creates one pending inbox item and notification", async () => {
  await withStorage(async () => {
    const content = new ContentGenerationRepository();
    const notifications = new InternalNotificationService();
    const generation = await saveGeneration(content);
    const approvals = new ApprovalService({ content, notifications });

    const first = await approvals.requestForContentGeneration(generation.id);
    const second = await approvals.requestForContentGeneration(generation.id);

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(first.approval.id, second.approval.id);
    assert.equal(first.approval.status, "PENDING");

    const updatedGeneration = await content.get(generation.id);
    assert.equal(updatedGeneration.status, "WAITING_APPROVAL");
    assert.equal(updatedGeneration.approvalId, first.approval.id);

    const unread = await notifications.list({ unread: true });
    assert.equal(unread.length, 1);
    assert.equal(unread[0].type, "APPROVAL_REQUIRED");
    assert.equal(unread[0].subjectId, first.approval.id);
  });
});

test("approving multiple variants requires an explicit human selection", async () => {
  await withStorage(async () => {
    const content = new ContentGenerationRepository();
    const generation = await saveGeneration(content, 3);
    const approvals = new ApprovalService({ content });
    const { approval } = await approvals.requestForContentGeneration(generation.id);

    await assert.rejects(
      () => approvals.approve(approval.id),
      /selectedVariantId is required/i,
    );

    const selected = generation.variants[1].id;
    const resolved = await approvals.approve(approval.id, {
      selectedVariantId: selected,
      note: "Usar la variante B.",
    });

    assert.equal(resolved.status, "APPROVED");
    assert.equal(resolved.selectedVariantId, selected);
    assert.ok(resolved.resolvedAt);

    const updatedGeneration = await content.get(generation.id);
    assert.equal(updatedGeneration.status, "APPROVED");
    assert.equal(updatedGeneration.selectedVariantId, selected);
    assert.equal(updatedGeneration.reviewNote, "Usar la variante B.");
  });
});

test("one-variant content can be approved without repeating its variant id", async () => {
  await withStorage(async () => {
    const content = new ContentGenerationRepository();
    const generation = await saveGeneration(content, 1);
    const approvals = new ApprovalService({ content });
    const { approval } = await approvals.requestForContentGeneration(generation.id);

    const resolved = await approvals.approve(approval.id);
    assert.equal(resolved.selectedVariantId, generation.variants[0].id);

    const updatedGeneration = await content.get(generation.id);
    assert.equal(updatedGeneration.status, "APPROVED");
    assert.equal(updatedGeneration.selectedVariantId, generation.variants[0].id);
  });
});

test("modify requires a note and stores CHANGES_REQUESTED on the content", async () => {
  await withStorage(async () => {
    const content = new ContentGenerationRepository();
    const generation = await saveGeneration(content);
    const approvals = new ApprovalService({ content });
    const { approval } = await approvals.requestForContentGeneration(generation.id);

    await assert.rejects(
      () => approvals.requestChanges(approval.id),
      /note is required/i,
    );

    const resolved = await approvals.requestChanges(approval.id, {
      note: "Hacer el hook más corto.",
    });
    assert.equal(resolved.status, "CHANGES_REQUESTED");

    const updatedGeneration = await content.get(generation.id);
    assert.equal(updatedGeneration.status, "CHANGES_REQUESTED");
    assert.equal(updatedGeneration.reviewNote, "Hacer el hook más corto.");
  });
});

test("reject marks both approval and content generation as rejected", async () => {
  await withStorage(async () => {
    const content = new ContentGenerationRepository();
    const generation = await saveGeneration(content);
    const approvals = new ApprovalService({ content });
    const { approval } = await approvals.requestForContentGeneration(generation.id);

    const resolved = await approvals.reject(approval.id, { note: "No usar esta idea." });
    assert.equal(resolved.status, "REJECTED");

    const updatedGeneration = await content.get(generation.id);
    assert.equal(updatedGeneration.status, "REJECTED");
    assert.equal(updatedGeneration.reviewNote, "No usar esta idea.");
  });
});

test("internal notifications can be marked read and unread", async () => {
  await withStorage(async () => {
    const notifications = new InternalNotificationService();
    const notification = await notifications.create({
      projectId: PROJECT_ID,
      type: "INFO",
      title: "Listo",
      message: "La pieza está preparada.",
    });

    const read = await notifications.markRead(notification.id);
    assert.ok(read.readAt);
    assert.equal((await notifications.list({ unread: true })).length, 0);

    const unread = await notifications.markUnread(notification.id);
    assert.equal(unread.readAt, null);
    assert.equal((await notifications.list({ unread: true })).length, 1);
  });
});
