const PLATFORM_NAMES = new Set(["TIKTOK", "YOUTUBE", "FACEBOOK"]);

export function resolveAgentRules(env = process.env, overrides = null) {
  let parsed = {};
  const raw = String(env.CLIPFORGE_AGENT_RULES_JSON || "").trim();

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("CLIPFORGE_AGENT_RULES_JSON must contain valid JSON.");
    }
  }

  return normalizeAgentRules({
    ...parsed,
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  });
}

export function normalizeAgentRules(input = {}) {
  return {
    allowedSources: normalizeStringList(input.allowedSources, 200),
    blockedSources: normalizeStringList(input.blockedSources, 200),
    allowedTopics: normalizeStringList(input.allowedTopics, 80),
    blockedTopics: normalizeStringList(input.blockedTopics, 80),
    countries: normalizeStringList(input.countries, 80),
    languages: normalizeStringList(input.languages, 20).map((value) => value.toLowerCase()),
    channels: normalizeChannels(input.channels),
    preferredTimes: normalizeTimes(input.preferredTimes),
    maxPostsPerDay: boundedInteger(input.maxPostsPerDay, 1, 50, 3),
    maxDailyAiBudgetUsd: nullableNumber(input.maxDailyAiBudgetUsd, 0, 10000),
    maxJobAiBudgetUsd: nullableNumber(input.maxJobAiBudgetUsd, 0, 10000),
    maxRetries: boundedInteger(input.maxRetries, 0, 5, 2),
    approvalRequired: input.approvalRequired !== false,
    publishingEnabled: input.publishingEnabled === true,
  };
}

export function assertAgentToolWithinRules(toolName, input = {}, rules = null) {
  if (!rules || typeof rules !== "object") return;
  const normalized = normalizeAgentRules(rules);
  const tool = String(toolName || "");

  if (tool === "research.start") {
    const sourceIds = Array.isArray(input.sourceIds)
      ? input.sourceIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];

    if (sourceIds.some((sourceId) =>
      normalized.blockedSources.some((blocked) => sameToken(blocked, sourceId)))) {
      throw ruleError("A requested source is blocked by the agent rules.");
    }

    if (normalized.allowedSources.length > 0 &&
      sourceIds.some((sourceId) =>
        !normalized.allowedSources.some((allowed) => sameToken(allowed, sourceId)))) {
      throw ruleError("A requested source is outside the allowed source list.");
    }

    const topic = String(input.topic || "").trim();
    if (topic && normalized.blockedTopics.some((blocked) => containsToken(topic, blocked))) {
      throw ruleError("The requested topic is blocked by the agent rules.");
    }
    if (topic && normalized.allowedTopics.length > 0 &&
      !normalized.allowedTopics.some((allowed) => containsToken(topic, allowed))) {
      throw ruleError("The requested topic is outside the allowed topic list.");
    }
  }

  if (tool === "script.generate" && normalized.languages.length > 0 && input.language) {
    const language = String(input.language).trim().toLowerCase();
    if (!normalized.languages.includes(language)) {
      throw ruleError("The requested language is outside the allowed language list.");
    }
  }

  if (tool === "publishing.prepare" &&
    normalized.channels.length > 0 &&
    Array.isArray(input.platforms)) {
    for (const platform of input.platforms) {
      const value = String(platform || "").trim().toUpperCase();
      if (!normalized.channels.includes(value)) {
        throw ruleError(`Platform ${value || "unknown"} is not allowed by agent rules.`);
      }
    }
  }
}

function normalizeChannels(value) {
  return normalizeStringList(value, 100).map((item) => {
    const upper = item.toUpperCase();
    return PLATFORM_NAMES.has(upper) ? upper : item;
  });
}

function normalizeTimes(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  for (const item of value) {
    const time = String(item || "").trim();
    if (!time) continue;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error(`Invalid agent preferred time: ${time}.`);
    }
    if (!output.includes(time)) output.push(time);
    if (output.length >= 24) break;
  }
  return output;
}

function normalizeStringList(value, maxLength) {
  if (!Array.isArray(value)) return [];
  const output = [];
  const seen = new Set();
  for (const item of value) {
    const text = String(item || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= 100) break;
  }
  return output;
}

function sameToken(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function containsToken(text, token) {
  return String(text || "").toLowerCase().includes(String(token || "").toLowerCase());
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(min, Math.min(max, number)));
}

function nullableNumber(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Agent budget values must be numeric.");
  return Math.max(min, Math.min(max, number));
}

function ruleError(message) {
  const error = new Error(message);
  error.code = "AGENT_RULE_BLOCKED";
  error.retryable = false;
  return error;
}
