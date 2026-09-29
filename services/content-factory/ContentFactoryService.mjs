import { isProjectId } from "../../lib/project-id.mjs";
import { AnalyticsService } from "../analytics/AnalyticsService.mjs";
import { BrandService } from "../branding/BrandService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { SchedulerService } from "../scheduler/SchedulerService.mjs";
import { MarketingWorkflowRunner } from "../workflows/MarketingWorkflowRunner.mjs";
import { WorkflowRecipeService } from "../workflows/WorkflowRecipeService.mjs";
import { WorkflowService } from "../workflows/WorkflowService.mjs";
import { ContentFactoryRepository } from "./ContentFactoryRepository.mjs";

const RECIPE_KEYS = new Set([
  "VIDEO_TO_CLIPS",
  "PRODUCT_TO_AD",
  "COMPANY_WEEK_CONTENT",
  "URL_TO_CONTENT",
]);
const FRAMING = new Set(["FILL", "FIT"]);
const QUALITY = new Set(["FAST", "BALANCED", "HIGH"]);
const SUBTITLES = new Set(["CLEAN", "VIRAL", "KARAOKE"]);

export class ContentFactoryService {
  constructor(options = {}) {
    this.repository = options.repository || new ContentFactoryRepository();
    this.channels = options.channels || new ChannelService();
    this.brands = options.brands || new BrandService();
    this.publications = options.publications || new PublicationService({ channels: this.channels });
    this.analytics = options.analytics || new AnalyticsService({ publications: this.publications });
    this.workflows = options.workflows || new WorkflowService();
    this.recipes = options.recipes || new WorkflowRecipeService({ workflows: this.workflows });
    this.runner = options.runner || new MarketingWorkflowRunner({ workflows: this.workflows });
    this.scheduler = options.scheduler || new SchedulerService({ publications: this.publications, channels: this.channels });
  }

  async listDashboard() {
    const channels = await this.channels.listChannels();
    const rows = await Promise.all(channels.map((channel) => this.getChannelView(channel.id)));
    return {
      realPublishingEnabled: realPublishingEnabled(),
      channels: rows,
      totals: sumStatus(rows),
    };
  }

  async getChannelView(channelId) {
    assertId(channelId);
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");

    const [storedProfile, publications, allExecutions, performance] = await Promise.all([
      this.repository.get(channelId),
      this.publications.list({ channelId }),
      this.workflows.listExecutions(),
      this.analytics.summarize({ channelId }),
    ]);

    const profile = storedProfile || defaultProfile(channelId);
    const executions = allExecutions.filter((item) => item?.input?.factoryChannelId === channelId);
    const status = countStatuses(publications, executions);

    return {
      channel,
      profile,
      frequency: {
        postsPerDay: effectivePostsPerDay(channel),
        preferredTimes: profile.preferredTimes,
        timezone: channel.timezone,
      },
      status,
      performance,
      realPublishingEnabled: realPublishingEnabled(),
    };
  }

  async configure(channelId, input = {}) {
    assertId(channelId);
    let channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");

    const current = (await this.repository.get(channelId)) || defaultProfile(channelId);
    const brandId = Object.hasOwn(input, "brandId") ? normalizeOptionalId(input.brandId, "brand") : current.brandId;
    if (brandId) {
      const brand = await this.brands.get(brandId);
      if (!brand) throw new Error("Brand not found.");
    }

    if (Object.hasOwn(input, "postsPerDay")) {
      const postsPerDay = boundedInteger(input.postsPerDay, 0, 50, channel.dailyLimit || 0);
      channel = await this.channels.updateChannel(channelId, { dailyLimit: postsPerDay });
      await this.channels.updateStrategy(channelId, { dailyPostLimit: postsPerDay });
      channel = await this.channels.getChannel(channelId);
    }

    if (input.strategy && typeof input.strategy === "object" && !Array.isArray(input.strategy)) {
      await this.channels.updateStrategy(channelId, input.strategy);
      channel = await this.channels.getChannel(channelId);
    }

    const now = new Date().toISOString();
    const profile = {
      channelId,
      enabled: Object.hasOwn(input, "enabled") ? Boolean(input.enabled) : current.enabled,
      brandId,
      language: Object.hasOwn(input, "language") ? cleanText(input.language, 40) || "es" : current.language,
      niche: Object.hasOwn(input, "niche") ? cleanText(input.niche, 180) : current.niche,
      recipeKey: Object.hasOwn(input, "recipeKey") ? normalizeRecipe(input.recipeKey) : current.recipeKey,
      editTemplate: normalizeEditTemplate({ ...current.editTemplate, ...(input.editTemplate || {}) }),
      preferredTimes: Object.hasOwn(input, "preferredTimes") ? normalizeTimes(input.preferredTimes) : current.preferredTimes,
      createdAt: current.createdAt || now,
      updatedAt: now,
    };

    await this.repository.save(profile);
    return this.getChannelView(channelId);
  }

