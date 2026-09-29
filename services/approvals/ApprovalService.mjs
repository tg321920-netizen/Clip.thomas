import { randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { ContentGenerationRepository } from "../content-generation/ContentGenerationRepository.mjs";
import { InternalNotificationService } from "../notifications/InternalNotificationService.mjs";
import { ApprovalRepository } from "./ApprovalRepository.mjs";

const SUBJECT_TYPES = new Set([
  "CONTENT_GENERATION",
  "WORKFLOW_EXECUTION",
  "PUBLICATION",
  "CAMPAIGN",
  "CONNECTION",
  "BUDGET",
  "DELETION",
  "INFORMATION",
]);

const STATUSES = new Set([
  "PENDING",
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
  "CANCELLED",
]);

export class ApprovalService {
  constructor(options = {}) {
    this.repository = options.repository || new ApprovalRepository();
    this.content = options.content || new ContentGenerationRepository();
    this.notifications = options.notifications || new InternalNotificationService();
  }

  async list(filters = {}) {
    return this.repository.list({
      ...(filters.projectId ? { projectId: normalizeId(filters.projectId, "project") } : {}),
      ...(filters.status ? { status: normalizeStatusFilter(filters.status) } : {}),
      ...(filters.subjectType ? { subjectType: normalizeSubjectType(filters.subjectType) } : {}),
      ...(filters.subjectId ? { subjectId: normalizeId(filters.subjectId, "subject") } : {}),
    });
  }

  async get(approvalId) {
    return this.repository.get(normalizeId(approvalId, "approval"));
  }

  async request(input = {}) {
    const subjectType = normalizeSubjectType(input.subjectType);
    const subjectId = normalizeId(input.subjectId, "subject");
    if (subjectType === "CONTENT_GENERATION") {
      return this.requestForContentGeneration(subjectId, input);
    }

    const existing = await this.repository.findPendingBySubject(subjectType, subjectId);
    if (existing) return { approval: existing, reused: true };

    const now = new Date().toISOString();
    const approval = {
      id: randomUUID(),
      projectId: optionalId(input.projectId, "project"),
      subjectType,
      subjectId,
      title: cleanText(input.title, 160) || defaultTitle(subjectType),
      message: cleanText(input.message, 1000) || "Esta acción necesita tu aprobación para continuar.",
      status: "PENDING",
      selectedVariantId: null,
      note: null,
      details: sanitizeObject(input.details),
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    await this.repository.save(approval);
    await this.#notifyRequired(approval);
    return { approval, reused: false };
  }

  async requestForContentGeneration(generationId, input = {}) {
    const id = normalizeId(generationId, "content generation");
    const generation = await this.content.get(id);
    if (!generation) throw new Error("Content generation not found.");
    if (generation.status === "APPROVED") {
      throw new Error("Content generation is already approved.");
    }

    const existing = await this.repository.findPendingBySubject("CONTENT_GENERATION", id);
    if (existing) return { approval: existing, reused: true };

    const now = new Date().toISOString();
    const approval = {
      id: randomUUID(),
      projectId: generation.projectId || null,
      subjectType: "CONTENT_GENERATION",
      subjectId: id,
      title: cleanText(input.title, 160) || "Contenido listo para aprobar",
      message:
        cleanText(input.message, 1000) ||
        `Hay ${generation.variants?.length || 0} variante(s) de contenido listas para revisar.`,
      status: "PENDING",
      selectedVariantId: null,
      note: null,
      details: {
        variantIds: Array.isArray(generation.variants)
          ? generation.variants.map((variant) => variant.id)
          : [],
        ...sanitizeObject(input.details),
      },
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };

    await this.repository.save(approval);
    await this.content.save({
      ...generation,
      status: "WAITING_APPROVAL",
      approvalId: approval.id,
      selectedVariantId: null,
      reviewNote: null,
      reviewedAt: null,
      updatedAt: now,
    });
    await this.#notifyRequired(approval);
    return { approval, reused: false };
  }

  async approve(approvalId, options = {}) {
    const approval = await this.#requirePending(approvalId);
    const now = new Date().toISOString();
    let selectedVariantId = null;

    if (approval.subjectType === "CONTENT_GENERATION") {
      const generation = await this.content.get(approval.subjectId);
      if (!generation) throw new Error("Content generation not found.");
      selectedVariantId = resolveSelectedVariant(generation, options.selectedVariantId);
      await this.content.save({
        ...generation,
        status: "APPROVED",
        approvalId: approval.id,
        selectedVariantId,
        reviewNote: cleanText(options.note, 1000) || null,
        reviewedAt: now,
        updatedAt: now,
      });
    }

    const updated = {
      ...approval,
      status: "APPROVED",
      selectedVariantId,
      note: cleanText(options.note, 1000) || null,
      updatedAt: now,
      resolvedAt: now,
    };
    await this.repository.save(updated);
    await this.#notifyResolved(updated, "Aprobación completada");
    return updated;
  }

  async requestChanges(approvalId, options = {}) {
    const approval = await this.#requirePending(approvalId);
    const note = cleanText(options.note, 1000);
    if (!note) throw new Error("A note is required when requesting changes.");
    const now = new Date().toISOString();

    if (approval.subjectType === "CONTENT_GENERATION") {
      const generation = await this.content.get(approval.subjectId);
      if (!generation) throw new Error("Content generation not found.");
      await this.content.save({
        ...generation,
        status: "CHANGES_REQUESTED",
        approvalId: approval.id,
        selectedVariantId: null,
        reviewNote: note,
        reviewedAt: now,
        updatedAt: now,
      });
    }

    const updated = {
      ...approval,
      status: "CHANGES_REQUESTED",
      note,
      updatedAt: now,
      resolvedAt: now,
    };
    await this.repository.save(updated);
    await this.#notifyResolved(updated, "Cambios solicitados");
    return updated;
  }

  async reject(approvalId, options = {}) {
    const approval = await this.#requirePending(approvalId);
    const now = new Date().toISOString();
    const note = cleanText(options.note, 1000) || null;

    if (approval.subjectType === "CONTENT_GENERATION") {
      const generation = await this.content.get(approval.subjectId);
      if (!generation) throw new Error("Content generation not found.");
      await this.content.save({
        ...generation,
        status: "REJECTED",
        approvalId: approval.id,
        selectedVariantId: null,
        reviewNote: note,
        reviewedAt: now,
        updatedAt: now,
      });
    }

    const updated = {
      ...approval,
      status: "REJECTED",
      note,
      updatedAt: now,
      resolvedAt: now,
    };
    await this.repository.save(updated);
    await this.#notifyResolved(updated, "Contenido o acción rechazada");
    return updated;
  }

  async cancel(approvalId, options = {}) {
    const approval = await this.#requirePending(approvalId);
    const now = new Date().toISOString();
    const updated = {
      ...approval,
      status: "CANCELLED",
      note: cleanText(options.note, 1000) || null,
      updatedAt: now,
      resolvedAt: now,
    };
    await this.repository.save(updated);
    await this.#notifyResolved(updated, "Solicitud de aprobación cancelada");
    return updated;
  }

  async #requirePending(approvalId) {
    const approval = await this.repository.get(normalizeId(approvalId, "approval"));
    if (!approval) throw new Error("Approval not found.");
    if (approval.status !== "PENDING") {
      throw new Error(`Approval cannot be changed from ${approval.status}.`);
    }
    return approval;
  }

  async #notifyRequired(approval) {
    try {
      await this.notifications.create({
        projectId: approval.projectId,
        type: "APPROVAL_REQUIRED",
        title: "Necesita tu atención",
        message: approval.title,
        subjectType: "APPROVAL",
        subjectId: approval.id,
      });
    } catch {
      // A notification failure must not lose the approval request itself.
    }
  }

  async #notifyResolved(approval, title) {
    try {
      await this.notifications.create({
        projectId: approval.projectId,
        type: "APPROVAL_RESOLVED",
        title,
        message: approval.title,
        subjectType: "APPROVAL",
        subjectId: approval.id,
      });
    } catch {
      // Resolution is authoritative even if internal notification persistence fails.
    }
  }
}

