const CANONICAL_PROJECT_ID = "prj_dU0D8QBQz5PGqD7tsqILqoqaUXqq";

const projectId = String(process.env.VERCEL_PROJECT_ID || "").trim();

// Vercel's ignoreCommand contract:
// exit 0 => skip this deployment
// exit 1 => continue building
//
// Fallback guard for duplicate projects. The canonical project is forced to
// build by vercel.json, while duplicate project IDs remain safe to skip here
// if this script is reused manually or from project settings in the future.
if (projectId && projectId !== CANONICAL_PROJECT_ID) {
  console.log(`Skipping duplicate Vercel project ${projectId}; canonical project is ${CANONICAL_PROJECT_ID}.`);
  process.exit(0);
}

console.log("Building active ClipForge Vercel project.");
process.exit(1);
