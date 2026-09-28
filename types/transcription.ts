export type TranscriptWord = {
  startTime: number;
  endTime: number;
  text: string;
  probability?: number;
};

export type TranscriptSegment = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: TranscriptWord[];
};

export type TranscriptStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export type TranscriptChunk = {
  index: number;
  startTime: number;
  endTime: number;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  attempts: number;
  segmentCount: number;
  error: string | null;
  completedAt: string | null;
};

export type TranscriptRecord = {
  id: string;
  projectId: string;
  videoId: string;
  status: TranscriptStatus;
  provider: string;
  model: string;
  language: string | null;
  text: string;
  durationSeconds?: number;
  segments: TranscriptSegment[];
  sourceKey: string;
  audioRelativePath: string;
  progress?: number;
  chunkDurationSeconds?: number;
  chunks?: TranscriptChunk[];
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};
