import { AnalyticsService } from "../analytics/AnalyticsService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { MarketingMemoryService } from "../marketing-memory/MarketingMemoryService.mjs";
import { ProductProfileService } from "../marketing-brain/ProductProfileService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { OriginalNewsScriptService } from "../owned-content/OriginalNewsScriptService.mjs";
import { AudioEngine } from "../owned-content/AudioEngine.mjs";
import { OwnedContentRenderService } from "../owned-content/OwnedContentRenderService.mjs";
import { ResearchEngine } from "../owned-content/ResearchEngine.mjs";
import { TrendHunterService } from "../owned-content/TrendHunterService.mjs";
import { VisualAssemblyService } from "../owned-content/VisualAssemblyService.mjs";
import { SocialPublishingRouter } from "../publishing/connectors/SocialPublishingRouter.mjs";
import { SmartLicensedClipService } from "../publishing/SmartLicensedClipService.mjs";
import { sanitizeAgentValue } from "./AgentContracts.mjs";
import { assertAgentToolWithinRules } from "./AgentRules.mjs";
import { createHash } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { JobStore } from "../JobStore.mjs";

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
    this.products = options.products || new ProductProfileService();
    this.social = options.social || new SocialPublishingRouter({
      channels: this.channels,
      publications: this.publications,
    });
    this.smartClips = options.smartClips || new SmartLicensedClipService({
      channels: this.channels,
      publications: this.publications,
    });

    this.tools = new Map();
    this.mediaJobs = options.mediaJobs || new JobStore();
    this.loadClipProject = options.loadClipProject || loadProjectFile;
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
      assertAgentToolWithinRules(
        name,
        input || {},
        context?.task?.context?.agentRules || null,
      );
      return sanitizeAgentValue(await tool.execute(input || {}, context || {}));
    } catch (error) {
      if (error instanceof AgentToolError) throw error;
      throw new AgentToolError(
        error instanceof Error ? error.message : String(error),
        {
          code: String(error?.code || "AGENT_TOOL_FAILED"),
          retryable: error?.retryable === true,
          waitingInformation: error?.waitingInformation === true,
          cause: error,
        },
      );
    }
  }

  #registerDefaults() {
    this.register({
      name: "clips.prepare",
      description: "Encolar clips reales de un proyecto existente con los ajustes y derechos confirmados por el propietario en task.context.clipping. Devuelve un trabajo, no un MP4 terminado. No captura URLs ni publica.",
      inputHint: {},
      execute: async (_input, context) => {
        const { projectId, outputId, settings } = await this.#clipContext(context);
        const job = await this.mediaJobs.enqueueMedia("MEDIA_CLIPS", outputId, {
          projectId, count: settings.count, targetDuration: settings.duration,
          minDuration: Math.max(15, settings.duration - 5), maxDuration: settings.duration + 5,
          contentProfile: settings.contentProfile, subtitles: settings.subtitles,
          analysisProvider: "zai", intensity: "GENTLE", agentExecutionId: context.executionId,
        });
        return { jobId: job.id, outputProjectId: outputId, status: job.status, stage: job.stage,
          progress: job.progress, reviewRequired: true, note: "El trabajo debe terminar y sus MP4 deben validarse antes de revisarlos. La publicación está desactivada." };
      },
    });
    this.register({
      name: "clips.status",
      description: "Consultar únicamente el trabajo de clips vinculado a esta ejecución. No vuelve a renderizar ni publica.",
      inputHint: {},
      execute: async (_input, context) => {
        const { outputId } = await this.#clipContext(context);
        const job = await this.mediaJobs.get(`bestclips-${outputId}`);
        if (!job) throw informationNeeded("Primero hay que encolar los clips con clips.prepare.");
        return { jobId: job.id, outputProjectId: outputId, status: job.status, stage: job.stage, progress: job.progress,
          reviewRequired: true, clips: (job.result?.clips || []).map(clip => ({ clipId: clip.clipId, title: clip.title,
            duration: clip.duration, sourceUrl: clip.sourceUrl, downloadUrl: clip.downloadUrl })) };
      },
    });
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
      name: "licensed.video.discover",
      description: "Buscar videos largos en español con licencia Creative Commons, priorizando vistas, engagement y el pico de repetición de YouTube cuando esté disponible.",
      inputHint: { channelId: "uuid", queries: ["podcast español entrevista?"] },
      execute: (input) => this.smartClips.discover(input.channelId, {
        queries: input.queries,
      }),
    });

    this.register({
      name: "licensed.clip.produce",
      description: "Elegir una fuente visual Creative Commons de alto rendimiento, usar el pico de repetición, crear un short real con video y subtítulos, generar título editorial y publicarlo mediante el conector controlado de YouTube.",
      inputHint: { channelId: "uuid", queries: ["podcast español entrevista?"] },
      execute: (input) => this.smartClips.run(input.channelId, {
        queries: input.queries,
      }),
    });

    this.register({
      name: "analytics.query",
      description: "Consultar analytics persistidos; no inventa métricas faltantes.",
      inputHint: { channelId: "uuid?", projectId: "uuid?" },
      execute: (input) => this.analytics.summarize(input),
    });

    this.register({
      name: "marketing.product.list",
      description: "Listar perfiles de productos configurados en ClipForge.",
      inputHint: { country: "string?", active: "boolean?" },
      execute: (input) => this.products.list(input),
    });

    this.register({
      name: "marketing.product.read",
      description: "Leer un perfil de producto configurado en ClipForge.",
      inputHint: { productId: "uuid" },
      execute: (input) => this.products.get(input.productId),
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

  async #clipContext(context) {
    const projectId = context.task?.projectId;
    const raw = context.task?.context?.clipping;
    if (!isProjectId(context.executionId) || !isProjectId(projectId)) throw informationNeeded("El propietario debe seleccionar un proyecto existente para preparar clips.");
    if (raw?.rightsConfirmed !== true) throw informationNeeded("Falta la confirmación de derechos del propietario para este video.");
    const count = Number(raw.count ?? 5), duration = Number(raw.duration ?? 30);
    if (!Number.isInteger(count) || count < 1 || count > 10 || ![15, 30, 45, 60, 90].includes(duration)) throw informationNeeded("Elige de uno a diez clips y una duración de 15, 30, 45, 60 o 90 segundos.");
    const settings = { count, duration, contentProfile: raw.contentProfile || "ENTERTAINMENT", subtitles: raw.subtitles !== false };
    if (!["GAMING", "PODCAST", "ENTERTAINMENT", "NEWS", "MOTIVATION"].includes(settings.contentProfile)) throw informationNeeded("El perfil de contenido no es válido.");
    const project = await this.loadClipProject(projectId);
    if (!project?.source?.relativePath) throw informationNeeded("No se encontró el archivo original del proyecto.");
    const hex = createHash("sha256").update(JSON.stringify([context.executionId, projectId, settings])).digest("hex");
    const outputId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
    return { projectId, outputId, settings };
  }
}

export class AgentToolError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AgentToolError";
    this.code = options.code || "AGENT_TOOL_ERROR";
    this.retryable = options.retryable === true;
    this.waitingInformation = options.waitingInformation === true;
    this.cause = options.cause;
  }
}

function informationNeeded(message) {
  return Object.assign(new Error(message), { code: "CLIP_AGENT_INFORMATION_REQUIRED", waitingInformation: true });
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
