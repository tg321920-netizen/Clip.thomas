import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "@/services/StorageService";
import type { UploadedVideo } from "@/types/video";
import type { TranscriptRecord } from "@/types/transcription";
import type { ContentAnalysisRecord } from "@/types/analysis";

export type ProjectRecord = {
  id: string;
  createdAt: string;
  source: UploadedVideo & {
    relativePath: string;
  };
  transcript?: TranscriptRecord;
  analysis?: ContentAnalysisRecord;
};

export class ProjectStore {
  async save(record: ProjectRecord): Promise<void> {
    const projectsDir = getProjectsDir();
    await mkdir(projectsDir, { recursive: true });

    const target = path.join(projectsDir, `${record.id}.json`);
    await writeFile(target, JSON.stringify(record, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
  }

  async list(limit = 20): Promise<ProjectRecord[]> {
    const projectsDir = getProjectsDir();
    await mkdir(projectsDir, { recursive: true });

    const entries = await readdir(projectsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);

    const records = await Promise.all(
      files.map(async (filename) => {
        try {
          const raw = await readFile(path.join(projectsDir, filename), "utf8");
          return parseProject(raw);
        } catch {
          return null;
        }
      }),
    );

    return records
      .filter((record): record is ProjectRecord => record !== null)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 100)));
  }
}

function getProjectsDir(): string {
  return path.join(getStorageRoot(), "projects");
}

function parseProject(raw: string): ProjectRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectRecord>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.createdAt !== "string" ||
      !parsed.source ||
      typeof parsed.source.projectId !== "string" ||
      typeof parsed.source.originalName !== "string"
    ) {
      return null;
    }
    return parsed as ProjectRecord;
  } catch {
    return null;
  }
}
