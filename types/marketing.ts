export type MarketingObjective =
  | "GET_MESSAGES"
  | "GET_CLIENTS"
  | "PRESENT_PRODUCT"
  | "PRESENT_SERVICE"
  | "EXPLAIN_FUNCTION"
  | "DEMONSTRATE"
  | "PROMOTION"
  | "EDUCATE"
  | "GENERATE_INTEREST"
  | "GET_REGISTRATIONS"
  | "DRIVE_TRAFFIC";

export type MarketingChannel =
  | "FACEBOOK_REELS"
  | "INSTAGRAM_REELS"
  | "TIKTOK"
  | "YOUTUBE_SHORTS"
  | "FACEBOOK_POST"
  | "INSTAGRAM_POST";

export type MarketingFormat =
  | "VERTICAL_VIDEO"
  | "STATIC_POST"
  | "CAROUSEL"
  | "TEXT_POST";

export type MarketingPlanMode = "AI" | "DETERMINISTIC";

export type MarketingEvidence = {
  extractionId: string;
  claim: string;
  evidence: string;
};

export type MarketingPlan = {
  id: string;
  projectId: string | null;
  extractionIds: string[];
  objective: MarketingObjective;
  audience: string;
  channels: MarketingChannel[];
  format: MarketingFormat;
  message: string;
  cta: string;
  concept: string;
  rationale: string;
  recommendedDurationSeconds: number | null;
  evidence: MarketingEvidence[];
  missingInformation: string[];
  assumptions: string[];
  mode: MarketingPlanMode;
  provider: string | null;
  model: string | null;
  brief: Record<string, unknown>;
  createdAt: string;
};
