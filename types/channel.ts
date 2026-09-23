export type ChannelPlatform = "TIKTOK" | "YOUTUBE" | "FACEBOOK";
export type ChannelStatus =
  | "DISCONNECTED"
  | "CONNECTED"
  | "PAUSED"
  | "ERROR";

export type ChannelStrategy = {
  channelId: string;
  name: string;
  description: string;
  systemPrompt: string;
  preferredMinDuration: number;
  preferredMaxDuration: number;
  dailyPostLimit: number;
  preferredTopics: string[];
  avoidTopics: string[];
  createdAt: string;
  updatedAt: string;
};

export type ChannelRecord = {
  id: string;
  userId: string | null;
  platform: ChannelPlatform;
  name: string;
  externalAccountId: string | null;
  status: ChannelStatus;
  publishingEnabled: boolean;
  dailyLimit: number;
  timezone: string;
  strategy: ChannelStrategy;
  createdAt: string;
  updatedAt: string;
};
