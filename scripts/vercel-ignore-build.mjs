const CANONICAL_PROJECT_ID = "prj_dU0D8QBQz5PGqD7tsqILqoqaUXqq";

const projectId = String(process.env.VERCEL_PROJECT_ID || "").trim();

// Vercel's ignoreCommand contract:
// exit 0 => skip this deployment
// exit 1 => continue building
//
// Build every deployment for the active ClipForge project. Only skip known
// duplicate Vercel projects so production can never be silently suppressed
// because Git-related environment variables are unavailable during this step.
if (projectId && projectId !== CANONICAL_PROJECT_ID) {
  console.log(`Skipping duplicate Vercel project ${projectId}; canonical project is ${CANONICAL_PROJECT_ID}.`);
  process.exit(0);
}

console.log("Building active ClipForge Vercel project.");
process.exit(1);
