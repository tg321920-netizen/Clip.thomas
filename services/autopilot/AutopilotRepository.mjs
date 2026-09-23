import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

export class AutopilotRepository {
  async getConfig() {
    try {
      return JSON.parse(await readFile(this.#configPath(), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async saveConfig(config) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });

    const target = this.#configPath();
    const temp = path.join(
      directory,
      `.config.${process.pid}.${Date.now()}.tmp`,
    );

    await writeFile(temp, JSON.stringify(config, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });

    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }

    return config;
  }

  #directory() {
    return path.join(getStorageRoot(), "autopilot");
  }

  #configPath() {
    return path.join(this.#directory(), "config.json");
  }
}
