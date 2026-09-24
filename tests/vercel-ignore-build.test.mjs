import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "vercel-ignore-build.mjs");
const canonicalProjectId = "prj_8rOfWiKDx2N5tWuvt5pfqtnypZwl";

function run(extraEnv) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    env: {
      ...process.env,
      VERCEL_PROJECT_ID: "",
      VERCEL_GIT_COMMIT_REF: "",
      VERCEL_ENV: "",
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

test("duplicate Vercel projects are ignored", () => {
  const result = run({
    VERCEL_PROJECT_ID: "prj_duplicate",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_ENV: "production",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Skipping duplicate Vercel project/);
});

test("canonical production deployment continues", () => {
  const result = run({
    VERCEL_PROJECT_ID: canonicalProjectId,
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_ENV: "production",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Building canonical ClipForge production deployment/);
});

test("canonical preview branches are ignored to conserve build quota", () => {
  const result = run({
    VERCEL_PROJECT_ID: canonicalProjectId,
    VERCEL_GIT_COMMIT_REF: "work/example",
    VERCEL_ENV: "preview",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Skipping non-production preview/);
});

test("missing project id fails open instead of silently suppressing builds", () => {
  const result = run({
    VERCEL_PROJECT_ID: "",
    VERCEL_GIT_COMMIT_REF: "feature/example",
    VERCEL_ENV: "preview",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /continuing build for safety/);
});
