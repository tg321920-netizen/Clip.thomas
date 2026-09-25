import path from "node:path";

export function getStorageRoot() {
  const configured = process.env.CLIPFORGE_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);

  // Vercel's deployed application directory (/var/task) is read-only at runtime.
  // Keep the local/Docker default for development and Render, but fall back to
  // the writable ephemeral /tmp filesystem when running on Vercel.
  if (process.env.VERCEL) return path.join("/tmp", "clipforge");

  return path.join(process.cwd(), "storage");
}

export function resolveStoragePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("Storage path is missing.");
  }

  const root = getStorageRoot();
  const normalized = relativePath.replaceAll("\\", "/").replace(/^storage\//, "");

  if (path.isAbsolute(normalized)) {
    throw new Error("Absolute storage paths are not allowed.");
  }

  const resolved = path.resolve(root, normalized);
  const rootWithSeparator = root.endsWith(path.sep) ? root : root + path.sep;

  if (resolved !== root && !resolved.startsWith(rootWithSeparator)) {
    throw new Error("Storage path escapes the configured root.");
  }

  return resolved;
}
