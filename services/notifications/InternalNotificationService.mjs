import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

const TYPES = new Set([
  "APPROVAL_REQUIRED",
  "APPROVAL_RESOLVED",
  "INFORMATION_REQUIRED",
  "ERROR",
  "INFO",
]);

export class InternalNotificationService {
  async list(filters = {}) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const names = await readdir(directory);
    const records = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map(async (name) => {
        try {
          return JSON.parse(await readFile(path.join(directory, name), "utf8"));
        } catch {
          return null;
        }
      }),
    );

    return records
      .filter(Boolean)
      .filter((record) => {
        if (filters.projectId && record.projectId !== filters.projectId) return false;
        if (filters.unread === true && record.readAt) return false;
        if (filters.type && record.type !== filters.type) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async create(input = {}) {
    const type = String(input.type || "INFO").trim().toUpperCase();
    if (!TYPES.has(type)) throw new Error("Unsupported notification type.");
    const projectId = optionalId(input.projectId, "project");
    const subjectId = optionalId(input.subjectId, "subject");
    const title = cleanText(input.title, 160);
    const message = cleanText(input.message, 1000);
    if (!title) throw new Error("Notification title is required.");
    if (!message) throw new Error("Notification message is required.");

    const record = {
      id: randomUUID(),
      projectId,
      type,
      title,
      message,
      subjectType: cleanText(input.subjectType, 80) || null,
      subjectId,
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    await this.#save(record);
    return record;
  }

  async markRead(notificationId) {
    const record = await this.#require(notificationId);
    if (record.readAt) return record;
    const updated = { ...record, readAt: new Date().toISOString() };
    await this.#save(updated);
    return updated;
  }

  async markUnread(notificationId) {
    const record = await this.#require(notificationId);
    if (!record.readAt) return record;
    const updated = { ...record, readAt: null };
    await this.#save(updated);
    return updated;
  }

  async #require(notificationId) {
    const id = normalizeId(notificationId, "notification");
    try {
      return JSON.parse(await readFile(this.#path(id), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error("Notification not found.");
      }
      throw error;
    }
  }

  async #save(record) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const target = this.#path(record.id);
    const temp = path.join(directory, `.${record.id}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, JSON.stringify(record, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    return record;
  }

  #directory() {
    return path.join(getStorageRoot(), "notifications", "internal");
  }

  #path(notificationId) {
    return path.join(this.#directory(), `${notificationId}.json`);
  }
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeId(value, label);
}

function normalizeId(value, label) {
  const id = String(value || "").trim();
  if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`);
  return id;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}
