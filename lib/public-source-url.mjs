import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "rtmp:", "rtmps:"]);

export async function parsePublicSourceUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("La URL no es válida.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error("Usa una URL HTTP(S), HLS, RTMP o RTMPS compatible.");
  }

  await assertPublicHost(url.hostname);
  return url;
}

export async function assertPublicHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized || normalized === "localhost" || normalized.endsWith(".local")) {
    throw new Error("No se permiten direcciones locales o internas.");
  }

  if (isIP(normalized)) {
    if (isPrivateAddress(normalized)) {
      throw new Error("No se permiten direcciones IP privadas o locales.");
    }
    return;
  }

  const addresses = await lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("El host debe resolver a una dirección pública.");
  }
}

export function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase();
  if (value === "::1" || value === "0.0.0.0" || value === "::") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));

  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
