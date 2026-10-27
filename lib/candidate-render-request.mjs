/** A saved cut is a revision to resume, never a new default 9:16 candidate. */
export function candidateRenderRequest(candidateId, clip) {
  return clip?.id ? {retryClipId:clip.id} : {candidateId,framingMode:'FILL',quality:'BALANCED'};
}
