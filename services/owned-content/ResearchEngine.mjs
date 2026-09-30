import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { SourceService } from "../sources/SourceService.mjs";
import { ExtractionService } from "../extraction/ExtractionService.mjs";

const TYPES = new Set(["FACT", "ATTRIBUTED_CLAIM", "UNCONFIRMED", "ANALYSIS"]);
const UNCONFIRMED = /\b(?:rumou?r|unconfirmed|allegedly|reportedly|speculation|rumor|sin confirmar|no confirmado|supuestamente|presuntamente|trascendió|trascendio)\b/i;
const ATTRIBUTION = /\b(?:according to|said|stated|reported|announced|confirmed|told|según|segun|dijo|afirmó|afirmo|reportó|reporto|anunció|anuncio|confirmó|confirmo|declaró|declaro)\b/i;
const ANALYSIS = /\b(?:analysis|analysts|could mean|may indicate|in context|análisis|analistas|podría significar|podria significar|puede indicar|en contexto)\b/i;

export class ResearchEngine {
  constructor(options = {}) {
    this.sources = options.sources || new SourceService();
    this.extractions = options.extractions || new ExtractionService();
  }

  async research(input = {}) {
    assertId(input.channelId, "channel");
    const sourceIds = [...new Set((Array.isArray(input.sourceIds) ? input.sourceIds : []).map(String))];
    if (sourceIds.length < 2) {
      throw new Error("Owned-content research requires at least two independent sources.");
    }
    sourceIds.forEach((id) => assertId(id, "source"));

    const materials = [];
    for (const sourceId of sourceIds) {
      const source = await this.sources.get(sourceId);
      if (!source) throw new Error(`Source not found: ${sourceId}`);
      let extraction = source.latestExtractionId ? await this.extractions.get(source.latestExtractionId) : null;
      if (!extraction || extraction.status !== "COMPLETED") extraction = await this.extractions.extract(sourceId);
      materials.push({ source, extraction });
    }

    const sentenceRows = materials.flatMap(({ source, extraction }, sourceIndex) =>
      splitSentences(extraction.text).slice(0, 240).map((text, sentenceIndex) => ({
        id: `s${sourceIndex + 1}-${sentenceIndex + 1}`,
        sourceId: source.id,
        extractionId: extraction.id,
        text,
        tokens: meaningfulTokens(text),
        numericFacts: extractNumericFacts(text),
      })),
    );

    const claims = sentenceRows.map((row) => {
      const supporters = new Set([row.sourceId]);
      for (const other of sentenceRows) {
        if (other.sourceId === row.sourceId) continue;
        if (tokenSimilarity(row.tokens, other.tokens) >= 0.46) supporters.add(other.sourceId);
      }
      let type = "ATTRIBUTED_CLAIM";
      if (UNCONFIRMED.test(row.text)) type = "UNCONFIRMED";
      else if (ANALYSIS.test(row.text)) type = "ANALYSIS";
      else if (supporters.size >= 2 && !ATTRIBUTION.test(row.text)) type = "FACT";
      else if (ATTRIBUTION.test(row.text)) type = "ATTRIBUTED_CLAIM";
      if (!TYPES.has(type)) type = "ATTRIBUTED_CLAIM";
      return {
        id: randomUUID(),
        type,
        text: compact(row.text, 420),
        sourceIds: [...supporters],
        primarySourceId: row.sourceId,
        sourceSentenceId: row.id,
        supportCount: supporters.size,
        numericFacts: row.numericFacts,
        attribution: type === "FACT" ? null : sourceLabel(materials, row.sourceId),
      };
    });

    const deduped = dedupeClaims(claims);
    const discrepancies = findDiscrepancies(sentenceRows, deduped);
    const facts = deduped.filter((claim) => claim.type === "FACT");
    const dates = extractDates(deduped);
    const topic = compact(input.topic || facts[0]?.text || deduped[0]?.text || "Untitled story", 240);
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      channelId: input.channelId,
      trendId: input.trendId || null,
      topic,
      topicFingerprint: fingerprint(topic),
      status: "READY",
      whatOccurred: facts[0]?.text || null,
      who: normalizeTextList(input.who),
      when: dates,
      where: normalizeTextList(input.where),
      timeline: buildTimeline(deduped),
      confirmedFacts: facts,
      statements: deduped.filter((claim) => claim.type === "ATTRIBUTED_CLAIM"),
      context: deduped.filter((claim) => claim.type === "ANALYSIS"),
      discrepancies,
      unconfirmed: deduped.filter((claim) => claim.type === "UNCONFIRMED"),
      claims: deduped,
      sources: materials.map(({ source, extraction }) => ({
        sourceId: source.id,
        extractionId: extraction.id,
        type: source.type,
        origin: source.origin,
        url: source?.input?.url || null,
        title: extraction?.metadata?.title || source?.metadata?.title || source.origin,
        authorizationStatus: source.authorizationStatus,
        extractedAt: extraction.completedAt,
      })),
      missingInformation: [
        ...(facts.length === 0 ? ["No fact is independently supported by two sources yet."] : []),
        ...(dates.length === 0 ? ["No reliable date was extracted."] : []),
        ...(normalizeTextList(input.who).length === 0 ? ["Who is not explicitly structured yet."] : []),
        ...(normalizeTextList(input.where).length === 0 ? ["Location is not explicitly structured yet."] : []),
      ],
      createdAt: now,
      updatedAt: now,
    };
    await save(record);
    return record;
  }

  async get(id) {
    assertId(id, "research");
    try { return JSON.parse(await readFile(recordPath(id), "utf8")); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async list(filters = {}) {
    await mkdir(directory(), { recursive: true });
    const names = await readdir(directory());
    const rows = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      try { return JSON.parse(await readFile(path.join(directory(), name), "utf8")); } catch { return null; }
    }));
    return rows.filter(Boolean).filter((row) => !filters.channelId || row.channelId === filters.channelId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}

