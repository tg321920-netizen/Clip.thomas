import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type StorageStatus = {
  writable: boolean;
  root: string;
  error?: string;
};

export function getStorageRoot(): string {
  const configured = process.env.CLIPFORGE_STORAGE_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "storage");
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const root = getStorageRoot();
  const healthDir = path.join(root, ".health");
  const healthFile = path.join(
    healthDir,
    `write-${process.pid}-${Date.now()}.tmp`,
  );

  try {
    await mkdir(healthDir, { recursive: true });
    await writeFile(healthFile, "ok", { encoding: "utf8", flag: "wx" });
    await rm(healthFile, { force: true });
    return { writable: true, root };
  } catch (error) {
    return {
      writable: false,
      root,
      error: error instanceof Error ? error.message : "Storage no disponible.",
    };
  }
}
