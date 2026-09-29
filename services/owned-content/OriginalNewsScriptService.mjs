import { randomUUID } from "node:crypto";

const FORMATS = new Set(["SHORT", "MEDIUM", "LONG"]);

export class OriginalNewsScriptService {
  create(input = {}) {
    const research = input.research;
    if (!research?.id || !Array.isArray(research.claims)) {
      throw new Error("Research dossier is required before scripting.");
    }
    const language = normalizeLanguage(input.language || "es-419");
    const format = normalizeFormat(input.format || "SHORT");
    const facts = research.confirmedFacts || [];
    const attributed = research.statements || [];
    const context = research.context || [];
    const usable = [...facts, ...attributed].filter(Boolean);

    const material = materialThreshold(format, research.sources?.length || 0, facts.length, usable.length);
    if (!material.enough) {
      return {
        id: randomUUID(),
        researchId: research.id,
        status: "INSUFFICIENT_MATERIAL",
        format,
        language,
        reason: material.reason,
        title: research.topic,
        hook: "",
        sections: [],
        narration: "",
        evidenceClaimIds: [],
        originality: { sourceContributionRatio: 0, directQuoteWords: 0 },
        createdAt: new Date().toISOString(),
      };
    }

    const selectedFacts = facts.slice(0, format === "SHORT" ? 3 : format === "MEDIUM" ? 6 : 10);
    const selectedAttributed = attributed.slice(0, format === "SHORT" ? 1 : 3);
    const selectedContext = context.slice(0, format === "SHORT" ? 1 : 3);
    const sectionData = buildSections({ research, language, format, facts: selectedFacts, attributed: selectedAttributed, context: selectedContext });
    const narration = sectionData.map((section) => section.text).filter(Boolean).join(" ");
    const claimWords = sectionData.reduce((total, section) => total + Number(section.sourceWords || 0), 0);
    const totalWords = wordCount(narration);
    const hook = sectionData.find((section) => section.key === "HOOK")?.text || "";
    const title = makeTitle(research.topic, language);

    return {
      id: randomUUID(),
      researchId: research.id,
      status: "READY",
      format,
      language,
      title,
      hook,
      sections: sectionData.map(publicSection),
      narration,
      evidenceClaimIds: [...new Set(sectionData.flatMap((section) => section.evidenceClaimIds || []))],
      originality: {
        sourceContributionRatio: totalWords > 0 ? Math.round((claimWords / totalWords) * 1000) / 1000 : 0,
        directQuoteWords: 0,
        method: "STRUCTURED_MULTI_SOURCE_COMPOSITION",
      },
      createdAt: new Date().toISOString(),
    };
  }
}

