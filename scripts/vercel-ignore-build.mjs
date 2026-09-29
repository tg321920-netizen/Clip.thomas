const CANONICAL_PROJECT_ID = "prj_8rOfWiKDx2N5tWuvt5pfqtnypZwl";

const projectId = String(process.env.VERCEL_PROJECT_ID || "").trim();
const gitRef = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim();
const vercelEnv = String(process.env.VERCEL_ENV || "").trim();

// Vercel's ignoreCommand contract:
// exit 0 => skip this deployment
// exit 1 => continue building
if (projectId && projectId !== CANONICAL_PROJECT_ID) {
  console.log(`Skipping duplicate Vercel project ${projectId}; canonical project is ${CANONICAL_PROJECT_ID}.`);
  process.exit(0);
}

if (vercelEnv === "production" || gitRef === "main") {
  console.log("Building canonical ClipForge production deployment.");
  process.exit(1);
}

if (!projectId) {
  // Fail open if Vercel ever stops exposing VERCEL_PROJECT_ID so a legitimate
  // deployment is not silently suppressed.
  console.log("VERCEL_PROJECT_ID is unavailable; continuing build for safety.");
  process.exit(1);
}

console.log(`Skipping non-production preview for branch ${gitRef || "unknown"}.`);
process.exit(0);
