import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot as resolveStorageRoot } from "@/lib/storage-paths.mjs";

export type StorageStatus = {
  writable: boolean;
  root: string;
  persistence: "PERSISTENT_PATH" | "EPHEMERAL_PATH" | "UNKNOWN";
  durable: boolean;
  warning?: string;
  error?: string;
};

export function getStorageRoot(): string {
  return resolveStorageRoot();
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const root = getStorageRoot();
  const durability = classifyStorageDurability(root);
  const healthDir = path.join(root, ".health");
  const healthFile = path.join(
    healthDir,
    `write-${process.pid}-${Date.now()}.tmp`,
  );

  try {
    await mkdir(healthDir, { recursive: true });
    await writeFile(healthFile, "ok", { encoding: "utf8", flag: "wx" });
    await rm(healthFile, { force: true });
    return {
      writable: true,
      root,
      persistence: durability.persistence,
      durable: durability.durable,
      ...(durability.warning ? { warning: durability.warning } : {}),
    };
  } catch (error) {
    return {
      writable: false,
      root,
      persistence: durability.persistence,
      durable: durability.durable,
      ...(durability.warning ? { warning: durability.warning } : {}),
      error: error instanceof Error ? error.message : "Storage no disponible.",
    };
  }
}

export function classifyStorageDurability(root: string) {
  const resolved = path.resolve(root);
  const normalized = resolved.replaceAll("\\", "/");

  if (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized.startsWith("/var/tmp/") ||
    normalized.includes("/.next/")
  ) {
    return {
      persistence: "EPHEMERAL_PATH" as const,
      durable: false,
      warning:
        "El almacenamiento es escribible pero temporal: un deploy o reemplazo de instancia puede borrar proyectos, jobs y renders. Configura CLIPFORGE_STORAGE_DIR sobre un volumen persistente para producción.",
    };
  }

  if (process.env.CLIPFORGE_STORAGE_DIR?.trim()) {
    return {
      persistence: "PERSISTENT_PATH" as const,
      durable: true,
      warning: undefined,
    };
  }

  return {
    persistence: "UNKNOWN" as const,
    durable: false,
    warning:
      "No se puede garantizar persistencia entre reemplazos de instancia sin un directorio persistente explícito.",
  };
}
