import { isProjectId } from "../../lib/project-id.mjs";
import { AnalyticsService } from "../analytics/AnalyticsService.mjs";
import { BrandService } from "../branding/BrandService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { ContentCostService, normalizeBudget } from "../owned-content/ContentCostService.mjs";
import { applyContentLinePreset, getContentLinePreset, listContentLinePresets, zeroBudget } from "../owned-content/ContentLinePresets.mjs";
import { OwnedContentPerformanceService } from "../owned-content/OwnedContentPerformanceService.mjs";
import { OwnedContentWorkflowRecipeService } from "../owned-content/OwnedContentWorkflowRecipeService.mjs";
import { OwnedContentWorkflowRunner } from "../owned-content/OwnedContentWorkflowRunner.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { SchedulerService } from "../scheduler/SchedulerService.mjs";
import { WorkflowService } from "../workflows/WorkflowService.mjs";
import { ContentFactoryRepository } from "./ContentFactoryRepository.mjs";

const FRAMING = new Set(["FILL", "FIT"]);
const QUALITY = new Set(["FAST", "BALANCED", "HIGH"]);
const SUBTITLES = new Set(["CLEAN", "VIRAL", "KARAOKE"]);
const FORMATS = new Set(["SHORT", "MEDIUM", "LONG"]);

export class ContentFactoryService {
  constructor(options = {}) {
    this.repository = options.repository || new ContentFactoryRepository();
    this.channels = options.channels || new ChannelService();
    this.brands = options.brands || new BrandService();
    this.publications = options.publications || new PublicationService({ channels: this.channels });
    this.analytics = options.analytics || new AnalyticsService({ publications: this.publications });
    this.workflows = options.workflows || new WorkflowService();
    this.ownedRecipes = options.ownedRecipes || new OwnedContentWorkflowRecipeService({ workflows: this.workflows });
    this.ownedRunner = options.ownedRunner || new OwnedContentWorkflowRunner({ workflows: this.workflows, brands: this.brands, publications: this.publications });
    this.scheduler = options.scheduler || new SchedulerService({ publications: this.publications, channels: this.channels });
    this.costs = options.costs || new ContentCostService();
    this.performance = options.performance || new OwnedContentPerformanceService({ publications: this.publications, analytics: this.analytics });
  }

  listPresets() {
    return listContentLinePresets();
  }

  async listDashboard() {
    const channels = await this.channels.listChannels();
    const rows = await Promise.all(channels.map((channel) => this.getChannelView(channel.id)));
    return {
      scope: "OWNED_CONTENT",
      realPublishingEnabled: realPublishingEnabled(),
      presets: this.listPresets(),
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
    const profile = migrateProfile(storedProfile || defaultProfile(channelId));
    const executions = allExecutions.filter((item) => item?.input?.factoryChannelId === channelId && item?.input?.contentScope === "OWNED_CONTENT");
    const status = countStatuses(publications, executions);
    const budgetStatus = await this.costs.budgetStatus(channelId, profile.budget || zeroBudget());

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
      budgetStatus,
      realPublishingEnabled: realPublishingEnabled(),
    };
  }

