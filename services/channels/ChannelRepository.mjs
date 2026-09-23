import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

export class ChannelRepository {
  async list() {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });

    const names = await readdir(directory);
    const records = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            return JSON.parse(await readFile(path.join(directory, name), "utf8"));
          } catch {
            return null;
          }
        }),
    );

    return records
      .filter(Boolean)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async get(channelId) {
    assertId(channelId);
    try {
      return JSON.parse(await readFile(this.#path(channelId), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(record) {
    assertId(record?.id);
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });

    const target = this.#path(record.id);
    const temp = path.join(
      directory,
      `.${record.id}.${process.pid}.${Date.now()}.tmp`,
    );

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

  async delete(channelId) {
    assertId(channelId);
    await rm(this.#path(channelId), { force: true });
  }

  #directory() {
    return path.join(getStorageRoot(), "channels");
  }

  #path(channelId) {
    return path.join(this.#directory(), `${channelId}.json`);
  }
}

function assertId(value) {
  if (!isProjectId(value)) {
    throw new Error("Invalid channel id.");
  }
}
