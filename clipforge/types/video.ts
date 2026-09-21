export type ProbeMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  container: string;
  aspectRatio: string;
};

export type UploadedVideo = ProbeMetadata & {
  projectId: string;
  originalName: string;
  storedName: string;
  sizeBytes: number;
  posterUrl: string;
};
