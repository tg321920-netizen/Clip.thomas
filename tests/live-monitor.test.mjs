import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LiveMonitorService } from "../services/live/LiveMonitorService.mjs";

const source = { channel: "westcol", channelId: "669746", chatroomId: "669512", sourceId: "01a17413-f760-7067-aa90-2e6d458a1aa6", sourceKind: "LIVE", startedAt: "2026-10-25T17:20:28Z" };
const enabled = { CLIPFORGE_LIVE_MONITOR_ENABLED: "true", CLIPFORGE_LIVE_RIGHTS_CONFIRMED: "true", CLIPFORGE_STORAGE_PERSISTENT: "true", CLIPFORGE_ANALYSIS_PROVIDER: "heuristic" };
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-monitor-")), jobs = new Map(), calls = [];
  const ingestStore = { get: async id => jobs.get(id), create: async input => { calls.push(input); if (!jobs.has(input.id)) jobs.set(input.id, { ...input, status: "QUEUED" }); return jobs.get(input.id); } };
  const env = { ...enabled };
  const options = { root, env, ingestStore, checkCapacity: async () => true, observations: { loadForSource: async () => ({ bins: [] }) }, resolveSource: async () => ({ metadata: source }) };
  return { root, jobs, calls, env, options, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("monitor is opt-in, checks rights/provider and does not enable paid calls", async () => {
  const f = await setup();
  try {
    const monitor = new LiveMonitorService(f.options);
    f.env.CLIPFORGE_LIVE_MONITOR_ENABLED = "false"; assert.equal((await monitor.tick()).status, "DISABLED");
    f.env.CLIPFORGE_LIVE_MONITOR_ENABLED = "true"; f.env.CLIPFORGE_LIVE_RIGHTS_CONFIRMED = "false";
    assert.equal((await monitor.tick()).status, "WAITING_RIGHTS_CONFIRMATION");
    f.env.CLIPFORGE_LIVE_RIGHTS_CONFIRMED = "true"; f.env.CLIPFORGE_ANALYSIS_PROVIDER = "zai";
    assert.equal((await monitor.tick()).status, "WAITING_LOCAL_ANALYSIS_PROVIDER");
    f.env.CLIPFORGE_ANALYSIS_PROVIDER = "heuristic"; f.env.CLIPFORGE_STORAGE_PERSISTENT = "false";
    assert.equal((await monitor.tick()).status, "WAITING_PERSISTENT_STORAGE");
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});
test("monitor captures only Westcol, at most ten per batch and resumes the existing job after restart", async () => {
  const f = await setup();
  try {
    const first = new LiveMonitorService(f.options), state = await first.tick();
    assert.equal(state.status, "CAPTURE_QUEUED"); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "https://kick.com/westcol"); assert.equal(f.calls[0].clipCount, 10);
    assert.equal(f.calls[0].subtitles, false); assert.equal(f.calls[0].onlyChatReactions, true);
    assert.equal(f.calls[0].analysisProvider, "heuristic");
    assert.equal((await new LiveMonitorService(f.options).tick()).activeJobId, state.activeJobId);
    assert.equal(f.calls.length, 1);
    // Simulate the enqueue/checkpoint crash boundary: deterministic ID is reused.
    await first.save({ ...state, activeJobId: null });
    assert.equal((await first.tick()).activeJobId, state.activeJobId); assert.equal(f.jobs.size, 1);
    f.jobs.delete(state.activeJobId);
    assert.equal((await first.tick()).status, "JOB_STATE_MISSING"); assert.equal(f.jobs.size, 0);
  } finally { await f.cleanup(); }
});
test("source OFFLINE is distinct from access failure and storage limits never delete or capture", async () => {
  const f = await setup();
  try {
    let code = "SOURCE_OFFLINE";
    const monitor = new LiveMonitorService({ ...f.options, resolveSource: async () => { throw Object.assign(new Error("safe"), { code }); } });
    assert.equal((await monitor.tick()).status, "OFFLINE");
    code = "SOURCE_ACCESS_DENIED"; assert.equal((await monitor.tick()).status, "SOURCE_ERROR");
    const full = new LiveMonitorService({ ...f.options, checkCapacity: async () => false });
    assert.equal((await full.tick()).status, "LOCAL_STORAGE_LIMIT"); assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});
test("monitor recovers observed reactions only from the matching VOD and avoids repeating a handled peak", async () => {
  const f = await setup();
  try {
    const start = Date.parse(source.startedAt);
    const bins = Array.from({ length: 8 }, (_, i) => ({ utc: new Date(start + i * 10000).toISOString(), complete: true,
      messages: i === 7 ? 100 : 20, uniqueSenders: i === 7 ? 90 : 20, distinctTexts: i === 7 ? 10 : 20,
      dominantTextCount: i === 7 ? 80 : 1, dominantTextSenders: i === 7 ? 70 : 1 }));
    const options = { ...f.options, observations: { loadForSource: async () => ({ bins }) }, resolveSource: async url => {
      if (url.includes("/videos/")) return { metadata: { ...source, sourceKind: "VOD" } };
      throw Object.assign(new Error("offline"), { code: "SOURCE_OFFLINE" });
    } };
    const monitor = new LiveMonitorService(options), state = await monitor.read();
    await monitor.save({ ...state, source });
    const recovery = await monitor.tick();
    assert.equal(recovery.status, "VOD_RECOVERY_QUEUED"); assert.equal(f.calls[0].startTimeSeconds, 45);
    assert.equal(f.calls[0].captureSeconds, 90); assert.ok(f.calls[0].url.endsWith(source.sourceId));
    f.jobs.get(recovery.activeJobId).status = "FAILED";
    assert.equal((await monitor.tick()).status, "OFFLINE"); assert.equal(f.calls.length, 1);
  } finally { await f.cleanup(); }
});
test("slow/failed editor and archive do not block the next capture; corrupt checkpoints fail closed", async () => {
  const f = await setup();
  try {
    const monitor = new LiveMonitorService({ ...f.options,
      mediaStore: { get: async () => ({ status: "READY", validation: { valid: true }, projectId: "project" }) },
      loadProject: async () => ({ clips: [{ id: "clip" }] }), archive: async () => { throw new Error("private error"); } });
    const queued = await monitor.tick();
    f.jobs.get(queued.activeJobId).status = "COMPLETED"; f.jobs.get(queued.activeJobId).result = { clipsJobId: "media" };
    const continued=await monitor.tick();
    assert.equal(continued.status, "CAPTURE_QUEUED"); assert.equal(f.calls.length, 2);
    assert.deepEqual(continued.downstream,[{ingestJobId:queued.activeJobId,mediaJobId:"media"}]);
    assert.equal(f.calls[1].captureSession,true);
    await writeFile(monitor.file, "{corrupt");
    await assert.rejects(monitor.tick(), /checkpoint/); assert.equal(f.calls.length, 2);
  } finally { await f.cleanup(); }
});
