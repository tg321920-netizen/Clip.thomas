export type ContentVariantAngle = "PROBLEM" | "DEMONSTRATION" | "BENEFIT";

export type GeneratedScriptBeat = {
  startSeconds: number;
  endSeconds: number;
  purpose: "HOOK" | "MESSAGE" | "CTA";
  narration: string;
};

export type StoryboardScene = {
  startSeconds: number;
  endSeconds: number;
  visual: string;
  onScreenText: string;
};

export type SubtitleCue = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type GeneratedContentVariant = {
  id: string;
  label: "A" | "B" | "C";
  angle: ContentVariantAngle;
  title: string;
  hook: string;
  description: string;
  adCopy: string;
  cta: string;
  hashtags: string[];
  script: GeneratedScriptBeat[];
  storyboard: StoryboardScene[];
  subtitles: SubtitleCue[];
  onScreenText: string[];
  evidenceExtractionIds: string[];
};

export type ContentGenerationStatus =
  | "DRAFT"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REJECTED";

export type ContentGenerationRecord = {
  id: string;
  planId: string;
  projectId: string | null;
  format: string;
  channels: string[];
  status: ContentGenerationStatus;
  requiresApproval: true;
  generationMode: "DETERMINISTIC";
  variants: GeneratedContentVariant[];
  approvalId?: string | null;
  selectedVariantId?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
