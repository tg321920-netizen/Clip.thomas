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

export type ContentGenerationRecord = {
  id: string;
  planId: string;
  projectId: string | null;
  format: string;
  channels: string[];
  status: "DRAFT";
  requiresApproval: true;
  generationMode: "DETERMINISTIC";
  variants: GeneratedContentVariant[];
  createdAt: string;
  updatedAt: string;
};
