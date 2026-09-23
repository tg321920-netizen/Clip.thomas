export type AutopilotMode = "MANUAL" | "AUTOPILOT";
export type AutopilotPlatform = "TIKTOK" | "YOUTUBE" | "FACEBOOK";

export type AutopilotConfig = {
  enabled: boolean;
  mode: AutopilotMode;
  approvalRequired: boolean;
  postsPerDay: number;
  platforms: AutopilotPlatform[];
  preferredTimes: string[];
  analyticsEnabled: boolean;
  learningEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AutopilotProjectState =
  | "DISABLED"
  | "WAITING_TRANSCRIPTION"
  | "WAITING_ANALYSIS"
  | "WAITING_AUTO_EDIT"
  | "WAITING_RENDER"
  | "READY_FOR_PUBLICATION";
