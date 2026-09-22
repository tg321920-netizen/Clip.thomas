export type ClipFramingMode = "FILL" | "FIT";
export type ClipRenderQuality = "FAST" | "BALANCED" | "HIGH";
export type SubtitleStyle = "CLEAN" | "VIRAL" | "KARAOKE";

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
  enabled: boolean;
  style: SubtitleStyle;
  sourceTranscriptId: string;
  cues: SubtitleCue[];
  generatedAt: string;
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
    framingMode: ClipFramingMode;
    subtitlesEnabled: boolean;
    subtitleStyle: SubtitleStyle;
    quality: ClipRenderQuality;
  };
  subtitles: SubtitleTrack | null;
  autoEdit: AutoEditPlan | null;
  render: {
    relativePath: string;
    sourceUrl: string;
    width: number;
    height: number;
    codec: string;
    container: string;
    sizeBytes: number;
    subtitlesBurned?: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};