function dedupeClaims(claims) {
  const output = [];
  for (const claim of claims) {
    const tokens = meaningfulTokens(claim.text);
    const duplicate = output.some((existing) => {
      if (tokenSimilarity(tokens, meaningfulTokens(existing.text)) < 0.82) return false;
      return numericConflicts(claim.numericFacts, existing.numericFacts).length === 0;
    });
    if (duplicate) continue;
    output.push(claim);
    if (output.length >= 180) break;
  }
  return output;
}

function findDiscrepancies(rows, claims) {
  const output = [];
  const claimBySentence = new Map((claims || []).map((claim) => [claim.sourceSentenceId, claim]));
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i], b = rows[j];
      if (a.sourceId === b.sourceId) continue;
      const similarity = tokenSimilarity(a.tokens, b.tokens);
      if (similarity < 0.34) continue;
      const conflicts = numericConflicts(a.numericFacts, b.numericFacts);
      if (conflicts.length === 0) continue;
      const claimIds = [claimBySentence.get(a.id)?.id, claimBySentence.get(b.id)?.id].filter(Boolean);
      output.push({
        id: randomUUID(),
        type: "NUMERIC_DISCREPANCY",
        sourceIds: [a.sourceId, b.sourceId],
        sentenceIds: [a.id, b.id],
        claimIds,
        dimensions: conflicts.map((item) => item.dimension),
        descriptions: [compact(a.text, 220), compact(b.text, 220)],
      });
      if (output.length >= 20) return output;
    }
  }
  return output;
}

function numericConflicts(first = [], second = []) {
  const output = [];
  for (const a of first) {
    for (const b of second) {
      if (a.dimension !== b.dimension) continue;
      if (String(a.value) === String(b.value)) continue;
      output.push({ dimension: a.dimension, first: a.value, second: b.value });
    }
  }
  return output;
}

