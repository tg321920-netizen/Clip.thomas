export class CoherenceGate {
  evaluate(input = {}) {
    const research = input.research;
    const script = input.script;
    const visualPlan = input.visualPlan || { assets: [], rightsReady: false };
    if (!research?.id || !script?.id) throw new Error("Research and script are required for coherence checks.");

    const checks = [];
    checks.push(check("TITLE_SUPPORTED", titleSupported(script.title, research), "CRITICAL", "El título debe corresponder con hechos y tema investigados."));
    checks.push(check("HOOK_SUPPORTED", hookSupported(script, research), "CRITICAL", "El hook debe enlazar evidencia del expediente."));
    checks.push(check("TIMELINE_SANE", timelineSane(research.timeline), "CRITICAL", "La cronología no puede contener fechas inválidas u orden imposible cuando son comparables."));
    checks.push(check("NO_UNRESOLVED_CONTRADICTION", contradictionsHandled(script, research), "CRITICAL", "Una discrepancia material usada en el guion debe quedar identificada, no resuelta por invención."));
    checks.push(check("NO_RUMOR_AS_FACT", noRumorAsFact(script, research), "CRITICAL", "Información no confirmada no puede narrarse como FACT."));
    checks.push(check("VISUALS_MATCH_STORY", visualsMatch(visualPlan, research), "CRITICAL", "Los recursos visuales deben corresponder al tema o ser gráficos propios neutrales."));
    checks.push(check("RIGHTS_READY", visualPlan.rightsReady === true, "CRITICAL", "Todo recurso utilizado debe tener derechos/procedencia evaluados."));
    checks.push(check("NOT_NEAR_DUPLICATE", input.nearDuplicate !== true, "CRITICAL", "El canal no debe publicar prácticamente la misma historia otra vez."));
    checks.push(check("TRANSFORMATIVE_ORIGINALITY", originalityReady(script, research), "CRITICAL", "La pieza debe combinar fuentes y narrativa propia, no reproducir texto fuente."));

    const criticalFailures = checks.filter((item) => !item.passed && item.severity === "CRITICAL");
    return {
      status: criticalFailures.length > 0 ? "WAITING_REVIEW" : "PASS",
      passed: criticalFailures.length === 0,
      checks,
      criticalFailures: criticalFailures.map((item) => item.key),
      evaluatedAt: new Date().toISOString(),
    };
  }
}

function titleSupported(title, research) {
  const titleTokens = meaningful(title);
  const evidence = meaningful([research.topic, ...(research.confirmedFacts || []).map((item) => item.text)].join(" "));
  if (titleTokens.length === 0 || evidence.length === 0) return false;
  const set = new Set(evidence);
  return titleTokens.filter((token) => set.has(token)).length >= Math.min(2, titleTokens.length);
}
function hookSupported(script, research) {
  const hookSection = script.sections?.find((item) => item.key === "HOOK");
  if (!hookSection || !Array.isArray(hookSection.evidenceClaimIds) || hookSection.evidenceClaimIds.length === 0) return false;
  const valid = new Set((research.claims || []).map((claim) => claim.id));
  return hookSection.evidenceClaimIds.every((id) => valid.has(id));
}
function timelineSane(timeline = []) {
  const parsed = timeline.map((item) => ({ item, time: Date.parse(item.dateText) })).filter((row) => Number.isFinite(row.time));
  if (parsed.length < 2) return true;
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].time < parsed[i - 1].time - 3650 * 24 * 3600 * 1000) return false;
  }
  return true;
}
function contradictionsHandled(script, research) {
  const used = new Set(script.evidenceClaimIds || []);
  for (const discrepancy of research.discrepancies || []) {
    const related = discrepancyClaimIds(discrepancy, research.claims || []);
    if (related.some((id) => used.has(id))) return false;
  }
  return true;
}
function discrepancyClaimIds(discrepancy, claims) {
  if (Array.isArray(discrepancy.claimIds) && discrepancy.claimIds.length > 0) {
    return [...new Set(discrepancy.claimIds.filter(Boolean))];
  }

  const descriptions = (discrepancy.descriptions || []).map(meaningful).filter((tokens) => tokens.length > 0);
  return claims
    .filter((claim) => discrepancy.sourceIds?.includes(claim.primarySourceId))
    .filter((claim) => descriptions.some((tokens) => tokenSimilarity(meaningful(claim.text), tokens) >= 0.5))
    .map((claim) => claim.id);
}
function noRumorAsFact(script, research) {
  const unconfirmed = new Set((research.unconfirmed || []).map((claim) => claim.id));
  for (const section of script.sections || []) {
    const usesUnconfirmed = (section.evidenceClaimIds || []).some((id) => unconfirmed.has(id));
    if (usesUnconfirmed && section.assertionType === "FACT") return false;
  }
  return true;
}
function visualsMatch(plan, research) {
  if (plan.generatedOwnedGraphic === true) return true;
  if (plan.topicFingerprint && plan.topicFingerprint === research.topicFingerprint) return true;
  return Array.isArray(plan.assets) && plan.assets.length > 0 && plan.assets.every((asset) => asset.topicFingerprint === research.topicFingerprint || asset.labels?.includes("generic-broll"));
}
function originalityReady(script, research) {
  return (research.sources?.length || 0) >= 2 && Number(script.originality?.directQuoteWords || 0) === 0 && Number(script.originality?.sourceContributionRatio || 1) <= 0.55;
}
function check(key, passed, severity, message) { return { key, passed: Boolean(passed), severity, message }; }
function meaningful(value) { return [...new Set(String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g) || [])].filter((token) => !STOP.has(token)); }
function tokenSimilarity(a, b) { if (!a?.length || !b?.length) return 0; const B = new Set(b); const common = a.filter((token) => B.has(token)).length; return common / Math.max(a.length, b.length); }
const STOP = new Set(["what","confirmed","about","this","that","with","from","esto","esta","este","confirmado","sobre","para","como","hasta"]);
