import { AnalyticsService } from "../analytics/AnalyticsService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { MarketingMemoryService } from "../marketing-memory/MarketingMemoryService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { OriginalNewsScriptService } from "../owned-content/OriginalNewsScriptService.mjs";
import { AudioEngine } from "../owned-content/AudioEngine.mjs";
import { OwnedContentRenderService } from "../owned-content/OwnedContentRenderService.mjs";
import { ResearchEngine } from "../owned-content/ResearchEngine.mjs";
import { TrendHunterService } from "../owned-content/TrendHunterService.mjs";
import { VisualAssemblyService } from "../owned-content/VisualAssemblyService.mjs";
import { SocialPublishingRouter } from "../publishing/connectors/SocialPublishingRouter.mjs";
import { sanitizeAgentValue } from "./AgentContracts.mjs";

export class AgentToolRegistry {
  constructor(options = {}) {
    this.trends = options.trends || new TrendHunterService();
    this.channels = options.channels || new ChannelService();
    this.research = options.research || new ResearchEngine();
    this.scripts = options.scripts || new OriginalNewsScriptService();
    this.audio = options.audio || new AudioEngine();
    this.visuals = options.visuals || new VisualAssemblyService();
    this.renderer = options.renderer || new OwnedContentRenderService();
    this.publications = options.publications || new PublicationService({
      channels: this.channels,
    });
    this.analytics = options.analytics || new AnalyticsService({
      publications: this.publications,
    });
    this.memory = options.memory || new MarketingMemoryService();
    this.social = options.social || new SocialPublishingRouter({
      channels: this.channels,
      publications: this.publications,
    });

    this.tools = new Map();
    this.#registerDefaults();
    for (const tool of options.extraTools || []) this.register(tool);
  }

  register(tool) {
    const name = String(tool?.name || "").trim();
    if (!/^[a-z][a-z0-9.-]{1,80}$/i.test(name)) throw new Error("Invalid agent tool name.");
    if (typeof tool.execute !== "function") throw new Error(`Agent tool ${name} requires execute().`);
    if (this.tools.has(name)) throw new Error(`Agent tool already registered: ${name}.`);
    this.tools.set(name, {
      name,
      description: String(tool.description || "").slice(0, 500),
      inputHint: sanitizeAgentValue(tool.inputHint || {}),
      execute: tool.execute,
    });
  }

  listDefinitions() {
    return [...this.tools.values()].map(({ name, description, inputHint }) => ({
      name,
      description,
      inputHint,
    }));
  }

  has(name) {
    return this.tools.has(String(name || ""));
  }

  async execute(name, input = {}, context = {}) {
    const tool = this.tools.get(String(name || ""));
    if (!tool) {
      throw new AgentToolError(`Agent tool is not allowed: ${name || "empty"}.`, {
        code: "AGENT_TOOL_NOT_ALLOWED",
        retryable: false,
      });
    }

    try {
      return sanitizeAgentValue(await tool.execute(input || {}, context || {}));
    } catch (error) {
      if (error instanceof AgentToolError) throw error;
      throw new AgentToolError(
        error instanceof Error ? error.message : String(error),
        {
          code: String(error?.code || "AGENT_TOOL_FAILED"),
          retryable: error?.retryable === true,
          cause: error,
        },
      );
    }
  }

  #registerDefaults() {
    this.register({
      name: "trends.query",
      description: "Consultar tendencias ya registradas por ClipForge.",
      inputHint: { channelId: "uuid?", state: "VIRAL|RISING|SATURATED|LOW?" },
      execute: (input) => this.trends.list(input),
    });

    this.register({
      name: "channels.status",
      description: "Consultar estado, OAuth y capacidades de TikTok, Facebook y YouTube.",
      inputHint: { scope: "MARKETING|OWNED_CONTENT?" },
      execute: (input) => this.social.listChannelStatuses(input),
    });

    this.register({
      name: "research.start",
      description: "Iniciar investigación con fuentes registradas y trazabilidad.",
      inputHint: { channelId: "uuid", sourceIds: ["uuid"], topic: "string" },
      execute: (input) => this.research.research(input),
    });

