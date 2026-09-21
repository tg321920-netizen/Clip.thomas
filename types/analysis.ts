export type ViralScoreComponents = {
  hook: number;
  semanticInterest: number;
  emotionTone: number;
  audioEnergy: number | null;
  standaloneComprehensibility: number;
  durationFit: number;
};

export type ClipCandidate = {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  text: string;
  title: string;
  hook: string;
  reason: string;
  viralScore: number;
  status: "CANDIDATE" | "SELECTED" | "REJECTED";
  analysisMethod: string;
  components: ViralScoreComponents;
  reasons: string[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
  disclaimer: string;
  aiAssessment?: {
    provider: string;
    model: string;
    relevanceScore: number;
    reason: string;
  };
};

export type ContentAnalysisRecord = {
  id: string;
  projectId: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  provider: string;
  sourceKey: string;
  config: {
    minDuration: number;
    maxDuration: number;
    targetDuration: number;
    maxCandidates: number;
  };
  candidates: ClipCandidate[];
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};
