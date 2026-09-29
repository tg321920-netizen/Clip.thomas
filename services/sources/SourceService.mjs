import { randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { parsePublicSourceUrl } from "../../lib/public-source-url.mjs";
import { SourceRepository } from "./SourceRepository.mjs";

const SOURCE_TYPES = new Set(["TEXT", "URL", "CLIPFORGE_PROJECT"]);

export class SourceService {
  constructor(options = {}) {
    this.repository = options.repository || new SourceRepository();
    this.parseUrl = options.parseUrl || parsePublicSourceUrl;
    this.loadProject = options.loadProject || loadProjectFile;
  }

  async list(filters = {}) {
    return this.repository.listSources({
      ...(filters.type ? { type: normalizeType(filters.type) } : {}),
      ...(filters.projectId ? { projectId: normalizeProjectId(filters.projectId) } : {}),
    });
  }

  async get(sourceId) {
    assertUuid(sourceId, "source");
    return this.repository.getSource(sourceId);
  }

  async create(input = {}) {
    const type = normalizeType(input.type);
    const now = new Date().toISOString();
    const base = {
      id: randomUUID(),
      type,
      projectId: null,
      origin: "",
      input: {},
      metadata: sanitizeObject(input.metadata),
      authorizationStatus: "USER_PROVIDED",
      createdAt: now,
      updatedAt: now,
      latestExtractionId: null,
    };

    let source;
    if (type === "TEXT") source = await this.#createText(base, input);
    else if (type === "URL") source = await this.#createUrl(base, input);
    else source = await this.#createClipForgeProject(base, input);

    await this.repository.saveSource(source);
    return source;
  }

  async markExtracted(sourceId, extractionId) {
    assertUuid(sourceId, "source");
    assertUuid(extractionId, "extraction");
    const source = await this.repository.getSource(sourceId);
    if (!source) throw new Error("Source not found.");

    const updated = {
      ...source,
      latestExtractionId: extractionId,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.saveSource(updated);
    return updated;
  }

  async #createText(base, input) {
    const text = normalizeText(input.text, 250_000);
    if (!text) throw new Error("Text source cannot be empty.");

    return {
      ...base,
      projectId: optionalProjectId(input.projectId),
      origin: "manual:text",
      input: { text },
      authorizationStatus: "USER_PROVIDED",
      metadata: {
        ...base.metadata,
        characterCount: text.length,
      },
    };
  }

  async #createUrl(base, input) {
    if (input.authorizationConfirmed !== true) {
      throw new Error("URL sources require explicit authorization confirmation.");
    }

    const url = await this.parseUrl(input.url);
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      throw new Error("Marketing webpage sources must use HTTP or HTTPS.");
    }
    if (url.username || url.password) {
      throw new Error("URLs with embedded credentials are not allowed.");
    }
    url.hash = "";

    return {
      ...base,
      projectId: optionalProjectId(input.projectId),
      origin: `${url.protocol}//${url.host}`,
      input: { url: url.toString() },
      authorizationStatus: "USER_CONFIRMED",
      metadata: {
        ...base.metadata,
        hostname: url.hostname,
      },
    };
  }

  async #createClipForgeProject(base, input) {
    const projectId = normalizeProjectId(input.projectId);
    const project = await this.loadProject(projectId);
    if (!project) throw new Error("ClipForge project not found.");

    return {
      ...base,
      projectId,
      origin: "clipforge:project",
      input: { projectId },
      authorizationStatus: "INTERNAL",
      metadata: {
        ...base.metadata,
        sourceName: project?.source?.originalName || null,
        hasTranscript: project?.transcript?.status === "COMPLETED",
        hasAnalysis: project?.analysis?.status === "COMPLETED",
        clipCount: Array.isArray(project?.clips) ? project.clips.length : 0,
      },
    };
  }
}

export function normalizeType(value) {
  const type = String(value || "").trim().toUpperCase();
  if (!SOURCE_TYPES.has(type)) {
    throw new Error(`Unsupported source type: ${type || "missing"}.`);
  }
  return type;
}

function optionalProjectId(value) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeProjectId(value);
}

function normalizeProjectId(value) {
  const projectId = String(value || "").trim();
  if (!isProjectId(projectId)) throw new Error("Invalid project id.");
  return projectId;
}

function assertUuid(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error("Source metadata must be JSON serializable.");
  }
}
