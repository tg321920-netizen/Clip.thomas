import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot as resolveStorageRoot } from "@/lib/storage-paths.mjs";
import { classifyStorageDurability as classifyDurability } from "@/lib/storage-durability.mjs";

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

export function classifyStorageDurability(root: string): Pick<StorageStatus, "persistence" | "durable" | "warning"> {
  return classifyDurability(root) as Pick<StorageStatus, "persistence" | "durable" | "warning">;
}
