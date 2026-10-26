// Public, read-only preflight. Health is never proof that an owner can edit.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetch, EnvHttpProxyAgent } from "undici";

const SHA = /^[a-f0-9]{40}$/i;

export async function checkDeployedRuntime({
  url,
  expectedCommit,
  request = fetch,
  timeoutMs = 45_000,
}) {
  const origin = new URL(url);
  if (
    origin.protocol !== "https:" || origin.username || origin.password ||
    origin.search || origin.hash || origin.pathname !== "/" ||
    !SHA.test(expectedCommit || "") ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000
  ) throw new Error("PREFLIGHT_CONFIG_INVALID");

  const probe = async (route) => {
    const started = performance.now();
    const check = { route, status: null, reachable: false, error: null };
    try {
      const response = await request(new URL(route, origin), {
        method: "GET",
        // Do not follow another origin or send credentials to the application.
        redirect: "manual",
        headers: { accept: route === "/api/health" ? "application/json" : "text/html, application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      check.status = response.status;
      check.reachable = true;
      try {
        if (route === "/api/health") check.health = publicHealth(await readHealth(response));
      } finally {
        // Never read or report a projects body, cookies or response headers.
        await response.body?.cancel();
      }
    } catch (error) {
      check.error = ["TimeoutError", "AbortError"].includes(error?.name)
        ? "REQUEST_TIMEOUT" : error?.code === "HEALTH_INVALID"
          ? "HEALTH_INVALID" : "REQUEST_FAILED";
      // Error messages may contain private headers or signed URLs. Omit them.
    }
    return { ...check, elapsedMs: Math.round(performance.now() - started) };
  };
  // A free host may be waking up. Check the application after health responds,
  // rather than mistaking simultaneous cold-start 503s for an auth defect.
  const healthCheck = await probe("/api/health");
  const [login, projects] = await Promise.all([probe("/login"), probe("/api/projects")]);
  const checks = [healthCheck, login, projects];
  const health = healthCheck.health;
  const gates = {
    healthResponds: healthCheck.status === 200 && !healthCheck.error,
    candidateMatches: health?.version === expectedCommit.toLowerCase(),
    mediaReady: health?.status === "ok" && health?.mediaReady === true &&
      health?.ffmpeg === true && health?.ffprobe === true && health?.storageWritable === true,
    publishingDisabled: health?.publishing === "OFF",
    schedulerObserved: health?.processing?.running === true && health?.processing?.status === "RUNNING",
    loginResponds: login.status === 200 && !login.error,
    projectsRequireSession: projects.status === 401 && !projects.error,
  };
  const publicPreflightPassed = Object.values(gates).every(Boolean);
  return {
    checkedAt: new Date().toISOString(),
    url: origin.origin,
    expectedCommit: expectedCommit.toLowerCase(),
    readOnly: true,
    adminRequests: 0,
    checks,
    gates,
    candidateDeployed: gates.healthResponds && gates.candidateMatches,
    publicPreflightPassed,
    status: publicPreflightPassed ? "READY_FOR_AUTHENTICATED_ACCEPTANCE" : "PUBLIC_PREFLIGHT_FAILED",
    // Even a matching, healthy server needs a separate authenticated media test.
    editorUsable: "NOT_VERIFIED",
    authenticatedUploadTest: "NOT_RUN_WITHOUT_OWNER_SESSION",
    physicalAndroid: "NOT_VERIFIED",
  };
}

async function readHealth(response) {
  if (!response.body) throw Object.assign(new Error(), { code: "HEALTH_INVALID" });
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) throw new Error();
      chunks.push(Buffer.from(value));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (["TimeoutError", "AbortError"].includes(error?.name)) throw error;
    throw Object.assign(new Error(), { code: "HEALTH_INVALID" });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function publicHealth(value) {
  return {
    status: ["ok", "degraded"].includes(value.status) ? value.status : null,
    version: typeof value.version === "string" && SHA.test(value.version) ? value.version.toLowerCase() : null,
    mediaReady: value.mediaReady === true,
    ffmpeg: value.ffmpeg === true,
    ffprobe: value.ffprobe === true,
    storageWritable: value.storageWritable === true,
    publishing: ["ON", "OFF"].includes(value.publishing) ? value.publishing : null,
    processing: {
      running: typeof value.processing?.running === "boolean" ? value.processing.running : null,
      status: ["RUNNING", "STOPPED", "NOT_RUNNING", "UNVERIFIED"].includes(value.processing?.status)
        ? value.processing.status : null,
    },
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const match = /^--(url|expected-commit|output)=(.+)$/.exec(arg);
    if (!match) throw new Error("PREFLIGHT_CONFIG_INVALID");
    return [match[1], match[2]];
  }));
  const dispatcher = new EnvHttpProxyAgent();
  try {
    const evidence = await checkDeployedRuntime({
      url: args.url,
      expectedCommit: args["expected-commit"],
      request: (url, options) => fetch(url, { ...options, dispatcher }),
    });
    const output = args.output || path.join("artifacts", "deployed-runtime", `${Date.now()}-evidence.json`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(evidence, null, 2), { flag: "wx" });
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = evidence.publicPreflightPassed ? 0 : 1;
  } finally {
    await dispatcher.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Preflight failed. Use --url=https://HOST --expected-commit=FULL_SHA [--output=NEW_FILE]. No deployment is performed.");
    process.exitCode = 2;
  });
}
