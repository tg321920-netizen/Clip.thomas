export type MarketingSourceType = "TEXT" | "URL" | "CLIPFORGE_PROJECT";

export type SourceAuthorizationStatus =
  | "USER_PROVIDED"
  | "USER_CONFIRMED"
  | "INTERNAL";

export type MarketingSourceRecord = {
  id: string;
  type: MarketingSourceType;
  projectId: string | null;
  origin: string;
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
  authorizationStatus: SourceAuthorizationStatus;
  createdAt: string;
  updatedAt: string;
  latestExtractionId: string | null;
};

export type ExtractionSignals = {
  prices: string[];
  emails: string[];
  phones: string[];
  urls: string[];
  hours: string[];
  ctaCandidates: string[];
};

export type ExtractionRecord = {
  id: string;
  sourceId: string;
  sourceType: MarketingSourceType;
  projectId: string | null;
  status: "COMPLETED" | "FAILED";
  text: string;
  summary: string;
  signals: ExtractionSignals;
  metadata: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  completedAt: string;
};
