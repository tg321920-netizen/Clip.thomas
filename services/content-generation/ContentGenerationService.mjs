import { randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { MarketingPlanRepository } from "../marketing-brain/MarketingPlanRepository.mjs";
import { ContentGenerationRepository } from "./ContentGenerationRepository.mjs";

const VARIANT_BLUEPRINTS = [
  { label: "A", angle: "PROBLEM" },
  { label: "B", angle: "DEMONSTRATION" },
  { label: "C", angle: "BENEFIT" },
];

export class ContentGenerationService {
  constructor(options = {}) {
    this.plans = options.plans || new MarketingPlanRepository();
    this.records = options.records || new ContentGenerationRepository();
  }

  async list(filters = {}) {
    return this.records.list({
      ...(filters.planId ? { planId: normalizeId(filters.planId, "plan") } : {}),
      ...(filters.projectId ? { projectId: normalizeId(filters.projectId, "project") } : {}),
      ...(filters.status ? { status: normalizeStatus(filters.status) } : {}),
    });
  }

  async get(generationId) {
    return this.records.get(normalizeId(generationId, "content generation"));
  }

  async generate(input = {}) {
    const planId = normalizeId(input.planId, "marketing plan");
    const plan = await this.plans.get(planId);
    if (!plan) throw new Error("Marketing plan not found.");

    const variantCount = normalizeVariantCount(input.variantCount);
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      planId: plan.id,
      projectId: plan.projectId || null,
      format: plan.format,
      channels: Array.isArray(plan.channels) ? [...plan.channels] : [],
      status: "DRAFT",
      requiresApproval: true,
      generationMode: "DETERMINISTIC",
      variants: VARIANT_BLUEPRINTS.slice(0, variantCount).map((blueprint) =>
        buildVariant(plan, blueprint),
      ),
      createdAt: now,
      updatedAt: now,
    };

    await this.records.save(record);
    return record;
  }
}

function buildVariant(plan, blueprint) {
  const duration = normalizeDuration(plan.recommendedDurationSeconds);
  const hook = hookFor(plan, blueprint.angle);
  const message = cleanText(plan.message, 520) || "Presentar la idea principal confirmada en la fuente.";
  const cta = cleanText(plan.cta, 240) || "Conocé más.";
  const title = titleFor(plan, blueprint.angle);
  const description = compact(`${message} ${cta}`, 700);
  const adCopy = [hook, message, cta].filter(Boolean).join("\n\n");
  const video = String(plan.format || "").toUpperCase() === "VERTICAL_VIDEO";
  const beats = video ? buildScript(duration, hook, message, cta) : [];
  const storyboard = video ? buildStoryboard(beats, blueprint.angle) : [];

  return {
    id: randomUUID(),
    label: blueprint.label,
    angle: blueprint.angle,
    title,
    hook,
    description,
    adCopy,
    cta,
    hashtags: buildHashtags(plan),
    script: beats,
    storyboard,
    subtitles: beats.map((beat) => ({
      startSeconds: beat.startSeconds,
      endSeconds: beat.endSeconds,
      text: beat.narration,
    })),
    onScreenText: unique([hook, compact(message, 90), cta]).filter(Boolean).slice(0, 3),
    evidenceExtractionIds: unique(
      (Array.isArray(plan.evidence) ? plan.evidence : [])
        .map((item) => item?.extractionId)
        .filter(Boolean),
    ).length > 0
      ? unique(plan.evidence.map((item) => item?.extractionId).filter(Boolean))
      : unique(Array.isArray(plan.extractionIds) ? plan.extractionIds : []),
  };
}

function hookFor(plan, angle) {
  const objective = String(plan.objective || "");
  if (angle === "DEMONSTRATION") return "Mirá cómo funciona en la práctica.";
  if (angle === "BENEFIT") {
    if (objective === "GET_MESSAGES") return "Hacé más claro el próximo paso para contactarte.";
    if (objective === "GET_CLIENTS") return "Convertí una idea clara en una invitación a conversar.";
    if (objective === "DEMONSTRATE") return "Mostrá la función con un ejemplo simple.";
    return "Comunicá el valor principal sin rodeos.";
  }

  if (objective === "GET_MESSAGES") return "¿La gente sabe cómo contactarte cuando se interesa?";
  if (objective === "GET_CLIENTS") return "¿Tu contenido deja claro qué debería hacer una persona interesada?";
  if (objective === "DEMONSTRATE") return "Explicar ayuda; mostrarlo suele ser más claro.";
  if (objective === "EDUCATE") return "Una idea útil se entiende mejor cuando va directo al punto.";
  return "¿Tu mensaje principal se entiende en los primeros segundos?";
}