function extractNumericFacts(text) {
  const value = String(text || "");
  const facts = [];

  const datePattern = /\b(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2}(?:,?\s+20\d{2})?)\b/gi;
  for (const match of value.matchAll(datePattern)) {
    facts.push({ dimension: "DATE", value: normalizeDate(match[0]) });
  }

  const percentagePattern = /\b(\d+(?:[.,]\d+)?)\s*%/g;
  for (const match of value.matchAll(percentagePattern)) {
    facts.push({ dimension: "PERCENT", value: normalizeNumber(match[1]) });
  }

  const symbolMoneyPattern = /([$€£₡])\s*(\d+(?:[.,]\d+)?)(?:\s*(thousand|million|billion|mil|mill[oó]n(?:es)?))?/gi;
  for (const match of value.matchAll(symbolMoneyPattern)) {
    facts.push({
      dimension: `MONEY:${currencyFromSymbol(match[1])}`,
      value: scaleNumber(match[2], match[3]),
    });
  }

  const namedMoneyPattern = /\b(\d+(?:[.,]\d+)?)\s*(thousand|million|billion|mil|mill[oó]n(?:es)?)?\s*(USD|EUR|CRC|dollars?|euros?|colones?)\b/gi;
  for (const match of value.matchAll(namedMoneyPattern)) {
    facts.push({
      dimension: `MONEY:${normalizeCurrency(match[3])}`,
      value: scaleNumber(match[1], match[2]),
    });
  }

  const wordMoneyPattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(thousand|million|billion|mil|mill[oó]n(?:es)?)\s+(dollars?|euros?|colones?)\b/gi;
  for (const match of value.matchAll(wordMoneyPattern)) {
    facts.push({
      dimension: `MONEY:${normalizeCurrency(match[3])}`,
      value: scaleNumber(wordNumber(match[1]), match[2]),
    });
  }

  const unitPattern = /\b(\d+(?:[.,]\d+)?)\s+([a-záéíóúñ]{3,24})\b/gi;
  for (const match of value.matchAll(unitPattern)) {
    const rawNumber = normalizeNumber(match[1]);
    const unit = normalizeUnit(match[2]);
    if (!unit || UNIT_STOP.has(unit)) continue;
    if (rawNumber >= 1900 && rawNumber <= 2100) continue;
    if (["percent", "porcentaje"].includes(unit)) continue;
    facts.push({ dimension: `UNIT:${unit}`, value: rawNumber });
  }

  const seen = new Set();
  return facts.filter((fact) => {
    const key = `${fact.dimension}:${fact.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTimeline(claims) {
  const rows = [];
  for (const claim of claims) {
    const dates = claim.text.match(/\b(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2}(?:,?\s+20\d{2})?)\b/gi) || [];
    for (const dateText of dates.slice(0, 2)) rows.push({ dateText, claimId: claim.id, text: claim.text, type: claim.type });
  }
  return rows.slice(0, 40);
}

function extractDates(claims) {
  const values = new Set();
  for (const item of buildTimeline(claims)) values.add(item.dateText);
  return [...values].slice(0, 20);
}

function sourceLabel(materials, sourceId) {
  const material = materials.find((item) => item.source.id === sourceId);
  return material?.extraction?.metadata?.title || material?.source?.origin || sourceId;
}
function splitSentences(text) { return String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => item.length >= 18); }
function meaningfulTokens(text) { return [...new Set(String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g) || [])].filter((t) => !STOP.has(t)); }
function tokenSimilarity(a, b) { if (!a?.length || !b?.length) return 0; const B = new Set(b); const common = a.filter((t) => B.has(t)).length; return common / Math.max(a.length, b.length); }
function fingerprint(value) { return createHash("sha256").update(String(value).toLowerCase().replace(/\W+/g, " ").trim()).digest("hex"); }
function compact(value, max) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, max); }
function normalizeTextList(value) { return Array.isArray(value) ? [...new Set(value.map((v) => compact(v, 160)).filter(Boolean))].slice(0, 30) : []; }
function normalizeNumber(value) { const parsed = Number(String(value).replace(/,/g, "")); return Number.isFinite(parsed) ? parsed : String(value); }
function scaleNumber(value, scale) { const base = typeof value === "number" ? value : normalizeNumber(value); if (typeof base !== "number") return base; const key = String(scale || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); const multiplier = key.startsWith("billion") ? 1_000_000_000 : key.startsWith("million") || key.startsWith("millon") ? 1_000_000 : key === "thousand" || key === "mil" ? 1_000 : 1; return base * multiplier; }
function wordNumber(value) { return WORD_NUMBERS[String(value || "").toLowerCase()] || 0; }
function normalizeDate(value) { const parsed = Date.parse(String(value)); return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : String(value).toLowerCase().replace(/\s+/g, " ").trim(); }
function currencyFromSymbol(value) { return value === "$" ? "USD" : value === "€" ? "EUR" : value === "₡" ? "CRC" : value === "£" ? "GBP" : "UNKNOWN"; }
function normalizeCurrency(value) { const key = String(value || "").toLowerCase(); if (key === "usd" || key.startsWith("dollar")) return "USD"; if (key === "eur" || key.startsWith("euro")) return "EUR"; if (key === "crc" || key.startsWith("colon")) return "CRC"; return key.toUpperCase(); }
function normalizeUnit(value) { const key = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); if (key.endsWith("ies") && key.length > 4) return `${key.slice(0, -3)}y`; if (key.endsWith("s") && key.length > 3 && !UNIT_SINGULAR_EXCEPTIONS.has(key)) return key.slice(0, -1); return key; }
async function save(record) { await mkdir(directory(), { recursive: true }); const target = recordPath(record.id); const temp = path.join(directory(), `.${record.id}.${process.pid}.${Date.now()}.tmp`); await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" }); try { await rename(temp, target); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
function directory() { return path.join(getStorageRoot(), "owned-content", "research"); }
function recordPath(id) { return path.join(directory(), `${id}.json`); }
function assertId(value, label) { if (!isProjectId(String(value || ""))) throw new Error(`Invalid ${label} id.`); }
const STOP = new Set(["this","that","with","from","have","will","would","about","para","como","esta","este","esto","entre","sobre","desde","hasta","porque","segun"]);
const UNIT_STOP = new Set(["after","before","since","during","while","that","this","from","with","into","over","under","about","para","como","desde","hasta","entre","sobre","tras","despues","antes","million","billion","thousand","millon","millones"]);
const UNIT_SINGULAR_EXCEPTIONS = new Set(["news", "series", "species"]);
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