function resolveSelectedVariant(generation, requestedVariantId) {
  const variants = Array.isArray(generation.variants) ? generation.variants : [];
  if (variants.length === 0) throw new Error("Content generation has no variants to approve.");
  if (variants.length === 1 && !requestedVariantId) return variants[0].id;

  const id = String(requestedVariantId || "").trim();
  if (!id) throw new Error("selectedVariantId is required when approving multiple variants.");
  const match = variants.find((variant) => variant.id === id);
  if (!match) throw new Error("selectedVariantId does not belong to this content generation.");
  return match.id;
}

function normalizeSubjectType(value) {
  const type = String(value || "").trim().toUpperCase();
  if (!SUBJECT_TYPES.has(type)) throw new Error(`Unsupported approval subject type: ${type || "missing"}.`);
  return type;
}

function normalizeStatusFilter(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = values.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  if (normalized.length === 0) throw new Error("Approval status filter cannot be empty.");
  for (const status of normalized) {
    if (!STATUSES.has(status)) throw new Error(`Unsupported approval status: ${status}.`);
  }
  return normalized.length === 1 ? normalized[0] : normalized;
}

function defaultTitle(subjectType) {
  if (subjectType === "BUDGET") return "Presupuesto pendiente de aprobación";
  if (subjectType === "CONNECTION") return "Conexión pendiente de aprobación";
  if (subjectType === "DELETION") return "Eliminación pendiente de aprobación";
  if (subjectType === "INFORMATION") return "Información necesaria";
  if (subjectType === "PUBLICATION") return "Publicación pendiente de aprobación";
  return "Acción pendiente de aprobación";
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeId(value, label);
}

function normalizeId(value, label) {
  const id = String(value || "").trim();
  if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`);
  return id;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}