function titleFor(plan, angle) {
  const objective = String(plan.objective || "");
  if (angle === "DEMONSTRATION") return compact("Demostración: así funciona", 100);
  if (angle === "BENEFIT") {
    if (objective === "GET_MESSAGES") return "De interés a conversación";
    if (objective === "GET_CLIENTS") return "Una propuesta con siguiente paso";
    return "El valor principal, en pocos segundos";
  }
  if (objective === "PROMOTION") return "Presentá la promoción con claridad";
  if (objective === "PRESENT_PRODUCT") return "Presentación rápida del producto";
  if (objective === "PRESENT_SERVICE") return "Presentación rápida del servicio";
  return "Empezá por el problema correcto";
}

function buildScript(duration, hook, message, cta) {
  const total = Math.max(9, duration || 18);
  const hookEnd = Math.max(2, Math.round(total * 0.22));
  const messageEnd = Math.max(hookEnd + 3, Math.round(total * 0.76));
  return [
    {
      startSeconds: 0,
      endSeconds: hookEnd,
      purpose: "HOOK",
      narration: hook,
    },
    {
      startSeconds: hookEnd,
      endSeconds: messageEnd,
      purpose: "MESSAGE",
      narration: compact(message, 380),
    },
    {
      startSeconds: messageEnd,
      endSeconds: total,
      purpose: "CTA",
      narration: cta,
    },
  ];
}

function buildStoryboard(beats, angle) {
  return beats.map((beat) => ({
    startSeconds: beat.startSeconds,
    endSeconds: beat.endSeconds,
    visual: visualForBeat(beat.purpose, angle),
    onScreenText: compact(beat.narration, 90),
  }));
}

function visualForBeat(purpose, angle) {
  if (purpose === "HOOK") {
    return angle === "PROBLEM"
      ? "Abrir con material propio o licenciado que represente el contexto del problema, sin afirmar datos nuevos."
      : "Abrir con el elemento visual más claro del material propio o licenciado disponible.";
  }
  if (purpose === "MESSAGE") {
    return angle === "DEMONSTRATION"
      ? "Si existe material autorizado de demostración, mostrar la función descrita; si no, usar texto y recursos de marca."
      : "Apoyar el mensaje con material propio o licenciado y texto en pantalla.";
  }
  return "Cerrar con identidad visual propia y el CTA aprobado, sin usar marcas o recursos ajenos no autorizados.";
}

function buildHashtags(plan) {
  const tags = [];
  const channels = Array.isArray(plan.channels) ? plan.channels : [];
  const objective = String(plan.objective || "");

  if (channels.some((channel) => String(channel).includes("REELS"))) tags.push("#Reels");
  if (channels.includes("YOUTUBE_SHORTS")) tags.push("#Shorts");
  if (channels.includes("TIKTOK")) tags.push("#TikTok");
  if (["GET_CLIENTS", "GET_MESSAGES"].includes(objective)) tags.push("#Negocios");
  if (objective === "EDUCATE") tags.push("#Aprende");
  if (objective === "DEMONSTRATE") tags.push("#Demostracion");

  for (const word of audienceKeywords(plan.audience)) tags.push(`#${word}`);
  return unique(tags).slice(0, 6);
}

function audienceKeywords(value) {
  const stop = new Set(["para", "de", "del", "la", "las", "los", "el", "y", "en", "con", "a"]);
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !stop.has(word.toLowerCase()))
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function normalizeVariantCount(value) {
  if (value === undefined || value === null || value === "") return 3;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 3) {
    throw new Error("variantCount must be an integer between 1 and 3.");
  }
  return count;
}

function normalizeDuration(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 5 && number <= 180 ? number : 18;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (status !== "DRAFT") throw new Error("Unsupported content generation status.");
  return status;
}

function normalizeId(value, label) {
  const id = String(value || "").trim();
  if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`);
  return id;
}

function compact(value, maxLength) {
  const text = cleanText(value, maxLength + 1);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function unique(values) {
  return [...new Set(values)];
}
