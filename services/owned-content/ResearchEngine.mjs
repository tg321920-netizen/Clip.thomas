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
        numbers: numericTokens(text),
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
        supportCount: supporters.size,
        attribution: type === "FACT" ? null : sourceLabel(materials, row.sourceId),
      };
    });

    const deduped = dedupeClaims(claims);
    const discrepancies = findDiscrepancies(sentenceRows);
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
    if (output.some((existing) => tokenSimilarity(tokens, meaningfulTokens(existing.text)) >= 0.82)) continue;
    output.push(claim);
    if (output.length >= 180) break;
  }
  return output;
}

function findDiscrepancies(rows) {
  const output = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i], b = rows[j];
      if (a.sourceId === b.sourceId) continue;
      const similarity = tokenSimilarity(a.tokens, b.tokens);
      if (similarity < 0.34) continue;
      if (a.numbers.length === 0 || b.numbers.length === 0) continue;
      if (a.numbers.join("|") === b.numbers.join("|")) continue;
      output.push({
        id: randomUUID(),
        type: "NUMERIC_DISCREPANCY",
        sourceIds: [a.sourceId, b.sourceId],
        descriptions: [compact(a.text, 220), compact(b.text, 220)],
      });
      if (output.length >= 20) return output;
    }
  }
  return output;
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
function numericTokens(text) { return String(text || "").match(/\b\d+(?:[.,]\d+)?%?\b/g) || []; }
function tokenSimilarity(a, b) { if (!a?.length || !b?.length) return 0; const B = new Set(b); const common = a.filter((t) => B.has(t)).length; return common / Math.max(a.length, b.length); }
function fingerprint(value) { return createHash("sha256").update(String(value).toLowerCase().replace(/\W+/g, " ").trim()).digest("hex"); }
function compact(value, max) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, max); }
function normalizeTextList(value) { return Array.isArray(value) ? [...new Set(value.map((v) => compact(v, 160)).filter(Boolean))].slice(0, 30) : []; }
async function save(record) { await mkdir(directory(), { recursive: true }); const target = recordPath(record.id); const temp = path.join(directory(), `.${record.id}.${process.pid}.${Date.now()}.tmp`); await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" }); try { await rename(temp, target); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
function directory() { return path.join(getStorageRoot(), "owned-content", "research"); }
function recordPath(id) { return path.join(directory(), `${id}.json`); }
function assertId(value, label) { if (!isProjectId(String(value || ""))) throw new Error(`Invalid ${label} id.`); }
const STOP = new Set(["this","that","with","from","have","will","would","about","para","como","esta","este","esto","entre","sobre","desde","hasta","porque","segun"]);
