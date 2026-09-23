import { randomUUID } from "node:crypto";
import { ChannelRepository } from "./ChannelRepository.mjs";

const PLATFORMS = new Set(["TIKTOK", "YOUTUBE", "FACEBOOK"]);
const STATUSES = new Set(["DISCONNECTED", "CONNECTED", "PAUSED", "ERROR"]);

export class ChannelService {
  constructor(options = {}) {
    this.repository = options.repository || new ChannelRepository();
  }

  async listChannels() {
    return this.repository.list();
  }

  async getChannel(channelId) {
    return this.repository.get(channelId);
  }

  async createChannel(input = {}) {
    const platform = normalizePlatform(input.platform);
    const name = cleanRequired(input.name, "Channel name", 100);
    const timezone = normalizeTimezone(input.timezone || "UTC");
    const dailyLimit = boundedInteger(input.dailyLimit, 0, 50, 3);
    const status = normalizeStatus(input.status || "DISCONNECTED");
    const publishingEnabled = Boolean(input.publishingEnabled);
    const now = new Date().toISOString();
    const id = randomUUID();

    if (publishingEnabled && status !== "CONNECTED") {
      throw new Error(
        "Publishing cannot be enabled until the channel is CONNECTED.",
      );
    }

    const record = {
      id,
      userId: null,
      platform,
      name,
      externalAccountId: cleanOptional(input.externalAccountId, 180),
      status,
      publishingEnabled,
      dailyLimit,
      timezone,
      strategy: normalizeStrategy(id, input.strategy || {}, dailyLimit, now),
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.save(record);
    return record;
  }

  async updateChannel(channelId, input = {}) {
    const current = await this.repository.get(channelId);
    if (!current) throw new Error("Channel not found.");

    const dailyLimit = Object.hasOwn(input, "dailyLimit")
      ? boundedInteger(input.dailyLimit, 0, 50, current.dailyLimit)
      : current.dailyLimit;

    const updated = {
      ...current,
      ...(Object.hasOwn(input, "name")
        ? { name: cleanRequired(input.name, "Channel name", 100) }
        : {}),
      ...(Object.hasOwn(input, "externalAccountId")
        ? { externalAccountId: cleanOptional(input.externalAccountId, 180) }
        : {}),
      ...(Object.hasOwn(input, "status")
        ? { status: normalizeStatus(input.status) }
        : {}),
      ...(Object.hasOwn(input, "publishingEnabled")
        ? { publishingEnabled: Boolean(input.publishingEnabled) }
        : {}),
      ...(Object.hasOwn(input, "dailyLimit") ? { dailyLimit } : {}),
      ...(Object.hasOwn(input, "timezone")
        ? { timezone: normalizeTimezone(input.timezone) }
        : {}),
      updatedAt: new Date().toISOString(),
    };

    if (updated.publishingEnabled && updated.status !== "CONNECTED") {
      throw new Error(
        "Publishing cannot be enabled until the channel is CONNECTED.",
      );
    }

    await this.repository.save(updated);
    return updated;
  }

  async getStrategy(channelId) {
    const channel = await this.repository.get(channelId);
    return channel?.strategy || null;
  }

  async updateStrategy(channelId, input = {}) {
    const channel = await this.repository.get(channelId);
    if (!channel) throw new Error("Channel not found.");

    const now = new Date().toISOString();
    channel.strategy = normalizeStrategy(
      channelId,
      { ...channel.strategy, ...input },
      channel.dailyLimit,
      channel.strategy?.createdAt || now,
      now,
    );
    channel.updatedAt = now;

    await this.repository.save(channel);
    return channel.strategy;
  }

  async deleteChannel(channelId) {
    const current = await this.repository.get(channelId);
    if (!current) return false;
    await this.repository.delete(channelId);
    return true;
  }
}

export function normalizeStrategy(
  channelId,
  input = {},
  fallbackDailyLimit = 3,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
) {
  const minDuration = boundedNumber(input.preferredMinDuration, 5, 120, 15);
  const maxDuration = boundedNumber(
    input.preferredMaxDuration,
    minDuration,
    180,
    Math.max(60, minDuration),
  );

  return {
    channelId,
    name: cleanText(input.name || "Estrategia principal", 100),
    description: cleanText(input.description || "", 500),
    systemPrompt: cleanText(input.systemPrompt || "", 3000),
    preferredMinDuration: minDuration,
    preferredMaxDuration: maxDuration,
    dailyPostLimit: boundedInteger(
      input.dailyPostLimit,
      0,
      50,
      fallbackDailyLimit,
    ),
    preferredTopics: normalizeTopics(input.preferredTopics),
    avoidTopics: normalizeTopics(input.avoidTopics),
    createdAt,
    updatedAt,
  };
}

export function normalizeTimezone(value) {
  const timezone = String(value || "").trim();
  if (!timezone || timezone.length > 100) {
    throw new Error("Timezone is invalid.");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error("Timezone is invalid.");
  }

  return timezone;
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toUpperCase();
  if (!PLATFORMS.has(platform)) {
    throw new Error("Unsupported platform. Use TIKTOK, YOUTUBE or FACEBOOK.");
  }
  return platform;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (!STATUSES.has(status)) throw new Error("Invalid channel status.");
  return status;
}

function normalizeTopics(value) {
  const input = Array.isArray(value) ? value : [];
  const output = [];
  const seen = new Set();

  for (const item of input) {
    const topic = cleanText(item, 80);
    if (!topic) continue;
    const key = topic.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(topic);
    if (output.length >= 50) break;
  }

  return output;
}

function cleanRequired(value, label, maxLength) {
  const text = cleanText(value, maxLength);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function cleanOptional(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  return cleanText(value, maxLength) || null;
}

function cleanText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1)}…`
    : text;
}

function boundedInteger(value, min, max, fallback) {
  return Math.round(boundedNumber(value, min, max, fallback));
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
