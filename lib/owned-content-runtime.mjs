const DEFAULT_RUNTIME_URL = "https://clipforge-runtime-free.onrender.com";

export function getOwnedContentRuntimeUrl(env = process.env) {
  if (!String(env.VERCEL || "").trim()) return null;

  const candidate = String(env.CLIPFORGE_CONTENT_RUNTIME_URL || DEFAULT_RUNTIME_URL).trim();
  if (!candidate) return null;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("CLIPFORGE_CONTENT_RUNTIME_URL is invalid.");
  }

  if (url.protocol !== "https:") {
    throw new Error("CLIPFORGE_CONTENT_RUNTIME_URL must use HTTPS.");
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function ownedContentRuntimeHref(pathname = "/factory", searchParams = null, env = process.env) {
  const base = getOwnedContentRuntimeUrl(env);
  if (!base) return null;

  const url = new URL(pathname, base);
  if (searchParams && typeof searchParams === "object") {
    for (const [key, value] of Object.entries(searchParams)) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (item !== undefined && item !== null && String(item) !== "") {
          url.searchParams.append(key, String(item));
        }
      }
    }
  }
  return url.toString();
}
