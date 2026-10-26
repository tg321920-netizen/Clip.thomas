import assert from "node:assert/strict";
import test from "node:test";
import { checkDeployedRuntime } from "../scripts/deployed-runtime-check.mjs";

const commit = "b6936e610e8cd0fafe05d4d326f57db9537b7d24";
const oldCommit = "e1045dfae859e773ac65f4b12b1ef1ed10e20a3a";
const healthy = {
  status: "ok", version: commit, mediaReady: true, ffmpeg: true,
  ffprobe: true, storageWritable: true, publishing: "OFF",
  processing: { running: true, status: "RUNNING" },
};

function diagnose(health = healthy, overrides = {}) {
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    const route = new URL(url).pathname;
    if (route === "/api/health") return Response.json(health);
    if (route === "/login") return new Response("Owner login");
    return new Response("PRIVATE_PROJECT_DATA_MUST_NOT_BE_REPORTED", { status: 401 });
  };
  return {
    requests,
    result: checkDeployedRuntime({ url: "https://clipforge.example", expectedCommit: commit, request, ...overrides }),
  };
}

test("an old healthy deployment is not the prepared ClipForge candidate", async () => {
  const { result } = diagnose({ ...healthy, version: oldCommit });
  const evidence = await result;
  assert.equal(evidence.checks[0].health.version, oldCommit);
  assert.equal(evidence.candidateDeployed, false);
  assert.equal(evidence.publicPreflightPassed, false);
  assert.equal(evidence.editorUsable, "NOT_VERIFIED");
});

test("matching public preflight still cannot certify authenticated editing or Android", async () => {
  const { result, requests } = diagnose();
  const evidence = await result;
  assert.equal(evidence.candidateDeployed, true);
  assert.equal(evidence.publicPreflightPassed, true);
  assert.equal(evidence.status, "READY_FOR_AUTHENTICATED_ACCEPTANCE");
  assert.equal(evidence.editorUsable, "NOT_VERIFIED");
  assert.equal(evidence.physicalAndroid, "NOT_VERIFIED");
  assert.equal(evidence.adminRequests, 0);
  assert.equal(requests.length, 3);
  for (const { url, options } of requests) {
    assert.equal(url.origin, "https://clipforge.example");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.body, undefined);
  }
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_PROJECT_DATA/);
});

test("web and FFmpeg alone cannot certify an active worker", async () => {
  for (const processing of [undefined, { running: false, status: "STOPPED" }, { running: true, status: "UNVERIFIED" }]) {
    const evidence = await diagnose({ ...healthy, processing }).result;
    assert.equal(evidence.gates.mediaReady, true);
    assert.equal(evidence.gates.schedulerObserved, false);
    assert.equal(evidence.publicPreflightPassed, false);
  }
});

test("health finishes before checking login and projects on a sleeping host", async () => {
  let healthFinished = false;
  const request = async (url) => {
    const route = new URL(url).pathname;
    if (route === "/api/health") {
      return new Response(new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setImmediate(resolve));
          healthFinished = true;
          controller.enqueue(new TextEncoder().encode(JSON.stringify(healthy)));
          controller.close();
        },
      }));
    }
    assert.equal(healthFinished, true);
    return new Response(null, { status: route === "/login" ? 200 : 401 });
  };
  assert.equal((await diagnose(healthy, { request }).result).publicPreflightPassed, true);
});

test("missing commit, degraded media or enabled publishing fails the public gates", async () => {
  for (const change of [{ version: null }, { version: "not-a-commit" }, { ffmpeg: false }, { storageWritable: false }, { publishing: "ON" }]) {
    assert.equal((await diagnose({ ...healthy, ...change }).result).publicPreflightPassed, false);
  }
});

test("a public projects API or a redirect cannot pass the private trial check", async () => {
  for (const projectStatus of [200, 302, 403]) {
    const request = async (url) => new URL(url).pathname === "/api/health"
      ? Response.json(healthy) : new Response(null, { status: new URL(url).pathname === "/login" ? 200 : projectStatus });
    const evidence = await diagnose(healthy, { request }).result;
    assert.equal(evidence.gates.projectsRequireSession, false);
    assert.equal(evidence.publicPreflightPassed, false);
  }
});

test("reports omit arbitrary health fields, credentials and private error messages", async () => {
  const sensitive = "NEVER_REPORT_THIS_SECRET_OR_SIGNED_URL";
  const evidence = await diagnose({ ...healthy, secret: sensitive, processing: { ...healthy.processing, secret: sensitive } }).result;
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(sensitive));
  const failed = await diagnose(healthy, { request: async () => { throw new Error(sensitive); } }).result;
  assert.equal(failed.publicPreflightPassed, false);
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(sensitive));
  assert.equal(failed.checks[0].error, "REQUEST_FAILED");
});

test("malformed, oversized and non-JSON health responses are rejected", async () => {
  for (const body of ["not JSON", "null", "[]", JSON.stringify({ ...healthy, large: "x".repeat(32_768) })]) {
    const request = async () => new Response(body);
    const evidence = await diagnose(healthy, { request }).result;
    assert.equal(evidence.checks[0].error, "HEALTH_INVALID");
    assert.equal(evidence.publicPreflightPassed, false);
  }
});

test("HTTP 503 and request timeouts do not pass preflight", async () => {
  const unavailable = await diagnose(healthy, { request: async () => Response.json(healthy, { status: 503 }) }).result;
  assert.equal(unavailable.candidateDeployed, false);
  const timeout = await diagnose(healthy, { request: async () => { throw new DOMException("Timed out", "TimeoutError"); } }).result;
  assert.equal(timeout.checks[0].error, "REQUEST_TIMEOUT");
  assert.equal(timeout.publicPreflightPassed, false);
});

test("invalid target or expected SHA makes zero network requests", async () => {
  for (const overrides of [
    { expectedCommit: undefined }, { expectedCommit: "b6936e6" },
    { url: "http://clipforge.example" }, { url: "https://user:secret@clipforge.example" },
    { url: "https://clipforge.example?token=secret" }, { url: "https://clipforge.example/api/health" },
    { timeoutMs: 0 },
  ]) {
    const { result, requests } = diagnose(healthy, overrides);
    await assert.rejects(result, /PREFLIGHT_CONFIG_INVALID/);
    assert.equal(requests.length, 0);
  }
});
