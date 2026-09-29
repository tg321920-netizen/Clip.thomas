import { parsePublicSourceUrl } from "../../lib/public-source-url.mjs";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

export async function extractPublicWebPage(urlValue, options = {}) {
  const parseUrl = options.parseUrl || parsePublicSourceUrl;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available in this runtime.");

  const maxBytes = clampInteger(options.maxBytes, 64 * 1024, 10 * 1024 * 1024, DEFAULT_MAX_BYTES);
  const timeoutMs = clampInteger(options.timeoutMs, 1000, 60_000, DEFAULT_TIMEOUT_MS);
  let current = await validateWebUrl(await parseUrl(urlValue));

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
          "User-Agent": "ClipForge/1.0 (+authorized-source-extraction)",
        },
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Web source request timed out.");
      throw new Error(`Could not fetch web source: ${compactError(error)}`);
    } finally {
      clearTimeout(timer);
    }

    if (isRedirect(response.status)) {
      if (redirectCount >= MAX_REDIRECTS) throw new Error("Web source exceeded redirect limit.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Web source redirect is missing Location header.");
      current = await validateWebUrl(await parseUrl(new URL(location, current).toString()));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Web source returned HTTP ${response.status}.`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error(`Unsupported web source content type: ${contentType || "unknown"}.`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error("Web source exceeds the configured extraction size limit.");
    }

    const raw = await readLimitedText(response, maxBytes);
    const isHtml = contentType.includes("text/html") || /<html[\s>]/i.test(raw);
    const title = isHtml ? extractTitle(raw) : null;
    const description = isHtml ? extractDescription(raw) : null;
    const text = normalizeWhitespace(isHtml ? htmlToText(raw) : raw);

    if (!text) throw new Error("Web source did not contain extractable text.");

    return {
      url: current.toString(),
      title,
      description,
      text,
      contentType: contentType || (isHtml ? "text/html" : "text/plain"),
      bytesRead: Buffer.byteLength(raw, "utf8"),
    };
  }

  throw new Error("Web source could not be resolved.");
}

async function validateWebUrl(url) {
  if (!(url instanceof URL)) url = new URL(String(url));
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("Webpage extraction only supports HTTP and HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }
  url.hash = "";
  return url;
}

async function readLimitedText(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("Web source exceeds the configured extraction size limit.");
    return buffer.toString("utf8");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Web source exceeds the configured extraction size limit.");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|hr)\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function extractTitle(html) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html));
  return match ? normalizeWhitespace(decodeEntities(match[1])).slice(0, 300) || null : null;
}

function extractDescription(html) {
  const source = String(html);
  const tags = source.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = attribute(tag, "name").toLowerCase();
    const property = attribute(tag, "property").toLowerCase();
    if (name !== "description" && property !== "og:description") continue;
    const content = normalizeWhitespace(decodeEntities(attribute(tag, "content")));
    if (content) return content.slice(0, 500);
  }
  return null;
}

function attribute(tag, name) {
  const expression = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = expression.exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => safeCodePoint(Number.parseInt(code, 16)));
}

function safeCodePoint(code) {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return " ";
  }
}

function normalizeWhitespace(value) {
  return String(value)
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function compactError(error) {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}
