import { createHash, randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { PerformanceAnalyzer } from "../analytics/PerformanceAnalyzer.mjs";
import { ContentGenerationRepository } from "../content-generation/ContentGenerationRepository.mjs";
import { MarketingMemoryRepository } from "./MarketingMemoryRepository.mjs";

export class MarketingMemoryService {
  constructor(options = {}) {
    this.repository = options.repository || new MarketingMemoryRepository();
    this.content = options.content || new ContentGenerationRepository();
    this.performance = options.performance || new PerformanceAnalyzer();
  }

  async list(filters = {}) {
    return this.repository.list({
      ...(filters.projectId ? { projectId: normalizeId(filters.projectId, "project") } : {}),
      ...(filters.type ? { type: String(filters.type).trim().toUpperCase() } : {}),
      ...(filters.subjectId ? { subjectId: normalizeId(filters.subjectId, "subject") } : {}),
    });
  }

  async captureGeneration(generationId) {
    const id = normalizeId(generationId, "content generation");
    const generation = await this.content.get(id);
    if (!generation) throw new Error("Content generation not found.");
    const existing = await this.repository.list({ subjectId: id });
    const fingerprint = fingerprintGeneration(generation);
    const same = existing.find((item) => item.fingerprint === fingerprint);
    if (same) return { record: same, reused: true };

    const selected = generation.selectedVariantId
      ? (generation.variants || []).find((item) => item.id === generation.selectedVariantId)
      : null;
    const variants = (generation.variants || []).map((variant) => ({
      id: variant.id,
      label: variant.label,
      angle: variant.angle,
      title: variant.title,
      hook: variant.hook,
      cta: variant.cta,
      hashtags: variant.hashtags || [],
    }));
    const record = {
      id: randomUUID(),
      projectId: generation.projectId || null,
      type: generation.status === "REJECTED" ? "REJECTED_CONTENT" : "CONTENT_HISTORY",
      subjectId: id,
      fingerprint,
      status: generation.status,
      selectedVariantId: generation.selectedVariantId || null,
      selected: selected ? {
        angle: selected.angle,
        title: selected.title,
        hook: selected.hook,
        cta: selected.cta,
        hashtags: selected.hashtags || [],
      } : null,
      variants,
      reviewNote: generation.reviewNote || null,
      createdAt: new Date().toISOString(),
    };
    await this.repository.save(record);
    return { record, reused: false };
  }

  async capturePerformance(filters = {}) {
    const report = await this.performance.analyze(filters);
    const projectId = filters.projectId ? normalizeId(filters.projectId, "project") : null;
    const fingerprint = hash(JSON.stringify({
      projectId,
      publicationCount: report.publicationCount,
      measuredCount: report.measuredCount,
      recommendations: report.recommendations,
    }));
    const existing = (await this.repository.list({ projectId: projectId || undefined, type: "PERFORMANCE_INSIGHT" }))
      .find((item) => item.fingerprint === fingerprint);
    if (existing) return { record: existing, reused: true, report };

    const record = {
      id: randomUUID(),
      projectId,
      type: "PERFORMANCE_INSIGHT",
      subjectId: null,
      fingerprint,
      report,
      createdAt: new Date().toISOString(),
    };
    await this.repository.save(record);
    return { record, reused: false, report };
  }

  async summarize(filters = {}) {
    const projectId = filters.projectId ? normalizeId(filters.projectId, "project") : null;
    const records = await this.repository.list({ projectId: projectId || undefined });
    const content = records.filter((item) => item.type === "CONTENT_HISTORY" || item.type === "REJECTED_CONTENT");
    const selected = content.map((item) => item.selected).filter(Boolean);
    const performance = records.filter((item) => item.type === "PERFORMANCE_INSIGHT");
    return {
      projectId,
      contentRecords: content.length,
      rejectedCount: content.filter((item) => item.type === "REJECTED_CONTENT").length,
      usedTitles: unique(selected.map((item) => item.title).filter(Boolean)).slice(0, 100),
      usedHooks: unique(selected.map((item) => item.hook).filter(Boolean)).slice(0, 100),
      usedCtas: unique(selected.map((item) => item.cta).filter(Boolean)).slice(0, 100),
      usedAngles: unique(selected.map((item) => item.angle).filter(Boolean)),
      latestPerformanceRecommendations: performance[0]?.report?.recommendations || [],
      latestPerformanceSampleNotice: performance[0]?.report?.sampleNotice || null,
      note: "La memoria registra historial y evidencia. No cambia automáticamente una estrategia solo por una muestra pequeña.",
    };
  }
}

function fingerprintGeneration(generation) {
  return hash(JSON.stringify({
    status: generation.status,
    selectedVariantId: generation.selectedVariantId || null,
    reviewNote: generation.reviewNote || null,
    variants: (generation.variants || []).map((item) => [item.id, item.title, item.hook, item.cta]),
  }));
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function unique(values) { return [...new Set(values)]; }
function normalizeId(value, label) {
  const id = String(value || "").trim();
  if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`);
  return id;
}
