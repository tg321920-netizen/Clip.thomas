/** One result contract for fresh and recovered clips. No signed links or
 * machine selection is converted into editorial approval here. */
export function clipResult(project, clip, validation = clip.render?.validation) {
  const hasCues = Boolean(clip.subtitles?.cues?.length);
  return {
    mediaKind: clip.render.mediaKind || project.source.mediaKind || 'VIDEO',
    clipId: clip.id, title: clip.title || project.source.originalName,
    duration: clip.duration, startTime: clip.startTime, endTime: clip.endTime,
    reason: clip.reason, aiAssessment: clip.aiAssessment || null,
    editorialReview: clip.editorialReview || { status: 'PENDING' },
    sourceUrl: clip.render.sourceUrl, downloadUrl: `${clip.render.sourceUrl}?download=1`,
    relativePath: clip.render.relativePath, validation,
    subtitleMode: hasCues ? clip.subtitles.mode || clip.edit?.subtitleMode || (clip.subtitles.language === 'en' ? 'ORIGINAL_EN' : 'ORIGINAL_ES') : 'NONE',
    subtitleLanguage: hasCues ? clip.subtitles.language || null : null,
    subtitleReviewStatus: hasCues ? clip.subtitles.reviewStatus || 'PENDING' : null,
    srtUrl: hasCues ? `/api/projects/${project.id}/clips/${clip.id}/subtitles?format=srt` : null,
  };
}
