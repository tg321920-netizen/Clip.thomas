import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UploadedVideo } from "@/types/video";

export type ProjectRecord = {
  id: string;
  createdAt: string;
  source: UploadedVideo & {
    relativePath: string;
  };
};

export class ProjectStore {
  async save(record: ProjectRecord): Promise<void> {
    const projectsDir = path.join(process.cwd(), "storage", "projects");
    await mkdir(projectsDir, { recursive: true });

    const target = path.join(projectsDir, `${record.id}.json`);
    await writeFile(target, JSON.stringify(record, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
  }
}
