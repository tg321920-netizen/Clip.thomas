import test from "node:test";
import assert from "node:assert/strict";
import { recoverMediaResult } from "../services/media-processing/MediaResultRecovery.mjs";

function fixture(count = 3) {
  return { id: "output", source: { originalName: "entrevista.mp4", hasAudio: true }, clips: Array.from({ length: count }, (_, index) => ({
    id: `clip-${index}`, status: "READY", title: `Idea ${index + 1}`, reason: `Razón ${index + 1}`,
    startTime: index * 60, endTime: index * 60 + 45, duration: 45,
    editorialReview: { status: "PENDING" },
    render: { relativePath: `clips/output/clip-${index}/render.mp4`, sourceUrl: `/clip-${index}`, width: 1080, height: 1920, validation: { subtitleValidation: "ASS_BURNED_NOT_VISUALLY_VERIFIED" } },
  })) };
}
const job = { type: "MEDIA_CLIPS", projectId: "output", payload: { count: 3 } };

test("recovery retains every title, duration, interval, preview, download and pending editorial review", async () => {
  const checks = [];
  const result = await recoverMediaResult(fixture(), job, { validate: async (filename, options) => { checks.push({ filename, options }); return { valid: true, duration: 45 }; } });
  assert.equal(checks.length, 3);
  assert.deepEqual(result.clips.map(c => c.title), ["Idea 1", "Idea 2", "Idea 3"]);
  assert.deepEqual(result.clips.map(c => c.startTime), [0, 60, 120]);
  for (const [index, clip] of result.clips.entries()) {
    assert.equal(clip.duration, 45);
    assert.equal(clip.endTime, index * 60 + 45);
    assert.equal(clip.reason, `Razón ${index + 1}`);
    assert.equal(clip.sourceUrl, `/clip-${index}`);
    assert.equal(clip.downloadUrl, `/clip-${index}?download=1`);
    assert.equal(clip.editorialReview.status, "PENDING");
    assert.equal(checks[index].options.requireAudio, true);
    assert.equal(checks[index].options.width, 1080);
    assert.equal(checks[index].options.height, 1920);
    assert.equal(checks[index].options.subtitleValidation, "ASS_BURNED_NOT_VISUALLY_VERIFIED");
  }
});

test("one recovered clip keeps the same clips-array response shape", async () => {
  const result = await recoverMediaResult(fixture(1), { ...job, payload: { count: 1 } }, { validate: async () => ({ valid: true }) });
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0].title, "Idea 1");
});

test("incomplete checkpoints cannot be treated as a finished three-clip delivery", async () => {
  await assert.rejects(recoverMediaResult(fixture(2), job), /cantidad de clips/);
  const project = fixture();
  project.clips[1].status = "PROCESSING";
  assert.equal(await recoverMediaResult(project, job), null);
});

test("revalidation failure is propagated and cannot become READY", async () => {
  await assert.rejects(recoverMediaResult(fixture(), job, { validate: async () => { throw new Error("archivo ausente"); } }), /archivo ausente/);
  await assert.rejects(recoverMediaResult(fixture(), job, { validate: async () => ({ valid: false }) }), /validación técnica/);
});
