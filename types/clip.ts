export type ClipFramingMode = "FILL" | "FIT" | "CONVERSATION";
export type ClipRenderQuality = "FAST" | "EFFICIENT" | "BALANCED" | "HIGH";
export type SubtitleStyle = "CLEAN" | "VIRAL" | "KARAOKE";
export type SubtitleMode = "NONE" | "ORIGINAL_ES" | "ORIGINAL_EN" | "TRANSLATE_ES";

export type SubtitleWord = {
  startTime: number;
  endTime: number;
  text: string;
};

export type SubtitleCue = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: SubtitleWord[];
};

export type SubtitleTrack = {
  layout?: { fontSize: number; position: 'TOP'|'BOTTOM'; marginPercent: number; color: string };
  readability?: Array<{ cueId: string; issues: string[] }>;
  mode?: SubtitleMode;
  language?: string;
  sourceLanguage?: string;
  sourceCues?: SubtitleCue[];
  machineCues?: SubtitleCue[];
  timingBasis?: string;
  reviewStatus?: "PENDING" | "REVIEW_REQUIRED";
  translation?: { provider: string; modelSha256: string; modelId?:string; modelRevision?:string; modelLicense?:string; modelFormat?:string; audioReplaced: false; reviewRequired: true; manuallyEdited?: boolean;
    glossary?: Array<{source:string;target:string}>; pipelineVersion?: string;
    units?: Array<{text:string;target:string;direct?:string;contextUsed:boolean;quality:{status:string;issues:string[]}}> };
  enabled: boolean;
  style: SubtitleStyle;
  sourceTranscriptId: string;
  cues: SubtitleCue[];
  generatedAt: string;
  updatedAt: string;
};

export type AutoReframeWindow = {
  startTime: number;
  endTime: number;
  focusX: number;
  focusY: number;
};

export type AutoReframePlan = {
  enabled: boolean;
  mode: "SPEECH_ZOOM";
  basis: "TRANSCRIPT_SPEECH_ACTIVITY";
  speakerAware: false;
  subjectMode: "CENTERED_SUBJECT";
  zoom: number;
  attackMs: number;
  releaseMs: number;
  mergeGapMs: number;
  paddingBeforeMs: number;
  paddingAfterMs: number;
  sourceTranscriptId: string;
  windows: AutoReframeWindow[];
  createdAt: string;
  updatedAt: string;
};

export type AutoEditPlan = {
  provider: string;
  model: string | null;
  sourceKey: string;
  candidateId: string;
  startTime: number;
  endTime: number;
  duration: number;
  title: string;
  hook: string;
  description: string;
  hashtags: string[];
  onScreenText: string;
  recommendedPlatforms: Array<"TIKTOK" | "YOUTUBE" | "FACEBOOK">;
  subtitleStyle: SubtitleStyle;
  framingMode: ClipFramingMode;
  quality: ClipRenderQuality;
  reason: string;
  createdAt: string;
};

export type ClipRecord = {
  subtitleHistory?: Array<{versionId:string;savedAt:string;reason:string;track:SubtitleTrack}>;
  id: string;
  projectId: string;
  candidateId: string;
  startTime: number;
  endTime: number;
  duration: number;
  status:
    | "DRAFT"
    | "QUEUED"
    | "RENDERING"
    | "READY"
    | "FAILED";
  edit: {
    output?:{width:number;height:number;aspectRatio:'9:16'|'16:9';resolution:'720p'|'1080p'};
    framingMode: ClipFramingMode;
    subtitlesEnabled: boolean;
    subtitleStyle: SubtitleStyle;
    subtitleMode?: SubtitleMode;
    subtitleRegenerate?: boolean;
    quality: ClipRenderQuality;
    autoReframeEnabled?: boolean;
  };
  subtitles: SubtitleTrack | null;
  autoEdit: AutoEditPlan | null;
  autoReframe: AutoReframePlan | null;
  render: {
    mediaKind?: 'VIDEO'|'AUDIO';
    archiveEligible?: boolean;
    relativePath: string;
    sourceUrl: string;
    width: number;
    height: number;
    codec: string;
    container: string;
    sizeBytes: number;
    subtitlesBurned?: boolean;
    autoReframeApplied?: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};
