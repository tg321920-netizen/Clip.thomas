/** Flags describe this deployment, never whether another site has this code. */
export function releasePolicy(env = process.env) {
  const channel = env.CLIPFORGE_RELEASE_CHANNEL === 'development' ? 'development' : 'stable';
  const experimental = channel === 'development' && env.CLIPFORGE_EXPERIMENTAL_FEATURES === 'true';
  return { version: '2026.10.26.1', channel, experimental,
    features: { manualTrim: true, localCandidates: true, privateLibrary: true,
      stories: experimental, live: experimental, agent: experimental } };
}
export function runtimeWorkerScripts(env = process.env) {
  const stable = ['scripts/render-worker.mjs', 'scripts/transcription-worker.mjs', 'scripts/analysis-worker.mjs', 'scripts/media-worker.mjs',
    ...(env.CLIPFORGE_MEDIA_STORAGE_PROVIDER === 'r2' ? ['scripts/storage-worker.mjs'] : [])];
  return releasePolicy(env).experimental ? [...stable, 'scripts/autopilot-worker.mjs', 'scripts/agent-worker.mjs',
    'scripts/autoedit-worker.mjs', 'scripts/news-worker.mjs', 'scripts/owned-content-worker.mjs', 'scripts/analytics-worker.mjs'] : stable;
}
