import { randomUUID } from "node:crypto";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { SourceRepository } from "../sources/SourceRepository.mjs";
import { SourceService } from "../sources/SourceService.mjs";
import { extractPublicWebPage } from "./WebPageExtractor.mjs";

const MAX_EXTRACTED_TEXT = 500_000;

export class ExtractionService {
  constructor(options = {}) {
    this.repository = options.repository || new SourceRepository();
    this.sources = options.sources || new SourceService({ repository: this.repository });
    this.extractWebPage = options.extractWebPage || extractPublicWebPage;
    this.loadProject = options.loadProject || loadProjectFile;
  }

  async list(filters = {}) {
    return this.repository.listExtractions(filters);
  }

  async get(extractionId) {
    assertUuid(extractionId, "extraction");
    return this.repository.getExtraction(extractionId);
  }

  async extract(sourceId) {
    assertUuid(sourceId, "source");
    const source = await this.repository.getSource(sourceId);
    if (!source) throw new Error("Source not found.");

    const extractionId = randomUUID();
    const createdAt = new Date().toISOString();

    try {
      const material = await this.#materialize(source);
      const text = normalizeText(material.text).slice(0, MAX_EXTRACTED_TEXT);
      if (!text) throw new Error("Source did not contain useful extractable text.");

      const record = {
        id: extractionId,
        sourceId: source.id,
        sourceType: source.type,
        projectId: source.projectId,
        status: "COMPLETED",
        text,
        summary: buildSummary(text),
        signals: extractSignals(text),
        metadata: sanitizeObject(material.metadata),
        error: null,
        createdAt,
        completedAt: new Date().toISOString(),
      };

      await this.repository.saveExtraction(record);
      await this.sources.markExtracted(source.id, record.id);
      return record;
    } catch (error) {
      const message = compactError(error);
      const record = {
        id: extractionId,
        sourceId: source.id,
        sourceType: source.type,
        projectId: source.projectId,
        status: "FAILED",
        text: "",
        summary: "",
        signals: emptySignals(),
        metadata: {},
        error: message,
        createdAt,
        completedAt: new Date().toISOString(),
      };

      await this.repository.saveExtraction(record);
      await this.sources.markExtracted(source.id, record.id);
      const extractionError = new Error(message);
      extractionError.extractionId = record.id;
      throw extractionError;
    }
  }

  async #materialize(source) {
    if (source.type === "TEXT") {
      return {
        text: String(source?.input?.text || ""),
        metadata: {
          origin: source.origin,
          characterCount: Number(source?.metadata?.characterCount || 0),
        },
      };
    }

    if (source.type === "URL") {
      const page = await this.extractWebPage(source?.input?.url);
      return {
        text: [page.title, page.description, page.text].filter(Boolean).join("\n\n"),
        metadata: {
          finalUrl: page.url,
          title: page.title,
          description: page.description,
          contentType: page.contentType,
          bytesRead: page.bytesRead,
        },
      };
    }

    if (source.type === "CLIPFORGE_PROJECT") {
      const projectId = String(source?.input?.projectId || source.projectId || "");
      if (!isProjectId(projectId)) throw new Error("Source has an invalid ClipForge project id.");
      const project = await this.loadProject(projectId);
      if (!project) throw new Error("ClipForge project not found.");

      const segments = Array.isArray(project?.transcript?.segments)
        ? project.transcript.segments
        : [];
      const candidates = Array.isArray(project?.analysis?.candidates)
        ? project.analysis.candidates
        : [];
      const transcriptText = segments
        .map((segment) => String(segment?.text || "").trim())
        .filter(Boolean)
        .join(" ");
      const candidateText = candidates
        .map((candidate) => String(candidate?.text || candidate?.hook || candidate?.title || "").trim())
        .filter(Boolean)
        .join("\n");

      return {
        text: transcriptText || candidateText,
        metadata: {
          originalName: project?.source?.originalName || null,
          durationSeconds: numberOrNull(project?.source?.durationSeconds),
          width: numberOrNull(project?.source?.width),
          height: numberOrNull(project?.source?.height),
          transcriptSegments: segments.length,
          candidateCount: candidates.length,
          topCandidates: candidates
            .slice()
            .sort((a, b) => Number(b?.viralScore || 0) - Number(a?.viralScore || 0))
            .slice(0, 10)
            .map((candidate) => ({
              id: candidate?.id || null,
              title: candidate?.title || null,
              hook: candidate?.hook || null,
              startTime: numberOrNull(candidate?.startTime),
              endTime: numberOrNull(candidate?.endTime),
              viralScore: numberOrNull(candidate?.viralScore),
            })),
        },
      };
    }

    throw new Error(`Unsupported source type: ${source.type}.`);
  }
}

export function extractSignals(text) {
  const value = normalizeText(text);
  const numericAmount = String.raw`\d(?:[\d.,]*\d)?`;
  const priceExpression = new RegExp(
    String.raw`(?:₡|\$|€|£)\s?${numericAmount}(?:\s?(?:CRC|USD|EUR))?|\b${numericAmount}\s?(?:CRC|USD|EUR)\b`,
    "gi",
  );

  return {
    prices: uniqueMatches(value, priceExpression, 30),
    emails: uniqueMatches(value, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 30),
    phones: uniqueMatches(value, /(?<!\d)(?:\+?\d[\d ()-]{6,}\d)(?!\d)/g, 30),
    urls: uniqueMatches(value, /https?:\/\/[^\s<>"')]+/gi, 30),
    hours: uniqueMatches(
      value,
      /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|a|hasta)\s*(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:a\.?m\.?|p\.?m\.?)?\b/gi,
      20,
    ),
    ctaCandidates: findCtaSentences(value, 20),
  };
}

export function buildSummary(text) {
  const value = normalizeText(text);
  if (value.length <= 600) return value;

  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const selected = [];
  let length = 0;

  for (const sentence of sentences) {
    if (selected.length >= 4) break;
    if (length + sentence.length > 580 && selected.length > 0) break;
    selected.push(sentence);
    length += sentence.length + 1;
  }

  const summary = selected.join(" ") || value.slice(0, 580);
  return summary.length < value.length ? `${summary.slice(0, 596).trim()}…` : summary;
}

function findCtaSentences(text, limit) {
  const expression = /\b(?:escrib\w*|llam\w*|contact\w*|reserv\w*|compr\w*|solicit\w*|agend\w*|visit\w*|cotiz\w*|whatsapp|más información)\b/i;
  const parts = text.split(/(?<=[.!?\n])\s+/).map((part) => part.trim()).filter(Boolean);
  const matches = [];
  for (const part of parts) {
    if (!expression.test(part)) continue;
    const compact = part.slice(0, 240);
    if (!matches.includes(compact)) matches.push(compact);
    if (matches.length >= limit) break;
  }
  return matches;
}

function uniqueMatches(text, expression, limit) {
  const matches = [];
  for (const match of text.matchAll(expression)) {
    const value = String(match[0] || "").trim();
    if (value && !matches.includes(value)) matches.push(value);
    if (matches.length >= limit) break;
  }
  return matches;
}

function emptySignals() {
  return { prices: [], emails: [], phones: [], urls: [], hours: [], ctaCandidates: [] };
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assertUuid(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}

function compactError(error) {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}
