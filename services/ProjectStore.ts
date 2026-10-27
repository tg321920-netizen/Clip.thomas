import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertProjectDeletionSafe } from "@/lib/project-deletion-guard.mjs";
import { withLocalStateLock } from "@/lib/atomic-local-state.mjs";
import { getStorageRoot } from "@/services/StorageService";
import type { UploadedVideo } from "@/types/video";
import type { TranscriptRecord } from "@/types/transcription";
import type { ContentAnalysisRecord } from "@/types/analysis";
import type { ClipRecord } from "@/types/clip";
import type { NewsBrief } from "@/types/news";

export type ProjectRecord = {
  translationSettings?: { glossary: Array<{source:string;target:string}>; updatedAt?: string };
  id: string;
  createdAt: string;
  source: UploadedVideo & {
    relativePath: string;
  };
  transcript?: TranscriptRecord;
  analysis?: ContentAnalysisRecord;
  clips?: ClipRecord[];
  newsBrief?: NewsBrief;
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

  async list(limit = 20, {summariesOnly = false}: {summariesOnly?: boolean} = {}): Promise<ProjectRecord[]> {
    const projectsDir = getProjectsDir();
    await mkdir(projectsDir, { recursive: true });

    const entries = await readdir(projectsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);

    const records: (ProjectRecord|null)[] = [];
    // Never parse every long transcript at once just to show the mobile history.
    for(let offset=0;offset<files.length;offset+=2){
      const batch=await Promise.all(files.slice(offset,offset+2).map(async (filename) => {
        try {
          const raw = await readFile(path.join(projectsDir, filename), "utf8");
          const record=parseProject(raw);
          return summariesOnly&&record ? {id:record.id,createdAt:record.createdAt,source:record.source} : record;
        } catch {
          return null;
        }
      }));
      records.push(...batch);
    }

    return records
      .filter((record): record is ProjectRecord => record !== null)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 100)));
  }

  async delete(projectId: string): Promise<boolean> {
    const root = getStorageRoot();
    const metadataPath = path.join(getProjectsDir(), `${projectId}.json`);
    return withLocalStateLock(metadataPath, async () => {
    await assertProjectDeletionSafe(projectId, { root });
    let existed = true;

    try {
      await rm(metadataPath);
    } catch (error) {
      if (isNotFound(error)) existed = false;
      else throw error;
    }

    await Promise.all([
      rm(path.join(root, "uploads", projectId), { recursive: true, force: true }),
      rm(path.join(root, "clips", projectId), { recursive: true, force: true }),
      rm(path.join(root, "transcripts", projectId), { recursive: true, force: true }),
      rm(path.join(root, "news", projectId), { recursive: true, force: true }),
    ]);

    return existed;
    });
  }
}

function getProjectsDir(): string {
  return path.join(getStorageRoot(), "projects");
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
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
