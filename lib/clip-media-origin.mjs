/** Media provenance is explicit metadata, never guessed from a title or from a
 * successful render. Test fixtures must stay outside the owner's clip library. */
export function clipMediaOrigin(project) {
  if (project?.testOnly === true || project?.source?.testOnly === true) return { kind: 'TECHNICAL_TEST' };
  const observed = project?.liveObservation || {}, source = observed.source || {};
  let url; try { url = new URL(project?.source?.originUrl || ''); } catch { /* Uploaded media has no source URL. */ }
  const host = url?.hostname?.toLowerCase().replace(/^www\./, '');
  const platform = ['KICK','TWITCH','YOUTUBE'].includes(source.platform) ? source.platform
    : host === 'kick.com' ? 'KICK' : host === 'twitch.tv' ? 'TWITCH' : ['youtube.com','youtu.be'].includes(host) ? 'YOUTUBE' : null;
  if (!platform) return { kind: 'VIDEO', sourceKind: 'UNKNOWN' };
  const sourceKind = [source.sourceKind, observed.sourceKind, observed.captureType].find(k => ['LIVE','VOD'].includes(k)) ||
    (platform === 'KICK' && /^\/[a-z0-9_-]+\/videos\/[a-f0-9-]{36}$/i.test(url?.pathname || '') ? 'VOD' : 'UNKNOWN');
  const channel = String(source.channel || observed.channel || (platform === 'KICK' || platform === 'TWITCH' ? url?.pathname.split('/')[1] || '' : '')).toLowerCase();
  const sourceId = String(source.sourceId || (platform === 'KICK' && sourceKind === 'VOD' ? url?.pathname.split('/')[3] || '' : ''));
  const origin = { kind: 'STREAM', platform, sourceKind };
  if (/^[a-z0-9_-]{1,64}$/.test(channel)) origin.channel = channel;
  if (/^[a-z0-9_-]{1,100}$/i.test(sourceId)) origin.sourceId = sourceId;
  if (platform === 'KICK' && origin.channel) origin.sourceUrl = `https://kick.com/${origin.channel}${sourceKind === 'VOD' && /^[a-f0-9-]{36}$/i.test(sourceId) ? '/videos/' + sourceId : ''}`;
  return origin;
}
