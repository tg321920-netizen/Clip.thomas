import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";

const ACTIVE_SCHEDULE_STATUSES = new Set([
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
]);

export class SchedulerService {
  constructor(options = {}) {
    this.publications = options.publications || new PublicationService();
    this.channels = options.channels || new ChannelService();
  }

  async schedulePublication(publicationId, config, options = {}) {
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");

    if (publication.status === "WAITING_APPROVAL") {
      return {
        publication,
        scheduled: false,
        reason: "WAITING_APPROVAL",
      };
    }

    if (publication.status === "PUBLISHED") {
      return { publication, scheduled: false, reason: "ALREADY_PUBLISHED" };
    }

    if (publication.status === "SCHEDULED" && publication.scheduledAt) {
      return { publication, scheduled: false, reason: "ALREADY_SCHEDULED" };
    }

    if (publication.status !== "APPROVED") {
      throw new Error(
        `Publication cannot be scheduled from ${publication.status}.`,
      );
    }

    const channel = await this.channels.getChannel(publication.channelId);
    if (!channel) throw new Error("Channel not found.");
    assertSchedulableChannel(channel);

    const channelPublications = await this.publications.list({
      channelId: channel.id,
    });

    const slot = findNextSlot({
      channel,
      config,
      publications: channelPublications,
      now: options.now || new Date(),
      horizonDays: options.horizonDays || 30,
    });

    if (!slot) {
      throw new Error("No scheduling slot is available within the horizon.");
    }

    const scheduled = await this.publications.schedule(
      publication.id,
      slot.toISOString(),
    );

    return {
      publication: scheduled,
      scheduled: true,
      reason: "SCHEDULED",
    };
  }

  async scheduleApproved(config, options = {}) {
    const approved = await this.publications.list({ status: "APPROVED" });
    const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
    const results = [];

    for (const publication of approved.slice(0, limit)) {
      try {
        results.push(
          await this.schedulePublication(publication.id, config, options),
        );
      } catch (error) {
        results.push({
          publication,
          scheduled: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }
}

export function findNextSlot({
  channel,
  config,
  publications = [],
  now = new Date(),
  horizonDays = 30,
}) {
  assertSchedulableChannel(channel);

  const timezone = channel.timezone || "UTC";
  const dailyLimit = effectiveDailyLimit(channel, config);
  if (dailyLimit <= 0) return null;

  const times = normalizeTimes(config?.preferredTimes || ["09:00", "15:00", "20:00"]);
  const localNow = zonedParts(now, timezone);
  const horizon = Math.max(1, Math.min(Number(horizonDays) || 30, 90));

  for (let offset = 0; offset < horizon; offset += 1) {
    const localDate = addCivilDays(localNow, offset);
    const dateKey = ymdKey(localDate);
    const dayCount = publications.filter((publication) => {
      if (!ACTIVE_SCHEDULE_STATUSES.has(publication.status)) return false;
      const value = publication.scheduledAt || publication.publishedAt;
      if (!value) return false;
      const instant = new Date(value);
      if (!Number.isFinite(instant.getTime())) return false;
      return ymdKey(zonedParts(instant, timezone)) === dateKey;
    }).length;

    if (dayCount >= dailyLimit) continue;

    for (const time of times) {
      const [hour, minute] = time.split(":").map(Number);
      const slot = zonedDateTimeToUtc(
        {
          year: localDate.year,
          month: localDate.month,
          day: localDate.day,
          hour,
          minute,
        },
        timezone,
      );

      if (!slot || slot.getTime() <= now.getTime() + 30_000) continue;

      const occupied = publications.some((publication) => {
        if (!publication.scheduledAt) return false;
        const scheduled = new Date(publication.scheduledAt);
        return (
          Number.isFinite(scheduled.getTime()) &&
          Math.abs(scheduled.getTime() - slot.getTime()) < 60_000
        );
      });

      if (!occupied) return slot;
    }
  }

  return null;
}

export function effectiveDailyLimit(channel, config = {}) {
  const limits = [
    Number(channel?.dailyLimit),
    Number(channel?.strategy?.dailyPostLimit),
    Number(config?.postsPerDay),
  ].filter(Number.isFinite);

  if (limits.some((limit) => limit <= 0)) return 0;
  if (limits.length === 0) return 0;
  return Math.max(0, Math.min(...limits.map((value) => Math.floor(value))));
}

export function zonedDateTimeToUtc(local, timeZone) {
  const targetUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    0,
    0,
  );
  let guess = targetUtc;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = zonedParts(new Date(guess), timeZone);
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      0,
    );
    const delta = targetUtc - observedUtc;
    guess += delta;
    if (Math.abs(delta) < 1000) break;
  }

  const result = new Date(guess);
  const verified = zonedParts(result, timeZone);

  if (
    verified.year !== local.year ||
    verified.month !== local.month ||
    verified.day !== local.day ||
    verified.hour !== local.hour ||
    verified.minute !== local.minute
  ) {
    return null;
  }

  return result;
}

export function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function addCivilDays(localDate, amount) {
  const date = new Date(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day + amount),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function normalizeTimes(value) {
  const input = Array.isArray(value) ? value : [];
  const output = [];

  for (const item of input) {
    const time = String(item || "").trim();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    if (!output.includes(time)) output.push(time);
  }

  return output.sort();
}

function ymdKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function assertSchedulableChannel(channel) {
  if (channel?.status !== "CONNECTED") {
    throw new Error("Channel must be CONNECTED before scheduling.");
  }
  if (channel?.publishingEnabled !== true) {
    throw new Error("Channel publishing is disabled.");
  }
}
