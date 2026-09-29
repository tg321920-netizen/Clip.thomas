import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { loadProjectFile } from "../lib/project-files.mjs";
import { resolveStoragePath } from "../lib/storage-paths.mjs";
import { ApprovalService } from "../services/approvals/ApprovalService.mjs";
import { BrandService } from "../services/branding/BrandService.mjs";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { ContentFactoryService } from "../services/content-factory/ContentFactoryService.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-owned-e2e-"));
const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
const previousSwitch = process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;
process.env.CLIPFORGE_STORAGE_DIR = root;
delete process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;

try {
  const channels = new ChannelService();
  const brands = new BrandService();
  const factory = new ContentFactoryService({ channels, brands });
  const channel = await channels.createChannel({
    platform: "YOUTUBE",
    name: "US News Test",
    timezone: "America/New_York",
    status: "CONNECTED",
    publishingEnabled: true,
    dailyLimit: 1,
  });
  const brand = await brands.create({
    name: "Verified Now",
    colors: { primary: "#172033" },
    preferredCta: "Follow for the next verified update",
    tone: "Clear and factual",
  });
  await factory.configure(channel.id, {
    enabled: true,
    lineKey: "US_NEWS_EN",
    brandId: brand.id,
    postsPerDay: 1,
    editTemplate: { framingMode: "FILL", quality: "BALANCED", subtitleStyle: "CLEAN" },
    budget: { dailyBudgetUsd: 0, monthlyBudgetUsd: 0, maxCostPerContentUsd: 0 },
  });

  const firstText = [
    "On September 29, 2026, City Hall opened a new public shelter after a council vote.",
    "The new public shelter has 120 beds and began receiving residents on September 29, 2026.",
    "The city allocated two million dollars for the shelter project after the council vote.",
    "Officials said staffing will be reviewed after the first month of operation.",
  ].join(" ");
  const secondText = [
    "City Hall opened the new public shelter on September 29, 2026 after the council approved the project.",
    "The public shelter opened with 120 beds and started receiving residents that day.",
    "The council approved two million dollars for the shelter project before opening day.",
    "The municipality reported that staffing levels will be reviewed after the first month.",
  ].join(" ");

  const started = await factory.start(channel.id, {
    idempotencyKey: "owned-content-real-e2e",
    topic: "City opens new public shelter after council vote",
    category: "GENERAL",
    format: "SHORT",
    sources: [
      { type: "TEXT", text: firstText, metadata: { title: "Source A" } },
      { type: "TEXT", text: secondText, metadata: { title: "Source B" } },
    ],
  });

  assert.equal(started.reused, false);
  assert.equal(started.run.execution.status, "waiting_approval");
  assert.ok(started.run.approval?.id);
  assert.equal(started.run.execution.results.gate.status, "PASS");
  assert.equal(started.run.execution.results.render.render.clip.status, "READY");
  assert.equal(started.run.execution.results.render.render.clip.render.width, 1080);
  assert.equal(started.run.execution.results.render.render.clip.render.height, 1920);
  assert.equal(started.run.execution.results.render.render.clip.render.subtitlesBurned, true);

  const project = await loadProjectFile(started.execution.id);
  assert.ok(project?.ownedContent);
  const clip = project.clips?.[0];
  assert.ok(clip?.render?.relativePath);
  const file = await stat(resolveStoragePath(clip.render.relativePath));
  assert.ok(file.size > 10_000);
  const probe = JSON.parse(await run(process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", resolveStoragePath(clip.render.relativePath)]));
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.ok(audio);

  await new ApprovalService().approve(started.run.approval.id, { note: "E2E human approval" });
  const resumed = await factory.continueAfterApproval(started.execution.id);
  assert.equal(resumed.execution.status, "completed");
  assert.equal(resumed.execution.results["dry-run"].dryRun, true);
  assert.equal(resumed.execution.results["dry-run"].realPublishingEnabled, false);
  assert.equal(resumed.execution.results["dry-run"].publication.status, "WAITING_APPROVAL");

  const duplicate = await factory.start(channel.id, {
    idempotencyKey: "owned-content-real-e2e",
    topic: "Should not duplicate",
    sources: [{ type: "TEXT", text: firstText }, { type: "TEXT", text: secondText }],
  });
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.execution.id, started.execution.id);

  console.log("Owned Content E2E passed", {
    executionId: started.execution.id,
    clipId: clip.id,
    sizeBytes: file.size,
    publicationId: resumed.execution.results["dry-run"].publicationId,
  });
} finally {
  if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
  else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
  if (previousSwitch === undefined) delete process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING;
  else process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING = previousSwitch;
  await rm(root, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} failed with ${code}`)));
  });
}