    this.register({
      name: "script.generate",
      description: "Generar guion desde un dossier de investigación.",
      inputHint: { researchId: "uuid?", research: "object?", language: "es|en", format: "SHORT" },
      execute: async (input) => {
        const research = input.research ||
          (input.researchId ? await this.research.get(input.researchId) : null);
        if (!research) throw new Error("Research dossier is required.");
        return this.scripts.create({
          research,
          language: input.language,
          format: input.format,
        });
      },
    });

    this.register({
      name: "voice.create",
      description: "Solicitar narración usando el AudioEngine configurado.",
      inputHint: { channelId: "uuid", contentId: "uuid", script: "object" },
      execute: (input) => this.audio.render(input),
    });

    this.register({
      name: "visual.prepare",
      description: "Preparar visuales autorizados para una pieza.",
      inputHint: { projectId: "uuid", channelId: "uuid", research: "object" },
      execute: (input) => this.visuals.prepare(input),
    });

    this.register({
      name: "render.create",
      description: "Solicitar render a través del renderer de contenido propio.",
      inputHint: { projectId: "uuid", channelId: "uuid", script: "object" },
      execute: (input) => this.renderer.render(input),
    });

    this.register({
      name: "publications.query",
      description: "Consultar publicaciones persistidas por ClipForge.",
      inputHint: { channelId: "uuid?", status: "string?" },
      execute: (input) => this.publications.list(input),
    });

    this.register({
      name: "publishing.prepare",
      description: "Preparar publicaciones para conectores sociales sin enviar contenido.",
      inputHint: {
        projectId: "uuid",
        clipId: "uuid",
        platforms: ["TIKTOK", "FACEBOOK", "YOUTUBE"],
        approvalRequired: true,
      },
      execute: (input) => this.social.prepareClip(input),
    });

    this.register({
      name: "publishing.schedule",
      description: "Programar una publicación aprobada. Está bloqueado mientras real publishing esté OFF.",
      inputHint: { publicationId: "uuid", config: "scheduler config" },
      execute: (input) =>
        this.social.schedulePublication(input.publicationId, input.config || {}, {
          allowRealPublishing: true,
        }),
    });

    this.register({
      name: "publishing.publish",
      description: "Publicar mediante TikTok/Facebook/YouTube. Nunca llama las APIs fuera del router controlado.",
      inputHint: { publicationIds: ["uuid"] },
      execute: (input) =>
        this.social.publishContent(input, { allowRealPublishing: true }),
    });

    this.register({
      name: "analytics.query",
      description: "Consultar analytics persistidos; no inventa métricas faltantes.",
      inputHint: { channelId: "uuid?", projectId: "uuid?" },
      execute: (input) => this.analytics.summarize(input),
    });

    this.register({
      name: "marketing.memory.read",
      description: "Leer memoria de marketing y recomendaciones basadas en evidencia.",
      inputHint: { projectId: "uuid?" },
      execute: (input) => this.memory.summarize(input),
    });

    this.register({
      name: "strategy.update",
      description: "Actualizar campos editoriales permitidos de la estrategia de un canal.",
      inputHint: { channelId: "uuid", strategy: "bounded strategy fields" },
      execute: (input) =>
        this.channels.updateStrategy(input.channelId, allowedStrategy(input.strategy)),
    });
  }
}

export class AgentToolError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AgentToolError";
    this.code = options.code || "AGENT_TOOL_ERROR";
    this.retryable = options.retryable === true;
    this.cause = options.cause;
  }
}

function allowedStrategy(input = {}) {
  const allowed = [
    "name",
    "description",
    "systemPrompt",
    "preferredMinDuration",
    "preferredMaxDuration",
    "dailyPostLimit",
    "preferredTopics",
    "avoidTopics",
    "agentAutonomyMode",
  ];
  return Object.fromEntries(
    allowed.filter((key) => Object.hasOwn(input || {}, key)).map((key) => [key, input[key]]),
  );
}