  async configure(channelId, input = {}) {
    assertId(channelId);
    let channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");

    const stored = migrateProfile((await this.repository.get(channelId)) || defaultProfile(channelId));
    let current = stored;
    if (Object.hasOwn(input, "lineKey") && input.lineKey) {
      current = applyContentLinePreset(current, input.lineKey);
    }

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
      ...current,
      channelId,
      scope: "OWNED_CONTENT",
      enabled: Object.hasOwn(input, "enabled") ? Boolean(input.enabled) : current.enabled,
      brandId,
      lineKey: Object.hasOwn(input, "lineKey") ? normalizeLineKey(input.lineKey) : current.lineKey,
      language: Object.hasOwn(input, "language") ? cleanText(input.language, 40) || current.language || "es-419" : current.language,
      targetCountry: Object.hasOwn(input, "targetCountry") ? cleanText(input.targetCountry, 80) : current.targetCountry,
      targetAudience: Object.hasOwn(input, "targetAudience") ? cleanText(input.targetAudience, 300) : current.targetAudience,
      niche: Object.hasOwn(input, "niche") ? cleanText(input.niche, 220) : current.niche,
      voiceProfile: Object.hasOwn(input, "voiceProfile") ? cleanText(input.voiceProfile, 80).toUpperCase() : current.voiceProfile,
      strategyText: Object.hasOwn(input, "strategyText") ? cleanText(input.strategyText, 2000) : current.strategyText,
      preferredSources: Object.hasOwn(input, "preferredSources") ? normalizeList(input.preferredSources, 30, 200) : current.preferredSources,
      rules: Object.hasOwn(input, "rules") ? normalizeList(input.rules, 40, 300) : current.rules,
      formats: Object.hasOwn(input, "formats") ? normalizeFormats(input.formats) : current.formats,
      defaultFormat: Object.hasOwn(input, "defaultFormat") ? normalizeFormat(input.defaultFormat) : current.defaultFormat,
      budget: Object.hasOwn(input, "budget") ? normalizeBudget({ ...current.budget, ...input.budget }) : normalizeBudget(current.budget),
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
    if (!view.profile.lineKey) throw new Error("Choose an owned-content line before starting a story.");
    if (!cleanText(input.topic, 240)) throw new Error("A story topic is required.");

    const sources = Array.isArray(input.sources) ? input.sources : [];
    const sourceIds = Array.isArray(input.sourceIds) ? input.sourceIds : [];
    if (sources.length + sourceIds.length < 2) throw new Error("Owned-content stories require at least two independent sources.");

    const ensured = await this.ownedRecipes.ensure();
    const created = await this.workflows.createExecution(ensured.workflow.id, {
      idempotencyKey: cleanOptional(input.idempotencyKey, 200),
      input: {
        contentScope: "OWNED_CONTENT",
        factoryChannelId: channelId,
        channelId,
        platform: view.channel.platform,
        brandId: view.profile.brandId,
        topic: cleanText(input.topic, 240),
        category: cleanText(input.category, 100) || "GENERAL",
        format: normalizeFormat(input.format || view.profile.defaultFormat || "SHORT"),
        sourceIds,
        sources,
        trendId: input.trendId || null,
        trendSignal: input.trendSignal || null,
        who: input.who,
        where: input.where,
        visualAssetIds: Array.isArray(input.visualAssetIds) ? input.visualAssetIds : [],
        musicAssetId: input.musicAssetId || null,
        ttsMode: input.ttsMode || "TTS_FREE",
        authorizedPremiumTts: input.authorizedPremiumTts === true,
        estimatedPremiumTtsCostUsd: input.estimatedPremiumTtsCostUsd,
        actualPremiumTtsCostUsd: input.actualPremiumTtsCostUsd,
        nearDuplicate: input.nearDuplicate === true,
        language: view.profile.language,
        voiceProfile: view.profile.voiceProfile,
        editTemplate: view.profile.editTemplate,
        profileSnapshot: view.profile,
      },
    });

    if (created.reused) return { ...created, run: null };
    const run = await this.ownedRunner.run(created.execution.id);
    return { ...created, run };
  }

  async continueAfterApproval(executionId) {
    return this.ownedRunner.continueAfterHumanApproval(executionId);
  }

  async schedule(channelId, publicationId, options = {}) {
    if (!realPublishingEnabled()) {
      throw new Error("Owned-content real publishing is OFF. Set CLIPFORGE_CONTENT_REAL_PUBLISHING=true only after explicit activation.");
    }
    const view = await this.getChannelView(channelId);
    const publication = await this.publications.get(publicationId);
    if (!publication || publication.channelId !== channelId) throw new Error("Publication does not belong to this Content Factory channel.");
    return this.scheduler.schedulePublication(publicationId, {
      postsPerDay: view.frequency.postsPerDay,
      preferredTimes: view.profile.preferredTimes,
    }, options);
  }

  async performanceFor(channelId) {
    assertId(channelId);
    return this.performance.analyze({ channelId });
  }
}

