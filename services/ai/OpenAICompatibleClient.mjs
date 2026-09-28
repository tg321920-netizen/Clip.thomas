export function resolveOpenAICompatibleConfig(options = {}) {
  const apiKey = String(
    options.apiKey ??
      process.env.CLIPFORGE_AI_API_KEY ??
      process.env.OPENAI_API_KEY ??
      "",
  ).trim();
  const baseUrl = String(
    options.baseUrl ??
      process.env.CLIPFORGE_AI_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1",
  ).trim().replace(/\/$/, "");
  const model = String(
    options.model ?? process.env.CLIPFORGE_AI_MODEL ?? "",
  ).trim();
  const requestedStyle = String(
    options.apiStyle ?? process.env.CLIPFORGE_AI_API_STYLE ?? "auto",
  ).trim().toLowerCase();
  const apiStyle = resolveApiStyle(requestedStyle, baseUrl);
  const temperature = clampNumber(
    options.temperature ?? process.env.CLIPFORGE_AI_TEMPERATURE,
    0,
    2,
    0.2,
  );
  const maxOutputTokens = Math.round(
    clampNumber(
      options.maxOutputTokens ?? process.env.CLIPFORGE_AI_MAX_OUTPUT_TOKENS,
      128,
      8192,
      2048,
    ),
  );

  return {
    apiKey,
    baseUrl,
    model,
    apiStyle,
    temperature,
    maxOutputTokens,
  };
}

export async function requestStructuredJson({
  config,
  name,
  schema,
  instructions,
  input,
  fetchImpl = globalThis.fetch,
}) {
  if (!config?.apiKey) {
    throw new Error("CLIPFORGE_AI_API_KEY (or OPENAI_API_KEY) is required for the configured AI provider.");
  }
  if (!config?.model) {
    throw new Error("CLIPFORGE_AI_MODEL is required for the configured AI provider.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available for the AI provider.");
  }

  if (config.apiStyle === "responses") {
    const response = await fetchImpl(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: authHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.model,
        store: false,
        instructions,
        input: typeof input === "string" ? input : JSON.stringify(input),
        text: {
          format: {
            type: "json_schema",
            name,
            strict: true,
            schema,
          },
        },
        temperature: config.temperature,
        max_output_tokens: config.maxOutputTokens,
      }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok) throw providerHttpError(body, response.status, "Responses API");
    return parseStructuredResult(body, "responses");
  }

  const messages = [
    { role: "system", content: instructions },
    {
      role: "user",
      content: typeof input === "string" ? input : JSON.stringify(input),
    },
  ];
  const endpoint = `${config.baseUrl}/chat/completions`;
  let response = await fetchImpl(endpoint, {
    method: "POST",
    headers: authHeaders(config.apiKey),
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxOutputTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name, strict: true, schema },
      },
    }),
  });
  let body = await readJsonResponse(response);

  // Some OpenAI-compatible providers support JSON objects but not JSON Schema.
  // Retry once without changing the requested task or inventing output.
  if (!response.ok && [400, 404, 422].includes(response.status)) {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: authHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              `${instructions}\nReturn only valid JSON matching this schema: ${JSON.stringify(schema)}`,
          },
          messages[1],
        ],
        temperature: config.temperature,
        max_tokens: config.maxOutputTokens,
        response_format: { type: "json_object" },
      }),
    });
    body = await readJsonResponse(response);
  }

  if (!response.ok) throw providerHttpError(body, response.status, "Chat Completions API");
  return parseStructuredResult(body, "chat-completions");
}

export function extractCompatibleText(body, style = "auto") {
  if (typeof body?.output_text === "string" && body.output_text.trim()) {
    return body.output_text.trim();
  }

  const output = Array.isArray(body?.output) ? body.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        return part.text.trim();
      }
    }
  }

  const message = body?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}

export function extractCompatibleUsage(body) {
  const input = Number(body?.usage?.input_tokens ?? body?.usage?.prompt_tokens);
  const output = Number(body?.usage?.output_tokens ?? body?.usage?.completion_tokens);
  return {
    inputTokens: Number.isFinite(input) && input >= 0 ? Math.round(input) : 0,
    outputTokens: Number.isFinite(output) && output >= 0 ? Math.round(output) : 0,
  };
}

function parseStructuredResult(body, style) {
  const text = extractCompatibleText(body, style);
  if (!text) throw new Error("The configured AI provider returned no text output.");

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error("The configured AI provider returned invalid JSON.");
  }

  return {
    body,
    text,
    parsed,
    style,
    usage: extractCompatibleUsage(body),
  };
}

function resolveApiStyle(requested, baseUrl) {
  if (requested === "responses" || requested === "chat-completions") return requested;
  if (requested !== "auto") {
    throw new Error("CLIPFORGE_AI_API_STYLE must be auto, responses, or chat-completions.");
  }

  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === "api.openai.com" || host.endsWith(".openai.com")) return "responses";
  } catch {
    // The request will later fail with the actual invalid endpoint error.
  }
  return "chat-completions";
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function providerHttpError(body, status, label) {
  const message =
    body?.error?.message ||
    body?.message ||
    `${label} returned HTTP ${status}.`;
  return new Error(String(message));
}

function stripJsonFence(value) {
  const text = String(value || "").trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return match ? match[1].trim() : text;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