  async start(channelId, input = {}) {
    const view = await this.getChannelView(channelId);
    if (!view.profile.enabled) throw new Error("Content Factory is disabled for this channel.");

    const source = input.source && typeof input.source === "object" ? input.source : null;
    if (!source?.type) throw new Error("A source is required to start Content Factory.");

    const recipeKey = normalizeRecipe(input.recipeKey || view.profile.recipeKey);
    const ensured = await this.recipes.ensureRecipes();
    const selected = ensured.find((item) => item.recipeKey === recipeKey);
    if (!selected) throw new Error("Content Factory recipe is unavailable.");

    const projectId = String(source.type).toUpperCase() === "CLIPFORGE_PROJECT"
      ? normalizeOptionalId(source.projectId, "project")
      : null;

    const created = await this.workflows.createExecution(selected.workflow.id, {
      projectId,
      idempotencyKey: cleanOptional(input.idempotencyKey, 200),
      input: {
        source,
        factoryChannelId: channelId,
        channelId,
        platform: view.channel.platform,
        brandId: view.profile.brandId,
        editTemplate: view.profile.editTemplate,
        language: view.profile.language,
        niche: view.profile.niche,
        brief: {
          mode: "DETERMINISTIC",
          audience: view.profile.niche || undefined,
          channels: [marketingChannel(view.channel.platform)],
          format: "VERTICAL_VIDEO",
          ...(input.brief || {}),
        },
      },
    });

    if (created.reused) return { ...created, run: null };
    const run = await this.runner.run(created.execution.id);
    return { ...created, run };
  }

  async schedule(channelId, publicationId, options = {}) {
    const view = await this.getChannelView(channelId);
    const publication = await this.publications.get(publicationId);
    if (!publication || publication.channelId !== channelId) {
      throw new Error("Publication does not belong to this Content Factory channel.");
    }

    return this.scheduler.schedulePublication(
      publicationId,
      {
        postsPerDay: view.frequency.postsPerDay,
        preferredTimes: view.profile.preferredTimes,
      },
      options,
    );
  }
}

export function defaultProfile(channelId) {
  assertId(channelId);
  const now = new Date().toISOString();
  return {
    channelId,
    enabled: false,
    brandId: null,
    language: "es",
    niche: "",
    recipeKey: "VIDEO_TO_CLIPS",
    editTemplate: normalizeEditTemplate({}),
    preferredTimes: ["09:00", "15:00", "20:00"],
    createdAt: now,
    updatedAt: now,
  };
}

function countStatuses(publications, executions) {
  const counts = {
    pending: 0,
    processing: 0,
    waitingApproval: 0,
    ready: 0,
    scheduled: 0,
    published: 0,
    failed: 0,
  };

  for (const publication of publications) {
    if (publication.status === "DRAFT") counts.pending += 1;
    else if (publication.status === "PUBLISHING") counts.processing += 1;
    else if (publication.status === "WAITING_APPROVAL") counts.waitingApproval += 1;
    else if (publication.status === "APPROVED") counts.ready += 1;
    else if (publication.status === "SCHEDULED") counts.scheduled += 1;
    else if (publication.status === "PUBLISHED") counts.published += 1;
    else if (publication.status === "FAILED") counts.failed += 1;
  }

  for (const execution of executions) {
    if (["draft", "queued", "waiting_information"].includes(execution.status)) counts.pending += 1;
    else if (["processing", "publishing"].includes(execution.status)) counts.processing += 1;
    else if (execution.status === "waiting_approval") counts.waitingApproval += 1;
    else if (execution.status === "failed") counts.failed += 1;
  }

  return counts;
}

function sumStatus(rows) {
  const totals = { pending: 0, processing: 0, waitingApproval: 0, ready: 0, scheduled: 0, published: 0, failed: 0 };
  for (const row of rows) {
    for (const key of Object.keys(totals)) totals[key] += Number(row.status?.[key] || 0);
  }
  return totals;
}

function effectivePostsPerDay(channel) {
  const values = [Number(channel?.dailyLimit), Number(channel?.strategy?.dailyPostLimit)].filter(Number.isFinite);
  if (values.length === 0 || values.some((value) => value <= 0)) return 0;
  return Math.floor(Math.min(...values));
}

function normalizeEditTemplate(input = {}) {
  return {
    framingMode: enumValue(input.framingMode, FRAMING, "FILL"),
    quality: enumValue(input.quality, QUALITY, "BALANCED"),
    subtitleStyle: enumValue(input.subtitleStyle, SUBTITLES, "VIRAL"),
  };
}

function normalizeTimes(value) {
  const output = [];
  for (const item of Array.isArray(value) ? value : []) {
    const time = String(item || "").trim();
    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && !output.includes(time)) output.push(time);
  }
  return output.length > 0 ? output.sort() : ["09:00", "15:00", "20:00"];
}

function normalizeRecipe(value) {
  const key = String(value || "").trim().toUpperCase();
  if (!RECIPE_KEYS.has(key)) throw new Error("Unsupported Content Factory recipe.");
  return key;
}

function marketingChannel(platform) {
  if (platform === "YOUTUBE") return "YOUTUBE_SHORTS";
  if (platform === "FACEBOOK") return "FACEBOOK_REELS";
  return "TIKTOK";
}

function realPublishingEnabled() {
  return String(process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING || "").trim().toLowerCase() === "true";
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || "").trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanOptional(value, maxLength) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function normalizeOptionalId(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const id = String(value).trim();
  if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`);
  return id;
}

function assertId(value) {
  if (!isProjectId(value)) throw new Error("Invalid channel id.");
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