export function defaultProfile(channelId) {
  assertId(channelId);
  const now = new Date().toISOString();
  return {
    channelId,
    scope: "OWNED_CONTENT",
    enabled: false,
    brandId: null,
    lineKey: null,
    language: "es-419",
    targetCountry: "",
    targetAudience: "",
    niche: "",
    voiceProfile: "LATAM_NEWS_ES",
    strategyText: "",
    preferredSources: [],
    rules: [],
    formats: ["SHORT", "MEDIUM"],
    defaultFormat: "SHORT",
    budget: zeroBudget(),
    editTemplate: normalizeEditTemplate({}),
    preferredTimes: ["09:00", "15:00", "20:00"],
    createdAt: now,
    updatedAt: now,
  };
}

function migrateProfile(profile) {
  const base = { ...defaultProfile(profile.channelId), ...profile };
  return {
    ...base,
    scope: "OWNED_CONTENT",
    budget: normalizeBudget(base.budget || zeroBudget()),
    editTemplate: normalizeEditTemplate(base.editTemplate || {}),
    preferredTimes: normalizeTimes(base.preferredTimes),
    preferredSources: normalizeList(base.preferredSources, 30, 200),
    rules: normalizeList(base.rules, 40, 300),
    formats: normalizeFormats(base.formats),
    defaultFormat: normalizeFormat(base.defaultFormat || "SHORT"),
  };
}

function countStatuses(publications, executions) {
  const counts = { pending: 0, processing: 0, waitingApproval: 0, ready: 0, scheduled: 0, published: 0, failed: 0 };
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
function sumStatus(rows) { const totals = { pending: 0, processing: 0, waitingApproval: 0, ready: 0, scheduled: 0, published: 0, failed: 0 }; for (const row of rows) for (const key of Object.keys(totals)) totals[key] += Number(row.status?.[key] || 0); return totals; }
function effectivePostsPerDay(channel) { const values = [Number(channel?.dailyLimit), Number(channel?.strategy?.dailyPostLimit)].filter(Number.isFinite); if (values.length === 0 || values.some((value) => value <= 0)) return 0; return Math.floor(Math.min(...values)); }
function normalizeEditTemplate(input = {}) { return { framingMode: enumValue(input.framingMode, FRAMING, "FILL"), quality: enumValue(input.quality, QUALITY, "BALANCED"), subtitleStyle: enumValue(input.subtitleStyle, SUBTITLES, "VIRAL") }; }
function normalizeTimes(value) { const output = []; for (const item of Array.isArray(value) ? value : []) { const time = String(item || "").trim(); if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && !output.includes(time)) output.push(time); } return output.length > 0 ? output.sort() : ["09:00", "15:00", "20:00"]; }
function normalizeFormat(value) { const format = String(value || "SHORT").trim().toUpperCase(); if (!FORMATS.has(format)) throw new Error("Unsupported content format."); return format; }
function normalizeFormats(value) { const items = Array.isArray(value) ? value.map((item) => String(item).toUpperCase()).filter((item) => FORMATS.has(item)) : []; return [...new Set(items)].length ? [...new Set(items)] : ["SHORT", "MEDIUM"]; }
function normalizeLineKey(value) { if (value === null || value === undefined || value === "") return null; return getContentLinePreset(value).key; }
function normalizeList(value, maxItems, maxLength) { return Array.isArray(value) ? [...new Set(value.map((item) => cleanText(item, maxLength)).filter(Boolean))].slice(0, maxItems) : []; }
function realPublishingEnabled() { return String(process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING || "").trim().toLowerCase() === "true"; }
function enumValue(value, allowed, fallback) { const normalized = String(value || "").trim().toUpperCase(); return allowed.has(normalized) ? normalized : fallback; }
function cleanText(value, maxLength) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength); }
function cleanOptional(value, maxLength) { const text = cleanText(value, maxLength); return text || null; }
function normalizeOptionalId(value, label) { if (value === undefined || value === null || value === "") return null; const id = String(value).trim(); if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`); return id; }
function assertId(value) { if (!isProjectId(value)) throw new Error("Invalid channel id."); }
function boundedInteger(value, min, max, fallback) { const parsed = Number.parseInt(String(value ?? ""), 10); if (!Number.isFinite(parsed)) return fallback; return Math.max(min, Math.min(max, parsed)); }
