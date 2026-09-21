export type ClipFramingMode = "FILL" | "FIT";
export type ClipRenderQuality = "FAST" | "BALANCED" | "HIGH";

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
    quality: ClipRenderQuality;
  };
  render: {
    relativePath: string;
    sourceUrl: string;
    width: number;
    height: number;
    codec: string;
    container: string;
    sizeBytes: number;
  } | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};
