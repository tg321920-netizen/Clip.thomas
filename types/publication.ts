export type PublicationStatus =
  | "DRAFT"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED";

export type PublicationPlatform = "TIKTOK" | "YOUTUBE" | "FACEBOOK";

export type PublicationRecord = {
  id: string;
  idempotencyKey: string;
  projectId: string;
  clipId: string;
  channelId: string;
  platform: PublicationPlatform;
  title: string;
  description: string;
  hashtags: string[];
  scheduledAt: string | null;
  publishedAt: string | null;
  status: PublicationStatus;
  externalPostId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
