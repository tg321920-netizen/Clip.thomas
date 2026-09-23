export type NewsCategory =
  | "BREAKING"
  | "POLITICS"
  | "ECONOMY"
  | "TECH"
  | "SPORTS"
  | "ENTERTAINMENT"
  | "GENERAL";

export type NewsTemplate =
  | "BREAKING"
  | "CLEAN"
  | "TECH"
  | "SPORTS"
  | "ECONOMY";

export type NewsEvidence = {
  segmentId: string;
  startTime: number;
  endTime: number;
  text: string;
};

export type NewsBrief = {
  id: string;
  projectId: string;
  sourceTranscriptId: string;
  status: "READY" | "RENDERING" | "RENDERED" | "FAILED";
  category: NewsCategory;
  template: NewsTemplate;
  headline: string;
  summary: string;
  narration: string;
  keyPoints: string[];
  sourceEvidence: NewsEvidence[];
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  render: {
    relativePath: string;
    sourceUrl: string;
    narrationRelativePath: string;
    width: number;
    height: number;
    durationSeconds: number;
    sizeBytes: number;
    ttsProvider: string;
    template: NewsTemplate;
  } | null;
};
