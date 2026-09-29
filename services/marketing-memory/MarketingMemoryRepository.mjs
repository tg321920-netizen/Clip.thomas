import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

export class MarketingMemoryRepository {
  async save(record) {
    const directory = getDirectory();
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${record.id}.json`);
    const temp = path.join(directory, `.${record.id}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" });
    try { await rename(temp, target); }
    catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
    return record;
  }

  async list(filters = {}) {
    const directory = getDirectory();
    await mkdir(directory, { recursive: true });
    const names = await readdir(directory);
    const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      try { return JSON.parse(await readFile(path.join(directory, name), "utf8")); } catch { return null; }
    }));
    return records.filter(Boolean).filter((record) => {
      if (filters.projectId && record.projectId !== filters.projectId) return false;
      if (filters.type && record.type !== filters.type) return false;
      if (filters.subjectId && record.subjectId !== filters.subjectId) return false;
      return true;
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}

function getDirectory() { return path.join(getStorageRoot(), "marketing-memory"); }
