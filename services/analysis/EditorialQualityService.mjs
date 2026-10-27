/** Conservative rejection of explicit defects. This is a rules-based technical
 * gate, not semantic understanding, proof of virality or owner approval. */
export function assessCandidateQuality(candidate) {
  const warnings = [...new Set(candidate?.qualityWarnings || [])], rejected = [];
  if (warnings.includes('INCOMPLETE_SENTENCE_END')) rejected.push('INCOMPLETE_SENTENCE_END');
  const audio = candidate?.audiovisualEvidence?.audio;
  const measured = Number.isFinite(audio?.coveredSeconds) && Number.isFinite(audio?.meanDb) &&
    Number.isFinite(candidate?.duration) && candidate.duration > 0 && audio.coveredSeconds >= candidate.duration * .8;
  // Do not reject based on relative volume, an unmeasured interval or one
  // missing window. -65 dB is deliberately below the audibility scoring level.
  if (measured && audio.meanDb < -65) rejected.push('MEASURED_INAUDIBLE_AUDIO');
  if (!measured) warnings.push('AUDIO_COVERAGE_NOT_CONFIRMED');
  return { status: rejected.length ? 'REJECTED' : 'REVIEW_REQUIRED', rejectedReasons: rejected,
    warnings: [...new Set(warnings)], method:'CONSERVATIVE_RULES', semanticConfirmation:'NOT_PERFORMED', ownerApproval:false };
}