function buildSections({ research, language, format, facts, attributed, context }) {
  const en = language.startsWith("en");
  const fact1 = factExcerpt(facts[0]);
  const fact2 = factExcerpt(facts[1]);
  const fact3 = factExcerpt(facts[2]);
  const statement = factExcerpt(attributed[0]);
  const contextText = factExcerpt(context[0]);
  const sections = [];

  sections.push(section("HOOK", en
    ? `Here is what is confirmed so far about ${shortTopic(research.topic)}.${fact1 ? ` ${fact1}` : ""}`
    : `Esto es lo que está confirmado hasta ahora sobre ${shortTopic(research.topic)}.${fact1 ? ` ${fact1}` : ""}`, [facts[0]], fact1));

  sections.push(section("WHAT_HAPPENED", en
    ? `The central development is this.${fact2 ? ` ${fact2}` : fact1 ? ` ${fact1}` : " The available sources do not yet support a fuller factual summary."}`
    : `El hecho central es este.${fact2 ? ` ${fact2}` : fact1 ? ` ${fact1}` : " Las fuentes disponibles todavía no respaldan un resumen factual más amplio."}`, [facts[1] || facts[0]], fact2 || fact1));

  if (contextText) {
    sections.push(section("CONTEXT", en ? `For context, ${lowerLead(contextText)}` : `Como contexto, ${lowerLead(contextText)}`, [context[0]], contextText));
  } else if (fact3) {
    sections.push(section("CONTEXT", en ? `Another confirmed point is that ${lowerLead(fact3)}` : `Otro punto confirmado es que ${lowerLead(fact3)}`, [facts[2]], fact3));
  }

  const whyEvidence = facts[3] || facts[2] || facts[1];
  const whyText = factExcerpt(whyEvidence);
  if (whyText) {
    sections.push(section("WHY_IT_MATTERS", en
      ? `Why this matters: ${lowerLead(whyText)}`
      : `Por qué importa: ${lowerLead(whyText)}`, [whyEvidence], whyText));
  }

  if (statement) {
    const label = attributed[0]?.attribution || (en ? "one of the cited sources" : "una de las fuentes citadas");
    sections.push(section("CURRENT_INFO", en
      ? `At this point, ${label} reports: ${statement}. This remains attributed rather than independently confirmed.`
      : `A esta hora, ${label} reporta: ${statement}. Esto se mantiene como una afirmación atribuida y no como un hecho confirmado de forma independiente.`, [attributed[0]], statement, "ATTRIBUTED_CLAIM"));
  } else {
    const latest = factExcerpt(facts[facts.length - 1]);
    if (latest) sections.push(section("CURRENT_INFO", en ? `The latest confirmed information in the dossier is: ${latest}` : `La información confirmada más reciente del expediente es: ${latest}`, [facts[facts.length - 1]], latest));
  }

  if (format !== "SHORT") {
    for (const claim of facts.slice(4, format === "MEDIUM" ? 6 : 10)) {
      const excerpt = factExcerpt(claim);
      if (excerpt) sections.push(section("DETAIL", en ? `A further confirmed detail: ${excerpt}` : `Otro detalle confirmado: ${excerpt}`, [claim], excerpt));
    }
  }

  sections.push(section("CLOSE", en
    ? "We will keep confirmed facts separate from claims as the story develops. Follow for the next verified update."
    : "Seguiremos separando hechos confirmados de versiones y declaraciones mientras evoluciona la historia. Sigue el canal para la próxima actualización verificada.", [], ""));

  return sections.filter((entry) => entry.text.trim());
}

function section(key, text, claims = [], sourceText = "", assertionType = "FACT") {
  const validClaims = claims.filter(Boolean);
  return {
    key,
    text: cleanSentence(text),
    assertionType,
    evidenceClaimIds: validClaims.map((claim) => claim.id),
    sourceWords: wordCount(sourceText),
  };
}

function publicSection(sectionValue) {
  return {
    key: sectionValue.key,
    text: sectionValue.text,
    assertionType: sectionValue.assertionType,
    evidenceClaimIds: sectionValue.evidenceClaimIds,
  };
}

function factExcerpt(claim) {
  if (!claim?.text) return "";
  const text = String(claim.text).replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean);
  const max = 12;
  return cleanSentence(words.length > max ? `${words.slice(0, max).join(" ")}…` : text);
}

function materialThreshold(format, sourceCount, factCount, usableCount) {
  if (sourceCount < 2) return { enough: false, reason: "At least two sources are required." };
  if (format === "LONG" && (sourceCount < 3 || factCount < 6 || usableCount < 8)) {
    return { enough: false, reason: "LONG format needs at least three sources, six confirmed facts and enough supporting material." };
  }
  if (format === "MEDIUM" && factCount < 3) return { enough: false, reason: "MEDIUM format needs at least three confirmed facts." };
  if (factCount < 1) return { enough: false, reason: "No independently supported fact is available for a script." };
  return { enough: true, reason: null };
}
function normalizeFormat(value) { const format = String(value || "SHORT").toUpperCase(); if (!FORMATS.has(format)) throw new Error("Unsupported content format."); return format; }
function normalizeLanguage(value) { const language = String(value || "").trim(); if (!language) return "es-419"; if (!/^en(?:-|$)|^es(?:-|$)/i.test(language)) throw new Error("Owned-content scripts currently support English or Spanish."); return language; }
function makeTitle(topic, language) { const clean = shortTopic(topic); return language.startsWith("en") ? `${clean}: what is confirmed` : `${clean}: lo que está confirmado`; }
function shortTopic(value) { const words = String(value || "story").replace(/\s+/g, " ").trim().split(" ").filter(Boolean); return words.slice(0, 12).join(" "); }
function lowerLead(value) { const text = String(value || "").trim(); return text ? text.charAt(0).toLowerCase() + text.slice(1) : text; }
function cleanSentence(value) { return String(value || "").replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim(); }
function wordCount(value) { return String(value || "").trim().split(/\s+/).filter(Boolean).length; }
